import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_INDEX, HOOK_TYPES } from '../activity/activity-colors.mjs';
import { createDemoActivity, DEMO_WAITING_IDS } from '../activity/demo-activity.mjs';

const SETTINGS = { impact: { minMs: 2000, maxMs: 120000 } };

function runFor(demo, seconds, step = 0.05) {
  const seen = { categories: new Set(), hooks: new Set(), impacts: [], waiting: new Set(), running: new Set() };
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    const frame = demo.tick(step, SETTINGS);
    frame.sceneByCategory.forEach((count, index) => { if (count > 0) seen.categories.add(CATEGORIES[index]); });
    frame.hookCounts.forEach((count, index) => { if (count > 0) seen.hooks.add(HOOK_TYPES[index]); });
    for (const impact of frame.impacts) seen.impacts.push({ ...impact });
    seen.waiting.add(frame.waiting);
    seen.running.add(frame.runningSessions);
  }
  return seen;
}

test('demo activity is silent until started', () => {
  const demo = createDemoActivity();
  assert.equal(demo.isRunning(), false);
  const frame = demo.tick(1, SETTINGS);
  assert.equal(frame.active, false);
  assert.equal(frame.sceneByCategory.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(frame.hookCounts.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(frame.impacts.length, 0);
  assert.equal(frame.runningSessions, 0);
  assert.equal(frame.waiting, false);
});

test('one demo cycle covers every scene effect except waiting as a pulse category', () => {
  const demo = createDemoActivity();
  demo.start();
  const seen = runFor(demo, demo.cycleSeconds + 0.1);
  const expected = CATEGORIES.filter((category) => category !== 'waiting');
  assert.deepEqual([...seen.categories].sort(), [...expected].sort());
  assert.deepEqual([...seen.hooks].sort(), [...HOOK_TYPES].sort());
  assert.ok(seen.impacts.length >= 1);
  assert.ok(seen.impacts.every(({ durationMs, category }) =>
    durationMs >= SETTINGS.impact.minMs && durationMs <= SETTINGS.impact.maxMs &&
    category !== CATEGORY_INDEX.waiting));
  assert.deepEqual([...seen.waiting].sort(), [false, true]);
  assert.ok([...seen.running].every((count) => count > 0));
});

test('demo fires its first step immediately on start', () => {
  const demo = createDemoActivity();
  demo.start();
  const frame = demo.tick(0.016, SETTINGS);
  assert.equal(frame.active, true);
  assert.ok(frame.sceneByCategory.some((count) => count > 0));
});

test('stopping clears the demo and restarts from the first step', () => {
  const demo = createDemoActivity();
  demo.start();
  const first = Array.from(demo.tick(0.016, SETTINGS).sceneByCategory);
  runFor(demo, 3);
  demo.stop();
  assert.equal(demo.isRunning(), false);
  const stopped = demo.tick(1, SETTINGS);
  assert.equal(stopped.active, false);
  assert.equal(stopped.sceneByCategory.reduce((sum, value) => sum + value, 0), 0);
  demo.start();
  assert.deepEqual(Array.from(demo.tick(0.016, SETTINGS).sceneByCategory), first);
});

test('demo ignores invalid frame deltas and caps long frames to one step', () => {
  const demo = createDemoActivity();
  demo.start();
  demo.tick(0.016, SETTINGS);
  for (const dt of [Number.NaN, -1, 0, Infinity]) {
    const frame = demo.tick(dt, SETTINGS);
    assert.equal(frame.sceneByCategory.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(frame.hookCounts.reduce((sum, value) => sum + value, 0), 0);
  }
  const frame = demo.tick(60, SETTINGS);
  const fired = frame.sceneByCategory.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) +
    frame.hookCounts.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) + frame.impacts.length;
  assert.ok(fired <= 1);
});

test('demo frames never carry recordable activity', () => {
  const demo = createDemoActivity();
  demo.start();
  for (let i = 0; i < 400; i++) {
    const frame = demo.tick(0.05, SETTINGS);
    assert.equal(frame.byCategory.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(frame.entries.length, 0);
  }
});

test('demo waiting markers use fixed synthetic identifiers', () => {
  assert.ok(DEMO_WAITING_IDS.length > 0);
  assert.ok(DEMO_WAITING_IDS.every((id) => id.startsWith('demo-')));
  assert.ok(Object.isFrozen(DEMO_WAITING_IDS));
});

test('per-frame scheduler code does not allocate', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../activity/demo-activity.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  function clearResult(');
  const end = source.indexOf('  return {', start);
  const tickStart = source.indexOf('    tick(dt, settings) {');
  assert.ok(start > 0 && end > start && tickStart > end);
  assert.doesNotMatch(source.slice(start, end) + source.slice(tickStart), /new |\[[^\]]*,|\.filter\(|\.slice\(|\.map\(|=>/);
});

test('focus repeats only the effect being tuned and isolates it', () => {
  const demo = createDemoActivity();
  demo.start();
  demo.setFocus('hooks');
  let seen = runFor(demo, 4);
  assert.equal(seen.categories.size, 0);
  assert.deepEqual([...seen.hooks].sort(), [...HOOK_TYPES].sort());
  assert.equal(seen.impacts.length, 0);
  assert.deepEqual([...seen.waiting], [false]);
  assert.deepEqual([...seen.running], [0]);

  demo.setFocus('impact');
  seen = runFor(demo, 4);
  assert.equal(seen.categories.size, 0);
  assert.equal(seen.hooks.size, 0);
  assert.ok(seen.impacts.length >= 3);
  assert.equal(new Set(seen.impacts.map(({ durationMs }) => durationMs)).size, 3);

  demo.setFocus('completion');
  seen = runFor(demo, 3);
  assert.deepEqual([...seen.categories], ['completion']);

  demo.setFocus('pulses');
  seen = runFor(demo, demo.cycleSeconds);
  assert.ok(seen.categories.size >= 8);
  assert.ok(!seen.categories.has('completion'));
  assert.equal(seen.hooks.size, 0);
  assert.equal(seen.impacts.length, 0);

  demo.setFocus('waiting');
  seen = runFor(demo, 3);
  assert.deepEqual([...seen.waiting], [true]);
  assert.equal(seen.categories.size + seen.hooks.size + seen.impacts.length, 0);
  assert.deepEqual([...seen.running], [0]);

  demo.setFocus('running');
  seen = runFor(demo, 3);
  assert.equal(seen.categories.size + seen.hooks.size + seen.impacts.length, 0);
  assert.ok([...seen.running].every((count) => count > 0));
  assert.deepEqual([...seen.waiting], [false]);
});

test('changing focus fires the new effect immediately; null restores the mixed cycle', () => {
  const demo = createDemoActivity();
  demo.start();
  runFor(demo, 0.3);
  demo.setFocus('hooks');
  assert.ok(demo.tick(0.016, SETTINGS).hookCounts.some((count) => count > 0));
  demo.setFocus('hooks');
  assert.equal(demo.tick(0.016, SETTINGS).hookCounts.some((count) => count > 0), false,
    'repeating the same focus does not restart it');
  demo.setFocus(null);
  const seen = runFor(demo, demo.cycleSeconds + 0.1);
  assert.equal(seen.categories.size, CATEGORIES.length - 1);
  assert.deepEqual([...seen.waiting].sort(), [false, true]);
  demo.setFocus('not-a-focus');
  assert.equal(demo.focus(), null);
  demo.setFocus('impact');
  demo.stop();
  demo.start();
  assert.equal(demo.focus(), null, 'a fresh start shows the mixed demo');
});
