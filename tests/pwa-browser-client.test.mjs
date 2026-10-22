import test from 'node:test';
import assert from 'node:assert/strict';
import { createPwaLifecycle } from '../pwa-lifecycle-client.mjs';
import { browserClock, browserEvents, boot, json, success, flush } from './fixtures/pwa-browser.mjs';

function setup(t, fetchImpl) {
  const clock = browserClock(), document = browserEvents(), window = browserEvents();
  const calls = [], states = [], events = [];
  let active = 0, maximum = 0;
  const client = createPwaLifecycle({
    ...clock, document, window, createId: () => 'z'.repeat(22),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      maximum = Math.max(maximum, ++active);
      try {
        return fetchImpl ? await fetchImpl(url, options, calls.length)
          : url.endsWith('/session') ? json(boot()) : success(JSON.parse(options.body));
      } finally { active--; }
    },
    onInvalidate: () => events.push('unknown'),
    onReady: ({ owned }) => events.push(owned ? 'owned' : 'manual'),
    onStatus: (state) => states.push(state),
  });
  t.after(() => client.stop());
  return { client, clock, document, window, calls, states, events, maximum: () => maximum };
}

test('bootstraps and registers before readiness; renews hidden documents at 15s without storage or overlap', async (t) => {
  const f = setup(t);
  f.client.start();
  assert.equal(f.client.checkFresh(), false);
  await flush();
  assert.deepEqual(f.events, ['owned']);
  assert.equal(f.client.checkFresh(), true);
  assert.equal(f.calls[0].url, '/api/app-lifecycle/session');
  assert.deepEqual(JSON.parse(f.calls[1].body), {
    op: 'register', instanceId: 'a'.repeat(32), windowId: 'z'.repeat(22),
  });
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  await f.clock.advance(15000);
  assert.equal(JSON.parse(f.calls.at(-1).body).op, 'renew');
  assert.equal(f.maximum(), 1);
  for (const call of f.calls) {
    assert.equal(call.mode, 'same-origin');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.redirect, 'error');
    assert.equal(call.url.includes('token'), false);
  }
  f.client.stop();
  await flush();
  assert.equal(f.clock.timers, 0);
  assert.equal(f.window.listeners + f.document.listeners, 0);
});

test('ordinary 404 mode continues activity without heartbeats or server ownership', async (t) => {
  const f = setup(t, async () => json({}, 404));
  f.client.start(); await flush();
  assert.deepEqual(f.events, ['manual']);
  assert.equal(f.client.checkFresh(), true);
  await f.clock.advance(150000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.clock.timers, 0);
});

test('403/409 renewal failure invalidates immediately and refreshes boot before registration', async (t) => {
  for (const status of [403, 409]) {
    let sessions = 0;
    const f = setup(t, async (url, options) => {
      if (url.endsWith('/session')) return json(boot(++sessions === 1 ? 'a' : 'b'));
      const body = JSON.parse(options.body);
      return body.op === 'renew' ? json({}, status) : success(body);
    });
    f.client.start(); await flush();
    await f.clock.advance(15000);
    assert.equal(f.client.checkFresh(), false);
    assert.deepEqual(f.events, ['owned', 'unknown']);
    await f.clock.advance(1000);
    assert.deepEqual(f.events, ['owned', 'unknown', 'owned']);
    assert.equal(f.calls.at(-1).headers['X-Sentient-Lifecycle-Token'], 'b'.repeat(43));
    assert.equal(JSON.parse(f.calls.at(-1).body).op, 'register');
  }
});

test('capacity failures use bounded backoff without claiming readiness', async (t) => {
  const f = setup(t, async (url) => url.endsWith('/session') ? json(boot()) : json({}, 429));
  f.client.start(); await flush();
  assert.equal(f.events.includes('owned'), false);
  await f.clock.advance(1000 + 2000 + 4000 + 8000 + 15000);
  assert.equal(f.calls.length, 12);
  assert.equal(f.maximum(), 1);
  assert.equal(f.states.at(-1), 'busy');
  f.client.stop(); await flush();
  assert.equal(f.clock.timers, 0);
});

test('late scheduling is fenced before an activity callback; focus and visibility revalidate before ready', async (t) => {
  const f = setup(t);
  f.client.start(); await flush();
  f.clock.jump(91000);
  assert.equal(f.client.checkFresh(), false);
  assert.deepEqual(f.events, ['owned', 'unknown']);
  await flush();
  assert.equal(f.client.checkFresh(), true);
  f.window.emit('focus');
  assert.equal(f.client.checkFresh(), false);
  await flush();
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  assert.equal(f.client.checkFresh(), false);
  await flush();
  assert.equal(f.events.filter((value) => value === 'owned').length, 4);
});

test('pagehide sends authenticated keepalive hint, bfcache pageshow reboots the same live document', async (t) => {
  const f = setup(t);
  f.client.start(); await flush();
  f.window.emit('pagehide', { persisted: true });
  assert.equal(f.client.checkFresh(), false);
  await flush();
  assert.equal(f.calls.at(-1).keepalive, true);
  assert.equal(JSON.parse(f.calls.at(-1).body).op, 'release');
  f.window.emit('pageshow', { persisted: true });
  await flush();
  assert.equal(JSON.parse(f.calls.at(-1).body).op, 'register');
  assert.equal(f.client.checkFresh(), true);
  assert.equal(f.maximum(), 1);
});

test('aborted/slow bootstrap times out; repeated focus never overlaps requests or accepts a stale response', async (t) => {
  let aborted = 0;
  const f = setup(t, (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted++;
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  }));
  f.client.start();
  await f.clock.advance(4000);
  assert.equal(aborted, 1);
  assert.equal(f.states.at(-1), 'unavailable');
  await f.clock.advance(1000);
  f.window.emit('focus');
  f.window.emit('focus');
  await flush();
  await f.clock.advance(0);
  assert.equal(f.maximum(), 1);
  assert.equal(f.events.includes('owned'), false);
  f.client.stop(); await flush();
  assert.equal(f.clock.timers, 0);
});

test('malformed and oversized bootstrap envelopes never enable activity', async (t) => {
  for (const value of [{ ...boot(), token: 'invalid' }, { ...boot(), heartbeatMs: 1 }, 'x'.repeat(9000)]) {
    const f = setup(t, async () => json(value));
    f.client.start(); await flush();
    assert.equal(f.client.checkFresh(), false);
    assert.equal(f.events.includes('owned'), false);
    assert.equal(f.states.at(-1), 'unavailable');
  }
});

test('a close during renewal skips overlapping release, and returning revalidates before re-enabling activity', async (t) => {
  let unblock;
  const f = setup(t, async (url, options) => {
    if (url.endsWith('/session')) return json(boot());
    const body = JSON.parse(options.body);
    if (body.op === 'renew') {
      await new Promise((resolve) => { unblock = resolve; });
    }
    return success(body);
  });
  f.client.start(); await flush();
  await f.clock.advance(15000);
  f.window.emit('pagehide', { persisted: true });
  assert.equal(f.client.checkFresh(), false);
  assert.equal(f.calls.some(({ body }) => body && JSON.parse(body).op === 'release'), false);
  f.window.emit('pageshow', { persisted: true });
  unblock(); await flush();
  await f.clock.advance(0);
  assert.equal(f.maximum(), 1);
  assert.equal(f.client.checkFresh(), true);
  assert.equal(JSON.parse(f.calls.at(-1).body).op, 'register');
});

test('failed keepalive release stays invalid and expiry is the fallback, not an unauthenticated retry', async (t) => {
  const f = setup(t, async (url, options) => {
    if (url.endsWith('/session')) return json(boot());
    const body = JSON.parse(options.body);
    return body.op === 'release' ? json({}, 503) : success(body);
  });
  f.client.start(); await flush();
  f.window.emit('pagehide'); await flush();
  assert.equal(f.client.checkFresh(), false);
  const count = f.calls.length;
  await f.clock.advance(120000);
  assert.equal(f.calls.length, count);
  assert.equal(f.calls.at(-1).headers['X-Sentient-Lifecycle-Token'], 'a'.repeat(43));
  assert.equal(f.clock.timers, 0);
});
