import { fork } from 'node:child_process';
import { access } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { desktopError, parseBrowserArguments, discoverActivation, dispatchInstalledApp } from './activation.mjs';
import { LIFECYCLE, lifecycleHeaders } from './lifecycle.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./server-child.mjs', import.meta.url));
const MESSAGES = {
	USAGE: 'Usage: node desktop/launch.mjs [--browser brave].',
	UNSUPPORTED_PLATFORM: 'Use this launcher on Windows.',
	NODE_VERSION: 'Install Node.js 22 or newer before starting the launcher.',
	CHECKOUT_UNAVAILABLE: 'Restore this checkout and install its dependencies manually.',
	BROWSER_UNAVAILABLE: 'Restore the Brave installation used by the SENTIENT shortcut.',
	APP_ACTIVATION_UNAVAILABLE: 'Use Brave and create one unambiguous SENTIENT OS app shortcut for the intended profile. Edge and Chrome are deferred.',
	PORT_IN_USE: 'Stop your independently started server yourself before launching. No existing listener was adopted or stopped.',
	START_FAILED: 'The owned server could not start. Check the checkout and local source access.',
	READY_TIMEOUT: 'The owned server did not become ready within 15 seconds.',
	BROWSER_LAUNCH_FAILED: 'Brave dispatch failed. Check the installed app shortcut and profile.',
	NO_PARTICIPATING_WINDOW: 'No page registered within 120 seconds. Reopen the installed Brave app and check its backend connection.',
	OWNERSHIP_LOST: 'The private server ownership or readiness check failed.',
	CLEANUP_FAILED: 'Owned-child cleanup could not be confirmed.',
};
const PUBLIC_CODES = new Set(Object.keys(MESSAGES));

export function launcherMessage(error) {
	const code = PUBLIC_CODES.has(error?.code) ? error.code : 'START_FAILED';
	return `${code}: ${MESSAGES[code]}\n`;
}

function waitFor(promise, timeoutMs, code, signal) {
	return new Promise((resolve, reject) => {
		let timer;
		const finish = (error, value) => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			if (error) reject(error);
			else resolve(value);
		};
		const onAbort = () => finish(desktopError('INTERRUPTED'));
		if (signal?.aborted) return onAbort();
		signal?.addEventListener('abort', onAbort, { once: true });
		if (timeoutMs !== undefined) timer = setTimeout(() => finish(desktopError(code)), timeoutMs);
		promise.then((value) => finish(null, value), (error) => finish(error));
	});
}

export function probeReady({ origin, instanceId, signal, timeoutMs = LIFECYCLE.probeMs }) {
	return new Promise((resolve, reject) => {
		let bytes = 0;
		const chunks = [];
		const request = httpGet(`${origin}/api/app-lifecycle/ready`, {
			headers: lifecycleHeaders(origin), signal,
		}, (response) => {
			response.on('data', (chunk) => {
				bytes += chunk.length;
				if (bytes > LIFECYCLE.maxResponseBytes) request.destroy();
				else chunks.push(chunk);
			});
			response.on('aborted', () => finish(desktopError('READY_TIMEOUT')));
			response.on('error', () => finish(desktopError('READY_TIMEOUT')));
			response.on('end', () => {
				if (response.statusCode !== 200) return finish(desktopError('READY_TIMEOUT'));
				let value;
				try {
					value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				} catch {
					return finish(desktopError('READY_TIMEOUT'));
				}
				if (value?.protocol !== 1 || value.instanceId !== instanceId || value.state !== 'ready') {
					return finish(desktopError('OWNERSHIP_LOST'));
				}
				finish();
			});
		});
		const timer = setTimeout(() => {
			request.destroy();
			finish(desktopError('READY_TIMEOUT'));
		}, timeoutMs);
		function finish(error) {
			clearTimeout(timer);
			if (error) reject(error);
			else resolve();
		}
		request.on('error', () => finish(desktopError('READY_TIMEOUT')));
	});
}

export async function runLauncher({
	args = [],
	platform = process.platform,
	nodeVersion = process.versions.node,
	checkCheckout = async () => {
		await Promise.all(['server.mjs', 'node_modules/yaml/package.json', 'node_modules/three/package.json']
			.map((file) => access(path.join(ROOT, file))));
	},
	discover = discoverActivation,
	dispatch = dispatchInstalledApp,
	createChild = () => fork(CHILD, [], {
		cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
	}),
	probe = probeReady,
	port = 43187,
	readyMs = LIFECYCLE.readyMs,
	cleanupMs = LIFECYCLE.cleanupMs,
	signal,
} = {}) {
	parseBrowserArguments(args);
	if (platform !== 'win32') throw desktopError('UNSUPPORTED_PLATFORM');
	if (!/^\d+\./u.test(nodeVersion) || Number(nodeVersion.split('.')[0]) < 22) throw desktopError('NODE_VERSION');
	try { await checkCheckout(); } catch { throw desktopError('CHECKOUT_UNAVAILABLE'); }
	const activation = await discover();
	if (signal?.aborted) return;
	const operations = new AbortController();
	let child;
	let exited = false;
	let ready;
	let stopped;
	let resolveReady;
	let resolveExit;
	let fail;
	const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
	const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
	const failurePromise = new Promise((resolve) => { fail = resolve; });
	const failed = failurePromise.then((code) => { throw desktopError(code); });
	void failed.catch(() => {});
	const abort = () => operations.abort();
	signal?.addEventListener('abort', abort, { once: true });

	const onMessage = (message) => {
		if (message?.protocol !== 1) return fail('OWNERSHIP_LOST');
		if (message.type === 'failure') return fail(PUBLIC_CODES.has(message.code) ? message.code : 'START_FAILED');
		if (message.type === 'ready' && !ready) {
			if (!/^[A-Za-z0-9_-]{32}$/u.test(message.instanceId) || !Number.isInteger(message.port) ||
				message.port < 1 || message.port > 65535 || (port !== 0 && message.port !== port)) return fail('OWNERSHIP_LOST');
			ready = message;
			resolveReady(message);
		} else if (message.type === 'stopped' && message.instanceId === ready?.instanceId) {
			stopped = message;
			if (!['EMPTY', 'STOP'].includes(message.reason)) {
				fail(PUBLIC_CODES.has(message.reason) ? message.reason : 'START_FAILED');
			}
		} else fail('OWNERSHIP_LOST');
	};
	const onError = () => fail('START_FAILED');
	const onExit = (code) => {
		exited = true;
		resolveExit(code);
		if (!stopped) fail(ready ? 'OWNERSHIP_LOST' : 'START_FAILED');
	};
	async function cleanup() {
		if (exited || !child) return;
		if (child.connected && !ready) {
			child.disconnect();
		} else if (child.connected) {
			try {
				child.send({ type: 'stop', protocol: 1, instanceId: ready?.instanceId }, (error) => {
					if (error) fail('OWNERSHIP_LOST');
				});
			} catch {
				fail('OWNERSHIP_LOST');
			}
		}
		try {
			await waitFor(exitPromise, cleanupMs, 'CLEANUP_FAILED');
		} catch {
			if (!exited) {
				// This handle is the child we created, never a discovered PID or process tree.
				if (!child.kill()) throw desktopError('CLEANUP_FAILED');
				await waitFor(exitPromise, 1000, 'CLEANUP_FAILED');
			}
			throw desktopError('CLEANUP_FAILED');
		}
	}

	try {
		try { child = createChild(); } catch { throw desktopError('START_FAILED'); }
		child.on('message', onMessage);
		child.once('error', onError);
		child.once('exit', onExit);
		const deadline = performance.now() + readyMs;
		child.send({ type: 'init', protocol: 1 }, (error) => { if (error) fail('START_FAILED'); });
		await waitFor(Promise.race([readyPromise, failed]), readyMs, 'READY_TIMEOUT', operations.signal);
		const origin = `http://127.0.0.1:${ready.port}`;
		while (true) {
			try {
				await waitFor(Promise.race([probe({
					origin, instanceId: ready.instanceId, signal: operations.signal,
					timeoutMs: Math.min(LIFECYCLE.probeMs, Math.max(1, deadline - performance.now())),
				}), failed]), Math.max(1, deadline - performance.now()), 'READY_TIMEOUT', operations.signal);
				break;
			} catch (error) {
				if (error?.code !== 'READY_TIMEOUT' || performance.now() >= deadline) throw error;
				await sleep(Math.min(100, deadline - performance.now()), undefined, { signal: operations.signal });
			}
		}
		await waitFor(Promise.race([dispatch(activation), failed]), 10_000, 'BROWSER_LAUNCH_FAILED', operations.signal);
		const code = await waitFor(Promise.race([exitPromise, failed]), undefined, undefined, operations.signal);
		if (code !== 0 || !stopped || !['EMPTY', 'STOP'].includes(stopped.reason)) throw desktopError('OWNERSHIP_LOST');
	} catch (error) {
		operations.abort();
		await cleanup();
		if (error?.code !== 'INTERRUPTED' && error?.name !== 'AbortError') throw error;
	} finally {
		operations.abort();
		signal?.removeEventListener('abort', abort);
		child?.removeListener('message', onMessage);
		child?.removeListener('error', onError);
		child?.removeListener('exit', onExit);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const interruption = new AbortController();
	const stop = () => interruption.abort();
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	runLauncher({ args: process.argv.slice(2), signal: interruption.signal })
		.catch((error) => {
			process.stderr.write(launcherMessage(error));
			process.exitCode = error?.code === 'USAGE' ? 2 : 1;
		})
		.finally(() => {
			process.removeListener('SIGINT', stop);
			process.removeListener('SIGTERM', stop);
		});
}
