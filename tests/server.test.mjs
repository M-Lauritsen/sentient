import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { get as httpGet, ServerResponse } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createSentientServer } from '../server.mjs';

async function fixture(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-http-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function record(type, data = {}) {
	return JSON.stringify({ id: `${type}-${Date.now()}`, type, data }) + '\n';
}

async function sseReader(base) {
	const response = await fetch(`${base}/events`, {
		headers: { origin: base },
		signal: AbortSignal.timeout(10_000),
	});
	assert.equal(response.status, 200);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let pending = '';
	return {
		cancel: () => reader.cancel(),
		async next() {
			while (!pending.includes('\n\n')) {
				const part = await reader.read();
				assert.equal(part.done, false, 'SSE stream must remain connected');
				pending += decoder.decode(part.value, { stream: true });
			}
			const boundary = pending.indexOf('\n\n') + 2;
			const frame = pending.slice(0, boundary);
			pending = pending.slice(boundary);
			return {
				frame,
				event: frame.match(/^event: (.+)$/m)[1],
				data: JSON.parse(frame.match(/^data: (.+)$/m)[1]),
			};
		},
	};
}

function fillWorstCaseStats(source) {
	for (const session of source.sessions.values()) {
		Object.assign(session.stats, {
			kinds: { thinking: 1e9, step: 1e9, completion: 1e9, activity: 1e9 },
			typeCounts: new Map(Array.from({ length: 10 }, (_, index) => [`type-${index}`.padEnd(128, 'a'), 1e9])),
			otherTypes: 1e9,
			toolCounts: new Map(Array.from({ length: 10 }, (_, index) => [`tool-${index}`.padEnd(128, 'a'), 1e9])),
			otherTools: 1e9,
			subagents: { started: 1e9, completed: 1e9, failed: 1e9 },
			errors: 1e9,
			runningMs: 1e9,
			unverifiedMs: 1e9,
			waitingMs: 1e9,
			turns: { count: 1e9, lastMs: 1e9, maxMs: 1e9, durations: Array(50).fill(1e9) },
		});
	}
}

async function captureSse(t, base) {
	let response;
	const flushHeaders = ServerResponse.prototype.flushHeaders;
	const mock = t.mock.method(ServerResponse.prototype, 'flushHeaders', function () {
		if (this.req.headers.host === new URL(base).host && this.req.url === '/events') response = this;
		return flushHeaders.call(this);
	});
	const reader = await sseReader(base);
	t.after(() => reader.cancel().catch(() => {}));
	const initial = await reader.next();
	mock.mock.restore();
	assert.ok(response);
	return { reader, response, initial };
}

test('healthy SSE reader receives an ordered grouped burst beyond 128KiB and subsequent activity', async (t) => {
	const activityRoot = await fixture(t);
	const files = Array.from({ length: 32 }, (_, index) => path.join(activityRoot, `session-${index}`, 'events.jsonl'));
	for (const file of files) {
		await mkdir(path.dirname(file));
		await writeFile(file, '');
	}
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	for (const file of files) await appendFile(file, record('assistant.turn_start'));
	await app.source.poll();
	const reader = await sseReader(`http://127.0.0.1:${port}`);
	t.after(() => reader.cancel().catch(() => {}));
	const initial = await reader.next();
	assert.equal(initial.event, 'snapshot');
	const accepted = [];
	app.source.on('activity', (value) => accepted.push({
		eventType: value.eventType,
		count: value.count,
		steps: app.source.snapshot().steps,
	}));
	// Read concurrently with polling: this is a healthy consumer, not a paused socket.
	const received = [];
	const consume = (async () => {
		while (received.length < 65) {
			const message = await reader.next();
			if (message.event === 'activity') received.push(message);
		}
	})();
	// Attach a rejection handler immediately; assert the original error after polling.
	consume.catch(() => {});
	await appendFile(files[0], Array.from({ length: 64 }, (_, index) =>
		Array.from({ length: 3 }, (_, repeat) => JSON.stringify({
			id: `burst-${index}-${repeat}`, type: `future.burst.${index}`, data: { content: 'PRIVATE' },
		}) + '\n').join('')).join(''));
	await app.source.poll();
	await appendFile(files[0], record('future.after_burst'));
	await app.source.poll();
	await consume;
	assert.equal(accepted.length, 65);
	assert.deepEqual(accepted.map(({ eventType, count }) => ({ eventType, count })), [
		...Array.from({ length: 64 }, (_, index) => ({ eventType: `future.burst.${index}`, count: 3 })),
		{ eventType: 'future.after_burst', count: undefined },
	]);
	assert.deepEqual(received.map(({ data }) => ({
		eventType: data.eventType, count: data.count, steps: data.snapshot.steps,
	})), accepted);
	assert.ok(received.slice(0, 64).reduce((bytes, { frame }) => bytes + Buffer.byteLength(frame), 0) > 128 * 1024);
	assert.deepEqual(received.map(({ data }) => data.sequence),
		Array.from({ length: 65 }, (_, index) => initial.data.sequence + index + 1));
	for (const { data, frame } of received) {
		assert.equal(data.epoch, initial.data.epoch);
		assert.match(frame, new RegExp(`^id: ${data.sequence}\\n`));
		assert.doesNotMatch(frame, /PRIVATE|events\.jsonl|session-0/);
	}
	assert.ok(received.slice(0, 64).every(({ data }) => data.count === 3));
	assert.equal(received.at(-1).data.eventType, 'future.after_burst');
});

test('server-side activity projection does not import browser visual settings', async () => {
	const [server, client] = await Promise.all([
		readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../activity/activity-client.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(server, /from '\.\/activity\/activity-client\.mjs'/);
	assert.doesNotMatch(client, /from ['"][^'"]*visual-settings\.mjs['"]/);
});

test('scene and presentation modules are explicitly served without exposing adjacent files', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	for (const module of ['scene/network.mjs', 'scene/structural-config.mjs',
		'scene/network-renderer.mjs', 'scene/pulses.mjs', 'scene/subagents.mjs',
		'scene/ambience.mjs', 'scene/viewport.mjs', 'scene/appearance.mjs',
		'activity/activity-presentation.mjs', 'ui/hud-ui.mjs', 'network-topology-design/index.mjs',
		'network-topology-design/lattice.mjs', 'network-topology-design/organic.mjs',
		'network-topology-design/waves.mjs', 'network-topology-design/dna.mjs']) {
		const response = await fetch(`${base}/${module}`);
		assert.equal(response.status, 200, module);
		assert.match(response.headers.get('content-type'), /^text\/javascript/);
		assert.equal(await response.text(), await readFile(new URL(`../${module}`, import.meta.url), 'utf8'));
	}
	for (const unlisted of ['/scene/unlisted.mjs', '/network-topology-design/unlisted.mjs',
		'/visual-settings_copy.mjs', '/tests/network-topology.test.mjs']) {
		assert.equal((await fetch(`${base}${unlisted}`)).status, 404, unlisted);
	}
});

test('organized modules and legacy URLs serve the same code with resolvable browser dependencies', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const modules = {
		activity: ['activity-client', 'activity-colors', 'activity-presentation', 'demo-activity'],
		appearance: ['visual-config', 'visual-settings-ui', 'visual-settings-preview', 'visual-settings-worker'],
		ui: ['hud-ui', 'navigation-ui', 'session-stats-ui'],
		workspace: ['workspace-model', 'workspace-ui'],
		library: ['copilot-library-ui'],
		lifecycle: ['pwa-lifecycle-client'],
	};
	const pending = ['/bootstrap.mjs', '/main.js', '/visual-settings.mjs'];
	for (const [folder, names] of Object.entries(modules)) {
		for (const name of names) {
			const canonical = `/${folder}/${name}.mjs`;
			const legacy = `/${name}.mjs`;
			const expected = await readFile(new URL(`..${canonical}`, import.meta.url), 'utf8');
			for (const url of [canonical, legacy]) {
				const response = await fetch(`${base}${url}`);
				assert.equal(response.status, 200, url);
				assert.match(response.headers.get('content-type'), /^text\/javascript/, url);
				assert.equal(await response.text(), expected, url);
				pending.push(url);
			}
		}
		assert.equal((await fetch(`${base}/${folder}/unlisted.mjs`)).status, 404);
	}
	const checked = new Set();
	while (pending.length) {
		const url = pending.pop();
		if (checked.has(url)) continue;
		checked.add(url);
		const response = await fetch(`${base}${url}`);
		assert.equal(response.status, 200, url);
		const source = await response.text();
		for (const match of source.matchAll(/(?:^\s*(?:import|export)\s+(?:\{[^}]*\}|\*[^;\n]*|[A-Za-z_$][\w$]*)\s+from\s*|\bimport\s*\(\s*|\bnew URL\(\s*)['"](\.{1,2}\/[^'"]+\.(?:mjs|js))['"]/gm)) {
			pending.push(new URL(match[1], `${base}${url}`).pathname);
		}
	}
	assert.equal((await fetch(`${base}/visual-settings_copy.mjs`)).status, 404);
});

test('SSE session projection uses stable opaque ids and excludes internal keys', async (t) => {
	const activityRoot = await fixture(t);
	const directory = 'private-session-dir';
	await mkdir(path.join(activityRoot, directory));
	await writeFile(path.join(activityRoot, directory, 'events.jsonl'), '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const connect = () => fetch(`${base}/events`, { headers: { origin: base } });
	const readSnapshot = async () => {
		const response = await connect();
		const reader = response.body.getReader();
		const payload = new TextDecoder().decode((await reader.read()).value);
		await reader.cancel();
		const json = JSON.parse(payload.match(/data: (.+)\n\n/)[1]);
		return { json, payload };
	};
	const first = await readSnapshot();
	const sessions = first.json.snapshot.sessions;
	assert.equal(sessions.length, 1);
	assert.match(sessions[0].id, /^[A-Z2-7]{6}$/);
	assert.deepEqual(Object.keys(sessions[0]).sort(), ['elapsedMs', 'id', 'stats', 'status']);
	assert.equal(sessions[0].status, 'idle');
	assert.deepEqual(sessions[0].stats.kinds, { thinking: 0, step: 0, completion: 0, activity: 0 });
	assert.equal(first.json.snapshot.sessionsTruncated, false);
	assert.deepEqual(first.json.snapshot.hudSessions, []);
	assert.equal(first.json.snapshot.hudSessionsTruncated, false);
	assert.deepEqual(first.json.snapshot.waitingSessionIds, []);
	assert.equal(first.json.snapshot.waitingSessions, 0);
	assert.doesNotMatch(
		first.payload,
		/private-session-dir|events\.jsonl|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
	);
	const second = await readSnapshot();
	assert.equal(second.json.snapshot.sessions[0].id, sessions[0].id);
	await appendFile(
		path.join(activityRoot, directory, 'events.jsonl'),
		record('assistant.turn_start', { turnId: 'live' }),
	);
	await app.source.poll();
	const third = await readSnapshot();
	assert.equal(third.json.snapshot.hudSessions.length, 1);
	assert.equal(third.json.snapshot.hudSessions[0].status, 'running');
	assert.equal(third.json.snapshot.hudSessions[0].id, sessions[0].id);
	assert.deepEqual(Object.keys(third.json.snapshot.hudSessions[0]).sort(), ['elapsedMs', 'id', 'stats', 'status']);
});

test('SSE projects only bounded wait fields for waiting sessions', async (t) => {
	const activityRoot = await fixture(t);
	const directory = 'private-wait-session';
	await mkdir(path.join(activityRoot, directory));
	const file = path.join(activityRoot, directory, 'events.jsonl');
	await writeFile(file, '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const response = await fetch(`${base}/events`, { headers: { origin: base } });
	const reader = response.body.getReader();
	let payload = new TextDecoder().decode((await reader.read()).value);
	await appendFile(
		file,
		record('permission.requested', { permissionId: 'private-permission-id' }) +
			record('user_input.requested', { requestId: 'private-input-id' }) +
			record('elicitation.requested', { requestId: 'private-elicitation-id' }) +
			record('assistant.message', { content: 'PRIVATE' }),
	);
	await app.source.poll();
	const eventFrames = () => payload.split('\n\n');
	while (
		eventFrames().filter((event) => event.startsWith('event: snapshot')).length < 2 ||
		eventFrames().filter(
			(event) => event.includes('event: activity') && event.includes('"eventType":"assistant.message"'),
		).length < 1
	) {
		const part = await reader.read();
		assert.equal(part.done, false);
		payload += new TextDecoder().decode(part.value);
	}
	const snapshots = () =>
		eventFrames()
			.filter((event) => event.startsWith('event: snapshot'))
			.map((event) => JSON.parse(event.match(/data: (.+)/)[1]));
	assert.equal(snapshots().at(-1).snapshot.waitingSessions, 1);
	assert.equal(snapshots().at(-1).snapshot.sessions[0].status, 'waiting');
	assert.equal(snapshots().at(-1).snapshot.sessions[0].waitKind, 'both');
	assert.deepEqual(snapshots().at(-1).snapshot.waitingSessionIds, [snapshots().at(-1).snapshot.sessions[0].id]);
	assert.deepEqual(snapshots().at(-1).snapshot.hudSessions, []);

	await appendFile(
		file,
		record('permission.completed', { permissionId: 'private-permission-id' }) +
			record('user_input.completed', { requestId: 'private-input-id' }) +
			record('elicitation.completed', { requestId: 'private-elicitation-id' }) +
			record('assistant.message', { content: 'PRIVATE AGAIN' }),
	);
	await app.source.poll();
	while (
		eventFrames().filter((event) => event.startsWith('event: snapshot')).length < 3 ||
		eventFrames().filter(
			(event) => event.includes('event: activity') && event.includes('"eventType":"assistant.message"'),
		).length < 2
	) {
		const part = await reader.read();
		assert.equal(part.done, false);
		payload += new TextDecoder().decode(part.value);
	}
	const activities = eventFrames()
		.filter((event) => event.includes('event: activity'))
		.map((event) => JSON.parse(event.match(/data: (.+)/)[1]));
	assert.deepEqual(
		activities.map(({ eventType }) => eventType),
		['assistant.message', 'assistant.message'],
	);
	assert.doesNotMatch(
		payload,
		/permission\.(?:requested|completed)|user_input\.(?:requested|completed)|elicitation\.(?:requested|completed)/,
	);
	assert.equal(snapshots().at(-1).snapshot.waitingSessions, 0);
	assert.deepEqual(snapshots().at(-1).snapshot.waitingSessionIds, []);
	assert.notEqual(snapshots().at(-1).snapshot.sessions[0].status, 'waiting');
	assert.deepEqual(Object.keys(snapshots()[1].snapshot.sessions[0]).sort(), [
		'elapsedMs',
		'id',
		'stats',
		'status',
		'waitKind',
	]);
	assert.doesNotMatch(payload, /private-wait-session|private-permission-id|events\.jsonl/);
	await reader.cancel();
});

test('SSE exposes bounded session stats without journal identifiers or private event content', async (t) => {
	const activityRoot = await fixture(t);
	const directory = 'private-stats-session';
	await mkdir(path.join(activityRoot, directory));
	const file = path.join(activityRoot, directory, 'events.jsonl');
	await writeFile(file, '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	await appendFile(
		file,
		record('assistant.turn_start', { turnId: 'private-turn' }) +
			record('assistant.message', { content: 'PRIVATE MESSAGE' }) +
			record('tool.execution_start', {
				toolCallId: 'private-call',
				toolName: 'functions.view',
				arguments: 'PRIVATE ARGUMENTS',
			}) +
			record('subagent.started', { toolCallId: 'private-subagent-call' }) +
			record('subagent.completed', { toolCallId: 'private-subagent-call' }) +
			record('session.error', { message: 'PRIVATE ERROR' }),
	);
	await app.source.poll();
	const base = `http://127.0.0.1:${port}`;
	const response = await fetch(`${base}/events`, { headers: { origin: base } });
	const reader = response.body.getReader();
	const payload = new TextDecoder().decode((await reader.read()).value);
	await reader.cancel();
	const message = JSON.parse(payload.match(/data: (.+)\n\n/)[1]);
	const stats = message.snapshot.sessions[0].stats;
	assert.deepEqual(stats.kinds, { thinking: 1, step: 1, completion: 0, activity: 4 });
	assert.deepEqual(stats.tools, [['functions.view', 1]]);
	assert.deepEqual(stats.subagents, { started: 1, completed: 1, failed: 0 });
	assert.equal(stats.errors, 1);
	assert.doesNotMatch(
		payload,
		/PRIVATE|private-stats-session|private-turn|private-call|private-subagent-call|events\.jsonl/,
	);
});

test('worst-case stats snapshot for 32 sessions stays within the SSE buffer bound', async (t) => {
	const activityRoot = await fixture(t);
	for (let index = 0; index < 32; index++) {
		const directory = path.join(activityRoot, `session-${index}`);
		await mkdir(directory);
		await writeFile(path.join(directory, 'events.jsonl'), '');
	}
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	fillWorstCaseStats(app.source);
	const response = await fetch(`http://127.0.0.1:${port}/events`, {
		headers: { origin: `http://127.0.0.1:${port}` },
		signal: AbortSignal.timeout(3000),
	});
	const reader = response.body.getReader();
	let payload = '';
	while (!payload.includes('\n\n')) {
		const chunk = await reader.read();
		assert.equal(chunk.done, false);
		payload += new TextDecoder().decode(chunk.value);
	}
	assert.equal(response.status, 200);
	assert.match(payload, /event: snapshot/);
	assert.ok(Buffer.byteLength(payload) < 128 * 1024);

	app.source.emit('activity', { kind: 'activity', eventType: 'overflow.test' });
	app.source.emit('activity', { kind: 'activity', eventType: 'overflow.test' });
	let activityText = '';
	while ((activityText.match(/event: activity/g) ?? []).length < 2 || !activityText.endsWith('\n\n')) {
		const chunk = await reader.read();
		assert.equal(chunk.done, false);
		activityText += new TextDecoder().decode(chunk.value);
	}
	const activities = activityText.trim().split('\n\n').map((frame) => JSON.parse(frame.match(/data: (.+)/)[1]));
	assert.equal(activities.length, 2);
	assert.deepEqual(activities.map(({ sequence }) => sequence), [1, 2]);
	assert.ok(Buffer.byteLength(activityText) > 128 * 1024);
	for (const { snapshot } of activities) assert.equal(snapshot.sessions.length, 32);
	await reader.cancel();
});

test('SSE FIFO captures emission-time state and gates each turn on both callback and drain', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const { response } = await captureSse(t, `http://127.0.0.1:${port}`);
	const writes = [];
	t.mock.method(response, 'write', (frame, callback) => {
		writes.push({ frame, callback });
		return false;
	});
	app.source.steps = 11;
	app.source.emit('activity', { kind: 'activity', eventType: 'fifo.first' });
	app.source.steps = 22;
	app.source.emit('activity', { kind: 'activity', eventType: 'fifo.second' });
	app.source.emit('change');
	app.source.steps = 33;
	assert.equal(writes.length, 0, 'emission must not write synchronously');
	await nextTurn();
	assert.equal(writes.length, 1);
	writes[0].callback();
	await nextTurn();
	assert.equal(writes.length, 1, 'callback alone does not release write(false)');
	response.emit('drain');
	response.emit('drain');
	await nextTurn();
	assert.equal(writes.length, 2, 'duplicate drains must not schedule duplicate writes');
	response.emit('drain');
	await nextTurn();
	assert.equal(writes.length, 2, 'drain alone does not release the outstanding callback');
	writes[1].callback();
	await nextTurn();
	assert.equal(writes.length, 3);
	const frames = writes.map(({ frame }) => frame.toString());
	assert.deepEqual(frames.map((frame) => frame.match(/event: (.+)/)[1]), ['activity', 'activity', 'snapshot']);
	const values = frames.map((frame) => JSON.parse(frame.match(/data: (.+)/)[1]));
	assert.deepEqual(values.map(({ snapshot }) => snapshot.steps), [11, 22, 22]);
	assert.deepEqual(values.map(({ sequence }) => sequence), [1, 2, 2]);
	writes[2].callback();
	response.emit('drain');
	await nextTurn();
	assert.equal(writes.length, 3, 'no accepted write is retried');
});

test('new SSE admission excludes frames still queued for an existing subscriber', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0, maxClients: 2 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const { response } = await captureSse(t, base);
	const writes = t.mock.method(response, 'write', () => false);
	app.source.emit('activity', { kind: 'activity', eventType: 'before.admission.first' });
	app.source.emit('activity', { kind: 'completion', eventType: 'session.task_complete' });
	await nextTurn();
	assert.equal(writes.mock.callCount(), 1, 'one frame remains in flight and another in the FIFO');
	const newcomer = await sseReader(base);
	t.after(() => newcomer.cancel().catch(() => {}));
	const initial = await newcomer.next();
	assert.equal(initial.event, 'snapshot');
	assert.equal(initial.data.sequence, 2);
	app.source.emit('activity', { kind: 'activity', eventType: 'after.admission' });
	const live = await newcomer.next();
	assert.equal(live.event, 'activity');
	assert.equal(live.data.sequence, 3);
	assert.equal(live.data.eventType, 'after.admission');
	assert.equal(live.data.epoch, initial.data.epoch);
});

test('paused real SSE reader overflows only its bounded FIFO while a healthy reader continues', async (t) => {
	const activityRoot = await fixture(t);
	for (let index = 0; index < 32; index++) {
		const directory = path.join(activityRoot, `session-${index}`);
		await mkdir(directory);
		await writeFile(path.join(directory, 'events.jsonl'), '');
	}
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0, maxClients: 2 });
	t.after(() => app.stop());
	const { port } = await app.start();
	fillWorstCaseStats(app.source);
	const base = `http://127.0.0.1:${port}`;
	let stalled;
	const flushHeaders = ServerResponse.prototype.flushHeaders;
	const capture = t.mock.method(ServerResponse.prototype, 'flushHeaders', function () {
		if (this.req.url === '/events' && this.req.headers.host === `127.0.0.1:${port}`) stalled = this;
		return flushHeaders.call(this);
	});
	const request = httpGet(`${base}/events`, { headers: { origin: base } });
	t.after(() => request.destroy());
	await new Promise((resolve, reject) => {
		request.once('error', reject);
		request.once('response', (response) => {
			// IncomingMessage stays paused: no data listener, resume, or body reads.
			response.on('error', (error) => assert.equal(error.code, 'ECONNRESET'));
			resolve();
		});
	});
	capture.mock.restore();
	assert.ok(stalled);
	const healthy = await sseReader(base);
	t.after(() => healthy.cancel().catch(() => {}));
	await healthy.next();
	assert.equal((await fetch(`${base}/events`, { headers: { origin: base } })).status, 429);
	let writtenBytes = 0;
	let outstanding = 0;
	let maximumOutstanding = 0;
	const write = stalled.write;
	t.mock.method(stalled, 'write', function (frame, callback) {
		writtenBytes += frame.length;
		maximumOutstanding = Math.max(maximumOutstanding, ++outstanding);
		return write.call(this, frame, (error) => {
			outstanding--;
			callback(error);
		});
	});
	let publishedBytes = 0;
	let disconnectedAt = 0;
	for (let index = 0; index < 512; index++) {
		app.source.emit('activity', { kind: 'activity', eventType: 'stalled.test' });
		const message = await healthy.next();
		assert.equal(message.event, 'activity');
		assert.equal(message.data.sequence, index + 1);
		publishedBytes += Buffer.byteLength(message.frame);
		const queuedBytes = publishedBytes - writtenBytes;
		if (stalled.destroyed) {
			assert.ok(queuedBytes > 8 * 1024 * 1024, 'disconnect occurs when the next frame exceeds the FIFO budget');
			assert.ok(queuedBytes - Buffer.byteLength(message.frame) <= 8 * 1024 * 1024);
			disconnectedAt = index + 1;
			break;
		}
		assert.ok(queuedBytes <= 8 * 1024 * 1024, 'retained FIFO stays within 8MiB');
	}
	assert.ok(disconnectedAt > 0, 'a genuinely unread stream must eventually be disconnected');
	assert.equal(maximumOutstanding, 1);
	assert.equal(stalled.listenerCount('drain'), 0);
	app.source.emit('activity', { kind: 'activity', eventType: 'healthy.after_overflow' });
	assert.equal((await healthy.next()).data.eventType, 'healthy.after_overflow');
	const replacement = await sseReader(base);
	t.after(() => replacement.cancel().catch(() => {}));
	assert.equal((await replacement.next()).event, 'snapshot', 'overflow releases admission immediately');
});

test('SSE oversize frame closes only its recipient and releases admission', async (t) => {
	const activityRoot = await fixture(t);
	const directory = path.join(activityRoot, 'session');
	await mkdir(directory);
	await writeFile(path.join(directory, 'events.jsonl'), '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0, maxClients: 1 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const { response } = await captureSse(t, base);
	const writes = t.mock.method(response, 'write', () => assert.fail('oversize frame must not reach the transport'));
	const value = app.source.snapshot();
	// Synthetic source boundary fault: valid individual sessions, but a count
	// beyond the source's normal bound. The oversized projection must not escape.
	const snapshot = t.mock.method(app.source, 'snapshot', () => ({
		...value, sessions: Array(1024).fill(value.sessions[0]),
	}));
	app.source.emit('change');
	assert.equal(response.destroyed, true);
	assert.equal(response.listenerCount('drain'), 0);
	await nextTurn();
	assert.equal(writes.mock.callCount(), 0);
	snapshot.mock.restore();
	const replacement = await sseReader(base);
	t.after(() => replacement.cancel().catch(() => {}));
	assert.equal((await replacement.next()).event, 'snapshot');
});

test('SSE failure, close and stop cleanup cancel queued work and ignore late callbacks', async (t) => {
	for (const mode of ['throw', 'callback-error', 'response-error', 'peer-close', 'stop-scheduled', 'stop-writing', 'stop-drain']) {
		await t.test(mode, async (t) => {
			const activityRoot = await fixture(t);
			const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0, maxClients: 1 });
			t.after(() => app.stop());
			const { port } = await app.start();
			const base = `http://127.0.0.1:${port}`;
			const { response } = await captureSse(t, base);
			let callback;
			const writes = t.mock.method(response, 'write', (_frame, done) => {
				callback = done;
				if (mode === 'throw') throw new Error('synthetic write failure');
				return false;
			});
			app.source.emit('activity', { kind: 'activity', eventType: 'queued.first' });
			app.source.emit('activity', { kind: 'activity', eventType: 'queued.second' });
			if (mode !== 'stop-scheduled') await nextTurn();
			if (mode === 'callback-error') callback(new Error('synthetic callback failure'));
			if (mode === 'response-error') response.emit('error', new Error('synthetic response failure'));
			if (mode === 'peer-close') await new Promise((resolve) => {
				response.once('close', resolve);
				response.destroy();
			});
			if (mode === 'stop-drain') callback();
			if (mode.startsWith('stop-')) {
				const stopped = app.stop();
				assert.equal(app.stop(), stopped, 'stop is idempotent');
				await stopped;
			}
			await nextTurn();
			assert.equal(response.destroyed, true);
			assert.equal(response.listenerCount('drain'), 0);
			const count = writes.mock.callCount();
			assert.equal(count, mode === 'stop-scheduled' ? 0 : 1);
			callback?.();
			response.emit('error', new Error('late transport notification after cleanup'));
			response.emit('drain');
			response.emit('drain');
			app.source.emit('activity', { kind: 'activity', eventType: 'after.cleanup' });
			app.source.emit('change');
			await nextTurn();
			assert.equal(writes.mock.callCount(), count, 'cleanup prevents late callbacks and drains restarting delivery');
			if (!mode.startsWith('stop-')) {
				const replacement = await sseReader(base);
				t.after(() => replacement.cancel().catch(() => {}));
				const initial = await replacement.next();
				assert.equal(initial.event, 'snapshot');
				assert.equal(initial.data.sequence, 3);
				app.source.emit('activity', { kind: 'activity', eventType: 'replacement.live' });
				assert.equal((await replacement.next()).data.eventType, 'replacement.live');
			}
		});
	}
});

test('loopback server serves only explicit app assets and denies traversal', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const address = await app.start();
	const base = `http://127.0.0.1:${address.port}`;
	const page = await fetch(base, { headers: { host: `127.0.0.1:${address.port}` } });
	assert.equal(page.status, 200);
	const policy = page.headers.get('content-security-policy');
	assert.match(policy, /connect-src 'self'/);
	const html = await page.text();
	assert.match(html, /<link\s+rel="icon"\s+href="\/favicon\.jpg"\s+type="image\/jpeg"\s*\/>/);
	assert.doesNotMatch(html, /https?:\/\//);
	const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(map);
	assert.ok(policy.includes(`'sha256-${createHash('sha256').update(map.replace(/\r\n?/g, '\n')).digest('base64')}'`));
	const three = await fetch(`${base}/vendor/three.module.js`);
	assert.equal(three.status, 200);
	assert.match(three.headers.get('content-type'), /javascript/);
	const favicon = await fetch(`${base}/favicon.jpg`);
	assert.equal(favicon.status, 200);
	assert.match(favicon.headers.get('content-type'), /image\/jpeg/);
	assert.deepEqual(Array.from(new Uint8Array(await favicon.arrayBuffer()).slice(0, 3)), [0xff, 0xd8, 0xff]);
	const statsUi = await fetch(`${base}/session-stats-ui.mjs`);
	assert.equal(statsUi.status, 200);
	assert.match(statsUi.headers.get('content-type'), /javascript/);
	const colors = await fetch(`${base}/activity-colors.mjs`);
	assert.equal(colors.status, 200);
	assert.match(colors.headers.get('content-type'), /javascript/);
	assert.match(await colors.text(), /activityCategory/);
	const visualSettings = await fetch(`${base}/visual-settings.mjs`);
	assert.equal(visualSettings.status, 200);
	assert.match(visualSettings.headers.get('content-type'), /javascript/);
	assert.match(await visualSettings.text(), /export const VISUAL/);
	const bootstrap = await fetch(`${base}/bootstrap.mjs`);
	assert.equal(bootstrap.status, 200);
	assert.match(await bootstrap.text(), /startVisualApplication/);
	const visualConfig = await fetch(`${base}/visual-config.mjs`);
	assert.equal(visualConfig.status, 200);
	assert.match(await visualConfig.text(), /validateVisualSettings/);
	for (const asset of [
		'appearance/visual-settings-ui.mjs', 'appearance/visual-settings-worker.mjs',
		'workspace/workspace-model.mjs', 'workspace/workspace-ui.mjs', 'ui/navigation-ui.mjs',
	]) {
		const response = await fetch(`${base}/${asset}`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type'), /javascript/);
		assert.equal(response.headers.get('cache-control'), 'no-store');
	}
	assert.match(html, /visual-settings-dialog/);
	assert.equal((await fetch(`${base}/package.json`)).status, 404);
	assert.equal((await fetch(`${base}/copilot/visual-settings.mjs`)).status, 404);
	const unlistedModule = await fetch(`${base}/copilot/activity-colors.mjs`);
	assert.equal(unlistedModule.status, 404);
	const privatePath = await fetch(`${base}/plans/sentient-copilot/spec.md`);
	assert.equal(privatePath.status, 404);
	const traversal = await fetch(`${base}/%2e%2e/package.json`);
	assert.equal(traversal.status, 404);
	const navigationStatus = await new Promise((resolve, reject) => {
		const request = httpGet(
			base,
			{
				headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
			},
			(response) => {
				response.resume();
				response.on('end', () => resolve(response.statusCode));
			},
		);
		request.on('error', reject);
	});
	assert.equal(navigationStatus, 200);
	const crossSiteAsset = await fetch(`${base}/main.js`, { headers: { 'sec-fetch-site': 'cross-site' } });
	assert.equal(crossSiteAsset.status, 403);
});

test('Library renderer assets are explicitly local and its bundled worker cannot connect to resources', async (t) => {
		const activityRoot = await fixture(t);
		const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
		t.after(() => app.stop());
		const { port } = await app.start();
		const base = `http://127.0.0.1:${port}`;
		for (const asset of [
			'copilot/library-markdown.mjs', 'copilot/library-render-limits.mjs',
			'copilot/library-text.mjs', 'copilot/library-markdown-worker.mjs',
		]) {
			const response = await fetch(`${base}/${asset}`);
			assert.equal(response.status, 200, asset);
			assert.match(response.headers.get('content-type'), /javascript/);
			const csp = response.headers.get('content-security-policy');
			assert.match(csp, /script-src 'self'/);
			assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:|blob:/);
			if (asset.endsWith('worker.mjs')) {
				assert.match(csp, /default-src 'none'/);
				assert.match(csp, /connect-src 'none'/);
				const bundle = await response.text();
				assert.match(bundle, /marked 15\.0\.12/);
				assert.match(bundle, /yaml 2\.8\.3/);
				assert.doesNotMatch(bundle, /\bimport\(/);
			}
		}
		for (const license of ['MARKED-LICENSE.txt', 'YAML-LICENSE.txt']) {
			const response = await fetch(`${base}/${license}`);
			assert.equal(response.status, 200, license);
			assert.match(response.headers.get('content-type'), /text\/plain/);
			assert.match(await response.text(), /Permission|permission/);
		}
		for (const denied of [
			'copilot/library-metadata.mjs', 'copilot/library-markdown-worker-source.mjs',
			'copilot/generated/library-markdown-worker.mjs', 'node_modules/marked/lib/marked.esm.js',
			'node_modules/yaml/browser/index.js', 'scripts/build-library-renderer.mjs',
			'tests/library-markdown.test.mjs',
		]) {
			assert.equal((await fetch(`${base}/${denied}`)).status, 404, denied);
		}
});

test('SSE emits sanitized current snapshot, live deltas, and never replays prior completions', async (t) => {
	const activityRoot = await fixture(t);
	const session = path.join(activityRoot, 'session-a');
	await mkdir(session);
	const file = path.join(session, 'events.jsonl');
	await writeFile(
		file,
		record('assistant.turn_start', { turnId: 'historic' }) +
			record('session.task_complete', { success: true, outcome: 'completed', summary: 'PRIVATE HISTORIC TEXT' }),
	);
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const address = await app.start();
	const base = `http://127.0.0.1:${address.port}`;

	const response = await fetch(`${base}/events`, {
		headers: {
			host: `127.0.0.1:${address.port}`,
			origin: base,
			'sec-fetch-site': 'same-origin',
		},
	});
	assert.equal(response.status, 200);
	const reader = response.body.getReader();
	const first = await reader.read();
	const initial = new TextDecoder().decode(first.value);
	assert.match(initial, /event: snapshot/);
	assert.doesNotMatch(initial, /event: activity|PRIVATE HISTORIC TEXT|historic/);
	assert.match(initial, /"runningSessions":0,"unverifiedRunningSessions":0/);

	await appendFile(
		file,
		record('assistant.turn_start', { turnId: 'live' }) +
			record('tool.execution_start', {
				toolCallId: 'live-call',
				toolName: 'functions.view',
				arguments: 'PRIVATE LIVE TEXT',
			}),
	);
	await app.source.poll();
	const next = await reader.read();
	let live = new TextDecoder().decode(next.value);
	while (!live.includes('"kind":"step"')) {
		const part = await reader.read();
		assert.equal(part.done, false);
		live += new TextDecoder().decode(part.value);
	}
	assert.match(live, /event: activity/);
	assert.match(live, /"kind":"thinking"/);
	assert.match(live, /"toolName":"functions.view"/);
	assert.match(live, /"runningSessions":1,"unverifiedRunningSessions":0/);
	assert.doesNotMatch(live, /PRIVATE LIVE TEXT|live-call|session-a|arguments/);
	await reader.cancel();

	await appendFile(
		file,
		record('tool.execution_complete', { toolCallId: 'live-call' }) +
			record('session.task_complete', { success: true, outcome: 'completed', summary: 'PRIVATE COMPLETION' }),
	);
	await app.source.poll();
	const reconnected = await fetch(`${base}/events`, {
		headers: { host: `127.0.0.1:${address.port}`, origin: base, 'sec-fetch-site': 'same-origin' },
	});
	const reconnectReader = reconnected.body.getReader();
	const reconnectSnapshot = new TextDecoder().decode((await reconnectReader.read()).value);
	assert.match(reconnectSnapshot, /event: snapshot/);
	assert.doesNotMatch(reconnectSnapshot, /event: activity|PRIVATE COMPLETION/);
	assert.match(reconnectSnapshot, /"sequence":\d+/);
	await reconnectReader.cancel();
});

test('mid-poll reconnect excludes already observed queued events, including completion', async (t) => {
	const activityRoot = await fixture(t);
	const files = ['session-a', 'session-b'].map((session) => path.join(activityRoot, session, 'events.jsonl'));
	for (const file of files) {
		await mkdir(path.dirname(file));
		await writeFile(file, '');
	}
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const connect = () =>
		fetch(`${base}/events`, {
			headers: { origin: base },
			signal: AbortSignal.timeout(5000),
		});
	const original = (await connect()).body.getReader();
	await original.read();
	await appendFile(
		files[0],
		record('assistant.turn_start', { turnId: 'live' }) +
			record('session.task_complete', { success: true, outcome: 'completed' }),
	);
	await appendFile(files[1], record('future.after_admission'));
	const readNormally = app.source.readFile.bind(app.source);
	let release;
	let notifyPaused;
	const paused = new Promise((resolve) => {
		notifyPaused = resolve;
	});
	const resume = new Promise((resolve) => {
		release = resolve;
	});
	app.source.readFile = async (file, ...args) => {
		const bytes = await readNormally(file, ...args);
		if (file === files[0]) {
			notifyPaused();
			await resume;
		}
		return bytes;
	};
	const polling = app.source.poll();
	let newcomer;
	let newcomerText = '';
	try {
		await paused;
		assert.equal(app.source.pendingActivities.size, 2);
		newcomer = (await connect()).body.getReader();
		newcomerText = new TextDecoder().decode((await newcomer.read()).value);
		assert.match(newcomerText, /event: snapshot/);
		assert.match(newcomerText, /"sequence":2/);
		assert.doesNotMatch(newcomerText, /event: activity/);
		assert.equal(app.source.pendingActivities.size, 0);
	} finally {
		release();
		await polling;
		app.source.readFile = readNormally;
	}
	while (!newcomerText.includes('future.after_admission')) {
		newcomerText += new TextDecoder().decode((await newcomer.read()).value);
	}
	assert.equal((newcomerText.match(/event: activity/g) || []).length, 1);
	assert.doesNotMatch(newcomerText, /"eventType":"session\.task_complete"/);
	let originalText = '';
	while (!originalText.includes('"kind":"completion"')) {
		originalText += new TextDecoder().decode((await original.read()).value);
	}
	assert.equal((originalText.match(/"kind":"completion"/g) || []).length, 1);
	await original.cancel();
	await newcomer.cancel();
});

test('real file tails group token SSE traffic and project future, empty and named tool events', async (t) => {
	const activityRoot = await fixture(t);
	await mkdir(path.join(activityRoot, 'session'));
	const file = path.join(activityRoot, 'session', 'events.jsonl');
	await writeFile(file, '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const response = await fetch(`${base}/events`, {
		headers: { origin: base },
		signal: AbortSignal.timeout(5000),
	});
	const reader = response.body.getReader();
	await reader.read();
	await appendFile(
		file,
		Array.from(
			{ length: 500 },
			(_, i) =>
				JSON.stringify({
					id: `token-${i}`,
					type: 'assistant.message_delta',
					data: { content: 'PRIVATE' },
				}) + '\n',
		).join('') +
			record('future.event', null) +
			record('tool.execution_progress', { toolName: 'functions.view', result: 'PRIVATE' }),
	);
	await app.source.poll();
	let text = '';
	while (!text.includes('"eventType":"tool.execution_progress"')) {
		const part = await reader.read();
		assert.equal(part.done, false);
		text += new TextDecoder().decode(part.value);
	}
	const activities = text
		.split('\n\n')
		.filter((part) => part.includes('event: activity'))
		.map((part) => JSON.parse(part.split('\ndata: ')[1]));
	assert.equal(activities.length, 3);
	assert.deepEqual(
		activities.map(({ kind, eventType, count, toolName }) => ({ kind, eventType, count, toolName })),
		[
			{ kind: 'activity', eventType: 'assistant.message_delta', count: 500, toolName: undefined },
			{ kind: 'activity', eventType: 'future.event', count: undefined, toolName: undefined },
			{ kind: 'activity', eventType: 'tool.execution_progress', count: undefined, toolName: 'functions.view' },
		],
	);
	assert.doesNotMatch(text, /PRIVATE|content|result|token-|session"/);
	await reader.cancel();
	const reconnect = await fetch(`${base}/events`, { headers: { origin: base } });
	const reconnectReader = reconnect.body.getReader();
	const initial = new TextDecoder().decode((await reconnectReader.read()).value);
	assert.doesNotMatch(initial, /eventType|toolName|event: activity|count":500/);
	await reconnectReader.cancel();
});

test('SSE subagent trees expose bounded epoch-opaque identifiers without local values', async (t) => {
	const activityRoot = await fixture(t);
	const session = path.join(activityRoot, 'PRIVATE-session-directory');
	await mkdir(session);
	const file = path.join(session, 'events.jsonl');
	await writeFile(file, '');
	const app = createSentientServer({ activityRoot, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const response = await fetch(`${base}/events`, { headers: { origin: base } });
	const reader = response.body.getReader();
	await reader.read();
	await appendFile(
		file,
		record('subagent.started', {
			toolCallId: 'PRIVATE-tool-call',
			agentDescription: 'PRIVATE-agent-description',
		}),
	);
	await app.source.poll();
	let text = '';
	while (!text.includes('"subagents":[{"sid":')) {
		const part = await reader.read();
		assert.equal(part.done, false);
		text += new TextDecoder().decode(part.value);
	}
	const snapshot = JSON.parse(text.split('data: ').at(-1).split('\n')[0]).snapshot;
	assert.equal(snapshot.treeSessions.length, 1);
	assert.match(snapshot.treeSessions[0].sid, /^[A-Z2-7]{4}$/);
	assert.match(snapshot.treeSessions[0].subagents[0].sid, /^[A-Z2-7]{4}$/);
	assert.equal(snapshot.treeSessions[0].status, 'running');
	assert.doesNotMatch(text, /PRIVATE|tool-call|agent-description|session-directory|events\.jsonl/);
	const childSid = snapshot.treeSessions[0].subagents[0].sid;
	await appendFile(file, record('subagent.completed', { toolCallId: 'PRIVATE-tool-call' }));
	await app.source.poll();
	let retiredText = '';
	while (!retiredText.includes('"outcome":"completed"')) {
		const part = await reader.read();
		assert.equal(part.done, false);
		retiredText += new TextDecoder().decode(part.value);
	}
	const retiredSnapshot = JSON.parse(retiredText.split('data: ').at(-1).split('\n')[0]).snapshot;
	assert.deepEqual(retiredSnapshot.treeSessions[0].retired, [{ sid: childSid, outcome: 'completed' }]);
	assert.doesNotMatch(retiredText, /PRIVATE|tool-call|agent-description|session-directory|events\.jsonl/);
	await reader.cancel();
});

test('rejects hostile host/origin and connection caps fail closed', async (t) => {
	const activityRoot = await fixture(t);
	const app = createSentientServer({ activityRoot, port: 0, maxClients: 1, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const address = await app.start();
	const base = `http://127.0.0.1:${address.port}`;
	const badHostStatus = await new Promise((resolve, reject) => {
		const request = httpGet(
			{
				hostname: '127.0.0.1',
				port: address.port,
				path: '/',
				headers: { host: 'attacker.invalid' },
			},
			(response) => {
				response.resume();
				response.on('end', () => resolve(response.statusCode));
			},
		);
		request.on('error', reject);
	});
	assert.equal(badHostStatus, 403);
	const badOrigin = await fetch(`${base}/events`, { headers: { origin: 'http://evil.invalid' } });
	assert.equal(badOrigin.status, 403);
	const badFetchSite = await fetch(`${base}/events`, {
		headers: { origin: base, 'sec-fetch-site': 'cross-site' },
	});
	assert.equal(badFetchSite.status, 403);
	const good = await fetch(`${base}/events`, { headers: { 'sec-fetch-site': 'same-origin' } });
	assert.equal(good.status, 200);
	const excess = await fetch(`${base}/events`, { headers: { origin: base } });
	assert.equal(excess.status, 429);
	await good.body.cancel();
});
