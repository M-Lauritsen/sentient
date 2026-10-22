import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityClient, createImpulseFeed, createImpulseBuffer, activityColor,
  diffSubagents, impulseIntensity, projectActivity, summarizeSubagents,
  projectActiveHudSessions, createThinkingPulseClock } from '../activity-client.mjs';
import { CATEGORIES, CATEGORY_GLYPH } from '../activity-colors.mjs';
import * as activityUi from '../activity-client.mjs';

test('idle uses the completion cascade while retaining lifecycle feed categorization', () => {
  const buffer = createImpulseBuffer();
  buffer.add({ kind: 'activity', eventType: 'session.idle' });
  const drained = buffer.drain();
  assert.equal(drained.entries[0].category, 'lifecycle');
  assert.equal(drained.byCategory[CATEGORIES.indexOf('lifecycle')], 1);
  assert.equal(drained.byCategory[CATEGORIES.indexOf('completion')], 0);
  const plan = activityUi.createCategoryBurstPlan().plan(drained.sceneByCategory);
  assert.equal(plan.length, 1);
  assert.equal(plan.kinds[0], 2);
  assert.equal(plan.categories[0], CATEGORIES.indexOf('completion'));
});

test('scene burst planning reuses storage, preserves motion and caps all category bursts at four', () => {
  const planner = activityUi.createCategoryBurstPlan();
  const counts = new Uint32Array(CATEGORIES.length);
  const index = (category) => CATEGORIES.indexOf(category);
  counts[index('read')] = 90;
  counts[index('shell')] = 80;
  counts[index('edit')] = 70;
  counts[index('reasoning')] = 60;
  counts[index('lifecycle')] = 50;
  counts[index('unknown')] = 40;
  counts[index('waiting')] = 999;
  const plan = planner.plan(counts);
  assert.equal(plan.length, 4);
  assert.deepEqual([...plan.categories], [index('read'), index('shell'), index('reasoning'), index('tool')]);
  assert.deepEqual([...plan.counts], [90, 80, 150, 70]);
  assert.deepEqual([...plan.kinds], [1, 1, 0, 1]);
  const categories = plan.categories;
  const totals = plan.counts;
  counts.fill(0);
  counts[index('completion')] = 1;
  const next = planner.plan(counts);
  assert.equal(next, plan);
  assert.equal(next.categories, categories);
  assert.equal(next.counts, totals);
  assert.equal(next.length, 1);
  assert.equal(next.categories[0], index('completion'), 'completion remains a category-colored burst');
  assert.equal(next.kinds[0], 2, 'completion retains its branching network motion');
  assert.equal(next.counts[0], 1);
  counts.fill(100);
  counts[index('completion')] = 1;
  const crowded = planner.plan(counts);
  assert.equal(crowded.length, 4);
  assert.equal(crowded.categories[0], index('completion'), 'completion cascade survives category overflow');
  assert.equal(crowded.kinds[0], 2);
  counts.fill(0);
  for (const category of ['reasoning', 'lifecycle', 'unknown', 'error']) {
    counts[index(category)] = 1;
    const single = planner.plan(counts);
    assert.equal(single.kinds[0], category === 'error' ? 1 : 0);
    counts.fill(0);
  }
  counts[index('waiting')] = 10;
  assert.equal(planner.plan(counts).length, 0);
});

test('aggregate timeline is fixed-size, rolls grouped counts and distinguishes loading, empty and gaps', () => {
  const timeline = activityUi.createActivityTimeline(0);
  const counts = new Uint32Array(CATEGORIES.length);
  const view = timeline.read(0);
  assert.equal(view.state, 'loading');
  assert.equal(view.counts.length, 120 * CATEGORIES.length);
  assert.equal(view.coverage.length, 120);
  assert.equal(view.coverage[view.head], 0, 'unobserved history is not zero activity');
  timeline.setCoverage(true, 1000);
  assert.equal(timeline.read(1000).state, 'empty');
  assert.equal(view.coverage[view.head], 2, 'partial startup bucket remains unknown');
  timeline.read(5000);
  assert.equal(view.coverage[view.head], 1, 'complete live bucket is known');
  counts[CATEGORIES.indexOf('edit')] = 7;
  counts[CATEGORIES.indexOf('read')] = 3;
  timeline.add(counts, 5001);
  assert.equal(timeline.read(5001).state, 'live');
  assert.equal(view.counts[view.head * CATEGORIES.length + CATEGORIES.indexOf('edit')], 7);
  timeline.setCoverage(false, 6000);
  counts.fill(1);
  timeline.add(counts, 11000);
  assert.equal(view.coverage[view.head], 2);
  assert.equal(view.counts[view.head * CATEGORIES.length], 0, 'gap/hidden activity is discarded');
  timeline.setCoverage(true, 12000);
  assert.equal(view.coverage[view.head], 2, 'reconnect cannot erase unknown coverage');
  timeline.read(15000);
  assert.equal(view.coverage[view.head], 1);
  const savedCounts = view.counts;
  const savedCoverage = view.coverage;
  assert.equal(timeline.read(700000), view);
  assert.equal(view.counts, savedCounts);
  assert.equal(view.coverage, savedCoverage);
  assert.equal(view.counts.reduce((sum, count) => sum + count, 0), 0);
  assert.equal(view.state, 'empty', 'old events expire without backfill');
  timeline.setCoverage(false, 700001);
  assert.equal(timeline.read(700001).state, 'gap');
});

test('frame drains reuse their result and label array rather than allocating empty-frame objects', () => {
  const buffer = createImpulseBuffer();
  buffer.add({ kind: 'step', toolName: 'edit' });
  const result = buffer.drain();
  const entries = result.entries;
  const categories = result.byCategory;
  for (let frame = 0; frame < 3600; frame++) {
    assert.equal(buffer.drain(), result);
    assert.equal(result.entries, entries);
    assert.equal(result.byCategory, categories);
    assert.equal(entries.length, 0);
  }
});

test('timeline expires exactly after 120 buckets, saturates safely, and fails closed before first coverage', () => {
  const timeline = activityUi.createActivityTimeline(0);
  timeline.setCoverage(false, 0, true);
  assert.equal(timeline.read(0).state, 'loading');
  timeline.setCoverage(false, 1);
  assert.equal(timeline.read(1).state, 'gap', 'initial connection failure is not endless loading');
  timeline.setCoverage(true, 2);
  const counts = new Uint32Array(CATEGORIES.length);
  counts[0] = 0xffffffff;
  timeline.add(counts, 3);
  timeline.add(counts, 4);
  const view = timeline.read(599999);
  assert.equal(view.counts[0], 0xffffffff, 'group counts saturate rather than wrap');
  timeline.read(600000);
  assert.equal(view.counts[0], 0);
  assert.equal(view.state, 'empty');
  assert.equal(view.coverage[view.head], 1);
});

test('waiting metadata produces no feed row and burst coalescing preserves all ordinary counts', () => {
  const element = feedElement();
  const feed = createImpulseFeed(element);
  for (const eventType of ['permission.requested', 'user_input.requested', 'elicitation.requested']) {
    feed.add('activity', undefined, eventType, 10);
  }
  assert.equal(element.children.length, 0);
  const planner = activityUi.createCategoryBurstPlan();
  const counts = new Uint32Array(CATEGORIES.length);
  for (let mask = 0; mask < 1 << CATEGORIES.length; mask++) {
    for (let i = 0; i < counts.length; i++) counts[i] = mask & (1 << i) ? i + 1 : 0;
    const plan = planner.plan(counts);
    assert.ok(plan.length <= 4);
    let actual = 0, expected = 0;
    for (let i = 0; i < plan.length; i++) actual += plan.counts[i];
    for (let i = 0; i < counts.length; i++) if (CATEGORIES[i] !== 'waiting') expected += counts[i];
    assert.equal(actual, expected);
  }
});
function feedElement() {
  const element = {
    children: [],
    ownerDocument: { createElement: () => ({ dataset: {} }) },
    prepend(row) { this.children.unshift(row); },
    get lastElementChild() {
      return { remove: () => this.children.pop() };
    },
  };
  return element;
}

test('impulse feed prepends privacy-safe labels and keeps only eight entries', () => {
  const element = feedElement();
  const feed = createImpulseFeed(element);
  feed.add('thinking');
  feed.add('step');
  feed.add('completion');
  assert.deepEqual(element.children.map((row) => row.textContent),
    ['Task completed', 'Task step', 'Thinking']);
  assert.equal(element.children[0].className, 'impulse-entry impulse-completion impulse-cat-completion');
  assert.equal(element.children[0].dataset.category, 'completion');
  assert.equal(element.children[0].dataset.glyph, CATEGORY_GLYPH.completion);
  assert.equal(element.children[1].dataset.category, 'tool');
  assert.equal(element.children[2].dataset.category, 'reasoning');
  for (let i = 0; i < 20; i++) feed.add('thinking');
  assert.equal(element.children.length, 8);
});

test('event types determine colors and grouped feed labels without payload inspection', () => {
  for (const eventType of ['assistant.message', 'assistant.message_delta', 'assistant.reasoning',
    'assistant.reasoning_delta', 'assistant.turn_start']) {
    assert.equal(activityColor({ kind: 'activity', eventType }), 'blue');
  }
  for (const eventType of ['user.message', 'tool.execution_complete', 'permission.requested',
    'session.error', 'subagent.completed', 'assistant.turn_end', 'future.event']) {
    assert.equal(activityColor({ kind: 'activity', eventType }), 'orange');
  }
  const element = feedElement();
  const feed = createImpulseFeed(element);
  feed.add('activity', 'functions.view', 'tool.execution_progress', 42);
  assert.equal(element.children[0].textContent, 'tool.execution_progress · functions.view ×42');
  assert.equal(element.children[0].className, 'impulse-entry impulse-activity impulse-cat-read');
  feed.add('activity', undefined, 'assistant.message_delta', 1000);
  assert.equal(element.children[0].className, 'impulse-entry impulse-activity impulse-cat-reasoning');
  feed.add('activity', undefined, '<PRIVATE>', 5);
  assert.equal(element.children.length, 2);
  feed.add('activity', undefined, 'future.event', 5);
  assert.equal(element.children[0].dataset.category, 'unknown');
  for (const count of [0, -1, 1.5, 1_000_000_001, Infinity]) {
    assert.equal(projectActivity({ kind: 'activity', eventType: 'future.event', count }), null);
  }
});

test('frame buffer bounds labels and render intensity while accounting for every event', () => {
  const buffer = createImpulseBuffer();
  for (let i = 0; i < 10000; i++) {
    buffer.add({ kind: 'activity', eventType: `future.event${i}`, count: 5, content: 'PRIVATE' });
    buffer.add({ kind: 'activity', eventType: 'assistant.message_delta', count: 3 });
  }
  buffer.add({ kind: 'completion' });
  const result = buffer.drain();
  assert.equal(result.blue, 30000);
  assert.equal(result.orange, 50001, 'completion contributes to ordinary activity totals');
  assert.ok(result.byCategory instanceof Uint32Array);
  assert.equal(result.byCategory[CATEGORIES.indexOf('reasoning')], 30000);
  assert.equal(result.byCategory[CATEGORIES.indexOf('unknown')], 50000);
  assert.equal(result.byCategory[CATEGORIES.indexOf('completion')], 1);
  assert.equal(result.entries.length, 8);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|content/);
  assert.equal(impulseIntensity(result.blue), 8);
  assert.equal(impulseIntensity(1), 1);
  const drained = buffer.drain();
  assert.equal(drained.byCategory, result.byCategory, 'category totals reuse their typed array');
  assert.deepEqual([...drained.byCategory], Array(CATEGORIES.length).fill(0));
  assert.deepEqual([...drained.sceneByCategory], Array(CATEGORIES.length).fill(0));
  assert.deepEqual([...drained.hookCounts], [0, 0, 0]);
  assert.deepEqual({ ...drained, byCategory: undefined, sceneByCategory: undefined, hookCounts: undefined }, {
    blue: 0, orange: 0, entries: [], impacts: [], byCategory: undefined, sceneByCategory: undefined, hookCounts: undefined,
  });
  buffer.add({ kind: 'step' });
  buffer.clear();
  assert.equal(buffer.drain().orange, 0);
});

test('hook effects retain bounded per-type counts independently of feed labels and generic unknown motion', () => {
  const buffer = createImpulseBuffer();
  buffer.add({ kind: 'activity', eventType: 'hook.start', count: 3, durationMs: 5000 });
  buffer.add({ kind: 'activity', eventType: 'hook.end', count: 2, durationMs: 6000 });
  buffer.add({ kind: 'activity', eventType: 'hook.future', count: 4 });
  for (let i = 0; i < 10; i++) buffer.add({ kind: 'activity', eventType: `future.event${i}` });
  const result = buffer.drain();
  assert.deepEqual([...result.hookCounts], [3, 2, 4]);
  assert.equal(result.entries.length, 8);
  assert.equal(result.byCategory[CATEGORIES.indexOf('unknown')], 19);
  assert.equal(result.sceneByCategory[CATEGORIES.indexOf('unknown')], 10);
  assert.equal(result.impacts.length, 0, 'hooks do not create a second, uncontrolled duration burst');
  assert.deepEqual([...buffer.drain().hookCounts], [0, 0, 0]);
  buffer.add({ kind: 'activity', eventType: 'hook.start', count: 2 });
  buffer.clear();
  assert.deepEqual([...buffer.drain().hookCounts], [0, 0, 0]);
  buffer.add({ kind: 'activity', eventType: 'hook.start', count: -1 });
  assert.deepEqual([...buffer.drain().hookCounts], [0, 0, 0]);
});

test('impulse feed rejects unknown kinds instead of displaying arbitrary text', () => {
  const element = feedElement();
  const feed = createImpulseFeed(element);
  for (const kind of ['private tool title', '<script>', 'toString', null, undefined]) feed.add(kind);
  assert.equal(element.children.length, 0);
});

test('step feed shows exact bounded tool names as text, with safe fallbacks', () => {
  const element = feedElement();
  const feed = createImpulseFeed(element);
  feed.add('step', 'functions.view');
  assert.equal(element.children[0].textContent, 'Task step · functions.view');
  feed.add('step', '<img src=x onerror=alert(1)>');
  assert.equal(element.children[0].textContent, 'Task step');
  feed.add('step', 'x'.repeat(129));
  assert.equal(element.children[0].textContent, 'Task step');
  feed.add('step', 'functions.view\n');
  assert.equal(element.children[0].textContent, 'Task step');
  feed.add('thinking', 'functions.view');
  assert.equal(element.children[0].textContent, 'Thinking');
});

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  close() { this.closed = true; }
  emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
}

  test('lifecycle invalidation fences queued old streams, drops deltas until a fresh snapshot and stops running pulses', () => {
    FakeEventSource.instances = [];
    const activities = [], states = [];
    const client = createActivityClient({
      EventSourceImpl: FakeEventSource, onState: (state) => states.push(state),
      onActivity: (activity) => activities.push(activity),
    });
    const snapshot = { sourceStatus: 'available', coverage: 'journal-only', journalFiles: 1,
      source: 'local-activity-files', unknownSessions: 0, backlogFiles: 0, unverifiedRunningSessions: 0,
      activeSessions: 1, thinkingSessions: 1, runningSessions: 1, sessions: [], treeSessions: [], steps: 0 };
    const message = (sequence, epoch = 'a'.repeat(24)) => ({ sequence, epoch, snapshot });
    client.connect();
    const old = FakeEventSource.instances[0];
    old.emit('snapshot', message(0));
    assert.equal(client.getState().connection, 'connected');
    const pulseClock = createThinkingPulseClock({ pulsesPerSecondPerSession: 20, maxSessions: 32 });
    assert.equal(pulseClock.tick(0.05, client.getState(), false), 1);
    client.suspend();
    assert.equal(old.closed, true);
    assert.equal(client.getState().runningSessions, 0);
    assert.equal(client.getState().coverage, 'unknown');
    assert.equal(pulseClock.tick(1, client.getState(), false), 0);
    old.emit('snapshot', message(50));
    old.emit('activity', { ...message(51), kind: 'step' });
    old.onerror();
    assert.equal(client.getState().connection, 'unknown');
    client.resume();
    const fresh = FakeEventSource.instances[1];
    fresh.emit('activity', { ...message(1, 'b'.repeat(24)), kind: 'step' });
    assert.equal(activities.length, 0, 'unbaselined deltas cannot count or animate');
    fresh.emit('snapshot', message(0, 'b'.repeat(24)));
    old.emit('snapshot', message(100));
    fresh.emit('activity', { ...message(1, 'b'.repeat(24)), kind: 'step' });
    assert.equal(activities.length, 1);
    assert.equal(states.at(-1).connection, 'connected');
    client.disconnect();
  });
test('subagent snapshot diffs classify live additions and all retirement outcomes', () => {
  const previous = [{
    sid: 'AAAA', status: 'running', subagents: [{ sid: 'AB22', ageMs: 10 }, { sid: 'CD33', ageMs: 20 }],
    subagentsMore: 0, retired: [],
  }];
  const next = [{
    sid: 'AAAA', status: 'waiting', subagents: [{ sid: 'AB22', ageMs: 30 }, { sid: 'EF44', ageMs: 0 }],
    subagentsMore: 0, retired: [{ sid: 'CD33', outcome: 'failed' }],
  }];
  assert.deepEqual(diffSubagents(previous, next), {
    added: [{ sessionSid: 'AAAA', sid: 'EF44', ageMs: 0 }],
    completed: [], failed: [{ sessionSid: 'AAAA', sid: 'CD33' }], cleared: [],
  });
  assert.deepEqual(diffSubagents(next, []), {
    added: [], completed: [], failed: [], cleared: [
      { sessionSid: 'AAAA', sid: 'AB22' }, { sessionSid: 'AAAA', sid: 'EF44' },
    ],
  });
});

test('subagent summaries expose bounded counts and statuses without identifiers', () => {
  assert.equal(summarizeSubagents([]), 'No observed delegated work.');
  assert.equal(summarizeSubagents([
    { status: 'running', subagents: [{ sid: 'ABCD' }], subagentsMore: 1 },
    { status: 'waiting', subagents: [{ sid: 'EFGH' }], subagentsMore: 0 },
    { status: 'quiet', subagents: [], subagentsMore: 0 },
  ]), 'Observed delegated work: 2 visible subagent branches across 2 sessions ' +
    '(1 running, 1 waiting); 1 additional branch omitted by display limits.');
});

test('client validates bounded subagent metadata and retains branches only for the connection grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeEventSource.instances = [];
  const trees = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onTree: (tree) => trees.push(tree),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const base = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0,
    journalFiles: 1, steps: 0, sessions: [], treeSessions: [],
  };
  const session = (subagents, retired = []) => ({
    sid: 'AAAA', status: 'running', subagents, subagentsMore: 0, retired,
  });
  const child = (sid, ageMs = 0) => ({ sid, ageMs });
  const epoch = 'subagent-client-epoch';
  stream.emit('snapshot', { epoch, sequence: 0, snapshot: { ...base, treeSessions: [session([])] } });
  stream.emit('snapshot', { epoch, sequence: 0, snapshot: { ...base, treeSessions: [session([{ ...child('bad!') }])] } });
  assert.equal(trees.length, 1, 'malformed snapshots are discarded');
  stream.emit('snapshot', { epoch, sequence: 0, snapshot: { ...base, treeSessions: [session([child('AB22')])] } });
  assert.equal(trees.at(-1).reset, true);
  assert.deepEqual(trees.at(-1).sessions[0].subagents, [child('AB22')]);
  stream.emit('snapshot', {
    epoch, sequence: 1,
    snapshot: { ...base, treeSessions: [session([child('AB22'), child('EF44')])] },
  });
  assert.deepEqual(trees.at(-1).added, [{ sessionSid: 'AAAA', sid: 'EF44', ageMs: 0 }]);
  const activitySnapshot = { ...base };
  delete activitySnapshot.treeSessions;
  stream.emit('activity', {
    epoch, sequence: 2, kind: 'activity', eventType: 'future.event', snapshot: activitySnapshot,
  });
  assert.deepEqual(client.getState().treeSessions[0].subagents, [child('AB22'), child('EF44')]);
  stream.emit('snapshot', {
    epoch, sequence: 2,
    snapshot: { ...base, treeSessions: [session([], [{ sid: 'AB22', outcome: 'completed' }])] },
  });
  assert.deepEqual(trees.at(-1).completed, [{ sessionSid: 'AAAA', sid: 'AB22' }]);
  stream.emit('snapshot', {
    epoch, sequence: 2, snapshot: { ...base, treeSessions: [session([child('EF44')])] },
  });
  const beforeError = trees.length;
  stream.onerror();
  assert.equal(trees.length, beforeError, 'connection errors do not remove visible branches immediately');
  assert.deepEqual(client.getState().treeSessions[0].subagents, [child('EF44')]);
  stream.emit('activity', { epoch, sequence: 3, kind: 'step', snapshot: base });
  assert.equal(trees.length, beforeError, 'deltas awaiting a recovery snapshot also retain branches');
  t.mock.timers.tick(14_999);
  assert.equal(trees.length, beforeError);
  t.mock.timers.tick(1);
  assert.deepEqual(trees.at(-1).cleared, [{ sessionSid: 'AAAA', sid: 'EF44' }]);
  assert.deepEqual(client.getState().treeSessions, []);
  client.disconnect();
});

test('client validates grouped generic metadata and never forwards private fields or replays after gaps', () => {
      FakeEventSource.instances = [];
      const activities = [];
      const buffer = createImpulseBuffer();
      const client = createActivityClient({
        EventSourceImpl: FakeEventSource,
        onState: (state) => { if (state.connection !== 'connected') buffer.clear(); },
        onActivity: (value) => { activities.push(value); buffer.add(value); },
      });
      client.connect();
    const stream = FakeEventSource.instances[0];
    const snapshot = {
      source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
      activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 0,
    };
    const epoch = 'grouped-live-epoch';
    stream.emit('snapshot', { epoch, sequence: 0, snapshot, eventType: 'PRIVATE' });
    const value = { epoch, sequence: 1, snapshot, kind: 'activity',
      eventType: 'tool.execution_complete', toolName: 'functions.view', count: 50, result: 'PRIVATE' };
    stream.emit('activity', value);
    stream.emit('activity', value);
    assert.deepEqual(activities, [{
      kind: 'activity', eventType: 'tool.execution_complete', toolName: 'functions.view', count: 50,
    }]);
    stream.emit('activity', { ...value, sequence: 3 });
    assert.equal(buffer.drain().orange, 0);
    stream.emit('snapshot', { epoch, sequence: 3, snapshot, eventType: 'PRIVATE' });
    assert.equal(activities.length, 1);
    stream.emit('activity', { ...value, sequence: 4, eventType: 'future.event', toolName: 'ignored', count: 2 });
    assert.deepEqual(activities.at(-1), { kind: 'activity', eventType: 'future.event', count: 2 });
    stream.onerror();
    assert.equal(buffer.drain().orange, 0);
    client.disconnect();
  });

test('activity client forwards tool names only for valid live step events', () => {
  FakeEventSource.instances = [];
  const activities = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource, onActivity: (activity) => activities.push(activity),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const snapshot = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 1, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 1,
  };
  const epoch = 'tool-detail-epoch';
  stream.emit('snapshot', { epoch, sequence: 0, snapshot, toolName: 'ignored' });
  stream.emit('activity', { epoch, sequence: 1, snapshot, kind: 'step', toolName: 'functions.view', arguments: 'PRIVATE' });
  stream.emit('activity', { epoch, sequence: 1, snapshot, kind: 'step', toolName: 'duplicate' });
  stream.emit('activity', { epoch, sequence: 2, snapshot, kind: 'thinking', toolName: 'ignored' });
  stream.emit('activity', { epoch, sequence: 3, snapshot, kind: 'step', toolName: '<script>' });
  stream.emit('activity', { epoch, sequence: 4, snapshot, kind: 'step', toolName: 'functions.view\n' });
  assert.deepEqual(activities, [
    { kind: 'step', toolName: 'functions.view' }, { kind: 'thinking' }, { kind: 'step' }, { kind: 'step' },
  ]);
  client.disconnect();
});

test('snapshots do not replay deltas, live sequences apply once, gaps become unknown', () => {
  FakeEventSource.instances = [];
  const states = [];
  const activities = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onState: (state) => states.push(state),
    onActivity: (activity) => activities.push(activity),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  stream.emit('snapshot', {
    epoch: 'boot-instance-aa',
    sequence: 20,
    snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 0 },
  });
  assert.equal(activities.length, 0);
  stream.emit('activity', { epoch: 'boot-instance-aa', sequence: 21, kind: 'step', snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 1, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 1 } });
  stream.emit('activity', { epoch: 'boot-instance-aa', sequence: 21, kind: 'step', snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 1, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 1 } });
  assert.equal(activities.length, 1);
  stream.emit('activity', { epoch: 'boot-instance-aa', sequence: 23, kind: 'completion', snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 1 } });
  assert.equal(activities.length, 1);
  assert.equal(states.at(-1).connection, 'unknown');
  stream.emit('snapshot', {
    epoch: 'boot-instance-aa',
    sequence: 23,
    snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 1 },
  });
  stream.emit('activity', { epoch: 'boot-instance-aa', sequence: 24, kind: 'step', snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 1, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 4, steps: 2 } });
  assert.equal(activities.length, 2);
  client.disconnect();
});

test('connection errors mark coverage unknown immediately but wait 15 seconds before retrying', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource, onState: (state) => states.push(state) });
  client.connect();
  const stream = FakeEventSource.instances[0];
  stream.emit('snapshot', { epoch: 'boot-instance-bb', sequence: 0, snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 0, steps: 0 } });
  stream.onerror();
  assert.equal(states.at(-1).connection, 'recovering');
  assert.equal(states.at(-1).coverage, 'unknown');
  t.mock.timers.tick(10_000);
  stream.onerror();
  t.mock.timers.tick(4_999);
  assert.equal(states.at(-1).connection, 'recovering', 'repeated errors do not restart the grace period');
  t.mock.timers.tick(1);
  assert.equal(states.at(-1).connection, 'retrying');
  assert.equal(states.at(-1).coverage, 'unknown');
  stream.onerror();
  t.mock.timers.tick(15_000);
  assert.equal(states.at(-1).connection, 'retrying', 'continued failures do not start another grace period');
  client.disconnect();
});

test('a valid recovery snapshot cancels the warning and the next outage gets a fresh grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeEventSource.instances = [];
  const states = [];
  const activities = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onState: (state) => states.push(state),
    onActivity: (activity) => activities.push(activity),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const snapshot = { source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 1, thinkingSessions: 1, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 1 };
  const epoch = 'connection-recovery-epoch';
  stream.emit('snapshot', { epoch, sequence: 0, snapshot });
  stream.onerror();
  assert.equal(client.getState().activeSessions, 1, 'last-known sessions stay visible during the grace period');
  assert.equal(client.getState().coverage, 'unknown', 'retained sessions are not verified live coverage');
  const clock = createThinkingPulseClock();
  assert.equal(clock.tick(0.05, client.getState(), false), 0);
  assert.equal(clock.tick(0.05, client.getState(), false), 0);
  assert.equal(clock.tick(0.05, client.getState(), false), 0);
  assert.equal(clock.tick(0.05, client.getState(), false), 1, 'running pulses continue during recovery');
  t.mock.timers.tick(14_999);
  stream.emit('activity', { epoch, sequence: 1, kind: 'step', snapshot });
  assert.equal(activities.length, 0, 'activity cannot bypass the required recovery snapshot');
  assert.equal(client.getState().connection, 'recovering', 'deltas do not trigger the warning early');
  stream.emit('snapshot', { epoch, sequence: 1, snapshot });
  assert.equal(client.getState().connection, 'connected');
  assert.equal(client.getState().activeSessions, 1);
  const recoveredCount = states.length;
  t.mock.timers.tick(15_000);
  assert.equal(states.length, recoveredCount, 'a recovered connection has no delayed warning');
  stream.onerror();
  t.mock.timers.tick(14_999);
  assert.equal(client.getState().connection, 'recovering');
  t.mock.timers.tick(1);
  assert.equal(client.getState().connection, 'retrying');
  assert.equal(client.getState().activeSessions, 0);
  assert.equal(clock.tick(0.05, client.getState(), false), 0, 'running pulses stop after the grace period');
  stream.emit('snapshot', { epoch, sequence: 1, snapshot });
  assert.equal(client.getState().connection, 'connected', 'long outages can also recover');
  client.disconnect();
});

test('disconnect cancels a pending reconnect warning', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource, onState: (state) => states.push(state) });
  client.connect();
  const stream = FakeEventSource.instances[0];
  stream.onerror();
  t.mock.timers.tick(14_999);
  client.disconnect();
  const disconnectedCount = states.length;
  t.mock.timers.tick(15_000);
  assert.equal(states.length, disconnectedCount);
  assert.equal(client.getState().connection, 'disconnected');
  assert.equal(stream.closed, true);
});

test('server restart epoch resets sequence without replaying old deltas', () => {
  FakeEventSource.instances = [];
  const activities = [];
  const states = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onState: (state) => states.push(state),
    onActivity: (activity) => activities.push(activity),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const snapshot = (epoch, sequence) => ({
    epoch,
    sequence,
    snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 2, steps: 0 },
  });
  stream.emit('snapshot', snapshot('boot-instance-aa', 42));
  stream.onerror();
  stream.emit('snapshot', snapshot('boot-instance-bb', 0));
  assert.equal(client.getState().connection, 'connected');
  stream.emit('activity', {
    epoch: 'boot-instance-bb',
    sequence: 1,
    kind: 'step',
    snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only', activeSessions: 1, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 2, steps: 1 },
  });
  assert.equal(activities.length, 1);
  assert.equal(states.at(-1).activeSessions, 1);
  client.disconnect();
});
test('thinking clock sustains six pulses per second per session without new events', () => {
  const clock = createThinkingPulseClock();
  const state = { connection: 'connected', sourceStatus: 'available', thinkingSessions: 1 };
  let pulses = 0;
  for (let i = 0; i < 120; i++) pulses += clock.tick(1 / 60, state, false);
  assert.equal(pulses, 12);
  clock.reset();
  pulses = 0;
  for (let i = 0; i < 60; i++) pulses += clock.tick(1 / 60, { ...state, thinkingSessions: 3 }, false);
  assert.equal(pulses, 18);
});

test('running pulse settings control per-session rate, cap and disabling', () => {
  const state = { connection: 'connected', sourceStatus: 'available', runningSessions: 1 };
  for (const [rate, cap, sessions, expected] of [
    [12, 2, 1, 12], [12, 2, 2, 24], [12, 2, 10, 24],
    [0, 2, 10, 0], [12, 0, 10, 0],
  ]) {
    const clock = createThinkingPulseClock({ pulsesPerSecondPerSession: rate, maxSessions: cap });
    let pulses = 0;
    for (let frame = 0; frame < 60; frame++) {
      pulses += clock.tick(1 / 60, { ...state, runningSessions: sessions }, false);
    }
    assert.equal(pulses, expected);
    assert.equal(clock.tick(1 / 60, state, true), 0);
    assert.equal(clock.tick(1 / 60, { ...state, connection: 'retrying' }, false), 0);
  }
});

test('thinking clock stops and clears accumulated time on inactive or unavailable states', () => {
  const state = { connection: 'connected', sourceStatus: 'available', thinkingSessions: 1 };
  for (const [change, hidden] of [
    [{ thinkingSessions: 0 }, false], [{ connection: 'retrying' }, false],
    [{ sourceStatus: 'unavailable' }, false], [{}, true],
  ]) {
    const clock = createThinkingPulseClock();
    for (let i = 0; i < 3; i++) assert.equal(clock.tick(0.05, state, false), 0);
    assert.equal(clock.tick(1, { ...state, ...change }, hidden), 0);
    assert.equal(clock.tick(0.05, state, false), 0);
    for (let i = 0; i < 2; i++) assert.equal(clock.tick(0.05, state, false), 0);
    clock.reset();
    assert.equal(clock.tick(0.05, state, false), 0);
  }
});

test('thinking clock bounds long frames and concurrent-session load', () => {
  const clock = createThinkingPulseClock();
  const state = { connection: 'connected', sourceStatus: 'available', thinkingSessions: 1000 };
  assert.equal(clock.tick(1000, state, false), 9);
  assert.equal(clock.tick(-1, state, false), 0);
  assert.equal(clock.tick(NaN, state, false), 0);
});

const runningSnapshot = (extra = {}) => ({
  source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
  activeSessions: 0, thinkingSessions: 0, unknownSessions: 1, backlogFiles: 0, journalFiles: 2, steps: 3,
  runningSessions: 1, unverifiedRunningSessions: 1, ...extra,
});

test('client validates optional bounded running counts and clears them after the connection grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource, onState: (state) => states.push(state) });
  client.connect();
  const stream = FakeEventSource.instances[0];
  stream.emit('snapshot', { epoch: 'running-epoch-aaaa', sequence: 0, snapshot: runningSnapshot() });
  assert.equal(states.at(-1).runningSessions, 1);
  assert.equal(states.at(-1).unverifiedRunningSessions, 1);
  for (const invalid of [
    { runningSessions: -1 }, { runningSessions: 1.5 }, { runningSessions: '1' },
    { unverifiedRunningSessions: 2 }, { runningSessions: undefined },
    { unverifiedRunningSessions: undefined }, { runningSessions: 1_000_000_001, unverifiedRunningSessions: 0 },
  ]) {
    stream.emit('snapshot', { epoch: 'running-epoch-aaaa', sequence: 1, snapshot: runningSnapshot(invalid) });
    assert.equal(client.getState().connection, 'unknown', JSON.stringify(invalid));
    assert.deepEqual(client.getState().sessions, []);
  }
  const legacy = runningSnapshot({ thinkingSessions: 2, activeSessions: 2, unknownSessions: 0 });
  delete legacy.runningSessions;
  delete legacy.unverifiedRunningSessions;
  stream.emit('snapshot', { epoch: 'running-epoch-aaaa', sequence: 2, snapshot: legacy });
  assert.equal(states.at(-1).runningSessions, 2, 'legacy servers keep thinking-based pulses');
  assert.equal(states.at(-1).unverifiedRunningSessions, 0);
  stream.onerror();
  assert.equal(states.at(-1).runningSessions, 2);
  assert.equal(states.at(-1).coverage, 'unknown');
  t.mock.timers.tick(15_000);
  assert.equal(states.at(-1).runningSessions, 0);
  assert.equal(states.at(-1).unverifiedRunningSessions, 0);
  client.disconnect();
  assert.equal(client.getState().runningSessions, 0);
});

test('running clock pulses for observed tool/delegated work, including unverified long silence', () => {
  const clock = createThinkingPulseClock();
  const state = { connection: 'connected', sourceStatus: 'available', thinkingSessions: 0,
    runningSessions: 1, unverifiedRunningSessions: 1 };
  let pulses = 0;
  for (let i = 0; i < 60; i++) pulses += clock.tick(1 / 60, state, false);
  assert.equal(pulses, 6);
  assert.equal(clock.tick(1, { ...state, runningSessions: 0, thinkingSessions: 3 }, false), 0,
    'an explicit zero running count wins over thinking');
  assert.equal(clock.tick(0.05, { ...state, connection: 'unknown' }, false), 0);
  assert.equal(clock.tick(0.05, { ...state, sourceStatus: 'unavailable' }, false), 0);
  assert.equal(clock.tick(10, state, true), 0, 'hidden tabs pause without catch-up');
  assert.equal(clock.tick(10, state, false), 0, 'long frames are capped (0.05s => 0.3 pulse)');
});

test('client strictly validates and whitelists optional session HUD projections', () => {
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onState: (state) => states.push(state),
  });

  client.connect();
  const stream = FakeEventSource.instances[0];
  const base = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 0,
  };
  const valid = { ...base, sessions: [{ id: 'K3F2QA', status: 'running', elapsedMs: 42 }], sessionsTruncated: false };
  stream.emit('snapshot', { epoch: 'sessions-epoch-aaaa', sequence: 0, snapshot: valid });
  assert.deepEqual(states.at(-1).sessions, [{ id: 'K3F2QA', status: 'running', elapsedMs: 42 }]);
  assert.equal(states.at(-1).sessionsTruncated, false);

  const invalidSnapshots = [
    { sessions: 'not-an-array' },
    { sessions: Array.from({ length: 33 }, (_, i) => ({ id: 'K3F2QA', status: 'idle', elapsedMs: i })) },
    { sessions: [{ id: 'session', status: 'idle', elapsedMs: 0 }] },
    { sessions: [{ id: 'K3F2QA', status: 'unknown', elapsedMs: 0 }] },
    { sessions: [{ id: 'K3F2QA', status: 'idle', elapsedMs: -1 }] },
    { sessions: [{ id: 'K3F2QA', status: 'idle', elapsedMs: 1.5 }] },
    { sessions: [{ id: 'K3F2QA', status: 'idle', elapsedMs: 1_000_000_001 }] },
    { sessions: [{ id: 'K3F2QA', status: 'idle', elapsedMs: 0, extra: true }] },
    { sessionsTruncated: 'false' },
  ];
  for (const extra of invalidSnapshots) {
    stream.emit('snapshot', { epoch: 'sessions-epoch-aaaa', sequence: 1, snapshot: { ...base, ...extra } });
    assert.equal(client.getState().connection, 'unknown', JSON.stringify(extra));
    assert.deepEqual(client.getState().sessions, []);
  }
  const legacy = { ...base };
  stream.emit('snapshot', { epoch: 'sessions-epoch-aaaa', sequence: 1, snapshot: legacy });
  assert.equal(states.at(-1).sessions, undefined);
  client.disconnect();
});

test('client validates separate active HUD sessions and waiter handles', () => {
  FakeEventSource.instances = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const running = { id: 'K3F2QA', status: 'running', elapsedMs: 42 };
  const waiting = { id: 'K3F2QB', status: 'waiting', waitKind: 'input', elapsedMs: 10 };
  const base = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 1, thinkingSessions: 1, unknownSessions: 0, backlogFiles: 0, journalFiles: 2, steps: 0,
    runningSessions: 1, unverifiedRunningSessions: 0, waitingSessions: 1,
    sessions: [running, waiting], sessionsTruncated: false,
    hudSessions: [running], hudSessionsTruncated: false,
    waitingSessionIds: [waiting.id],
  };
  stream.emit('snapshot', {
    epoch: 'active-hud-epoch-aaaa', sequence: 0, snapshot: base,
  });
  assert.deepEqual(client.getState().hudSessions, [running]);
  assert.deepEqual(client.getState().waitingSessionIds, [waiting.id]);

  const invalid = [
    { hudSessions: [waiting] },
    { hudSessions: [running], hudSessionsTruncated: true },
    { hudSessionsTruncated: 'false' },
    { waitingSessionIds: ['private'] },
    { waitingSessionIds: [] },
    { waitingSessionIds: Array.from({ length: 33 }, () => waiting.id) },
  ];
  for (let index = 0; index < invalid.length; index++) {
    stream.emit('snapshot', {
      epoch: 'active-hud-epoch-aaaa', sequence: index + 1, snapshot: { ...base, ...invalid[index] },
    });
    assert.equal(client.getState().connection, 'unknown', JSON.stringify(invalid[index]));
    assert.deepEqual(client.getState().hudSessions, []);
    assert.deepEqual(client.getState().waitingSessionIds, []);
  }
  client.disconnect();
});

test('active HUD projection prefers the running-only list and filters legacy waiting rows', () => {
  const running = { id: 'K3F2QA', status: 'running' };
  const unverified = { id: 'K3F2QB', status: 'running-unverified' };
  const waiting = { id: 'K3F2QC', status: 'waiting' };
  const idle = { id: 'K3F2QD', status: 'idle' };

  assert.deepEqual(projectActiveHudSessions({
    hudSessions: [running, unverified],
    sessions: [running, waiting],
  }), [running, unverified]);
  assert.deepEqual(projectActiveHudSessions({ sessions: [running, waiting, idle] }), [running]);
  assert.equal(projectActiveHudSessions({}), null);
});

test('client strictly validates and whitelists per-session stats', () => {
  FakeEventSource.instances = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const base = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 0,
  };
  const stats = {
    kinds: { thinking: 1, step: 2, completion: 3, activity: 4 },
    types: [['assistant.message', 2]],
    otherTypes: 0,
    tools: [['functions.view', 1]],
    otherTools: 0,
    subagents: { started: 1, completed: 0, failed: 0 },
    errors: 0,
    runningMs: 100,
    unverifiedMs: 10,
    waitingMs: 20,
    turns: { count: 1, lastMs: 50, medianMs: 50, maxMs: 50 },
  };
  const session = { id: 'K3F2QA', status: 'running', elapsedMs: 42, stats };
  stream.emit('snapshot', {
    epoch: 'stats-epoch-aaaa', sequence: 0,
    snapshot: { ...base, sessions: [session] },
  });
  assert.deepEqual(client.getState().sessions, [session]);

  const invalidStats = [
    { ...stats, extra: true },
    { ...stats, kinds: { ...stats.kinds, extra: 0 } },
    { ...stats, kinds: { ...stats.kinds, step: -1 } },
    { ...stats, types: [['PRIVATE TEXT', 1]] },
    { ...stats, types: Array.from({ length: 11 }, (_, index) => [`type.${index}`, 1]) },
    { ...stats, types: [['assistant.message', 1], ['assistant.message', 2]] },
    { ...stats, tools: [['invalid tool', 1]] },
    { ...stats, tools: [['functions.view', 1_000_000_001]] },
    { ...stats, subagents: { started: 1, completed: 0, failed: 0, extra: 0 } },
    { ...stats, errors: 1.5 },
    { ...stats, runningMs: -1 },
    { ...stats, turns: { ...stats.turns, medianMs: 1_000_000_001 } },
  ];
  for (const invalid of invalidStats) {
    stream.emit('snapshot', {
      epoch: 'stats-epoch-aaaa', sequence: 1,
      snapshot: { ...base, sessions: [{ ...session, stats: invalid }] },
    });
    assert.equal(client.getState().connection, 'unknown', JSON.stringify(invalid));
    assert.deepEqual(client.getState().sessions, []);
  }
  stream.emit('snapshot', {
    epoch: 'stats-epoch-aaaa', sequence: 1,
    snapshot: { ...base, sessions: [{ id: 'K3F2QA', status: 'running', elapsedMs: 42 }] },
  });
  assert.deepEqual(client.getState().sessions, [{ id: 'K3F2QA', status: 'running', elapsedMs: 42 }]);
  client.disconnect();
});

test('client validates wait kind consistency and bounded aggregate count', () => {
  FakeEventSource.instances = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const base = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 2, journalFiles: 2, steps: 0,
    sessionsTruncated: false,
  };
  const waiting = { id: 'K3F2QA', status: 'waiting', waitKind: 'both', elapsedMs: 10 };
  stream.emit('snapshot', {
    epoch: 'waiting-fields-epoch', sequence: 0,
    snapshot: { ...base, waitingSessions: 1, sessions: [waiting] },
  });
  assert.equal(client.getState().waitingSessions, 1);
  assert.deepEqual(client.getState().sessions, [waiting]);

  const invalid = [
    { waitingSessions: -1 },
    { waitingSessions: 3 },
    { waitingSessions: 513 },
    { waitingSessions: 1.5 },
    { sessions: [{ id: 'K3F2QA', status: 'waiting', elapsedMs: 0 }] },
    { sessions: [{ ...waiting, waitKind: 'tool' }] },
    { sessions: [{ ...waiting, status: 'idle' }] },
    { waitingSessions: 0 },
  ];
  for (const extra of invalid) {
    stream.emit('snapshot', {
      epoch: 'waiting-fields-epoch', sequence: 1,
      snapshot: { ...base, waitingSessions: 1, sessions: [waiting], ...extra },
    });
    assert.equal(client.getState().connection, 'unknown', JSON.stringify(extra));
  }
  client.disconnect();
});

test('malformed session snapshots and activities clear stale statuses until a fresh snapshot', () => {
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({
    EventSourceImpl: FakeEventSource,
    onState: (state) => states.push(state),
  });
  client.connect();
  const stream = FakeEventSource.instances[0];
  const snapshot = {
    source: 'local-activity-files', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 1, steps: 0,
    sessions: [{ id: 'K3F2QA', status: 'running', elapsedMs: 100 }],
    sessionsTruncated: false,
  };
  stream.emit('snapshot', { epoch: 'session-gap-epoch', sequence: 0, snapshot });
  assert.equal(client.getState().sessions[0].status, 'running');

  stream.emit('snapshot', {
    epoch: 'session-gap-epoch', sequence: 1,
    snapshot: { ...snapshot, sessions: [{ ...snapshot.sessions[0], extra: 'invalid' }] },
  });
  assert.equal(client.getState().connection, 'unknown');
  assert.deepEqual(client.getState().sessions, []);

  stream.emit('snapshot', { epoch: 'session-gap-epoch', sequence: 1, snapshot });
  assert.equal(client.getState().connection, 'connected');
  assert.equal(client.getState().sessions[0].status, 'running');
  stream.emit('activity', {
    epoch: 'session-gap-epoch', sequence: 2, kind: 'step',
    snapshot: { ...snapshot, sessions: [{ id: 'invalid', status: 'running', elapsedMs: 100 }] },
  });
  assert.equal(client.getState().connection, 'unknown');
  assert.deepEqual(client.getState().sessions, []);
  client.disconnect();
});

test('projected activity keeps only a bounded integer duration', () => {
  const base = { kind: 'activity', eventType: 'tool.execution_complete' };
  assert.equal(projectActivity({ ...base, durationMs: 4200 }).durationMs, 4200);
  for (const bad of [-1, 1.5, '4200', Infinity, 1_000_000_001]) {
    assert.equal(projectActivity({ ...base, durationMs: bad }), null, String(bad));
  }
  assert.equal('durationMs' in projectActivity(base), false);
});

test('impact bursts scale with run length between the configured bounds', async () => {
  const { impactBurst } = activityUi;
  const { VISUAL } = await import('../visual-settings.mjs');
  const impact = VISUAL.impact;
  assert.equal(impactBurst(impact.minMs - 1, impact), null);
  assert.equal(impactBurst(NaN, impact), null);
  const small = impactBurst(impact.minMs, impact);
  const mid = impactBurst(Math.sqrt(impact.minMs * impact.maxMs), impact);
  const large = impactBurst(impact.maxMs * 10, impact);
  assert.deepEqual([small.hops, small.spread, small.neighbourSeeds], [impact.minHops, impact.minSpread, 0]);
  assert.deepEqual([large.t, large.hops, large.spread, large.neighbourSeeds, large.neighbourHops],
    [1, impact.maxHops, impact.maxSpread, impact.neighbourSeeds, impact.neighbourHops]);
  assert.ok(Math.abs(mid.t - 0.5) < 1e-9);
  assert.ok(small.hops < mid.hops && mid.hops < large.hops);
});

test('impulse buffer drains only the four longest timed runs per frame', () => {
  const buffer = createImpulseBuffer();
  for (const durationMs of [5, 900, 30, 7000, 60, 400]) {
    buffer.add({ kind: 'activity', eventType: 'tool.execution_complete', toolName: 'view', durationMs });
  }
  buffer.add({ kind: 'step', eventType: 'tool.execution_start', toolName: 'view' });
  const first = buffer.drain().impacts.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
  assert.deepEqual(first, [60, 400, 900, 7000]);
  assert.equal(buffer.drain().impacts.length, 0);
  buffer.add({ kind: 'activity', eventType: 'assistant.turn_end', durationMs: 10 });
  buffer.clear();
  assert.equal(buffer.drain().impacts.length, 0);
});