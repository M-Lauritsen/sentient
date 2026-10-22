import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createSentientServer } from '../server.mjs';
import { createLifecycle, lifecycleHeaders } from '../desktop/lifecycle.mjs';

function controlledClock() {
	let now = 0;
	let id = 0;
	const timers = new Map();
	return {
		clock: () => now,
		setTimer(callback, ms) { const key = ++id; timers.set(key, { callback, at: now + ms }); return key; },
		clearTimer(key) { timers.delete(key); },
		advance(ms) {
			const end = now + ms;
			while (true) {
				const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!next) break;
				now = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
			}
			now = end;
		},
		jump(ms) { now += ms; },
		get timers() { return timers.size; },
	};
}

async function fixture(t, options = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-lifecycle-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const clock = controlledClock();
	const reasons = [];
	const lifecycle = createLifecycle({ ...clock, onStop: (reason) => reasons.push(reason), ...options });
	const app = createSentientServer({ activityRoot: root, port: 0, pollIntervalMs: 0, lifecycle });
	t.after(() => app.stop());
	const { port } = await app.start();
	const origin = `http://127.0.0.1:${port}`;
	lifecycle.start();
	const headers = lifecycleHeaders(origin);
	const sessionResponse = await raw(`${origin}/api/app-lifecycle/session`, { headers });
	assert.equal(sessionResponse.status, 200);
	const session = sessionResponse.body;
	return {
		app, clock, lifecycle, reasons, origin, headers, session,
		lease: (op, windowId = 'a'.repeat(22), changes = {}, extraHeaders = {}) =>
			raw(`${origin}/api/app-lifecycle/leases`, {
				method: 'POST',
				headers: {
					...headers, 'content-type': 'application/json', 'x-sentient-lifecycle-token': session.token,
					...extraHeaders,
				},
				body: JSON.stringify({ op, instanceId: session.instanceId, windowId, ...changes }),
			}),
	};
}

function raw(url, { method = 'GET', headers = {}, body, open } = {}) {
	return new Promise((resolve, reject) => {
		const request = httpRequest(url, { method, headers, agent: false }, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null });
			});
			response.on('error', reject);
		});
		request.on('error', reject);
		if (open) open(request);
		else request.end(body);
	});
}

test('owned bootstrap returns a bounded independent memory-only capability and no-store readiness', async (t) => {
	const f = await fixture(t);
	assert.deepEqual(Object.keys(f.session).sort(), ['heartbeatMs', 'instanceId', 'leaseTtlMs', 'protocol', 'token']);
	assert.equal(f.session.protocol, 1);
	assert.equal(f.session.heartbeatMs, 15_000);
	assert.equal(f.session.leaseTtlMs, 90_000);
	assert.match(f.session.instanceId, /^[A-Za-z0-9_-]{32}$/u);
	assert.match(f.session.token, /^[A-Za-z0-9_-]{43}$/u);
	const ready = await raw(`${f.origin}/api/app-lifecycle/ready`, { headers: f.headers });
	assert.deepEqual(ready.body, { protocol: 1, instanceId: f.session.instanceId, state: 'ready' });
	assert.equal(ready.headers['cache-control'], 'no-store');
	assert.equal(ready.headers['access-control-allow-origin'], undefined);
	assert.ok(JSON.stringify(f.session).length < 8192);
	const other = await fixture(t);
	assert.notEqual(other.session.token, f.session.token);
	assert.notEqual(other.session.instanceId, f.session.instanceId);
	const replay = await other.lease('register', 'a'.repeat(22), { instanceId: f.session.instanceId },
		{ 'x-sentient-lifecycle-token': f.session.token });
	assert.deepEqual(replay.body, { error: { code: 'FORBIDDEN' } });
});

test('first-window deadline is exact and rejected traffic never extends it', async (t) => {
	const f = await fixture(t);
	f.clock.advance(119_999);
	assert.equal(f.lifecycle.state, 'awaiting-first-window');
	assert.equal((await f.lease('register', 'invalid')).status, 400);
	f.clock.advance(1);
	assert.deepEqual(f.reasons, ['NO_PARTICIPATING_WINDOW']);
	assert.equal((await f.lease('register')).status, 503);
	assert.equal(f.clock.timers, 0);
});

test('renewal before TTL succeeds, renewal at TTL fails, and lost release stops after TTL plus empty grace', async (t) => {
	const f = await fixture(t);
	assert.equal((await f.lease('register')).status, 200);
	f.clock.advance(89_999);
	assert.equal((await f.lease('renew')).status, 200);
	f.clock.advance(90_000);
	assert.equal((await f.lease('renew')).status, 409);
	assert.equal(f.lifecycle.state, 'empty-grace');
	f.clock.advance(29_999);
	assert.deepEqual(f.reasons, []);
	f.clock.advance(1);
	assert.deepEqual(f.reasons, ['EMPTY']);
});

test('one remaining window keeps ownership alive and timely registration cancels empty grace', async (t) => {
	const f = await fixture(t);
	const a = 'a'.repeat(22);
	const b = 'b'.repeat(22);
	await f.lease('register', a);
	await f.lease('register', b);
	await f.lease('release', a);
	f.clock.advance(30_001);
	assert.equal(f.lifecycle.state, 'active');
	assert.deepEqual(f.reasons, []);
	await f.lease('renew', b);
	await f.lease('release', b);
	f.clock.advance(29_999);
	assert.equal((await f.lease('register', a)).status, 200);
	f.clock.advance(1);
	assert.equal(f.lifecycle.state, 'active');
	await f.lease('release', a);
	f.clock.advance(30_000);
	assert.equal((await f.lease('register', b)).status, 503, 'stop wins at the exact deadline');
	assert.deepEqual(f.reasons, ['EMPTY']);
});

test('duplicate register/release are idempotent and capacity is bounded at eight live leases', async (t) => {
	const f = await fixture(t);
	for (let i = 0; i < 8; i++) assert.equal((await f.lease('register', String(i).repeat(22))).status, 200);
	assert.equal((await f.lease('register', '0'.repeat(22))).status, 200);
	assert.equal((await f.lease('register', 'x'.repeat(22))).status, 429);
	await f.lease('release', '0'.repeat(22));
	assert.equal((await f.lease('release', '0'.repeat(22))).status, 200);
	assert.equal((await f.lease('register', 'x'.repeat(22))).status, 200);
	f.clock.advance(120_000);
	assert.deepEqual(f.reasons, ['EMPTY']);
});

test('delayed timer scheduling does not add another TTL/grace interval', async (t) => {
	const f = await fixture(t);
	await f.lease('register');
	f.clock.jump(120_001);
	assert.equal(f.lifecycle.state, 'stopping');
	assert.deepEqual(f.reasons, ['EMPTY']);
});

test('wall-clock jumps do not advance or postpone the monotonic first-window deadline', (t) => {
	let wall = 0;
	t.mock.method(Date, 'now', () => wall);
	const clock = controlledClock();
	const reasons = [];
	const lifecycle = createLifecycle({ ...clock, onStop: (reason) => reasons.push(reason) });
	lifecycle.start();
	wall += 1_000_000_000;
	assert.equal(lifecycle.state, 'awaiting-first-window');
	clock.advance(119_999);
	wall -= 2_000_000_000;
	assert.equal(lifecycle.state, 'awaiting-first-window');
	clock.advance(1);
	assert.deepEqual(reasons, ['NO_PARTICIPATING_WINDOW']);
	assert.equal(clock.timers, 0);
});

test('Host, Origin, fetch metadata and custom header guards reject cross-origin and navigation traffic', async (t) => {
	const f = await fixture(t);
	for (const changes of [
		{ host: 'evil.invalid' }, { origin: 'http://evil.invalid' },
		{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': undefined },
		{ 'sec-fetch-mode': 'navigate' }, { 'sec-fetch-dest': 'document' },
		{ 'x-sentient-lifecycle': undefined },
	]) {
		const headers = Object.fromEntries(Object.entries({ ...f.headers, ...changes }).filter(([, value]) => value !== undefined));
		const response = await raw(`${f.origin}/api/app-lifecycle/session`, { headers });
		assert.equal(response.status, 403);
		assert.deepEqual(response.body, { error: { code: 'FORBIDDEN' } });
		assert.equal(response.headers['cache-control'], 'no-store');
	}
	assert.equal((await raw(`${f.origin}/api/app-lifecycle/leases`, { method: 'OPTIONS', headers: f.headers })).status, 405);
	assert.equal((await f.lease('register', 'a'.repeat(22), {}, { origin: '' })).status, 403);
});

test('strict routes, methods, tokens, request shape and content type fail with bounded codes', async (t) => {
	const f = await fixture(t);
	assert.equal((await raw(`${f.origin}/api/app-lifecycle/session?token=not-allowed`, { headers: f.headers })).status, 404);
	const wrongMethod = await raw(`${f.origin}/api/app-lifecycle/leases`, { headers: f.headers });
	assert.equal(wrongMethod.status, 405);
	assert.equal(wrongMethod.headers.allow, 'POST');
	for (const token of ['', 'wrong', 'a'.repeat(43)]) {
		assert.equal((await f.lease('register', 'a'.repeat(22), {}, { 'x-sentient-lifecycle-token': token })).status, 403);
	}
	assert.equal((await f.lease('register', 'a'.repeat(22), { extra: 'not allowed' })).status, 400);
	assert.equal((await f.lease('shutdown')).status, 400);
	assert.equal((await f.lease('register', 'a'.repeat(22), { instanceId: 'x'.repeat(32) })).status, 409);
	assert.equal((await f.lease('register', 'a'.repeat(22), {}, { 'content-type': 'text/plain' })).status, 415);
	assert.equal(f.lifecycle.state, 'awaiting-first-window');
});

test('malformed UTF-8, JSON, declared oversized and chunked overflowing bodies never register leases', async (t) => {
	const f = await fixture(t);
	const headers = { ...f.headers, 'content-type': 'application/json', 'x-sentient-lifecycle-token': f.session.token };
	for (const [body, changes, status] of [
		['{', {}, 400],
		[Buffer.from([0xff, 0xfe]), {}, 400],
		['x'.repeat(2049), { 'content-length': '2049' }, 413],
		['x'.repeat(2049), { 'transfer-encoding': 'chunked' }, 413],
	]) {
		assert.equal((await raw(`${f.origin}/api/app-lifecycle/leases`, {
			method: 'POST', headers: { ...headers, ...changes }, body,
		})).status, status);
	}
	f.clock.advance(120_000);
	assert.deepEqual(f.reasons, ['NO_PARTICIPATING_WINDOW']);
});

test('slow bodies time out without pinning the server and in-flight excess is rejected', async (t) => {
	const f = await fixture(t, { limits: { requestMs: 50, maxInFlight: 2 } });
	const headers = { ...f.headers, 'content-type': 'application/json', 'x-sentient-lifecycle-token': f.session.token };
	let opened = 0;
	let resolveOpened;
	const bothOpen = new Promise((resolve) => { resolveOpened = resolve; });
	const hold = (request) => {
		request.flushHeaders();
		request.write('{');
		if (++opened === 2) resolveOpened();
	};
	const first = raw(`${f.origin}/api/app-lifecycle/leases`, { method: 'POST', headers, open: hold });
	const second = raw(`${f.origin}/api/app-lifecycle/leases`, { method: 'POST', headers, open: hold });
	await bothOpen;
	const excess = await f.lease('register');
	assert.equal(excess.status, 429);
	assert.equal((await first).status, 400);
	assert.equal((await second).status, 400);
	assert.equal(f.lifecycle.state, 'awaiting-first-window');
});

test('aborted bodies do not register a lease', async (t) => {
	const f = await fixture(t);
	await new Promise((resolve) => {
		const request = httpRequest(`${f.origin}/api/app-lifecycle/leases`, {
			method: 'POST',
			agent: false,
			headers: { ...f.headers, 'content-type': 'application/json', 'x-sentient-lifecycle-token': f.session.token },
		});
		request.on('error', () => resolve());
		request.on('socket', (socket) => socket.once('connect', () => {
			request.write('{"op":"register",');
			setImmediate(() => request.destroy());
		}));
	});
	f.clock.advance(120_000);
	assert.deepEqual(f.reasons, ['NO_PARTICIPATING_WINDOW']);
});

test('rolling request cap recovers after its window without extending first-window grace', async (t) => {
	const f = await fixture(t, { limits: { maxRequests: 3, rateWindowMs: 1000 } });
	assert.equal((await f.lease('register', 'invalid')).status, 400);
	assert.equal((await f.lease('register', 'invalid')).status, 400);
	assert.equal((await f.lease('register')).status, 429);
	f.clock.advance(1000);
	assert.equal((await f.lease('register')).status, 200);
});

test('ordinary server mode has no lifecycle endpoints and source cleanup is idempotent', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-manual-mode-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const app = createSentientServer({ activityRoot: root, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	for (const route of ['ready', 'session', 'leases']) {
		assert.equal((await raw(`http://127.0.0.1:${port}/api/app-lifecycle/${route}`)).status, 404);
	}
	await Promise.all([app.stop(), app.stop()]);
	assert.equal(app.source.stopped, true);
	assert.equal(app.source.timer, null);
});

test('SSE and Library do not receive the lifecycle capability and desktop modules are not public assets', async (t) => {
	const f = await fixture(t);
	const library = await raw(`${f.origin}/api/library/bootstrap`, { headers: f.headers });
	assert.equal(library.status, 200);
	assert.notEqual(library.body.token, f.session.token);
	assert.equal((await raw(`${f.origin}/desktop/launch.mjs`)).status, 404);
	const response = await fetch(`${f.origin}/events`, { headers: { origin: f.origin } });
	const reader = response.body.getReader();
	const text = new TextDecoder().decode((await reader.read()).value);
	assert.doesNotMatch(text, new RegExp(f.session.token, 'u'));
	assert.doesNotMatch(text, /app-lifecycle|windowId/u);
	await f.app.stop();
	await assert.rejects(reader.read(), TypeError, 'stop terminates active SSE connections');
});

test('bind failure cleans the partially started source without touching the existing listener', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-bind-cleanup-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const foreign = createServer((request, response) => response.end('alive'));
	await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise((resolve) => foreign.close(resolve)));
	const app = createSentientServer({ activityRoot: root, port: foreign.address().port, pollIntervalMs: 1000 });
	await assert.rejects(app.start(), { code: 'EADDRINUSE' });
	assert.equal(app.source.stopped, true);
	assert.equal(app.source.timer, null);
	assert.equal(foreign.listening, true);
	await app.stop();
});

test('stop closes acquired Library resources exactly once even when a resource close fails', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-resource-cleanup-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let closes = 0;
	const app = createSentientServer({
		activityRoot: root, port: 0, pollIntervalMs: 0,
		librarySourceFactory: () => ({
			async list() { throw Object.assign(new Error('synthetic unavailable'), { code: 'SOURCE_UNAVAILABLE' }); },
			close() { closes++; throw new Error('synthetic close failure'); },
		}),
	});
	const { port } = await app.start();
	const origin = `http://127.0.0.1:${port}`;
	const headers = lifecycleHeaders(origin);
	const bootstrap = await raw(`${origin}/api/library/bootstrap`, { headers });
	await raw(`${origin}/api/library`, { headers: { ...headers, 'x-sentient-library-token': bootstrap.body.token } });
	await assert.rejects(app.stop(), AggregateError);
	await assert.rejects(app.stop(), AggregateError);
	assert.equal(closes, 1);
	assert.equal(app.source.stopped, true);
	await assert.rejects(fetch(origin));
});
