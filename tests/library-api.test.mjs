import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createSentientServer } from '../server.mjs';
import { createLibrarySource } from '../copilot/library-source.mjs';
import { buildLibraryHelper } from '../copilot/library-native.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sentient-library-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function browserHeaders(origin, token) {
  return {
    origin,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'same-origin',
    'sec-fetch-dest': 'empty',
    ...(token ? { 'x-sentient-library-token': token } : {}),
  };
}

function rawRequest(url, headers) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('library browser authorization rejects before source construction and bootstrap is non-discovering', async (t) => {
  const directory = await fixture(t);
  let constructions = 0;
  const app = createSentientServer({
    activityRoot: path.join(directory, 'activity'),
    port: 0,
    librarySourceFactory: () => {
      constructions++;
      throw new Error('source should not be initialized');
    },
  });
  t.after(() => app.stop());
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;

  for (const [url, headers, mode] of [
    [`${origin}/api/library/bootstrap`, { ...browserHeaders(origin), 'sec-fetch-site': 'cross-site' }, 'same-origin'],
    [`${origin}/api/library/bootstrap`, { ...browserHeaders(origin) }, 'cors'],
    [`${origin}/api/library/bootstrap`, { ...browserHeaders(origin), origin: 'null' }, 'same-origin'],
    [`${origin}/api/library`, browserHeaders(origin), 'same-origin'],
  ]) {
    const response = await fetch(url, { mode, headers });
    assert.equal(response.status, 403, `${url} ${JSON.stringify(headers)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-type'), /^application\/json\b/u);
  }
  const forgedHost = await rawRequest(`${origin}/api/library/bootstrap`, {
    ...browserHeaders(origin),
    host: '127.0.0.1:1',
  });
  assert.equal(forgedHost.status, 403);
  assert.equal(forgedHost.headers['cache-control'], 'no-store');
  assert.match(forgedHost.headers['content-type'], /^application\/json\b/u);
  assert.equal(constructions, 0, 'rejected requests and bootstrap must not initialize the library');

  const forgedMutation = await fetch(`${origin}/api/library/roots`, {
    mode: 'same-origin',
    method: 'POST',
    headers: {
      ...browserHeaders('http://example.invalid'),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(forgedMutation.status, 403);
  assert.equal(constructions, 0, 'a forged-origin mutation must be rejected before source construction');

  const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
    mode: 'same-origin',
    headers: browserHeaders(origin),
  });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
  const payload = await bootstrap.json();
  assert.deepEqual(Object.keys(payload), ['token']);
  assert.match(payload.token, /^[A-Za-z0-9_-]{32,64}$/u);
  assert.equal(constructions, 0, 'bootstrap must not discover files or start a source');

  for (const [route, method] of [
    ['/api/library/refresh', 'POST'],
    ['/api/library/roots', 'POST'],
    [`/api/library/roots/${'A'.repeat(32)}`, 'DELETE'],
  ]) {
    const missingOriginHeaders = browserHeaders(origin, payload.token);
    delete missingOriginHeaders.origin;
    const missingOriginMutation = await fetch(`${origin}${route}`, {
      mode: 'same-origin',
      method,
      headers: { ...missingOriginHeaders, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(missingOriginMutation.status, 403, `${method} ${route}`);
    assert.equal(constructions, 0, `${method} without exact Origin must be rejected before source construction`);
  }
});

test('slow library request bodies time out with bounded JSON before source construction', async (t) => {
  const directory = await fixture(t);
  let constructions = 0;
  const app = createSentientServer({
    activityRoot: path.join(directory, 'activity'),
    libraryRequestTimeoutMs: 100,
    port: 0,
    librarySourceFactory: () => {
      constructions++;
      return {};
    },
  });
  t.after(() => app.stop());
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
    mode: 'same-origin',
    headers: browserHeaders(origin),
  });
  const { token } = await bootstrap.json();
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/library/refresh',
      method: 'POST',
      headers: {
        ...browserHeaders(origin, token),
        'content-type': 'application/json',
        'content-length': '100',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.setTimeout(1000, () => request.destroy(new Error('test request timed out')));
    request.write('{"revision":"');
  });
  assert.equal(result.status, 504, result.body);
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers.connection, 'close');
  assert.equal(JSON.parse(result.body).error.code, 'TIMEOUT');
  assert.equal(constructions, 0, 'a timed-out mutation must not construct the library source');
});

test('loopback API lists, reads, registers and rejects hostile requests using synthetic roots', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sentient-library-api-'));
  let app;
  t.after(async () => {
    try {
      await app?.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  const activityRoot = path.join(directory, 'activity');
  const libraryRoot = path.join(directory, 'default');
  const extraRoot = path.join(directory, 'extra');
  const rootExtra = path.join(directory, 'root-extra');
  const settingsPath = path.join(directory, 'private', 'library');
  const executable = path.join(directory, 'LibraryHelper.exe');
  await buildLibraryHelper(executable);
  await mkdir(activityRoot);
  await mkdir(path.join(libraryRoot, 'agents'), { recursive: true });
  await mkdir(extraRoot);
  await mkdir(path.join(rootExtra, 'agents'), { recursive: true });
  await writeFile(path.join(libraryRoot, 'agents', 'Example.agent.md'), '# Synthetic Agent\n');
  await writeFile(path.join(extraRoot, 'Custom.md'), '# Extra Instructions\n');
  await writeFile(path.join(rootExtra, 'agents', 'Root.md'), '# Additional Root Agent\n');
  let constructions = 0;
  app = createSentientServer({
    activityRoot,
    libraryRoot,
    librarySettingsPath: settingsPath,
    port: 0,
    librarySourceFactory: (options) => {
      constructions++;
      return createLibrarySource({ ...options, executable });
    },
  });
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
    mode: 'same-origin',
    headers: browserHeaders(origin),
  });
  assert.equal(bootstrap.status, 200);
  const { token } = await bootstrap.json();

  const request = (route, options = {}) => fetch(`${origin}${route}`, {
    ...options,
    mode: 'same-origin',
    headers: { ...browserHeaders(origin, token), ...(options.headers ?? {}) },
  });
  const listResponse = await request('/api/library');
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get('cache-control'), 'no-store');
  const snapshot = await listResponse.json();
  assert.deepEqual(snapshot.warnings, [], JSON.stringify(snapshot.warnings));
  assert.deepEqual(Object.keys(snapshot).sort(), ['complete', 'files', 'generation', 'revision', 'scannedAt', 'sources', 'truncated', 'warnings']);
  assert.equal(snapshot.sources[0].label, 'Default Copilot');
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.files[0].title, 'Synthetic Agent');
  assert.equal(JSON.stringify(snapshot).includes(directory), false);
  assert.match(snapshot.generation, /^[A-Za-z0-9_-]{32,64}$/u);
  assert.match(snapshot.revision, /^[A-Za-z0-9_-]{32,64}$/u);

  const detailResponse = await request(`/api/library/files/${snapshot.files[0].id}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.generation, snapshot.generation);
  assert.equal(detail.markdown, '# Synthetic Agent\n');
  assert.deepEqual(Object.keys(detail.file).sort(), ['category', 'id', 'kind', 'relativePath', 'sourceId']);

  const added = await request('/api/library/roots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: snapshot.revision, path: extraRoot, mode: 'category', category: 'instructions' }),
  });
  const addedText = await added.text();
  assert.equal(added.status, 201, addedText);
  const addedBody = JSON.parse(addedText);
  assert.match(addedBody.rootId, /^[A-Za-z0-9_-]{32,64}$/u);
  assert.equal(addedBody.snapshot.sources.length, 2);
  assert.ok(addedBody.snapshot.files.some((file) => file.title === 'Extra Instructions'));
  assert.equal(JSON.stringify(addedBody).includes(directory), false);

  const duplicate = await request('/api/library/roots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      revision: addedBody.snapshot.revision,
      path: extraRoot,
      mode: 'category',
      category: 'instructions',
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'DUPLICATE_ROOT');

  const duplicateKeys = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"revision":"${addedBody.snapshot.revision}","revision":"${addedBody.snapshot.revision}"}`,
  });
  assert.equal(duplicateKeys.status, 400);
  assert.deepEqual(Object.keys(await duplicateKeys.json()), ['error']);

  const unknown = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: addedBody.snapshot.revision, path: extraRoot }),
  });
  assert.equal(unknown.status, 400);

  const badMedia = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ revision: addedBody.snapshot.revision }),
  });
  assert.equal(badMedia.status, 415);

  const badEncoding = await request('/api/library/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    body: JSON.stringify({ revision: addedBody.snapshot.revision }),
  });
  assert.equal(badEncoding.status, 415);

  const badCharset = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=latin1' },
    body: JSON.stringify({ revision: addedBody.snapshot.revision }),
  });
  assert.equal(badCharset.status, 415);

  const tooLarge = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: addedBody.snapshot.revision, padding: 'x'.repeat(9 * 1024) }),
  });
  assert.equal(tooLarge.status, 413);

  const rootAdded = await request('/api/library/roots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      revision: addedBody.snapshot.revision,
      path: rootExtra,
      mode: 'root',
    }),
  });
  assert.equal(rootAdded.status, 201);
  const rootAddedBody = await rootAdded.json();
  assert.equal(rootAddedBody.snapshot.sources.length, 3);
  assert.equal(rootAddedBody.snapshot.sources[2].mode, 'root');
  assert.ok(rootAddedBody.snapshot.files.some((file) => file.title === 'Additional Root Agent'));
  assert.equal(JSON.stringify(rootAddedBody).includes(directory), false);

  const wrongMethod = await request('/api/library', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
  assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED');

  const query = await request('/api/library?path=arbitrary');
  assert.equal(query.status, 400);

  const refreshed = await request('/api/library/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: rootAddedBody.snapshot.revision }),
  });
  assert.equal(refreshed.status, 200);
  const refreshedSnapshot = await refreshed.json();
  assert.notEqual(refreshedSnapshot.generation, snapshot.generation);
  const staleDetail = await request(`/api/library/files/${snapshot.files[0].id}`);
  assert.equal(staleDetail.status, 404);
  assert.equal((await staleDetail.json()).error.code, 'NOT_FOUND');

  const removeDefault = await request(`/api/library/roots/${refreshedSnapshot.sources[0].id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: refreshedSnapshot.revision }),
  });
  assert.equal(removeDefault.status, 403);
  assert.equal((await removeDefault.json()).error.code, 'DEFAULT_ROOT');

  const removeExtra = await request(`/api/library/roots/${refreshedSnapshot.sources[1].id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: refreshedSnapshot.revision }),
  });
  assert.equal(removeExtra.status, 200);
  const removed = await removeExtra.json();
  assert.equal(removed.snapshot.sources.length, 2);
  assert.equal(await readFile(path.join(extraRoot, 'Custom.md'), 'utf8'), '# Extra Instructions\n');

  const removeRoot = await request(`/api/library/roots/${refreshedSnapshot.sources[2].id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: removed.snapshot.revision }),
  });
  assert.equal(removeRoot.status, 200);
  const rootRemoved = await removeRoot.json();
  assert.equal(rootRemoved.snapshot.sources.length, 1);
  assert.equal(await readFile(path.join(rootExtra, 'agents', 'Root.md'), 'utf8'), '# Additional Root Agent\n');

  const missingRoot = await request(`/api/library/roots/${refreshedSnapshot.sources[1].id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: rootRemoved.snapshot.revision }),
  });
  assert.equal(missingRoot.status, 404);

  const invalidId = await request('/api/library/files/%2e%2e%2fsecret');
  assert.equal(invalidId.status, 400);
  assert.match(invalidId.headers.get('content-type'), /^application\/json\b/u);
  assert.equal(constructions, 1, 'only the first authorized non-bootstrap request creates a source');
});

test('registration envelope permits a snapshot at the bounded source snapshot limit', async (t) => {
  const directory = await fixture(t);
  const maximumSnapshotBytes = 2 * 1024 * 1024;
  const baseSnapshot = { padding: '' };
  const snapshot = {
    padding: 'x'.repeat(maximumSnapshotBytes - Buffer.byteLength(JSON.stringify(baseSnapshot))),
  };
  assert.equal(Buffer.byteLength(JSON.stringify(snapshot)), maximumSnapshotBytes);
  let persisted = false;
  const app = createSentientServer({
    activityRoot: path.join(directory, 'activity'),
    port: 0,
    librarySourceFactory: () => ({
      async register() {
        persisted = true;
        return { rootId: 'A'.repeat(32), snapshot };
      },
      close() {},
    }),
  });
  t.after(() => app.stop());
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
    mode: 'same-origin',
    headers: browserHeaders(origin),
  });
  const { token } = await bootstrap.json();
  const response = await fetch(`${origin}/api/library/roots`, {
    mode: 'same-origin',
    method: 'POST',
    headers: {
      ...browserHeaders(origin, token),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ revision: 'A'.repeat(32), path: directory, mode: 'root' }),
  });
  assert.equal(persisted, true);
  assert.equal(response.status, 201);
  assert.equal(Buffer.byteLength(await response.text()) <= maximumSnapshotBytes + 256, true);
});

test('oversized library response is replaced with a bounded safe JSON error', async (t) => {
  const directory = await fixture(t);
  await mkdir(path.join(directory, 'activity'));
  const app = createSentientServer({
    activityRoot: path.join(directory, 'activity'),
    port: 0,
    librarySourceFactory: () => ({
      async list() {
        return { generation: 'opaque-generation', files: ['x'.repeat(2 * 1024 * 1024)] };
      },
      async close() {},
    }),
  });
  t.after(() => app.stop());
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(`${origin}/api/library/bootstrap`, {
    mode: 'same-origin',
    headers: browserHeaders(origin),
  });
  const { token } = await bootstrap.json();
  const response = await fetch(`${origin}/api/library`, {
    mode: 'same-origin',
    headers: browserHeaders(origin, token),
  });
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) < 1024);
  assert.equal(JSON.parse(body).error.code, 'LIMIT_EXCEEDED');
});
