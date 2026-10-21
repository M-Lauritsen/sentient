import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSentientServer } from '../server.mjs';
import { createLifecycle, LIFECYCLE } from './lifecycle.mjs';

export function serveOwnedChild({ serverOptions = {}, lifecycleOptions = {} } = {}) {
	if (!process.send || !process.connected) {
		process.stderr.write('START_FAILED: This entry requires launcher-owned private IPC.\n');
		process.exitCode = 1;
		return;
	}
	let app;
	let controller;
	let initialized = false;
	let stopping;
	let starting;
	const send = (message) => new Promise((resolve) => {
		if (!process.connected) return resolve(false);
		process.send(message, (error) => resolve(!error));
	});
	const initTimer = setTimeout(() => void shutdown('START_FAILED'), LIFECYCLE.readyMs);

	async function shutdown(reason) {
		if (stopping) return stopping;
		clearTimeout(initTimer);
		stopping = (async () => {
			const watchdog = setTimeout(() => process.exit(1), LIFECYCLE.cleanupMs);
			let code = ['EMPTY', 'STOP'].includes(reason) ? 0 : 1;
			let result = reason;
			try {
				await starting;
				await app?.stop();
			} catch {
				code = 1;
				result = 'CLEANUP_FAILED';
			}
			controller?.close();
			const sent = await send({
				type: 'stopped', protocol: 1, instanceId: controller?.instanceId, reason: result,
			});
			if (!sent && result !== 'OWNERSHIP_LOST') code = 1;
			clearTimeout(watchdog);
			process.exit(code);
		})();
		return stopping;
	}

	process.on('message', (message) => {
		if (!initialized) {
			if (!message || Object.keys(message).length !== 2 || message.type !== 'init' || message.protocol !== 1) {
				void shutdown('START_FAILED');
				return;
			}
			initialized = true;
			clearTimeout(initTimer);
			controller = createLifecycle({ ...lifecycleOptions, onStop: (reason) => void shutdown(reason) });
			app = createSentientServer({ ...serverOptions, lifecycle: controller });
			starting = app.start().then(async (address) => {
				if (stopping) return;
				controller.start();
				await send({ type: 'ready', protocol: 1, instanceId: controller.instanceId, port: address.port });
			}, async (error) => {
				const code = error?.code === 'EADDRINUSE' ? 'PORT_IN_USE' :
					error?.code === 'CLEANUP_FAILED' ? 'CLEANUP_FAILED' : 'START_FAILED';
				await send({
					type: 'failure', protocol: 1,
					code,
				});
				void shutdown(code);
			});
			return;
		}
		if (!message || message.type !== 'stop' || message.protocol !== 1 ||
			message.instanceId !== controller.instanceId || Object.keys(message).length !== 3) {
			void shutdown('OWNERSHIP_LOST');
			return;
		}
		void shutdown('STOP');
	});
	process.once('disconnect', () => void shutdown('OWNERSHIP_LOST'));
	process.once('SIGINT', () => void shutdown('STOP'));
	process.once('SIGTERM', () => void shutdown('STOP'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serveOwnedChild();
