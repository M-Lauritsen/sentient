import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLibrarySource } from '../copilot/library-source.mjs';
import { buildLibraryHelper, libraryHelperExecutable } from '../copilot/library-native.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

test('bounded Library source, protected settings and restart on synthetic Windows folders', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'sentient-library-'));
  const executable = path.join(path.dirname(libraryHelperExecutable), `test-source-${randomUUID()}.exe`);
  let source;
  try {
    await buildLibraryHelper(executable);
    const home = path.join(fixture, 'default');
    const extra = path.join(fixture, 'extra');
    const settingsPath = path.join(fixture, 'private', 'library');
    for (const folder of ['agents/nested', 'skills/outer/nested', 'instructions', 'session-state', '.git']) {
      await mkdir(path.join(home, folder), { recursive: true });
    }
    await mkdir(extra);
    const documents = new Map([
      ['agents/hello.agent.MD', '---\nname: Friendly Agent\ndescription: Just synthetic\nunknown: yes\n---\n# Fallback\n[Plain](nested/plain.md)\n'],
      ['agents/null.md', '---\nnull\n---\n# Null Metadata Heading'],
      ['agents/nested/plain.md', '# Mixed Case'],
      ['skills/outer/SKILL.md', '# Outer'],
      ['skills/outer/help.md', '# Support'],
      ['skills/outer/nested/SKILL.md', '# Inner'],
      ['skills/outer/nested/help.md', '# Inner Support'],
      ['skills/orphan.md', '# Orphan'],
      ['session-state/private.md', 'excluded-synthetic-journal'],
      ['.git/private.md', 'excluded-synthetic-git'],
      ['agents/ignore.exe', 'excluded-synthetic-executable'],
    ]);
    for (const [relative, bytes] of documents) await writeFile(path.join(home, relative), bytes);
    const originalHashes = new Map([...documents].map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')]));
    const options = { defaultRoot: home, settingsPath, executable };
    source = createLibrarySource(options);
    let snapshot;
    await t.test('discovers categories only, metadata, nearest nested skill and unassociated Markdown', async () => {
      snapshot = await source.list();
      assert.equal(snapshot.files.length, 8);
      assert.equal(snapshot.complete, true);
      assert.equal(snapshot.sources[0].label, 'Default Copilot');
      assert.equal(snapshot.files[0].title, 'Friendly Agent');
      assert.equal(snapshot.files[0].description, 'Just synthetic');
      const malformed = snapshot.files.find((file) => file.relativePath === 'null.md');
      assert.equal(malformed.title, 'Null Metadata Heading');
      assert.ok(malformed.warnings.some((item) => item.code === 'FRONT_MATTER_MALFORMED'));
      const orphan = snapshot.files.find((file) => file.relativePath === 'orphan.md');
      assert.equal(orphan.kind, 'unassociated');
      const support = snapshot.files.find((file) => file.relativePath === 'outer/nested/help.md');
      assert.equal(support.kind, 'support');
      assert.equal(support.skillEntryId, snapshot.files.find((file) => file.relativePath === 'outer/nested/SKILL.md').id);
      assert.equal(JSON.stringify(snapshot).includes(fixture), false);
      assert.equal(JSON.stringify(snapshot).includes('excluded-synthetic'), false);
      assert.deepEqual(await source.list(), snapshot);
    });
    await t.test('detail uses opened identity/digest, excludes absolute paths and rejects changed content', async () => {
      const file = snapshot.files[0];
      const detail = await source.detail(file.id);
      assert.equal(detail.generation, snapshot.generation);
      assert.match(detail.markdown, /name: Friendly Agent/);
      const target = snapshot.files.find((value) => value.relativePath === 'nested/plain.md');
      assert.deepEqual(detail.links['nested/plain.md'], {
        fileId: target.id,
        sourceId: target.sourceId,
        category: target.category,
        relativePath: target.relativePath,
      });
      await writeFile(path.join(home, 'agents', 'nested', 'plain.md'), '# Changed Link Target');
      assert.equal((await source.detail(file.id)).links['nested/plain.md'], undefined);
      await writeFile(path.join(home, 'agents', 'nested', 'plain.md'), documents.get('agents/nested/plain.md'));
      await writeFile(path.join(home, 'agents', 'hello.agent.MD'), '# Changed');
      await assert.rejects(source.detail(file.id), { code: 'CONTENT_CHANGED' });
      await writeFile(path.join(home, 'agents', 'hello.agent.MD'), documents.get('agents/hello.agent.MD'));
      await assert.rejects(source.detail('../outside'), { code: 'NOT_FOUND' });
    });
    await t.test('registration rejects duplicate/overlap and supports explicit category mode with durable restart', async () => {
      await assert.rejects(source.register({ revision: snapshot.revision, path: home, mode: 'root' }), { code: 'DUPLICATE_ROOT' });
      await assert.rejects(source.register({ revision: snapshot.revision, path: path.join(home, 'agents'), mode: 'category', category: 'agents' }), { code: 'OVERLAPPING_ROOT' });
      await writeFile(path.join(extra, 'x.md'), '# Explicit Category');
      const added = await source.register({ revision: snapshot.revision, path: extra, mode: 'category', category: 'instructions' });
      assert.equal(added.snapshot.sources.length, 2);
      assert.ok(added.snapshot.files.some((file) => file.category === 'instructions' && file.title === 'Explicit Category'));
      await assert.rejects(source.detail(snapshot.files[0].id), { code: 'NOT_FOUND' });
      snapshot = added.snapshot;
      await source.close();
      source = createLibrarySource(options);
      snapshot = await source.list();
      assert.equal(snapshot.sources.length, 2);
      assert.equal(snapshot.sources[1].mode, 'category');
    });
    await t.test('explicit category and nested root registrations cannot enter excluded ancestor trees', async () => {
      for (const [relative, mode] of [['.git', 'category'], ['node_modules/nested', 'root'], ['parent/session-state/nested', 'root']]) {
        const excluded = path.join(fixture, relative);
        await mkdir(excluded, { recursive: true });
        await writeFile(path.join(excluded, 'hidden.md'), 'excluded-registration-marker');
        await assert.rejects(source.register({
          revision: snapshot.revision, path: excluded, mode, ...(mode === 'category' ? { category: 'agents' } : {}),
        }), { code: relative.includes('session-state') ? 'INVALID_PATH' : 'UNSAFE_SOURCE' });
      }
      assert.equal(JSON.stringify(await source.list()).includes('excluded-registration-marker'), false);
    });
    await t.test('external same-revision writer conflicts without losing in-memory snapshot', async () => {
      const other = createLibrarySource(options);
      try {
        const old = await other.list();
        const extra2 = path.join(fixture, 'extra2');
        await mkdir(extra2);
        const added = await source.register({ revision: snapshot.revision, path: extra2, mode: 'root' });
        await assert.rejects(other.refresh(old.revision), { code: 'SETTINGS_CONFLICT' });
        assert.deepEqual(await other.list(), old);
        snapshot = added.snapshot;
      } finally { await other.close(); }
    });
    await t.test('manual refresh invalidates IDs; unregister removes registration, never source bytes', async () => {
      const oldId = snapshot.files[0].id;
      snapshot = await source.refresh(snapshot.revision);
      await assert.rejects(source.detail(oldId), { code: 'NOT_FOUND' });
      const rootId = snapshot.sources[1].id;
      snapshot = (await source.unregister(rootId, snapshot.revision)).snapshot;
      assert.equal(await readFile(path.join(extra, 'x.md'), 'utf8'), '# Explicit Category');
      await assert.rejects(source.unregister(snapshot.sources[0].id, snapshot.revision), { code: 'DEFAULT_ROOT' });
    });
    await t.test('unwritable settings preserve safe reads and mutation failure keeps prior snapshot', async () => {
      const settingsFile = path.join(settingsPath, 'settings.json');
      await execFile('attrib.exe', ['+R', settingsFile], { windowsHide: true });
      try {
        await assert.rejects(source.unregister(snapshot.sources[1].id, snapshot.revision), { code: 'SETTINGS_UNAVAILABLE' });
        assert.deepEqual(await source.list(), snapshot);
      } finally {
        await execFile('attrib.exe', ['-R', settingsFile], { windowsHide: true });
        await source.close();
      }
      source = createLibrarySource(options);
      snapshot = await source.list();
      assert.equal(snapshot.sources.length, 2);
    });
    await t.test('missing saved registrations survive refresh and restart as visible source errors', async () => {
      await rm(path.join(fixture, 'extra2'), { recursive: true });
      snapshot = await source.refresh(snapshot.revision);
      assert.equal(snapshot.sources[1].state, 'missing');
      await source.close();
      source = createLibrarySource(options);
      snapshot = await source.list();
      assert.equal(snapshot.sources[1].state, 'missing');
      assert.equal(snapshot.sources.length, 2);
    });
    await t.test('small scan limits publish honest partiality', async () => {
      await source.close();
      source = createLibrarySource({ ...options, limits: { maxFiles: 1 } });
      const partial = await source.list();
      assert.equal(partial.files.length, 1);
      assert.equal(partial.complete, false);
      assert.equal(partial.truncated, true);
      assert.ok(partial.warnings.some((warning) => warning.code === 'LIMIT_EXCEEDED'));
    });
    await t.test('persisted excluded registrations disable mutations and never scan their content', async () => {
      await source.close();
      const file = path.join(settingsPath, 'settings.json');
      const original = await readFile(file, 'utf8');
      const unsafe = { version: 1, revision: randomUUID().replaceAll('-', ''), additionalRoots: [{ path: path.join(fixture, '.git'), mode: 'category', category: 'agents' }] };
      await writeFile(file, JSON.stringify(unsafe));
      source = createLibrarySource(options);
      const result = await source.list();
      assert.equal(result.sources.length, 1);
      assert.ok(result.warnings.some((value) => value.code === 'SETTINGS_UNAVAILABLE'));
      assert.equal(JSON.stringify(result).includes('excluded-registration-marker'), false);
      await source.close();
      await writeFile(file, original);
    });
    await t.test('corrupt/duplicate-key settings preserve bytes and disable mutations, not default viewing', async () => {
      await source.close();
      const file = path.join(settingsPath, 'settings.json');
      // Existing protected file remains private; Node write is fixture-only, not production persistence.
      const corrupt = '{"version":1,"version":1}';
      await writeFile(file, corrupt);
      source = createLibrarySource(options);
      const result = await source.list();
      assert.equal(result.sources[0].isDefault, true);
      assert.ok(result.warnings.some((warning) => warning.code === 'SETTINGS_UNAVAILABLE'));
      await assert.rejects(source.register({ revision: result.revision, path: extra, mode: 'root' }), { code: 'SETTINGS_UNAVAILABLE' });
      assert.equal(await readFile(file, 'utf8'), corrupt);
    });

    await t.test('native operations receive remaining source deadline, not a fresh full timeout', async () => {
      let clock = 0, closed = false;
      const observed = [];
      const source = createLibrarySource({
        defaultRoot: 'C:\\synthetic', settingsPath: 'C:\\private\\library',
        limits: { sourceMs: 6, requestMs: 20 }, now: () => clock, monotonicNow: () => clock,
        nativeFactory: () => ({
          async request(request, { timeoutMs }) {
            assert.equal(closed, false);
            observed.push({ op: request.op, timeoutMs });
            if (request.op === 'settingsRead') { clock++; return { data: '', signature: 'missing' }; }
            if (request.op === 'identify') { clock += 4; return { chain: ['volume', 'source'], path: request.path, canonical: request.path }; }
            assert.equal(request.op, 'inspect');
            assert.equal(timeoutMs, 2);
            clock += timeoutMs;
            throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });
          },
          async close() { closed = true; },
        }),
      });
      try {
        const snapshot = await source.list();
        assert.equal(snapshot.files.length, 0);
        assert.equal(snapshot.truncated, true);
        assert.equal(snapshot.sources[0].state, 'partial');
        assert.equal(observed.length, 3);
        assert.equal(clock, 7);
        assert.equal(closed, true, 'timed-out native work must settle before returning capacity');
      } finally { await source.close(); }
    });

    await t.test('metadata completed after the deadline is discarded, not published as a summary', async () => {
      let clock = 0;
      const source = createLibrarySource({
        defaultRoot: 'C:\\synthetic', settingsPath: 'C:\\private\\library',
        limits: { sourceMs: 6, requestMs: 20 }, now: () => clock, monotonicNow: () => clock,
        nativeFactory: () => ({
          async request(request) {
            if (request.op === 'settingsRead') return { data: '', signature: 'missing' };
            if (request.op === 'identify') return { path: request.path, chain: ['root'], canonical: request.path };
            if (request.op === 'inspect') return { entries: [{ name: 'x.md', directory: false, reparse: false }], truncated: false };
            return { data: Buffer.from('# Late').toString('base64'), chain: ['root', 'file'], signature: 'synthetic' };
          },
          async close() {},
        }),
        parserFactory: () => ({
          async run(op, text, basename, { timeoutMs }) {
            assert.equal(timeoutMs, 6);
            clock = 7;
            return { title: 'Must not publish', warnings: [] };
          },
          async close() {},
        }),
      });
      try {
        const snapshot = await source.list();
        assert.equal(snapshot.files.length, 0);
        assert.equal(snapshot.truncated, true);
        assert.ok(snapshot.warnings.some((value) => value.code === 'TIMEOUT'));
      } finally { await source.close(); }
    });
    await t.test('wall-clock rollback cannot extend monotonic source deadlines', async () => {
      let wall = 1000, elapsed = 0;
      const timeouts = [];
      const bounded = createLibrarySource({
        defaultRoot: 'C:\\synthetic', settingsPath: 'C:\\private\\library',
        limits: { sourceMs: 6, requestMs: 20 }, now: () => wall, monotonicNow: () => elapsed,
        nativeFactory: () => ({
          async request(request, { timeoutMs }) {
            if (request.op === 'settingsRead') return { data: '', signature: 'missing' };
            if (request.op === 'identify') {
              elapsed += 4; wall -= 1000;
              return { chain: ['root'], path: request.path, canonical: request.path };
            }
            timeouts.push(timeoutMs);
            elapsed += timeoutMs; wall -= 100000;
            throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });
          },
          async close() {},
        }),
        parserFactory: () => ({ async close() {} }),
      });
      try {
        const result = await bounded.list();
        assert.deepEqual(timeouts, [2], 'wall rollback must not grant a fresh or extended native deadline');
        assert.equal(result.files.length, 0);
        assert.equal(result.truncated, true);
        assert.equal(result.scannedAt, new Date(wall).toISOString(), 'timestamp remains wall-clock based');
      } finally { await bounded.close(); }
    });
    for (const [file, hash] of originalHashes) assert.equal(createHash('sha256').update(await readFile(path.join(home, file))).digest('hex'), hash);
  } finally {
    await source?.close();
    await rm(fixture, { recursive: true, force: true });
    await rm(executable, { force: true });
  }
});

test('snapshot byte limit publishes a bounded partial skill listing after classification', async () => {
  const root = 'C:\\synthetic';
  const deepNames = Array.from({ length: 4 }, (_, index) => `${index}${'d'.repeat(150)}`);
  const directories = [path.win32.join(root, 'skills')];
  for (const name of deepNames) directories.push(path.win32.join(directories.at(-1), name));
  const documents = Array.from({ length: 1_400 }, (_, index) =>
    `document-${String(index).padStart(4, '0')}-${'x'.repeat(185)}.md`);
  const nativeFactory = () => ({
    async request(request) {
      if (request.op === 'settingsRead') return { data: '', signature: 'missing' };
      if (request.op === 'identify') return { path: request.path, canonical: request.path, chain: ['root'] };
      if (request.op === 'inspect') {
        const index = directories.indexOf(request.path);
        if (index === 0) return { entries: [
          { name: 'SKILL.md', directory: false, reparse: false },
          { name: deepNames[0], directory: true, reparse: false },
        ], truncated: false };
        if (index > 0 && index < directories.length - 1) {
          return { entries: [{ name: deepNames[index], directory: true, reparse: false }], truncated: false };
        }
        if (index === directories.length - 1) {
          return { entries: documents.map((name) => ({ name, directory: false, reparse: false })), truncated: false };
        }
        return { entries: [], truncated: false };
      }
      assert.equal(request.op, 'read');
      return {
        data: Buffer.from('# Synthetic').toString('base64'),
        chain: ['root', request.path],
        signature: 'synthetic',
      };
    },
    async close() {},
  });
  const parserFactory = () => ({
    async run() {
      return { title: 'T'.repeat(200), description: 'D'.repeat(500), warnings: [] };
    },
    async close() {},
  });
  const source = createLibrarySource({
    defaultRoot: root,
    settingsPath: 'C:\\private\\library',
    nativeFactory,
    parserFactory,
  });
  try {
    const snapshot = await source.list();
    assert.ok(snapshot.files.length > 0);
    assert.ok(snapshot.files.length < documents.length + 1);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.complete, false);
    assert.ok(snapshot.warnings.some((item) => item.code === 'LIMIT_EXCEEDED'));
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 2 * 1024 * 1024);
  } finally {
    await source.close();
  }
});
