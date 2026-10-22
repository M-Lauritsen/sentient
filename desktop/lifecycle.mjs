import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const LIFECYCLE = Object.freeze({
	protocol: 1, heartbeatMs: 15_000, leaseTtlMs: 90_000, emptyGraceMs: 30_000,
	initialGraceMs: 120_000, cleanupMs: 5_000, readyMs: 15_000, probeMs: 1_000,
	maxLeases: 8, maxBodyBytes: 2048, requestMs: 2_000, maxResponseBytes: 8192,
	maxInFlight: 32, maxRequests: 256, rateWindowMs: 10_000,
});
const STATUS = {
	INVALID_REQUEST: 400, FORBIDDEN: 403, LIFECYCLE_DISABLED: 404, METHOD_NOT_ALLOWED: 405,
	INSTANCE_CHANGED: 409, LEASE_EXPIRED: 409, LIMIT_EXCEEDED: 413, UNSUPPORTED_CONTENT: 415,
	BUSY: 429, STOPPING: 503,
};
const failure = (code) => Object.assign(new Error(code), { code });

export function lifecycleHeaders(origin) {
	return {
		origin, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'same-origin',
		'sec-fetch-dest': 'empty', 'x-sentient-lifecycle': '1',
	};
}

function readBody(request, limits) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let bytes = 0;
		const finish = (error, value) => {
			clearTimeout(timer);
			request.removeListener('data', onData);
			request.removeListener('end', onEnd);
			request.removeListener('aborted', onAborted);
			request.removeListener('error', onAborted);
			if (error) {
				request.pause();
				reject(error);
			} else resolve(value);
		};
		const onData = (chunk) => {
			bytes += chunk.length;
			if (bytes > limits.maxBodyBytes) finish(failure('LIMIT_EXCEEDED'));
			else chunks.push(chunk);
		};
		const onAborted = () => finish(failure('INVALID_REQUEST'));
		const onEnd = () => {
			if (!request.complete || bytes === 0) return finish(failure('INVALID_REQUEST'));
			let value;
			try {
				value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
			} catch {
				return finish(failure('INVALID_REQUEST'));
			}
			finish(null, value);
		};
		const timer = setTimeout(() => finish(failure('INVALID_REQUEST')), limits.requestMs);
		request.on('data', onData);
		request.once('end', onEnd);
		request.once('aborted', onAborted);
		request.once('error', onAborted);
	});
}

export function createLifecycle({
	clock = () => performance.now(),
	setTimer = setTimeout,
	clearTimer = clearTimeout,
	onStop,
	limits: overrides = {},
} = {}) {
	if (typeof onStop !== 'function') throw new TypeError('Lifecycle requires an owned stop callback');
	const limits = { ...LIFECYCLE, ...overrides };
	const instanceId = randomBytes(24).toString('base64url');
	const token = randomBytes(32).toString('base64url');
	const tokenBytes = Buffer.from(token);
	const leases = new Map();
	const requests = [];
	let state = 'ready';
	let initialDeadline;
	let emptyDeadline;
	let timer;
	let inFlight = 0;
	let participated = false;

	function commitStop(reason) {
		if (state === 'stopping' || state === 'stopped') return;
		state = 'stopping';
		clearTimer(timer);
		timer = undefined;
		onStop(reason);
	}

	function advance() {
		if (state === 'ready' || state === 'stopping' || state === 'stopped') return;
		const now = clock();
		let lastExpiry;
		for (const [windowId, deadline] of leases) {
			if (deadline <= now) {
				leases.delete(windowId);
				lastExpiry = Math.max(lastExpiry ?? deadline, deadline);
			}
		}
		if (!participated && now >= initialDeadline) return commitStop('NO_PARTICIPATING_WINDOW');
		if (participated && leases.size === 0) {
			state = 'empty-grace';
			emptyDeadline ??= (lastExpiry ?? now) + limits.emptyGraceMs;
			if (now >= emptyDeadline) return commitStop('EMPTY');
		}
	}

	function schedule() {
		clearTimer(timer);
		timer = undefined;
		if (['ready', 'stopping', 'stopped'].includes(state)) return;
		const deadline = leases.size > 0 ? Math.min(...leases.values()) :
			participated ? emptyDeadline : initialDeadline;
		timer = setTimer(() => {
			timer = undefined;
			advance();
			schedule();
		}, Math.max(0, deadline - clock()));
	}

	function available() {
		advance();
		if (['ready', 'stopping', 'stopped'].includes(state)) throw failure('STOPPING');
	}

	function apply(value) {
		available();
		if (!value || typeof value !== 'object' || Array.isArray(value) ||
			Object.keys(value).length !== 3 ||
			!['op', 'instanceId', 'windowId'].every((key) => Object.hasOwn(value, key)) ||
			!['register', 'renew', 'release'].includes(value.op) ||
			typeof value.instanceId !== 'string' || !/^[A-Za-z0-9_-]{32}$/u.test(value.instanceId) ||
			typeof value.windowId !== 'string' || !/^[A-Za-z0-9_-]{22}$/u.test(value.windowId)) {
			throw failure('INVALID_REQUEST');
		}
		if (value.instanceId !== instanceId) throw failure('INSTANCE_CHANGED');
		if (value.op === 'renew' && !leases.has(value.windowId)) throw failure('LEASE_EXPIRED');
		if (value.op !== 'release') {
			if (!leases.has(value.windowId) && leases.size >= limits.maxLeases) throw failure('BUSY');
			leases.set(value.windowId, clock() + limits.leaseTtlMs);
			participated = true;
			emptyDeadline = undefined;
			state = 'active';
		} else if (leases.delete(value.windowId) && leases.size === 0) {
			emptyDeadline = clock() + limits.emptyGraceMs;
			state = 'empty-grace';
		}
		schedule();
		return {
			instanceId, windowId: value.windowId,
			state: value.op === 'release' ? 'released' : 'active', leaseTtlMs: limits.leaseTtlMs,
		};
	}

	function reply(response, status, body) {
		if (response.destroyed) return;
		const json = JSON.stringify(body);
		if (Buffer.byteLength(json) > limits.maxResponseBytes) throw new Error('Lifecycle response limit');
		response.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json),
			'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
		});
		response.end(json);
	}

	return {
		instanceId,
		get state() { advance(); return state; },
		start() {
			if (state !== 'ready') throw new Error('Lifecycle already started');
			initialDeadline = clock() + limits.initialGraceMs;
			state = 'awaiting-first-window';
			schedule();
		},
		close() {
			clearTimer(timer);
			timer = undefined;
			leases.clear();
			state = 'stopped';
		},
		async handle(request, response, { host, origin }) {
			const fail = (code) => {
				if (!request.complete) {
					response.shouldKeepAlive = false;
					response.setHeader('Connection', 'close');
				}
				reply(response, STATUS[code], { error: { code } });
			};
			const now = clock();
			while (requests.length && requests[0] <= now - limits.rateWindowMs) requests.shift();
			if (inFlight >= limits.maxInFlight || requests.length >= limits.maxRequests) return fail('BUSY');
			requests.push(now);
			inFlight++;
			try {
				const headers = request.headers;
				if (headers.host !== host || (headers.origin !== undefined && headers.origin !== origin) ||
					headers['sec-fetch-site'] !== 'same-origin' || headers['sec-fetch-mode'] !== 'same-origin' ||
					headers['sec-fetch-dest'] !== 'empty' || headers['x-sentient-lifecycle'] !== '1') throw failure('FORBIDDEN');
				const route = request.url;
				if (!['/api/app-lifecycle/ready', '/api/app-lifecycle/session', '/api/app-lifecycle/leases'].includes(route)) {
					throw failure('LIFECYCLE_DISABLED');
				}
				const method = route.endsWith('/leases') ? 'POST' : 'GET';
				if (request.method !== method) {
					response.setHeader('Allow', method);
					throw failure('METHOD_NOT_ALLOWED');
				}
				available();
				if (method === 'GET') {
					if (headers['transfer-encoding'] !== undefined ||
						(headers['content-length'] !== undefined && headers['content-length'] !== '0')) throw failure('INVALID_REQUEST');
					if (route.endsWith('/ready')) reply(response, 200, { protocol: 1, instanceId, state: 'ready' });
					else reply(response, 200, { protocol: 1, instanceId, token, heartbeatMs: limits.heartbeatMs, leaseTtlMs: limits.leaseTtlMs });
					return;
				}
				if (headers.origin !== origin) throw failure('FORBIDDEN');
				const supplied = headers['x-sentient-lifecycle-token'];
				if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(supplied) ||
					!timingSafeEqual(Buffer.from(supplied), tokenBytes)) throw failure('FORBIDDEN');
				if (headers['content-type'] !== 'application/json') throw failure('UNSUPPORTED_CONTENT');
				if (headers['content-length'] !== undefined &&
					(!/^[0-9]+$/u.test(headers['content-length']) || Number(headers['content-length']) > limits.maxBodyBytes)) {
					throw failure('LIMIT_EXCEEDED');
				}
				const value = await readBody(request, limits);
				reply(response, 200, apply(value));
			} catch (error) {
				if (!Object.hasOwn(STATUS, error?.code)) throw error;
				fail(error.code);
			} finally {
				inFlight--;
			}
		},
	};
}
