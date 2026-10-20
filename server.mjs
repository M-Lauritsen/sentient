import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { LocalActivitySource } from './copilot/activity-source.mjs';
import { createLibrarySource } from './copilot/library-source.mjs';
import { projectActivity, projectSessionStats } from './activity-client.mjs';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_CLIENTS = 8;
const MAX_CLIENT_BUFFER = 128 * 1024;
const MAX_TREE_SESSIONS = 32;
const MAX_TREE_SUBAGENTS = 16;
const MAX_TREE_RETIREMENTS = 8;
const MAX_LIBRARY_REQUEST = 8 * 1024;
const MAX_LIBRARY_SNAPSHOT = 2 * 1024 * 1024;
const MAX_LIBRARY_SNAPSHOT_ENVELOPE = MAX_LIBRARY_SNAPSHOT + 256;
const MAX_LIBRARY_DETAIL = 512 * 1024;
const LIBRARY_REQUEST_TIMEOUT_MS = 15_000;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VENDOR_FILES = new Map([
	['/vendor/three.module.js', 'node_modules/three/build/three.module.js'],
	['/vendor/addons/controls/OrbitControls.js', 'node_modules/three/examples/jsm/controls/OrbitControls.js'],
	[
		'/vendor/addons/postprocessing/EffectComposer.js',
		'node_modules/three/examples/jsm/postprocessing/EffectComposer.js',
	],
	['/vendor/addons/postprocessing/RenderPass.js', 'node_modules/three/examples/jsm/postprocessing/RenderPass.js'],
	[
		'/vendor/addons/postprocessing/UnrealBloomPass.js',
		'node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js',
	],
	['/vendor/addons/postprocessing/OutputPass.js', 'node_modules/three/examples/jsm/postprocessing/OutputPass.js'],
	['/vendor/addons/postprocessing/Pass.js', 'node_modules/three/examples/jsm/postprocessing/Pass.js'],
	['/vendor/addons/postprocessing/MaskPass.js', 'node_modules/three/examples/jsm/postprocessing/MaskPass.js'],
	['/vendor/addons/postprocessing/ShaderPass.js', 'node_modules/three/examples/jsm/postprocessing/ShaderPass.js'],
	['/vendor/addons/shaders/CopyShader.js', 'node_modules/three/examples/jsm/shaders/CopyShader.js'],
	[
		'/vendor/addons/shaders/LuminosityHighPassShader.js',
		'node_modules/three/examples/jsm/shaders/LuminosityHighPassShader.js',
	],
	['/vendor/addons/shaders/OutputShader.js', 'node_modules/three/examples/jsm/shaders/OutputShader.js'],
]);
const STATIC_FILES = new Map([
	['/', ['index.html', 'text/html; charset=utf-8']],
	['/index.html', ['index.html', 'text/html; charset=utf-8']],
	['/favicon.jpg', ['favicon.jpg', 'image/jpeg']],
	['/main.js', ['main.js', 'text/javascript; charset=utf-8']],
	['/bootstrap.mjs', ['bootstrap.mjs', 'text/javascript; charset=utf-8']],
	['/visual-config.mjs', ['visual-config.mjs', 'text/javascript; charset=utf-8']],
	['/visual-settings-ui.mjs', ['visual-settings-ui.mjs', 'text/javascript; charset=utf-8']],
	['/visual-settings-worker.mjs', ['visual-settings-worker.mjs', 'text/javascript; charset=utf-8']],
	['/activity-client.mjs', ['activity-client.mjs', 'text/javascript; charset=utf-8']],
	['/activity-colors.mjs', ['activity-colors.mjs', 'text/javascript; charset=utf-8']],
	['/visual-settings.mjs', ['visual-settings.mjs', 'text/javascript; charset=utf-8']],
	['/session-stats-ui.mjs', ['session-stats-ui.mjs', 'text/javascript; charset=utf-8']],
	['/workspace-model.mjs', ['workspace-model.mjs', 'text/javascript; charset=utf-8']],
	['/workspace-ui.mjs', ['workspace-ui.mjs', 'text/javascript; charset=utf-8']],
	['/copilot-library-ui.mjs', ['copilot-library-ui.mjs', 'text/javascript; charset=utf-8']],
	['/copilot/library-markdown.mjs', ['copilot/library-markdown.mjs', 'text/javascript; charset=utf-8']],
	['/copilot/library-render-limits.mjs', ['copilot/library-render-limits.mjs', 'text/javascript; charset=utf-8']],
	['/copilot/library-text.mjs', ['copilot/library-text.mjs', 'text/javascript; charset=utf-8']],
	['/copilot/library-markdown-worker.mjs', ['copilot/generated/library-markdown-worker.mjs', 'text/javascript; charset=utf-8']],
	['/MARKED-LICENSE.txt', ['node_modules/marked/LICENSE.md', 'text/plain; charset=utf-8']],
	['/YAML-LICENSE.txt', ['node_modules/yaml/LICENSE', 'text/plain; charset=utf-8']],
	['/style.css', ['style.css', 'text/css; charset=utf-8']],
	['/THREE-LICENSE.txt', ['node_modules/three/LICENSE', 'text/plain; charset=utf-8']],
]);
const IMPORT_MAP_HASH = async () => {
	const html = await readFile(path.join(APP_ROOT, 'index.html'), 'utf8');
	const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
	if (!match) return '';
	// HTML parsing normalizes CRLF before checking inline-script hashes.
	return `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`;
};

function contentTypeFor(file, fallback) {
	if (fallback) return fallback;
	if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
	return 'application/octet-stream';
}

function sessionHandle(key, epochKey) {
	const digest = createHmac('sha256', epochKey).update(key).digest();
	let encoded = '';
	for (let char = 0; char < 6; char++) {
		const bitOffset = char * 5;
		const byteOffset = Math.floor(bitOffset / 8);
		const bitInByte = bitOffset % 8;
		const pair = (digest[byteOffset] << 8) | digest[byteOffset + 1];
		encoded += BASE32[(pair >>> (11 - bitInByte)) & 31];
	}
	return encoded;
}

function writeJson(response, status, value) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	});
	response.end(body);
}

const LIBRARY_HTTP_STATUS = new Map([
	['INVALID_REQUEST', 400], ['INVALID_PATH', 400], ['INVALID_MODE', 400], ['INVALID_ID', 400],
	['FORBIDDEN', 403], ['DEFAULT_ROOT', 403], ['UNSAFE_SOURCE', 403], ['SAFETY_UNSUPPORTED', 403],
	['NOT_FOUND', 404], ['DUPLICATE_ROOT', 409], ['OVERLAPPING_ROOT', 409],
	['SETTINGS_CONFLICT', 409], ['CONTENT_CHANGED', 409], ['LIMIT_EXCEEDED', 413],
	['UNSUPPORTED_CONTENT', 415], ['METHOD_NOT_ALLOWED', 405], ['BUSY', 503],
	['SETTINGS_UNAVAILABLE', 503], ['SOURCE_UNAVAILABLE', 503], ['TIMEOUT', 504],
]);
const LIBRARY_MESSAGES = new Map([
	['INVALID_REQUEST', 'The Library request is invalid.'],
	['INVALID_PATH', 'The selected folder path is not supported.'],
	['INVALID_MODE', 'Choose a supported Library folder mode and category.'],
	['INVALID_ID', 'The Library identifier is invalid.'],
	['FORBIDDEN', 'This Library request is not authorized.'],
	['DEFAULT_ROOT', 'The default Copilot source cannot be removed.'],
	['UNSAFE_SOURCE', 'The selected source could not be opened safely.'],
	['SAFETY_UNSUPPORTED', 'Verified Windows Library safety is unavailable.'],
	['NOT_FOUND', 'The Library item was not found. Refresh and select it again.'],
	['DUPLICATE_ROOT', 'This folder is already registered.'],
	['OVERLAPPING_ROOT', 'This folder overlaps another registered source.'],
	['SETTINGS_CONFLICT', 'Library settings changed elsewhere. Restart before retrying.'],
	['CONTENT_CHANGED', 'This file changed. Refresh and select it again.'],
	['LIMIT_EXCEEDED', 'A Library request or response exceeded its size limit.'],
	['UNSUPPORTED_CONTENT', 'The Library request content is not supported.'],
	['METHOD_NOT_ALLOWED', 'The method is not allowed for this Library route.'],
	['BUSY', 'The Library is busy. Try again shortly.'],
	['SETTINGS_UNAVAILABLE', 'Library registrations are unavailable. Repair settings and restart.'],
	['SOURCE_UNAVAILABLE', 'The Library source is temporarily unavailable.'],
	['TIMEOUT', 'The Library request timed out.'],
	['INTERNAL_ERROR', 'The Library request could not be completed.'],
]);
const libraryFailure = (code) => Object.assign(new Error(code), { code });
function writeLibraryError(response, code, allowedMethods) {
	const status = LIBRARY_HTTP_STATUS.get(code) ?? 500;
	if (allowedMethods) response.setHeader('Allow', allowedMethods);
	writeJson(response, status, {
		error: {
			code,
			message: LIBRARY_MESSAGES.get(code) ?? LIBRARY_MESSAGES.get('INTERNAL_ERROR'),
			retryable: ['BUSY', 'SETTINGS_CONFLICT', 'SOURCE_UNAVAILABLE', 'TIMEOUT'].includes(code),
		},
	});
}

function writeLibraryValue(response, status, value, maximum = MAX_LIBRARY_SNAPSHOT) {
	const body = JSON.stringify(value);
	if (Buffer.byteLength(body) > maximum) {
		writeLibraryError(response, 'LIMIT_EXCEEDED');
		return;
	}
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	});
	response.end(body);
}

function validLibraryToken(value, expected) {
	if (typeof value !== 'string') return false;
	const supplied = Buffer.from(value);
	const actual = Buffer.from(expected);
	return supplied.length === actual.length && timingSafeEqual(supplied, actual);
}

async function readLibraryJson(request, timeoutMs) {
	if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '') ||
		(request.headers['content-encoding'] && request.headers['content-encoding'].toLowerCase() !== 'identity')) {
		throw libraryFailure('UNSUPPORTED_CONTENT');
	}
	const declared = request.headers['content-length'];
	if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > MAX_LIBRARY_REQUEST)) {
		throw libraryFailure(Number(declared) > MAX_LIBRARY_REQUEST ? 'LIMIT_EXCEEDED' : 'INVALID_REQUEST');
	}
	const chunks = [];
	let bytes = 0;
	await new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			request.removeListener('data', onData);
			request.removeListener('end', onEnd);
			request.removeListener('aborted', onAborted);
			request.removeListener('error', onError);
			if (error) reject(error);
			else resolve();
		};
		const onData = (chunk) => {
			bytes += chunk.length;
			if (bytes > MAX_LIBRARY_REQUEST) {
				request.pause();
				finish(libraryFailure('LIMIT_EXCEEDED'));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => finish();
		const onAborted = () => finish(libraryFailure('INVALID_REQUEST'));
		const onError = () => finish(libraryFailure('INVALID_REQUEST'));
		const timer = setTimeout(() => {
			request.pause();
			finish(libraryFailure('TIMEOUT'));
		}, timeoutMs);
		request.on('data', onData);
		request.once('end', onEnd);
		request.once('aborted', onAborted);
		request.once('error', onError);
	});
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
	} catch {
		throw libraryFailure('INVALID_REQUEST');
	}
	try {
		const document = parseDocument(text, {
			schema: 'json',
			uniqueKeys: true,
			strict: true,
			prettyErrors: false,
			logLevel: 'silent',
		});
		if (document.errors.length || document.warnings.length) throw new Error();
		const value = JSON.parse(text);
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		return value;
	} catch {
		throw libraryFailure('INVALID_REQUEST');
	}
}

function exactLibraryFields(value, required, optional = []) {
	const allowed = new Set([...required, ...optional]);
	if (!required.every((key) => Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !allowed.has(key))) throw libraryFailure('INVALID_REQUEST');
}

const LIBRARY_ID = /^[A-Za-z0-9_-]{24,64}$/u;
function requireLibraryRevision(value) {
	if (typeof value !== 'string' || !LIBRARY_ID.test(value)) throw libraryFailure('INVALID_REQUEST');
}

export function createSentientServer({
	activityRoot,
	rootDir = APP_ROOT,
	host = '127.0.0.1',
	port = 43187,
	maxClients = MAX_CLIENTS,
	pollIntervalMs = 1000,
	libraryRequestTimeoutMs = LIBRARY_REQUEST_TIMEOUT_MS,
	libraryRoot,
	librarySettingsPath,
	librarySourceFactory = (options) => createLibrarySource(options),
} = {}) {
	if (host !== '127.0.0.1') throw new Error('SENTIENT OS binds to IPv4 loopback only');
	const source = new LocalActivitySource({ ...(activityRoot ? { root: activityRoot } : {}), pollIntervalMs });
	const clients = new Set();
	let streamSequence = 0;
	const streamEpoch = randomBytes(18).toString('base64url');
	const treeKey = randomBytes(32);
	const treeSid = (scope, value, used) => {
		for (let collision = 0; ; collision++) {
			const digest = createHmac('sha256', treeKey)
				.update(scope)
				.update('\0')
				.update(value)
				.update('\0')
				.update(String(collision))
				.digest();
			const first20Bits = (digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4);
			const sid = Array.from(
				{ length: 4 },
				(_, index) => BASE32_ALPHABET[(first20Bits >>> (15 - index * 5)) & 31],
			).join('');
			if (!used.has(sid)) {
				used.add(sid);
				return sid;
			}
		}
	};
	const streamEpochKey = randomBytes(32);
	let server;
	let expectedHost;
	let origin;
	let started = false;
	const libraryToken = randomBytes(32).toString('base64url');
	let librarySource;
	const getLibrarySource = () => {
		if (!librarySource) {
			librarySource = librarySourceFactory({
				...(libraryRoot === undefined ? {} : { defaultRoot: libraryRoot }),
				...(librarySettingsPath === undefined ? {} : { settingsPath: librarySettingsPath }),
			});
		}
		return librarySource;
	};

	const snapshot = (includeTree = true) => {
		const value = source.snapshot();
		const snapshotSessionSids = new Set();
		return {
			source: value.source,
			sourceStatus: value.sourceStatus,
			coverage: value.coverage,
			journalFiles: value.journalFiles,
			activeSessions: value.activeSessions,
			thinkingSessions: value.thinkingSessions,
			unknownSessions: value.unknownSessions,
			runningSessions: value.runningSessions,
			unverifiedRunningSessions: value.unverifiedRunningSessions,
			waitingSessions: value.waitingSessions,
			backlogFiles: value.backlogFiles,
			steps: value.steps,
			sessions: value.sessions.map(({ key, status, waitKind, elapsedMs, stats }) => {
				const projectedStats = projectSessionStats(stats);
				if (!projectedStats) throw new Error('Invalid session stats from activity source');
				return {
					id: sessionHandle(key, streamEpochKey),
					status,
					...(status === 'waiting' ? { waitKind } : {}),
					elapsedMs,
					stats: projectedStats,
				};
			}),
			sessionsTruncated: value.sessionsTruncated,
			hudSessions: value.hudSessions.map(({ key, status, elapsedMs, stats }) => {
				const projectedStats = projectSessionStats(stats);
				if (!projectedStats) throw new Error('Invalid HUD session stats from activity source');
				return {
					id: sessionHandle(key, streamEpochKey),
					status,
					elapsedMs,
					stats: projectedStats,
				};
			}),
			hudSessionsTruncated: value.hudSessionsTruncated,
			waitingSessionIds: value.waitingSessionKeys.map((key) => sessionHandle(key, streamEpochKey)),
			treeSessions: includeTree
				? value.treeSessions
						.slice(0, MAX_TREE_SESSIONS)
						.sort((a, b) => a.file.localeCompare(b.file))
						.map((session) => {
							const usedSessionSids = snapshotSessionSids;
							const sid = treeSid('session', session.file, usedSessionSids);
							const calls = new Map();
							const usedSubagentSids = new Set();
							for (const callId of [
								...new Set([
									...session.subagents.map((subagent) => subagent.callId),
									...session.retired.map((retirement) => retirement.callId),
								]),
							].sort()) {
								calls.set(callId, treeSid(`subagent:${session.file}`, callId, usedSubagentSids));
							}
							return {
								sid,
								status: ['running', 'waiting', 'stuck', 'quiet'].includes(session.status) ? session.status : 'quiet',
								subagents: session.subagents.slice(0, MAX_TREE_SUBAGENTS).map((subagent) => ({
									sid: calls.get(subagent.callId),
									ageMs: subagent.ageMs,
								})),
								subagentsMore: session.subagentsMore,
								retired: session.retired.slice(-MAX_TREE_RETIREMENTS).map((retirement) => ({
									sid: calls.get(retirement.callId),
									outcome: retirement.outcome,
								})),
							};
						})
				: undefined,
		};
	};

	const sendEvent = (response, name, data, id) => {
		const payload = JSON.stringify(data);
		const frame = `${id === undefined ? '' : `id: ${id}\n`}event: ${name}\ndata: ${payload}\n\n`;
		if (
			response.destroyed ||
			!response.writable ||
			response.writableLength + Buffer.byteLength(frame) > MAX_CLIENT_BUFFER
		) {
			response.destroy();
			clients.delete(response);
			return;
		}
		response.write(frame);
	};

	const sendSnapshot = (response) => {
		sendEvent(response, 'snapshot', { epoch: streamEpoch, sequence: streamSequence, snapshot: snapshot() });
	};

	const broadcastState = () => {
		for (const response of clients) sendSnapshot(response);
	};

	const broadcastActivity = (value) => {
		const activity = projectActivity(value);
		if (!activity) return;
		streamSequence++;
		const message = { epoch: streamEpoch, sequence: streamSequence, ...activity, snapshot: snapshot(false) };
		for (const response of clients) sendEvent(response, 'activity', message, streamSequence);
	};

	const handleLibrary = async (request, response, rawPath, rawUrl) => {
		const denied = () => writeLibraryError(response, 'FORBIDDEN');
		if (request.headers.origin !== undefined && request.headers.origin !== origin) return denied();
		if (request.headers['sec-fetch-site'] !== 'same-origin' ||
			request.headers['sec-fetch-mode'] !== 'same-origin' ||
			request.headers['sec-fetch-dest'] !== 'empty') return denied();
		if (rawUrl.includes('?')) {
			writeLibraryError(response, 'INVALID_REQUEST');
			return;
		}

		if (rawPath === '/api/library/bootstrap' && request.method === 'GET') {
			writeLibraryValue(response, 200, { token: libraryToken }, 1024);
			return;
		}
		if (!validLibraryToken(request.headers['x-sentient-library-token'], libraryToken)) return denied();

		let route, id;
		if (rawPath === '/api/library') route = 'list';
		else if (rawPath === '/api/library/bootstrap') route = 'bootstrap';
		else if (rawPath === '/api/library/refresh') route = 'refresh';
		else if (rawPath === '/api/library/roots') route = 'roots';
		else if ((id = rawPath.match(/^\/api\/library\/files\/([^/]+)$/u)?.[1]) !== undefined) route = 'detail';
		else if ((id = rawPath.match(/^\/api\/library\/roots\/([^/]+)$/u)?.[1]) !== undefined) route = 'root';
		else {
			writeLibraryError(response, 'NOT_FOUND');
			return;
		}
		const methods = {
			list: 'GET', bootstrap: 'GET', detail: 'GET', refresh: 'POST', roots: 'POST', root: 'DELETE',
		};
		const method = methods[route];
		if (request.method !== method) {
			writeLibraryError(response, 'METHOD_NOT_ALLOWED', method);
			return;
		}
		if (route === 'detail' || route === 'root') {
			if (!LIBRARY_ID.test(id)) {
				writeLibraryError(response, 'INVALID_ID');
				return;
			}
		}
		if (['refresh', 'roots', 'root'].includes(route) && request.headers.origin !== origin) return denied();
		try {
			if (route === 'bootstrap') {
				writeLibraryError(response, 'NOT_FOUND');
				return;
			}
			if (route === 'list') {
				writeLibraryValue(response, 200, await getLibrarySource().list());
				return;
			}
			if (route === 'detail') {
				writeLibraryValue(response, 200, await getLibrarySource().detail(id), MAX_LIBRARY_DETAIL);
				return;
			}

			const body = await readLibraryJson(request, libraryRequestTimeoutMs);
			if (route === 'refresh') {
				exactLibraryFields(body, ['revision']);
				requireLibraryRevision(body.revision);
				writeLibraryValue(response, 200, await getLibrarySource().refresh(body.revision));
			} else if (route === 'roots') {
				exactLibraryFields(body, ['revision', 'path', 'mode'], ['category']);
				requireLibraryRevision(body.revision);
				writeLibraryValue(response, 201, await getLibrarySource().register(body), MAX_LIBRARY_SNAPSHOT_ENVELOPE);
			} else {
				exactLibraryFields(body, ['revision']);
				requireLibraryRevision(body.revision);
				writeLibraryValue(
					response,
					200,
					await getLibrarySource().unregister(id, body.revision),
					MAX_LIBRARY_SNAPSHOT_ENVELOPE,
				);
			}
		} catch (error) {
			const code = LIBRARY_HTTP_STATUS.has(error?.code) ? error.code : 'INTERNAL_ERROR';
			if (!request.complete && !response.headersSent) {
				request.pause();
				response.shouldKeepAlive = false;
				response.setHeader('Connection', 'close');
			}
			writeLibraryError(response, code);
		}
	};

	source.on('change', broadcastState);
	source.on('activity', broadcastActivity);

	const handler = async (request, response) => {
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Referrer-Policy', 'no-referrer');
		response.setHeader('Cache-Control', 'no-store');
		const rawUrl = String(request.url || '');
		const rawPath = rawUrl.split('?')[0];
		const libraryRequest = rawPath.startsWith('/api/library');
		if (request.headers.host !== expectedHost) {
			if (libraryRequest) return writeLibraryError(response, 'FORBIDDEN');
			writeJson(response, 403, { error: 'forbidden' });
			return;
		}
		if (libraryRequest) {
			await handleLibrary(request, response, rawPath, rawUrl);
			return;
		}
		if (/%(?:2e|2f|5c|00)/i.test(rawPath) || rawPath.includes('\\') || rawPath.includes('\0')) {
			writeJson(response, 404, { error: 'not_found' });
			return;
		}
		const requestOrigin = request.headers.origin;
		if (requestOrigin !== undefined && requestOrigin !== origin) {
			writeJson(response, 403, { error: 'forbidden' });
			return;
		}
		const pageNavigation =
			(rawPath === '/' || rawPath === '/index.html') &&
			request.method === 'GET' &&
			request.headers['sec-fetch-mode'] === 'navigate' &&
			request.headers['sec-fetch-dest'] === 'document';
		if (request.headers['sec-fetch-site'] === 'cross-site' && !pageNavigation) {
			writeJson(response, 403, { error: 'forbidden' });
			return;
		}
		if (rawPath === '/events') {
			const fetchSite = request.headers['sec-fetch-site'];
			const badOrigin = requestOrigin !== undefined ? requestOrigin !== origin : fetchSite !== 'same-origin';
			if (request.method !== 'GET' || badOrigin || (fetchSite && fetchSite !== 'same-origin')) {
				writeJson(response, 403, { error: 'forbidden' });
				return;
			}
			if (clients.size >= maxClients) {
				writeJson(response, 429, { error: 'busy' });
				return;
			}
			response.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
			});
			response.flushHeaders?.();
			// A poll can be suspended between files with observed groups pending.
			// Deliver those only to existing subscribers before admitting this one;
			// its snapshot then establishes a watermark with no historical deltas.
			source.flushActivities();
			clients.add(response);
			response.on('close', () => clients.delete(response));
			sendSnapshot(response);
			return;
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			writeJson(response, 405, { error: 'method_not_allowed' });
			return;
		}
		const item = STATIC_FILES.get(rawPath);
		const vendorFile = VENDOR_FILES.get(rawPath);
		if (!item && !vendorFile) {
			writeJson(response, 404, { error: 'not_found' });
			return;
		}
		const relative = item?.[0] ?? vendorFile;
		const file = path.resolve(rootDir, relative);
		if (!file.startsWith(`${path.resolve(rootDir)}${path.sep}`)) {
			writeJson(response, 404, { error: 'not_found' });
			return;
		}
		try {
			let current = path.resolve(rootDir);
			const segments = path.relative(path.resolve(rootDir), file).split(path.sep);
			for (const [index, segment] of segments.entries()) {
				current = path.join(current, segment);
				const info = await lstat(current);
				if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) throw new Error('not_file');
				if (index === segments.length - 1 && !info.isFile()) throw new Error('not_file');
			}
			const body = await readFile(file);
			const importHash = await IMPORT_MAP_HASH();
			response.setHeader(
				'Content-Security-Policy',
				rawPath === '/copilot/library-markdown-worker.mjs'
					? "default-src 'none'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
					: `default-src 'self'; script-src 'self' ${importHash}; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
			);
			response.setHeader('Content-Type', contentTypeFor(file, item?.[1]));
			response.setHeader('Content-Length', body.length);
			response.writeHead(200);
			response.end(request.method === 'HEAD' ? undefined : body);
		} catch {
			writeJson(response, 404, { error: 'not_found' });
		}
	};

	return {
		source,
		async start() {
			if (started) return server.address();
			await source.start();
			server = createServer((request, response) => {
				handler(request, response).catch(() => {
					if (!response.headersSent) writeJson(response, 500, { error: 'internal_error' });
					else response.destroy();
				});
			});
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(port, host, () => {
					server.removeListener('error', reject);
					resolve();
				});
			});
			const address = server.address();
			expectedHost = `127.0.0.1:${address.port}`;
			origin = `http://${expectedHost}`;
			started = true;
			return address;
		},
		async stop() {
			if (!started) {
				await Promise.all([source.stop(), librarySource?.close()]);
				return;
			}
			for (const response of clients) response.destroy();
			clients.clear();
			const closed = new Promise((resolve) => server.close(() => resolve()));
			server.closeAllConnections?.();
			await closed;
			await Promise.all([source.stop(), librarySource?.close()]);
			started = false;
		},
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const portArg = process.argv.indexOf('--port');
	const requestedPort = portArg >= 0 ? Number(process.argv[portArg + 1]) : 43187;
	const app = createSentientServer({ host: '127.0.0.1', port: requestedPort });
	app
		.start()
		.then((address) => {
			process.stdout.write(`SENTIENT OS listening on http://127.0.0.1:${address.port} (local activity-file source)\n`);
		})
		.catch(() => {
			process.stderr.write('SENTIENT OS could not start. Check port availability and local source access.\n');
			process.exitCode = 1;
		});
	const shutdown = () => app.stop().finally(() => process.exit(0));
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
}
