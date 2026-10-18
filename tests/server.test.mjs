import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { createSentientServer } from '../server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function record(type, data = {}) {
  return JSON.stringify({ id: `${type}-${Date.now()}`, type, data }) + '\n';
}

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
  assert.doesNotMatch(html, /https?:\/\//);
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(map);
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(map.replace(/\r\n?/g, '\n')).digest('base64')}'`));
  const three = await fetch(`${base}/vendor/three.module.js`);
  assert.equal(three.status, 200);
  assert.match(three.headers.get('content-type'), /javascript/);
  const privatePath = await fetch(`${base}/plans/sentient-copilot/spec.md`);
  assert.equal(privatePath.status, 404);
  const traversal = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(traversal.status, 404);
  const navigationStatus = await new Promise((resolve, reject) => {
    const request = httpGet(base, {
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(navigationStatus, 200);
  const crossSiteAsset = await fetch(`${base}/main.js`, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSiteAsset.status, 403);
});

test('SSE emits sanitized current snapshot, live deltas, and never replays prior completions', async (t) => {
  const activityRoot = await fixture(t);
  const session = path.join(activityRoot, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, record('assistant.turn_start', { turnId: 'historic' }) +
    record('session.task_complete', { success: true, outcome: 'completed', summary: 'PRIVATE HISTORIC TEXT' }));
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
  assert.doesNotMatch(initial, /completion|PRIVATE HISTORIC TEXT|historic/);
  assert.match(initial, /"runningSessions":0,"unverifiedRunningSessions":0/);

  await appendFile(file, record('assistant.turn_start', { turnId: 'live' }) +
    record('tool.execution_start', { toolCallId: 'live-call', toolName: 'functions.view', arguments: 'PRIVATE LIVE TEXT' }));
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

  await appendFile(file,
    record('tool.execution_complete', { toolCallId: 'live-call' }) +
    record('session.task_complete', { success: true, outcome: 'completed', summary: 'PRIVATE COMPLETION' }));
  await app.source.poll();
  const reconnected = await fetch(`${base}/events`, {
    headers: { host: `127.0.0.1:${address.port}`, origin: base, 'sec-fetch-site': 'same-origin' },
  });
  const reconnectReader = reconnected.body.getReader();
  const reconnectSnapshot = new TextDecoder().decode((await reconnectReader.read()).value);
  assert.match(reconnectSnapshot, /event: snapshot/);
  assert.doesNotMatch(reconnectSnapshot, /event: activity|completion|PRIVATE COMPLETION|toolName/);
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
  const connect = () => fetch(`${base}/events`, {
    headers: { origin: base }, signal: AbortSignal.timeout(5000),
  });
  const original = (await connect()).body.getReader();
  await original.read();
  await appendFile(files[0], record('assistant.turn_start', { turnId: 'live' }) +
    record('session.task_complete', { success: true, outcome: 'completed' }));
  await appendFile(files[1], record('future.after_admission'));
  const readNormally = app.source.readFile.bind(app.source);
  let release;
  let notifyPaused;
  const paused = new Promise((resolve) => { notifyPaused = resolve; });
  const resume = new Promise((resolve) => { release = resolve; });
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
    assert.doesNotMatch(newcomerText, /event: activity|eventType|completion/);
    assert.equal(app.source.pendingActivities.size, 0);
  } finally {
    release();
    await polling;
    app.source.readFile = readNormally;
  }
  while (!newcomerText.includes('future.after_admission')) {
    newcomerText += new TextDecoder().decode((await newcomer.read()).value);
  }
  assert.doesNotMatch(newcomerText, /completion|session.task_complete|assistant.turn_start/);
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
        headers: { origin: base }, signal: AbortSignal.timeout(5000),
      });
      const reader = response.body.getReader();
      await reader.read();
      await appendFile(file, Array.from({ length: 500 }, (_, i) => JSON.stringify({
        id: `token-${i}`, type: 'assistant.message_delta', data: { content: 'PRIVATE' },
      }) + '\n').join('') + record('future.event', null) +
        record('tool.execution_progress', { toolName: 'functions.view', result: 'PRIVATE' }));
      await app.source.poll();
      let text = '';
      while (!text.includes('"eventType":"tool.execution_progress"')) {
        const part = await reader.read();
        assert.equal(part.done, false);
        text += new TextDecoder().decode(part.value);
      }
      const activities = text.split('\n\n').filter((part) => part.includes('event: activity'))
        .map((part) => JSON.parse(part.split('\ndata: ')[1]));
      assert.equal(activities.length, 3);
      assert.deepEqual(activities.map(({ kind, eventType, count, toolName }) => ({ kind, eventType, count, toolName })), [
        { kind: 'activity', eventType: 'assistant.message_delta', count: 500, toolName: undefined },
        { kind: 'activity', eventType: 'future.event', count: undefined, toolName: undefined },
        { kind: 'activity', eventType: 'tool.execution_progress', count: undefined, toolName: 'functions.view' },
      ]);
      assert.doesNotMatch(text, /PRIVATE|content|result|token-|session"/);
      await reader.cancel();
      const reconnect = await fetch(`${base}/events`, { headers: { origin: base } });
      const reconnectReader = reconnect.body.getReader();
      const initial = new TextDecoder().decode((await reconnectReader.read()).value);
      assert.doesNotMatch(initial, /eventType|toolName|event: activity|count":500/);
      await reconnectReader.cancel();
});

test('rejects hostile host/origin and connection caps fail closed', async (t) => {
  const activityRoot = await fixture(t);
  const app = createSentientServer({ activityRoot, port: 0, maxClients: 1, pollIntervalMs: 0 });
  t.after(() => app.stop());
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = httpGet({
      hostname: '127.0.0.1',
      port: address.port,
      path: '/',
      headers: { host: 'attacker.invalid' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
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
