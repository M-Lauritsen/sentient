import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { get as httpGet } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createSentientServer } from '../server.mjs';

async function temporaryDirectory(t, prefix) {
	const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

function pngChunks(buffer) {
	assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const chunks = [];
	for (let offset = 8; offset < buffer.length;) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		const data = buffer.subarray(offset + 8, offset + 8 + length);
		const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
		assert.equal(crc32(buffer.subarray(offset + 4, offset + 8 + length)), expectedCrc, `${type} CRC`);
		chunks.push({ type, data });
		offset += length + 12;
	}
	assert.equal(chunks.at(-1)?.type, 'IEND');
	return chunks;
}

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function assertDecodedPng(buffer, expectedSize) {
	const chunks = pngChunks(buffer);
	const header = chunks.find(({ type }) => type === 'IHDR')?.data;
	assert.ok(header, 'PNG has an image header');
	const width = header.readUInt32BE(0);
	const height = header.readUInt32BE(4);
	assert.equal(width, expectedSize);
	assert.equal(height, expectedSize);
	assert.equal(header[8], 8, 'uses 8-bit channels');
	assert.equal(header[9], 6, 'uses RGBA pixels');
	const pixels = inflateSync(Buffer.concat(chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data)));
	assert.equal(pixels.length, (width * 4 + 1) * height, 'decoded scanlines match the declared dimensions');
	for (let row = 0; row < height; row++) {
		assert.ok(pixels[row * (width * 4 + 1)] <= 4, `row ${row} has a valid PNG filter`);
	}
}

async function copyInstallabilityAssets(root) {
	await mkdir(path.join(root, 'icons'), { recursive: true });
	await Promise.all([
		['index.html', 'index.html'],
		['manifest.webmanifest', 'manifest.webmanifest'],
		['icons/pwa-192.png', 'icons/pwa-192.png'],
		['icons/pwa-512.png', 'icons/pwa-512.png'],
	].map(async ([source, destination]) => {
		const content = await readFile(new URL(`../${source}`, import.meta.url));
		await writeFile(path.join(root, destination), content);
	}));
}

test('PWA installability assets are valid, same-origin, explicit and independent of optional Library output', async (t) => {
	const activityRoot = await temporaryDirectory(t, 'sentient-pwa-activity-');
	const rootDir = await temporaryDirectory(t, 'sentient-pwa-root-');
	await copyInstallabilityAssets(rootDir);
	const app = createSentientServer({ activityRoot, rootDir, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
	assert.match(serverSource, /host\s*=\s*'127\.0\.0\.1'/u);
	assert.match(serverSource, /port\s*=\s*43187/u);
	assert.equal(await exists(path.join(rootDir, 'copilot', 'generated', 'library-markdown-worker.mjs')), false);

	const page = await fetch(`${base}/`);
	assert.equal(page.status, 200);
	assert.equal(page.headers.get('cache-control'), 'no-store');
	assert.match(page.headers.get('content-security-policy'), /img-src 'self'/u);
	const html = await page.text();
	assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/u);

	const response = await fetch(`${base}/manifest.webmanifest`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
	assert.equal(response.headers.get('cache-control'), 'no-store');
	const manifest = await response.json();
	assert.equal(manifest.id, '/');
	assert.equal(manifest.start_url, '/');
	assert.equal(manifest.scope, '/');
	assert.equal(manifest.name, 'SENTIENT OS');
	assert.equal(manifest.short_name, 'SENTIENT');
	assert.equal(manifest.display, 'standalone');
	assert.equal(manifest.prefer_related_applications, false);

	for (const field of ['id', 'start_url', 'scope']) {
		const url = new URL(manifest[field], base);
		assert.equal(url.origin, base);
		assert.equal(url.pathname, '/');
		assert.equal(url.username, '');
		assert.equal(url.password, '');
		assert.equal(url.search, '');
		assert.equal(url.hash, '');
	}
	assert.deepEqual(manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })), [
		{ src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
	]);
	for (const icon of manifest.icons) {
		const url = new URL(icon.src, base);
		assert.equal(url.origin, base);
		assert.equal(url.username, '');
		assert.equal(url.password, '');
		assert.equal(url.search, '');
		assert.equal(url.hash, '');
		const iconResponse = await fetch(url);
		assert.equal(iconResponse.status, 200);
		assert.equal(iconResponse.headers.get('content-type'), 'image/png');
		assert.equal(iconResponse.headers.get('cache-control'), 'no-store');
		assertDecodedPng(Buffer.from(await iconResponse.arrayBuffer()), Number.parseInt(icon.sizes, 10));
	}

	for (const asset of ['/manifest.webmanifest', '/icons/pwa-192.png', '/icons/pwa-512.png']) {
		const get = await fetch(`${base}${asset}`);
		const getBody = await get.arrayBuffer();
		const head = await fetch(`${base}${asset}`, { method: 'HEAD' });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-length'), String(getBody.byteLength));
		assert.equal(await head.text(), '');
		assert.equal(head.headers.get('cache-control'), 'no-store');
	}

	assert.equal(await statusWithHeaders(`${base}/icons/pwa-192.png`, { host: 'attacker.invalid' }), 403);
	assert.equal((await fetch(`${base}/manifest.webmanifest`, {
		headers: { origin: 'http://evil.invalid' },
	})).status, 403);
	assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
	assert.equal((await fetch(`${base}/icons/not-listed.png`)).status, 404);
	assert.equal((await fetch(`${base}/package.json`)).status, 404);

	const filesWithoutOfflineCaching = await Promise.all([
		'index.html', 'server.mjs', 'bootstrap.mjs', 'main.js', 'activity-client.mjs', 'copilot-library-ui.mjs',
	].map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
	assert.doesNotMatch(filesWithoutOfflineCaching.join('\n'), /serviceWorker|caches\.open/iu);
});

test('PWA icon route refuses a symlinked asset', async (t) => {
	const activityRoot = await temporaryDirectory(t, 'sentient-pwa-symlink-activity-');
	const rootDir = await temporaryDirectory(t, 'sentient-pwa-symlink-root-');
	const outside = await temporaryDirectory(t, 'sentient-pwa-symlink-outside-');
	await writeFile(path.join(rootDir, 'index.html'), '<!doctype html>');
	await writeFile(path.join(outside, 'pwa-192.png'), 'outside');
	await symlink(outside, path.join(rootDir, 'icons'), 'junction');
	const app = createSentientServer({ activityRoot, rootDir, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const response = await fetch(`http://127.0.0.1:${port}/icons/pwa-192.png`);
	assert.equal(response.status, 404);
});

async function exists(filePath) {
	try {
		await readFile(filePath);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

function statusWithHeaders(url, headers) {
	const target = new URL(url);
	return new Promise((resolve, reject) => {
		const request = httpGet({
			hostname: target.hostname,
			port: target.port,
			path: target.pathname,
			headers,
		}, (response) => {
			response.resume();
			response.on('end', () => resolve(response.statusCode));
		});
		request.on('error', reject);
	});
}
