import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSentientServer } from '../server.mjs';
import { createLifecycle, lifecycleHeaders } from '../desktop/lifecycle.mjs';
import { probeReady } from '../desktop/launch.mjs';
import { createPwaLifecycle } from '../lifecycle/pwa-lifecycle-client.mjs';
import { browserClock, browserEvents, flush } from './fixtures/pwa-browser.mjs';

async function ownedServer(t, { clock = browserClock(), port = 0 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient browser e2e '));
  t.after(() => rm(root, { recursive: true, force: true }));
  let stopping;
  const lifecycle = createLifecycle({ ...clock, onStop: () => { stopping = app.stop(); } });
  const app = createSentientServer({
    activityRoot: root, libraryRoot: root, librarySettingsPath: path.join(root, 'settings.json'),
    lifecycle, port, pollIntervalMs: 0,
  });
  t.after(async () => { lifecycle.close(); await app.stop(); });
  const address = await app.start();
  const origin = `http://127.0.0.1:${address.port}`;
  lifecycle.start();
  return { app, lifecycle, clock, origin, port: address.port, stopped: () => stopping };
}

function page(t, server, id) {
  const document = browserEvents(), window = browserEvents(), clock = browserClock();
  const requests = [], events = [];
  let completions = 0;
  const client = createPwaLifecycle({
    ...clock, document, window, createId: () => id.repeat(22),
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method });
      const headers = new Headers(lifecycleHeaders(server.origin));
      for (const [name, value] of Object.entries(options.headers)) headers.set(name, value);
      const result = await fetch(`${server.origin}${url}`, {
        ...options, headers,
      });
      completions++;
      return result;
    },
    onReady: () => events.push('ready'), onInvalidate: () => events.push('unknown'),
  });
  t.after(() => client.stop());
  const settle = async (count) => {
    for (let i = 0; i < 200 && completions < count; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await flush();
    assert.ok(completions >= count, 'synthetic page completed its real HTTP requests');
  };
  return { client, document, window, requests, events, clock, settle };
}

test('real owned HTTP server: readiness precedes fake dispatch, documents aggregate, release and lost release stop ownership', async (t) => {
  const server = await ownedServer(t);
  const a = page(t, server, 'a'), b = page(t, server, 'b');
  const order = [];
  await probeReady({ origin: server.origin, instanceId: server.lifecycle.instanceId });
  order.push('ready');
  const dispatch = () => { order.push('dispatch'); a.client.start(); b.client.start(); };
  dispatch();
  await Promise.all([a.settle(2), b.settle(2)]);
  assert.deepEqual(order, ['ready', 'dispatch']);
  assert.equal(server.lifecycle.state, 'active');
  a.window.emit('pagehide');
  await a.settle(3);
  await server.clock.advance(30001);
  assert.equal(server.lifecycle.state, 'active', 'another live document preserves server ownership');
  b.window.emit('pagehide');
  await b.settle(3);
  await server.clock.advance(29999);
  assert.equal(server.lifecycle.state, 'empty-grace');
  await server.clock.advance(1);
  await server.stopped();
  await assert.rejects(fetch(`${server.origin}/api/app-lifecycle/ready`));

  const second = await ownedServer(t);
  const lost = page(t, second, 'c');
  lost.client.start(); await lost.settle(2);
  lost.client.stop(); // No release: models abrupt destruction of a document.
  await second.clock.advance(119999);
  assert.equal(second.lifecycle.state, 'empty-grace');
  await second.clock.advance(1);
  await second.stopped();
  await assert.rejects(fetch(`${second.origin}/api/app-lifecycle/ready`));
});

test('a surviving page reboots against a new owned instance without reusing its old capability', async (t) => {
  const first = await ownedServer(t);
  const p = page(t, first, 'd');
  p.client.start(); await p.settle(2);
  p.window.emit('pagehide', { persisted: true }); await p.settle(3);
  first.lifecycle.close();
  await first.app.stop();
  const second = await ownedServer(t, { port: first.port });
  assert.notEqual(first.lifecycle.instanceId, second.lifecycle.instanceId);
  p.window.emit('pageshow', { persisted: true });
  await p.settle(5);
  assert.deepEqual(p.events, ['ready', 'unknown', 'ready']);
  assert.equal(second.lifecycle.state, 'active');
  assert.equal(p.client.checkFresh(), true);
  assert.deepEqual(p.requests.slice(-2).map(({ url }) => url),
    ['/api/app-lifecycle/session', '/api/app-lifecycle/leases']);
});

test('ordinary HTTP server supports pages without lifecycle ownership; new browser module is explicitly served', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient manual page '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = createSentientServer({ activityRoot: root, port: 0, pollIntervalMs: 0 });
  t.after(() => app.stop());
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const p = page(t, { origin }, 'e');
  p.client.start(); await p.settle(1);
  assert.equal(p.client.checkFresh(), true);
  await p.clock.advance(120000);
  assert.equal(p.requests.length, 1);
  assert.equal((await fetch(origin)).status, 200);
  const module = await fetch(`${origin}/pwa-lifecycle-client.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/u);
  assert.equal(module.headers.get('cache-control'), 'no-store');
});
