import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildDesktopLauncher } from '../scripts/build-desktop-launcher.mjs';

const execute = promisify(execFile);
const source = fileURLToPath(new URL('../native/DesktopLauncher.cs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('console-free Windows entry preserves arguments, process lifetime and visible failure contract', {
  skip: process.platform !== 'win32', timeout: 60000,
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient hidden & % launcher '));
  const children = [];
  t.after(async () => {
    for (const { child, exit } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exit;
    }
    await rm(root, { recursive: true, force: true });
  });
  const checkout = path.join(root, 'checkout & space');
  const bin = path.join(checkout, 'native', 'bin');
  const elsewhere = path.join(root, 'unrelated cwd');
  const script = path.join(checkout, 'desktop', 'launch.mjs');
  await mkdir(bin, { recursive: true });
  await mkdir(path.dirname(script), { recursive: true });
  await mkdir(elsewhere);
  await writeFile(script, '// Synthetic entry marker; never real journals.\n');
  const gui = path.join(bin, 'SentientLauncher.exe');
  await buildDesktopLauncher(gui);
  const pe = await readFile(gui);
  const peOffset = pe.readUInt32LE(0x3c);
  assert.equal(pe.readUInt16LE(peOffset + 24 + 68), 2, 'built executable uses Windows GUI subsystem');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const probe = path.join(bin, 'probe.exe');
  const fake = path.join(root, 'node.exe');
  await execute(compiler, [
    '/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll', '/main:DesktopLauncherProbe', `/out:${probe}`,
    source, fixture('desktop-launcher-probe.cs'),
  ], { windowsHide: true });
  await execute(compiler, [
    '/nologo', '/target:exe', '/platform:x64', '/reference:System.Web.Extensions.dll',
    `/out:${fake}`, fixture('desktop-fake-node.cs'),
  ], { windowsHide: true });
  let index = 0;
  const run = async (args, env = {}) => {
    const notification = path.join(root, `notification-${++index}.json`);
    const report = path.join(root, `child-${index}.json`);
    const child = spawn(probe, args, {
      cwd: elsewhere, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, SENTIENT_TEST_NOTIFICATION: notification, SENTIENT_TEST_REPORT: report, ...env },
    });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    children.push({ child, exit });
    return { child, exit, report, notifications: async () => JSON.parse(await readFile(notification, 'utf8')) };
  };
  const awaitReport = async (file) => {
    for (let i = 0; i < 200; i++) {
      try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await sleep(20);
    }
    assert.fail('synthetic Node did not report startup');
  };
  await t.test('no console, no shell interpolation, exact fixed script and Brave arguments; waits for Node exit', async () => {
    const release = path.join(root, 'release');
    const s = await run([fake], { SENTIENT_TEST_RELEASE: release });
    const report = await awaitReport(s.report);
    assert.deepEqual(report.args, [script, '--browser', 'brave']);
    assert.equal(report.cwd, checkout);
    assert.equal(report.console, 0, 'actual child has no console allocation');
    assert.equal(s.child.exitCode, null, 'GUI entry remains alive while supervisor is running');
    await writeFile(release, '');
    assert.equal(await s.exit, 0);
    assert.deepEqual(await s.notifications(), []);
  });
  await t.test('nonzero supervisor exit reports bounded safe guidance and drains large output', async () => {
    const s = await run([fake], { SENTIENT_TEST_EXIT: '1', SENTIENT_TEST_LARGE_OUTPUT: '1' });
    assert.equal(await s.exit, 1);
    const messages = await s.notifications();
    assert.equal(messages.length, 1);
    assert.match(messages[0], /^PORT_IN_USE:.*No existing listener was adopted or stopped/);
    assert.ok(messages[0].length < 300);
  });
  await t.test('unknown raw stderr is not shown in failure notification', async () => {
    const s = await run([fake], { SENTIENT_TEST_EXIT: '1', SENTIENT_TEST_ERROR: 'synthetic-private-content' });
    assert.equal(await s.exit, 1);
    assert.deepEqual(await s.notifications(), [
      'START_FAILED: Run node desktop\\launch.mjs from the checkout in a terminal for recovery guidance.',
    ]);
  });
  await t.test('missing, relative or extra Node arguments fail visibly before starting anything', async () => {
    for (const args of [[], ['node.exe'], [path.join(root, 'absent', 'node.exe')], [fake, '--extra']]) {
      const s = await run(args);
      assert.equal(await s.exit, 1);
      assert.match((await s.notifications())[0], /^NODE_UNAVAILABLE:/);
      await assert.rejects(access(s.report), { code: 'ENOENT' });
    }
  });
  await t.test('invalid executable and misplaced launcher fail with safe guidance', async () => {
    const invalid = path.join(root, 'invalid', 'node.exe');
    await mkdir(path.dirname(invalid));
    await writeFile(invalid, 'not an executable');
    const failed = await run([invalid]);
    assert.equal(await failed.exit, 1);
    assert.match((await failed.notifications())[0], /^START_FAILED:/);
    await rm(script);
    const missing = await run([fake]);
    assert.equal(await missing.exit, 1);
    assert.match((await missing.notifications())[0], /^CHECKOUT_UNAVAILABLE:/);
    await assert.rejects(access(missing.report), { code: 'ENOENT' });
  });
  await t.test('real Node executes quoted fixed script and its successful exit stays silent', async () => {
    await writeFile(script, "process.exitCode = process.argv.slice(2).join(' ') === '--browser brave' ? 0 : 1;\n");
    const s = await run([process.execPath]);
    assert.equal(await s.exit, 0);
    assert.deepEqual(await s.notifications(), []);
  });
});
