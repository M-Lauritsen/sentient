import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, link, symlink, rename, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { buildLibraryHelper, LibraryNative } from '../copilot/library-native.mjs';
const execFile = promisify(execFileCallback);

// No home, journals, app-data or running application is used by this suite.
test('Windows opened-handle and private settings boundary (real synthetic filesystem)', async (t) => {
  assert.equal(process.platform, 'win32', 'Windows SOURCE proof must run on Windows');
  const base = await mkdtemp(path.join(os.tmpdir(), 'sentient-native-'));
  let native;
  try {
    // Never overwrite the application's executable (it may be in use), or
    // contend with other suites. This build belongs only to this fixture.
    const executable = path.join(base, 'LibraryHelper.exe');
    await buildLibraryHelper(executable);
    native = new LibraryNative({ executable, allowTestBarriers: true });
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'agents'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, 'agents', 'safe.md'), '# Synthetic safe');
    await writeFile(path.join(outside, 'secret.md'), 'synthetic-outside-marker');
    await t.test('opens full ancestor chain and returns opened identity before reading', async () => {
      const result = await native.request({ op: 'read', path: path.join(root, 'agents', 'safe.md') });
      assert.equal(Buffer.from(result.data, 'base64').toString(), '# Synthetic safe');
      assert.ok(result.chain.length >= 4);
      assert.ok(result.signature);
    });
    await t.test('rejects junctions in root, ancestor and leaf positions', async () => {
      await symlink(outside, path.join(root, 'jump'), 'junction');
      await assert.rejects(native.request({ op: 'read', path: path.join(root, 'jump', 'secret.md') }), { code: 'UNSAFE_SOURCE' });
      await assert.rejects(native.request({ op: 'inspect', path: path.join(root, 'jump') }), { code: 'UNSAFE_SOURCE' });
      // Junction creation needs no symlink privilege; test a reparse point in the file position too.
      await symlink(outside, path.join(root, 'agents', 'alias.md'), 'junction');
      await assert.rejects(native.request({ op: 'read', path: path.join(root, 'agents', 'alias.md') }), { code: 'UNSAFE_SOURCE' });
    });
    await t.test('rejects multiply linked regular files before bytes are returned', async () => {
      await link(path.join(outside, 'secret.md'), path.join(root, 'agents', 'hard.md'));
      await assert.rejects(native.request({ op: 'read', path: path.join(root, 'agents', 'hard.md') }), { code: 'UNSAFE_SOURCE' });
    });
    await t.test('rejects changed file and replaced safe ancestor against snapshot identity', async () => {
      const file = path.join(root, 'agents', 'safe.md');
      const before = await native.request({ op: 'read', path: file });
      await rename(path.join(root, 'agents'), path.join(root, 'old-agents'));
      await mkdir(path.join(root, 'agents'));
      await writeFile(file, '# Replacement');
      await assert.rejects(native.request({ op: 'read', path: file, expectedChain: before.chain, expected: before.signature }), { code: 'CONTENT_CHANGED' });
    });
    await t.test('pinned ancestors and opened file deny rename and writes during read', async () => {
      const file = path.join(root, 'agents', 'safe.md');
      // A test-only protocol barrier pauses after validation, BEFORE bytes are read.
      const held = await native.request({ op: 'hold', path: file });
      try {
        await assert.rejects(rename(path.join(root, 'agents'), path.join(root, 'swapped')));
        await assert.rejects(rename(root, path.join(base, 'moved-root')));
        await assert.rejects(writeFile(file, 'hostile overwrite'));
        await assert.rejects(rm(file));
      } finally {
        await native.request({ op: 'release', hold: held.hold });
      }
    });
    await t.test('same-size edits with restored timestamps fail the content digest precondition', async () => {
      const file = path.join(root, 'agents', 'digest.md');
      await writeFile(file, 'AAAA');
      await utimes(file, 946684800, 946684800);
      const before = await native.request({ op: 'read', path: file });
      await writeFile(file, 'BBBB');
      await utimes(file, 946684800, 946684800);
      await assert.rejects(native.request({ op: 'read', path: file, expectedChain: before.chain, expected: before.signature }), { code: 'CONTENT_CHANGED' });
    });
    await t.test('document and directory work is bounded before returning data', async () => {
      await writeFile(path.join(root, 'large.md'), Buffer.alloc(262145, 65));
      await assert.rejects(native.request({ op: 'read', path: path.join(root, 'large.md') }), { code: 'LIMIT_EXCEEDED' });
      const result = await native.request({ op: 'inspect', path: root, limit: 1 });
      assert.equal(result.entries.length, 1);
      assert.equal(result.truncated, true);
    });
    const settings = path.join(base, 'private', 'library');
    await t.test('creates and verifies protected user-only settings and artifacts', async () => {
      const initial = await native.request({ op: 'settingsRead', path: settings });
      assert.equal(initial.data, '');
      const saved = await native.request({ op: 'settingsWrite', path: settings, expected: initial.signature, data: Buffer.from('synthetic-settings').toString('base64') });
      const loaded = await native.request({ op: 'settingsRead', path: settings });
      assert.equal(loaded.data, Buffer.from('synthetic-settings').toString('base64'));
      assert.equal(loaded.signature, saved.signature);
    });
    await t.test('two processes same revision: one atomic success, one conflict', async () => {
      const other = new LibraryNative({ executable });
      try {
        const initial = await native.request({ op: 'settingsRead', path: settings });
        const results = await Promise.allSettled([native, other].map((client, i) => client.request({
          op: 'settingsWrite', path: settings, expected: initial.signature, data: Buffer.from(`writer-${i}`).toString('base64'),
        })));
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'SETTINGS_CONFLICT');
        const loaded = await native.request({ op: 'settingsRead', path: settings });
        assert.match(Buffer.from(loaded.data, 'base64').toString(), /^writer-[01]$/);
      } finally { await other.close(); }
    });
    await t.test('failed pre-rename write preserves last valid bytes and removes its temporary', async () => {
      const initial = await native.request({ op: 'settingsRead', path: settings });
      await assert.rejects(native.request({
        op: 'settingsWrite', path: settings, expected: initial.signature, data: Buffer.from('must-not-commit').toString('base64'), testFailure: 'beforeReplace',
      }), { code: 'SETTINGS_UNAVAILABLE' });
      assert.deepEqual(await native.request({ op: 'settingsRead', path: settings }), initial);
      const files = await native.request({ op: 'inspect', path: settings });
      assert.deepEqual(files.entries.map((entry) => entry.name).sort(), ['settings.json', 'settings.lock']);
    });
    await t.test('settings ancestors/file cannot swap during opened-handle use; crash releases stable lock', async () => {
      const holder = new LibraryNative({ executable, allowTestBarriers: true });
      const held = await holder.request({ op: 'holdSettings', path: settings });
      assert.equal(held.hold, 'pinned');
      try {
        await assert.rejects(rename(settings, `${settings}-race`));
        await assert.rejects(rename(path.dirname(settings), `${path.dirname(settings)}-race`));
        await assert.rejects(writeFile(path.join(settings, 'settings.json'), 'attack'));
        await assert.rejects(native.request({ op: 'settingsRead', path: settings }), { code: 'SETTINGS_CONFLICT' });
      } finally { await holder.close(); }
      assert.ok((await native.request({ op: 'settingsRead', path: settings })).signature);
    });
    await t.test('broad file and directory ACLs are refused, never silently repaired', async () => {
      const settingsFile = path.join(settings, 'settings.json');
      await execFile('icacls.exe', [settingsFile, '/grant', '*S-1-5-32-545:(R)'], { windowsHide: true });
      await assert.rejects(native.request({ op: 'settingsRead', path: settings }), { code: 'SETTINGS_UNAVAILABLE' });
      await execFile('icacls.exe', [settingsFile, '/remove:g', '*S-1-5-32-545'], { windowsHide: true });
      await execFile('icacls.exe', [settings, '/grant', '*S-1-5-32-545:(RX)'], { windowsHide: true });
      await assert.rejects(native.request({ op: 'settingsRead', path: settings }), { code: 'SETTINGS_UNAVAILABLE' });
      await execFile('icacls.exe', [settings, '/remove:g', '*S-1-5-32-545'], { windowsHide: true });
    });
    await t.test('rejects hostile path syntax without reading its target', async () => {
      for (const input of ['relative', 'C:drive', '\\\\server\\share', '\\\\?\\C:\\x', 'C:\\safe\\..\\x', 'C:\\safe\\x:stream', 'C:\\safe\\NUL.txt', 'C:\\session-state\\x', 'C:\\trailing.']) {
        await assert.rejects(native.request({ op: 'read', path: input }), { code: 'INVALID_PATH' });
      }
    });
    await t.test('settings reparse replacement is rejected without reading target', async () => {
      await rename(settings, `${settings}-old`);
      await symlink(outside, settings, 'junction');
      await assert.rejects(native.request({ op: 'settingsRead', path: settings }), { code: 'UNSAFE_SOURCE' });
    });
    assert.equal(await readFile(path.join(outside, 'secret.md'), 'utf8'), 'synthetic-outside-marker');
  } finally {
    await native?.close();
    await rm(base, { recursive: true, force: true });
  }
});
