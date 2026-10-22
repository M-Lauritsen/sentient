import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { createSentientServer } from '../server.mjs';
import { createLibrarySource } from '../copilot/library-source.mjs';
import { buildLibraryHelper } from '../copilot/library-native.mjs';
import { createLibraryMarkdownRenderer } from '../copilot/library-markdown.mjs';

const markers = Object.freeze({
  body: 'SYNTHETIC_LIBRARY_BODY_BOUNDARY',
  metadata: 'SYNTHETIC_LIBRARY_METADATA_BOUNDARY',
  settings: 'SYNTHETIC_REGISTRATION_PATH_BOUNDARY',
  excluded: 'SYNTHETIC_EXCLUDED_TREE_BOUNDARY',
  activity: 'SYNTHETIC_PRIVATE_ACTIVITY_BOUNDARY',
});
const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function treeHashes(root, prefix = '') {
  const hashes = {};
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) Object.assign(hashes, await treeHashes(root, relative));
    else hashes[relative] = hash(await readFile(path.join(root, relative)));
  }
  return hashes;
}

function browserHeaders(origin, token) {
  return {
    origin, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'same-origin',
    'sec-fetch-dest': 'empty', ...(token ? { 'x-sentient-library-token': token } : {}),
  };
}

function parserWorker() {
  const worker = new Worker(new URL('./helpers/library-render-worker.mjs', import.meta.url));
  return {
    postMessage: (value) => worker.postMessage(value),
    terminate: () => worker.terminate(),
    addEventListener: (type, callback) => worker.on(type,
      type === 'message' ? (data) => callback({ data }) : callback),
  };
}

async function integration() {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'sentient-library-regressions-'));
  const activityRoot = path.join(fixture, 'journals');
  const libraryRoot = path.join(fixture, 'default');
  const extraRoot = path.join(fixture, markers.settings);
  const settingsPath = path.join(fixture, 'private', 'library');
  const executable = path.join(fixture, 'LibraryHelper.exe');
  let app, reader, renderer, dom;
  const requests = [];
  const browserLogs = [];
  let libraryConstructions = 0;
  const start = async ({ disabled = false } = {}) => {
    app = createSentientServer({
      activityRoot, libraryRoot, librarySettingsPath: settingsPath,
      host: '127.0.0.1', port: 0, pollIntervalMs: 0,
      librarySourceFactory: (options) => {
        libraryConstructions++;
        if (disabled) throw Object.assign(new Error('SAFETY_UNSUPPORTED'), { code: 'SAFETY_UNSUPPORTED' });
        return createLibrarySource({ ...options, executable });
      },
    });
    const { port } = await app.start();
    const origin = `http://127.0.0.1:${port}`;
    const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
      mode: 'same-origin', headers: browserHeaders(origin),
    });
    assert.equal(bootstrap.status, 200);
    const { token } = await bootstrap.json();
    return {
      origin,
      async request(route, { method = 'GET', body, status = 200 } = {}) {
        const response = await fetch(`${origin}${route}`, {
          method, mode: 'same-origin', headers: {
            ...browserHeaders(origin, token),
            ...(body ? { 'content-type': 'application/json' } : {}),
          }, ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, status, `${method} ${route}`);
        return response.json();
      },
    };
  };
  const event = (type, data) => `${JSON.stringify({ type, data })}\n`;
  try {
    await buildLibraryHelper(executable);
    const journal = path.join(activityRoot, 'synthetic-session', 'events.jsonl');
    await mkdir(path.dirname(journal), { recursive: true });
    await writeFile(journal, '');
    const documents = [
      ['agents/main.agent.md', `---\nname: Synthetic Reader\nunknown: ${markers.metadata}\n---\n# Reader\n\n${markers.body}\n\n[Support](support.md#section)\n\n![Remote](https://example.invalid/image)\n[Remote](https://example.invalid/link)\n<script src="https://example.invalid/script"></script>\n<iframe src="https://example.invalid/frame"></iframe>\n`],
      ['agents/support.md', '# Section\n\nSynthetic local support.\n'],
      ['skills/sample/SKILL.md', '# Synthetic Skill\n'],
      ['skills/sample/notes.md', '# Synthetic support\n'],
      ['skills/orphan.md', '# Synthetic orphan\n'],
      ['instructions/sample.instructions.md', '# Synthetic instructions\n'],
      ['root-secret.md', markers.excluded],
      ['agents/program.exe', markers.excluded],
    ];
    for (const category of ['agents', 'skills', 'instructions']) {
      for (const excluded of ['session-state', '.git', 'node_modules']) {
        documents.push([`${category}/${excluded}/hidden.md`, markers.excluded]);
      }
    }
    documents.push(['session-state/private/events.jsonl', markers.excluded]);
    for (const [relative, content] of documents) {
      const file = path.join(libraryRoot, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    await mkdir(extraRoot);
    await writeFile(path.join(extraRoot, 'extra.md'), '# Synthetic extra\n');
    const beforeDefault = await treeHashes(libraryRoot);
    const beforeExtra = await treeHashes(extraRoot);
    let client = await start();

    // Subscribe before viewing/mutating Library; exercise live frames as well
    // as snapshots. All connections are to this captured ephemeral origin.
    const sse = await fetch(`${client.origin}/events`, {
      headers: { origin: client.origin }, signal: AbortSignal.timeout(15_000),
    });
    assert.equal(sse.status, 200);
    reader = sse.body.getReader();
    let stream = '';
    const readUntil = async (predicate) => {
      while (!predicate(stream)) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        stream += new TextDecoder().decode(value);
      }
    };
    const frames = (value) => value.split('\n\n').slice(0, -1);
    await readUntil((value) => frames(value).some((frame) => frame.startsWith('event: snapshot')));
    let snapshot = await client.request('/api/library');
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.files.length, 6);
    assert.equal(JSON.stringify(snapshot).includes(markers.excluded), false);
    assert.ok(snapshot.files.some((file) => file.kind === 'support'));
    assert.ok(snapshot.files.some((file) => file.kind === 'unassociated'));
    assert.ok(!snapshot.files.some((file) => /session-state|node_modules|\.git|root-secret|program\.exe/.test(file.relativePath)));
    const main = snapshot.files.find((file) => file.relativePath === 'main.agent.md');
    const detail = await client.request(`/api/library/files/${main.id}`);
    assert.ok(detail.markdown.includes(markers.body));
    assert.ok(detail.markdown.includes(markers.metadata));
    assert.equal(Object.keys(detail.links).length, 1);
    assert.ok(detail.links['support.md#section']);
    assert.equal(JSON.stringify(snapshot).includes(markers.activity), false);

    // Execute the real shipped parser bundle and DOM constructor against the
    // HTTP detail, with every DOM resource/fetch attempt intercepted locally.
    class NoResources extends ResourceLoader {
      fetch(url) { requests.push(String(url)); return null; }
    }
    const virtualConsole = new VirtualConsole();
    for (const kind of ['log', 'info', 'warn', 'error', 'jsdomError']) {
      virtualConsole.on(kind, (...values) => browserLogs.push(values.join(' ')));
    }
    dom = new JSDOM('<!doctype html><main></main>', {
      url: `${client.origin}/`, resources: new NoResources(), runScripts: 'dangerously', virtualConsole,
      beforeParse(window) {
        window.fetch = (url) => { requests.push(String(url)); throw new Error('network denied'); };
        window.XMLHttpRequest = class { open(_method, url) { requests.push(String(url)); } };
      },
    });
    const pane = dom.window.document.querySelector('main');
    let navigated;
    renderer = createLibraryMarkdownRenderer({ pane, workerFactory: parserWorker });
    const rendered = await renderer.render(detail, {
      generation: snapshot.generation, files: snapshot.files,
      fileIds: snapshot.files.map((file) => file.id), onNavigate: (id) => { navigated = id; },
    });
    assert.equal(rendered.status, 'rendered');
    assert.ok(pane.textContent.includes(markers.body));
    assert.ok(pane.textContent.includes(markers.metadata));
    assert.equal(pane.querySelectorAll('script,img,iframe,style,link,object,embed').length, 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(browserLogs, []);
    const anchors = [...pane.querySelectorAll('a')];
    assert.equal(anchors.length, 1, 'only the mapped local link is interactive');
    anchors[0].click();
    assert.deepEqual(navigated, {
      fileId: detail.links['support.md#section'].fileId, fragment: 'section',
    });

    const added = await client.request('/api/library/roots', {
      method: 'POST', status: 201,
      body: { revision: snapshot.revision, path: extraRoot, mode: 'category', category: 'instructions' },
    });
    snapshot = added.snapshot;
    const saved = await readFile(path.join(settingsPath, 'settings.json'));
    assert.ok(saved.toString().includes(markers.settings));
    for (const marker of [markers.body, markers.metadata, markers.activity, markers.excluded]) {
      assert.equal(saved.toString().includes(marker), false);
    }
    assert.equal(JSON.stringify(snapshot).includes(markers.settings), false);
    await client.request('/api/library/roots', {
      method: 'POST', status: 400,
      body: { revision: snapshot.revision, path: path.join(libraryRoot, 'session-state'), mode: 'root' },
    });
    const excludedResponse = await fetch(`${client.origin}/private/library/settings.json`);
    assert.equal(excludedResponse.status, 404);
    for (const file of snapshot.files) {
      const current = await client.request(`/api/library/files/${file.id}`);
      assert.equal(current.markdown.includes(markers.excluded), false);
      assert.equal(current.markdown.includes(markers.activity), false);
    }

    await appendFile(journal, event('assistant.turn_start', { turnId: markers.activity }) +
      event('assistant.message', { content: markers.activity }) +
      event('tool.execution_start', {
        toolCallId: 'synthetic-call', toolName: 'functions.view',
        arguments: { path: markers.activity },
      }));
    const journalBeforePoll = await readFile(journal);
    await app.source.poll();
    await readUntil((value) =>
      ['assistant.message', 'tool.execution_start'].every((type) =>
        frames(value).some((frame) => frame.includes(`"eventType":"${type}"`))));
    for (const marker of Object.values(markers)) assert.equal(stream.includes(marker), false);
    assert.ok(stream.includes('"functions.view"'), 'bounded activity still arrives');
    assert.ok(stream.includes('"stats"'), 'statistics snapshot remains available');
    assert.deepEqual(await readFile(journal), journalBeforePoll, 'polling is read-only');
    // Check the converse boundary after the private activity marker exists,
    // not just against the initially empty journal.
    snapshot = await client.request('/api/library/refresh', {
      method: 'POST', body: { revision: snapshot.revision },
    });
    for (const file of snapshot.files) {
      const current = await client.request(`/api/library/files/${file.id}`);
      assert.equal(current.markdown.includes(markers.activity), false);
      assert.equal(current.markdown.includes(markers.excluded), false);
    }
    await reader.cancel(); reader = undefined;

    // Original scene/feed/timeline/palette/settings modules remain served.
    for (const route of ['/', '/main.js', '/activity/activity-client.mjs', '/activity/activity-colors.mjs',
      '/ui/session-stats-ui.mjs', '/visual-settings.mjs', '/appearance/visual-settings-ui.mjs', '/style.css']) {
      const response = await fetch(`${client.origin}${route}`);
      assert.equal(response.status, 200, route);
      const text = await response.text();
      for (const marker of Object.values(markers)) assert.equal(text.includes(marker), false);
    }
    const appIndex = await (await fetch(`${client.origin}/`)).text();
    assert.match(appIndex, /visual-settings-open/);
    assert.match(appIndex, /timeline/);

    await app.stop();
    client = await start();
    snapshot = await client.request('/api/library');
    assert.equal(snapshot.sources.length, 2, 'registration persists through isolated server restart');
    const extra = snapshot.sources.find((source) => !source.isDefault);
    const oldFile = snapshot.files[0].id;
    snapshot = await client.request('/api/library/refresh', {
      method: 'POST', body: { revision: snapshot.revision },
    });
    await client.request(`/api/library/files/${oldFile}`, { status: 404 });
    const removed = await client.request(`/api/library/roots/${extra.id}`, {
      method: 'DELETE', body: { revision: snapshot.revision },
    });
    assert.equal(removed.snapshot.sources.length, 1);
    assert.deepEqual(await treeHashes(extraRoot), beforeExtra, 'unregister never deletes source bytes');

    // Dormant/unavailable-Library rollback seam, not a claim that production
    // has a runtime disable flag or that routes/assets were actually removed.
    // A stopped Library and ignored settings must not gate original HTTP/SSE.
    const retainedSettings = await readFile(path.join(settingsPath, 'settings.json'));
    await app.stop();
    const previousConstructions = libraryConstructions;
    client = await start({ disabled: true });
    for (const route of ['/', '/main.js', '/activity/activity-client.mjs', '/visual-settings.mjs']) {
      assert.equal((await fetch(`${client.origin}${route}`)).status, 200);
    }
    const dormantSse = await fetch(`${client.origin}/events`, {
      headers: { origin: client.origin }, signal: AbortSignal.timeout(15_000),
    });
    reader = dormantSse.body.getReader();
    let dormantFrame = '';
    while (!dormantFrame.includes('\n\n')) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      dormantFrame += new TextDecoder().decode(value);
    }
    assert.match(dormantFrame, /event: snapshot/);
    for (const marker of Object.values(markers)) assert.equal(dormantFrame.includes(marker), false);
    await reader.cancel(); reader = undefined;
    assert.equal(libraryConstructions, previousConstructions, 'original routes never start Library work');
    const unavailable = await client.request('/api/library', { status: 403 });
    assert.equal(unavailable.error.code, 'SAFETY_UNSUPPORTED');
    assert.equal((await fetch(`${client.origin}/main.js`)).status, 200);
    assert.deepEqual(await readFile(path.join(settingsPath, 'settings.json')), retainedSettings,
      'unavailable Library does not reset or auto-delete settings');
    assert.deepEqual(await treeHashes(libraryRoot), beforeDefault);
    assert.deepEqual(await treeHashes(extraRoot), beforeExtra);
    assert.deepEqual(await readFile(journal), journalBeforePoll);
  } finally {
    await reader?.cancel();
    renderer?.dispose();
    dom?.window.close();
    await app?.stop();
    await rm(fixture, { recursive: true, force: true });
  }
}

if (process.argv.includes('--library-regression-child')) {
  await integration();
  console.log('Synthetic Library integration completed; fixture removed.');
} else {
  test('isolated Library privacy, inert resources, persistence, unregister and dormant rollback invariants',
    { timeout: 90_000 }, async () => {
      // Capture actual server/renderer/native-wrapper process output, not just
      // mocked console methods. No private source is used even on failure.
      const { stdout, stderr } = await run(process.execPath,
        [fileURLToPath(import.meta.url), '--library-regression-child'], { timeout: 80_000 });
      assert.match(stdout, /Synthetic Library integration completed; fixture removed\./);
      assert.equal(stderr, '');
      for (const marker of Object.values(markers)) {
        assert.equal((stdout + stderr).includes(marker), false, 'synthetic marker escaped into process logs');
      }
    });
}
