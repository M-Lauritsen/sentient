import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanPublication } from '../scripts/check-publication.mjs';

test('publication check reports sensitive categories without disclosing values', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const personal = ['C:', 'Users', 'sample-user', 'notes'].join('\\');
  const credential = ['ghp', 'x'.repeat(36)].join('_');
  await writeFile(path.join(root, 'notes.txt'), `${personal}\n${credential}`);
  await writeFile(path.join(root, 'events.jsonl'), '{}\n');
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules', 'fixture.txt'), personal);
  const findings = await scanPublication(root);
  assert.ok(findings.some((item) => item.category === 'personal-path'));
  assert.ok(findings.some((item) => item.category === 'possible-credential'));
  assert.ok(findings.some((item) => item.category === 'local-data'));
  assert.doesNotMatch(JSON.stringify(findings), /sample-user|xxxxxxxx/);
  assert.ok(findings.every((item) => !item.file.includes('node_modules')));
});

test('publication check accepts portable source and placeholder documentation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'README.md'), 'Use %USERPROFILE% and os.homedir().');
  assert.deepEqual(await scanPublication(root), []);
});

test('publication check detects session identifiers and local record directories', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'plans'));
  const session = [8, 4, 4, 4, 12].map((size) => 'a'.repeat(size)).join('-');
  await writeFile(path.join(root, 'plans', 'notes.md'), session);
  const findings = await scanPublication(root);
  assert.ok(findings.some(({ category }) => category === 'session-identifier'));
  assert.ok(findings.some(({ category }) => category === 'local-records'));
  assert.equal(JSON.stringify(findings).includes(session), false);
});

test('publication check fails on unreadable or missing scan roots', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(scanPublication(path.join(root, 'missing')), { code: 'ENOENT' });
});
