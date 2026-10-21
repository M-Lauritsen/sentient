const ROUTE = '/api/app-lifecycle';
const ID = /^[A-Za-z0-9_-]{32}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const REQUEST_MS = 4000;

function documentId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

// Credentials and document identity never leave this instance except in authenticated requests.
export function createPwaLifecycle({
  fetchImpl = globalThis.fetch.bind(globalThis),
  document = globalThis.document,
  window = globalThis.window,
  clock = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  createId = documentId,
  onInvalidate = () => {},
  onReady = () => {},
  onStatus = () => {},
} = {}) {
  const windowId = createId();
  if (!/^[A-Za-z0-9_-]{22}$/u.test(windowId)) throw new TypeError('Invalid document identity');
  let session = null;
  let mode = 'unknown';
  let valid = false;
  let started = false;
  let closed = false;
  let parked = false;
  let timer;
  let controller;
  let pending = null;
  let generation = 0;
  let acceptedAt = 0;
  let failures = 0;
  let recheck = false;
  const listeners = [];

  const status = (state) => onStatus(state);
  function cancelTimer() { clearTimer(timer); timer = undefined; }
  function invalidate() {
    const wasValid = valid;
    valid = false;
    if (wasValid || mode === 'unknown') onInvalidate();
  }
  function schedule(ms) {
    cancelTimer();
    if (!closed && !parked) timer = setTimer(() => { timer = undefined; void run(); }, ms);
  }
  async function request(route, { body, signal, keepalive = false, boot = session } = {}) {
    const response = await fetchImpl(`${ROUTE}/${route}`, {
      method: body ? 'POST' : 'GET', mode: 'same-origin', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal, keepalive,
      headers: {
        'X-Sentient-Lifecycle': '1',
        ...(body ? { 'Content-Type': 'application/json', 'X-Sentient-Lifecycle-Token': boot.token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404 && route === 'session') {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Lifecycle unavailable'), { status: response.status });
    }
    // All successful lifecycle envelopes are far below this fixed bound.
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) throw new Error('Invalid lifecycle response');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  function lease(op, boot, signal, keepalive = false) {
    return request('leases', {
      body: { op, instanceId: boot.instanceId, windowId }, boot, signal, keepalive,
    }).then((value) => {
      if (value?.instanceId !== boot.instanceId || value.windowId !== windowId ||
          value.state !== (op === 'release' ? 'released' : 'active') || value.leaseTtlMs !== boot.leaseTtlMs) {
        throw new Error('Invalid lifecycle lease');
      }
    });
  }
  async function cycle(signal, current) {
    const usable = () => !closed && !parked && generation === current;
    try {
      if (valid && mode === 'owned' && clock() - acceptedAt >= session.heartbeatMs * 2) {
        invalidate();
        session = null;
      }
      if (!valid) {
        const boot = await request('session', { signal });
        if (!usable()) return;
        if (boot === null) {
          session = null;
          mode = 'manual';
          valid = true;
          failures = 0;
          onReady({ owned: false });
          status('manual');
          return;
        }
        if (boot?.protocol !== 1 || !ID.test(boot.instanceId) || !TOKEN.test(boot.token) ||
            boot.heartbeatMs !== 15000 || boot.leaseTtlMs !== 90000) throw new Error('Invalid lifecycle session');
        session = { instanceId: boot.instanceId, token: boot.token, heartbeatMs: boot.heartbeatMs, leaseTtlMs: boot.leaseTtlMs };
        await lease('register', session, signal);
        if (!usable()) return;
        mode = 'owned';
        valid = true;
        failures = 0;
        acceptedAt = clock();
        onReady({ owned: true });
        status('owned');
      } else if (mode === 'owned') {
        await lease('renew', session, signal);
        if (!usable()) return;
        acceptedAt = clock();
        failures = 0;
      }
      if (mode === 'owned') schedule(session.heartbeatMs);
    } catch (error) {
      if (!usable()) return;
      invalidate();
      session = null;
      status(error?.status === 429 ? 'busy' : 'unavailable');
      schedule(Math.min(15000, 1000 * 2 ** Math.min(failures++, 4)));
    }
  }
  function run() {
    if (closed || parked || pending) return pending;
    cancelTimer();
    const current = generation;
    controller = new AbortController();
    const active = controller;
    const timeout = setTimer(() => active.abort(), REQUEST_MS);
    pending = cycle(active.signal, current).finally(() => {
      clearTimer(timeout);
      controller = null;
      pending = null;
      if (recheck && !closed && !parked) {
        recheck = false;
        schedule(0);
      }
    });
    return pending;
  }
  function recover() {
    if (!started || closed) return;
    if (mode === 'manual') mode = 'unknown';
    invalidate();
    generation++;
    controller?.abort();
    session = null;
    parked = false;
    status('checking');
    cancelTimer();
    if (pending) recheck = true;
    else void run();
  }
  function pagehide() {
    if (closed) return;
    const boot = session;
    parked = true;
    invalidate();
    generation++;
    cancelTimer();
    controller?.abort();
    session = null;
    // Serialize the close hint after any in-flight heartbeat. Expiry handles lost delivery.
    if (pending || !boot) return;
    controller = new AbortController();
    const active = controller;
    const timeout = setTimer(() => active.abort(), REQUEST_MS);
    pending = lease('release', boot, active.signal, true)
      .catch(() => { if (parked && !closed) status('unavailable'); })
      .finally(() => {
        clearTimer(timeout);
        controller = null;
        pending = null;
        if (recheck && !closed && !parked) { recheck = false; schedule(0); }
      });
  }
  function listen(target, name, handler) {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  }
  return {
    start() {
      if (started || closed) return;
      started = true;
      listen(window, 'pagehide', pagehide);
      listen(window, 'pageshow', (event) => { if (event.persisted || parked) recover(); });
      listen(window, 'focus', () => { if (!parked) recover(); });
      listen(document, 'visibilitychange', () => { if (!document.hidden && !parked) recover(); });
      status('checking');
      void run();
    },
    checkFresh() {
      if (closed || parked || !valid) return false;
      if (mode === 'owned' && clock() - acceptedAt >= session.heartbeatMs * 2) {
        recover();
        return false;
      }
      return true;
    },
    recover,
    stop() {
      if (closed) return;
      closed = true;
      generation++;
      cancelTimer();
      controller?.abort();
      for (const remove of listeners.splice(0)) remove();
      session = null;
      valid = false;
    },
  };
}
