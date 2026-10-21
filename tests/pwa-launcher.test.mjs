import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLauncher, probeReady, launcherMessage } from '../desktop/launch.mjs';
import { lifecycleHeaders } from '../desktop/lifecycle.mjs';
import { createSentientServer } from '../server.mjs';

const instanceId = 'x'.repeat(32);
const activation = {
	executable: 'C:\\Synthetic Browser With Spaces\\chrome_proxy.exe',
	profile: 'Profile 2', appId: 'a'.repeat(32),
	args: ['--profile-directory=Profile 2', `--app-id=${'a'.repeat(32)}`],
};
const defaults = {
	platform: 'win32', nodeVersion: '22.0.0', checkCheckout: async () => {},
	discover: async () => activation, readyMs: 200, cleanupMs: 100,
};

function fakeChild({ ready = { type: 'ready', protocol: 1, instanceId, port: 43187 }, stallStop = false } = {}) {
	const child = new EventEmitter();
	child.connected = true;
	child.sent = [];
	child.kills = 0;
	child.finish = (reason = 'EMPTY', code = 0) => {
		child.emit('message', { type: 'stopped', protocol: 1, instanceId, reason });
		child.emit('exit', code);
	};
	child.send = (message, callback) => {
		child.sent.push(message);
		callback?.();
		if (message.type === 'init' && ready) queueMicrotask(() => child.emit('message', ready));
		if (message.type === 'stop' && !stallStop) queueMicrotask(() => child.finish('STOP'));
	};
	child.disconnect = () => { child.connected = false; queueMicrotask(() => child.emit('exit', 1)); };
	child.kill = () => { child.kills++; queueMicrotask(() => child.emit('exit', 1)); return true; };
	return child;
}

test('launcher enforces platform, runtime, checkout and explicit browser before creating a child', async () => {
	for (const [overrides, code] of [
		[{ platform: 'linux' }, 'UNSUPPORTED_PLATFORM'],
		[{ nodeVersion: '20.9.0' }, 'NODE_VERSION'],
		[{ checkCheckout: async () => { throw new Error('private path'); } }, 'CHECKOUT_UNAVAILABLE'],
		[{ args: ['--browser', 'edge'] }, 'APP_ACTIVATION_UNAVAILABLE'],
		[{ args: ['--browser', 'chrome'] }, 'APP_ACTIVATION_UNAVAILABLE'],
		[{ args: ['--port', '0'] }, 'USAGE'],
	]) {
		await assert.rejects(runLauncher({
			...defaults, createChild: () => assert.fail('must not create a child'), ...overrides,
		}), { code });
	}
});

test('matching private readiness and HTTP readiness precede dispatch; browser process exit is not closure', async () => {
	const child = fakeChild();
	const observations = [];
	await runLauncher({
		...defaults,
		createChild: () => child,
		probe: async ({ origin, instanceId: actualId }) => {
			assert.equal(origin, 'http://127.0.0.1:43187');
			assert.equal(actualId, instanceId);
			observations.push('http-ready');
		},
		dispatch: async (selected) => {
			assert.equal(selected, activation);
			observations.push('dispatch');
			assert.equal(child.listenerCount('exit'), 1, 'only the owned child is supervised');
			queueMicrotask(() => child.finish());
		},
	});
	assert.deepEqual(observations, ['http-ready', 'dispatch']);
	assert.deepEqual(child.sent, [{ type: 'init', protocol: 1 }]);
	assert.equal(child.kills, 0);
	assert.equal(child.eventNames().length, 0);
});

test('wrong identity, protocol or production port fails closed before browser dispatch', async () => {
	for (const change of [{ instanceId: 'bad' }, { protocol: 2 }, { port: 43188 }]) {
		const child = fakeChild({ ready: { type: 'ready', protocol: 1, instanceId, port: 43187, ...change } });
		await assert.rejects(runLauncher({
			...defaults, createChild: () => child,
			probe: async () => assert.fail('must not probe an invalid IPC identity'),
			dispatch: async () => assert.fail('must not dispatch'),
		}), { code: 'OWNERSHIP_LOST' });
		assert.equal(child.kills, 0);
	}
	const child = fakeChild();
	await assert.rejects(runLauncher({
		...defaults, createChild: () => child,
		probe: async () => { throw Object.assign(new Error('private'), { code: 'OWNERSHIP_LOST' }); },
		dispatch: async () => assert.fail('must not dispatch'),
	}), { code: 'OWNERSHIP_LOST' });
	assert.equal(child.sent.at(-1).type, 'stop');
});

test('startup failure, IPC loss, bounded readiness and stalled cleanup clean only the held child', async () => {
	const noReady = fakeChild({ ready: null });
	await assert.rejects(runLauncher({
		...defaults, readyMs: 10, createChild: () => noReady, dispatch: async () => assert.fail(),
	}), { code: 'READY_TIMEOUT' });
	assert.equal(noReady.kills, 0);

	const child = fakeChild();
	await assert.rejects(runLauncher({
		...defaults, createChild: () => child, probe: async () => {},
		dispatch: async () => { queueMicrotask(() => child.emit('exit', 1)); },
	}), { code: 'OWNERSHIP_LOST' });

	const stalled = fakeChild({ stallStop: true });
	await assert.rejects(runLauncher({
		...defaults, cleanupMs: 10, createChild: () => stalled, probe: async () => {},
		dispatch: async () => { throw Object.assign(new Error('private'), { code: 'BROWSER_LAUNCH_FAILED' }); },
	}), { code: 'CLEANUP_FAILED' });
	assert.equal(stalled.kills, 1);
	assert.equal(stalled.sent.at(-1).type, 'stop');
});

test('interruption requests a private owned stop without killing the browser', async () => {
	const child = fakeChild();
	const controller = new AbortController();
	await runLauncher({
		...defaults, createChild: () => child, probe: async () => {}, signal: controller.signal,
		dispatch: async () => { controller.abort(); },
	});
	assert.equal(child.sent.at(-1).type, 'stop');
	assert.equal(child.kills, 0);
});

test('readiness retries are serialized and bounded before dispatch', async () => {
	const child = fakeChild();
	let probes = 0;
	let active = 0;
	await runLauncher({
		...defaults, readyMs: 1000, createChild: () => child,
		probe: async () => {
			assert.equal(active++, 0);
			try {
				if (++probes < 3) throw Object.assign(new Error('retry'), { code: 'READY_TIMEOUT' });
			} finally { active--; }
		},
		dispatch: async () => { assert.equal(probes, 3); queueMicrotask(() => child.finish()); },
	});
	assert.equal(child.eventNames().length, 0);
	const stalled = fakeChild();
	await assert.rejects(runLauncher({
		...defaults, readyMs: 15, createChild: () => stalled,
		probe: async () => { throw Object.assign(new Error('retry'), { code: 'READY_TIMEOUT' }); },
		dispatch: async () => assert.fail('must not dispatch before readiness'),
	}), { code: 'READY_TIMEOUT' });
	assert.equal(stalled.eventNames().length, 0);
});

test('HTTP readiness bounds oversized and stalled responses', async (t) => {
	let requests = 0;
	const server = createServer((request, response) => {
		response.writeHead(200);
		if (++requests === 1) response.write('x'.repeat(8193));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise((resolve) => server.close(resolve));
	});
	for (let i = 0; i < 2; i++) {
		await assert.rejects(probeReady({
			origin: `http://127.0.0.1:${server.address().port}`, instanceId, timeoutMs: 50,
		}), { code: 'READY_TIMEOUT' });
	}
});

test('launcher errors never contain private messages, paths, argv or capability values', () => {
	for (const error of [
		new Error('SECRET capability and C:\\private\\path'),
		{ code: 'PORT_IN_USE', message: 'SECRET' },
		{ code: 'SECRET', stack: 'SECRET' },
	]) {
		assert.doesNotMatch(launcherMessage(error), /SECRET|C:\\private/u);
	}
});

async function realFixture(t, { initialMs = 3000, port = 0 } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient launcher space '));
	t.after(() => rm(root, { recursive: true, force: true }));
	const children = [];
	const createChild = () => {
		const child = fork(fileURLToPath(new URL('./fixtures/owned-server-child.mjs', import.meta.url)), [], {
			cwd: root,
			env: {
				...process.env, SENTIENT_FIXTURE_ROOT: root,
				SENTIENT_FIXTURE_INITIAL_MS: String(initialMs), SENTIENT_FIXTURE_PORT: String(port),
			},
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
		});
		children.push(child);
		t.after(async () => {
			if (child.exitCode === null && child.signalCode === null) {
				const exit = once(child, 'exit');
				child.kill();
				await exit;
			}
		});
		return child;
	};
	return {
		children, createChild,
		options: { ...defaults, createChild, readyMs: 5000, cleanupMs: 1000, port },
	};
}

async function participate(origin) {
	const headers = lifecycleHeaders(origin);
	const response = await fetch(`${origin}/api/app-lifecycle/session`, { headers, mode: 'same-origin' });
	assert.equal(response.status, 200);
	const { token, instanceId: boot } = await response.json();
	const lease = async (op, windowId) => {
		const result = await fetch(`${origin}/api/app-lifecycle/leases`, {
			method: 'POST',
			mode: 'same-origin',
			headers: { ...headers, 'content-type': 'application/json', 'x-sentient-lifecycle-token': token },
			body: JSON.stringify({ op, instanceId: boot, windowId }),
		});
		assert.equal(result.status, 200);
		await result.json();
	};
	await lease('register', 'a'.repeat(22));
	await lease('register', 'b'.repeat(22));
	return async () => {
		await lease('release', 'a'.repeat(22));
		await lease('release', 'b'.repeat(22));
	};
}

test('real Windows owned child supports synthetic windows and exits after last release from a cwd containing spaces', async (t) => {
	const f = await realFixture(t);
	let origin;
	await runLauncher({
		...f.options,
		probe: async (options) => { origin = options.origin; return probeReady(options); },
		dispatch: async () => { const release = await participate(origin); await release(); },
	});
	assert.equal(f.children[0].exitCode, 0);
	await assert.rejects(fetch(`${origin}/api/app-lifecycle/ready`));
});

test('real owned child without participating windows reports initial timeout and cleans its listener', async (t) => {
	const f = await realFixture(t, { initialMs: 150 });
	let origin;
	await assert.rejects(runLauncher({
		...f.options,
		probe: async (options) => { origin = options.origin; return probeReady(options); },
		dispatch: async () => {},
	}), { code: 'NO_PARTICIPATING_WINDOW' });
	assert.equal(f.children[0].exitCode, 1);
	await assert.rejects(fetch(`${origin}/api/app-lifecycle/ready`));
});

test('an occupied foreign listener survives and receives no readiness or control requests', async (t) => {
	let requests = 0;
	const foreign = createServer((request, response) => { requests++; response.end('foreign alive'); });
	await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise((resolve) => foreign.close(resolve)));
	const port = foreign.address().port;
	const f = await realFixture(t, { port });
	await assert.rejects(runLauncher({
		...f.options,
		dispatch: async () => assert.fail('must not dispatch against a foreign listener'),
	}), { code: 'PORT_IN_USE' });
	assert.equal(requests, 0);
	assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'foreign alive');
	assert.equal(foreign.listening, true);
	assert.equal(f.children[0].exitCode, 1);
});

test('an independently started SENTIENT listener survives a launcher conflict unchanged', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sentient independent '));
	t.after(() => rm(root, { recursive: true, force: true }));
	const app = createSentientServer({ activityRoot: root, port: 0, pollIntervalMs: 0 });
	t.after(() => app.stop());
	const { port } = await app.start();
	const f = await realFixture(t, { port });
	await assert.rejects(runLauncher({
		...f.options, dispatch: async () => assert.fail('must not dispatch against a manual server'),
	}), { code: 'PORT_IN_USE' });
	assert.equal(app.source.stopped, false);
	assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
	assert.equal((await fetch(`http://127.0.0.1:${port}/api/app-lifecycle/session`)).status, 404);
});

test('real owned child expires a lost release and closes its listener', async (t) => {
	const f = await realFixture(t);
	let origin;
	await runLauncher({
		...f.options,
		probe: async (options) => { origin = options.origin; return probeReady(options); },
		dispatch: async () => { await participate(origin); },
	});
	assert.equal(f.children[0].exitCode, 0);
	await assert.rejects(fetch(`${origin}/api/app-lifecycle/ready`));
});

test('double-start bind race has one owner; loser cannot stop the winner', async (t) => {
	const reservation = createServer();
	await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const f = await realFixture(t, { port });
	let signalLoser;
	const loserObserved = new Promise((resolve) => { signalLoser = resolve; });
	let dispatches = 0;
	const run = () => {
		let origin;
		return runLauncher({
			...f.options,
			probe: async (options) => { origin = options.origin; return probeReady(options); },
			dispatch: async () => {
				dispatches++;
				const release = await participate(origin);
				await loserObserved;
				assert.equal((await fetch(`${origin}/api/app-lifecycle/ready`, {
					headers: lifecycleHeaders(origin), mode: 'same-origin',
				})).status, 200);
				await release();
			},
		}).catch((error) => { signalLoser(); throw error; });
	};
	const results = await Promise.allSettled([run(), run()]);
	assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
	assert.equal(results.find(({ status }) => status === 'rejected').reason.code, 'PORT_IN_USE');
	assert.equal(dispatches, 1);
});

test('loss of supervisor private IPC causes real owned-child exit and listener closure', async (t) => {
	const f = await realFixture(t);
	const child = f.createChild();
	const ready = new Promise((resolve) => child.on('message', (message) => {
		if (message.type === 'ready') resolve(message);
	}));
	child.send({ type: 'init', protocol: 1 });
	const message = await ready;
	const exit = once(child, 'exit');
	child.disconnect();
	const [code] = await exit;
	assert.equal(code, 1);
	await assert.rejects(fetch(`http://127.0.0.1:${message.port}/api/app-lifecycle/ready`));
});
