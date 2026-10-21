export const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };

export function browserClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    clock: () => now,
    setTimer(callback, ms) { const key = ++id; timers.set(key, { callback, at: now + ms }); return key; },
    clearTimer(key) { timers.delete(key); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
    jump(ms) { now += ms; },
    get timers() { return timers.size; },
  };
}

export function browserEvents() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name, event = {}) { for (const handler of listeners.get(name) ?? []) handler(event); },
    get listeners() { return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
  };
}

export const boot = (letter = 'a') => ({
  protocol: 1, instanceId: letter.repeat(32), token: letter.repeat(43),
  heartbeatMs: 15000, leaseTtlMs: 90000,
});
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
export const success = (request) => json({
  instanceId: request.instanceId, windowId: request.windowId,
  state: request.op === 'release' ? 'released' : 'active', leaseTtlMs: 90000,
});
