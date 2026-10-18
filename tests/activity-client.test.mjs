import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityClient, createImpulseFeed, createImpulseBuffer, activityColor,
  diffSubagents, impulseIntensity, projectActivity, summarizeSubagents,
  projectActiveHudSessions, createThinkingPulseClock } from '../activity-client.mjs';

function feedElement() {
  const element = {
    children: [],
    ownerDocument: { createElement: () => ({}) },
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
  assert.equal(element.children[0].className, 'impulse-entry impulse-completion impulse-orange');
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
  assert.match(element.children[0].className, /impulse-orange/);
  feed.add('activity', undefined, 'assistant.message_delta', 1000);
  assert.match(element.children[0].className, /impulse-blue/);
  feed.add('activity', undefined, '<PRIVATE>', 5);
  assert.equal(element.children.length, 2);
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
  assert.equal(result.orange, 50000);
  assert.equal(result.completions, 1);
  assert.equal(result.entries.length, 8);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|content/);
  assert.equal(impulseIntensity(result.blue), 8);
  assert.equal(impulseIntensity(1), 1);
  assert.deepEqual(buffer.drain(), { blue: 0, orange: 0, completions: 0, entries: [] });
  buffer.add({ kind: 'step' });
  buffer.clear();
  assert.equal(buffer.drain().orange, 0);
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

test('client validates bounded subagent metadata, diffs snapshots, and clears branches across gaps', () => {
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
  stream.onerror();
  assert.deepEqual(trees.at(-1).cleared, []);
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

test('accepts only bounded metadata and reports reconnecting as unknown rather than idle', () => {
  FakeEventSource.instances = [];
  const states = [];
  const client = createActivityClient({ EventSourceImpl: FakeEventSource, onState: (state) => states.push(state) });
  client.connect();
  const stream = FakeEventSource.instances[0];
  stream.emit('snapshot', { epoch: 'boot-instance-bb', sequence: 0, snapshot: { source: 'local-activity-files', sourceStatus: 'available', coverage: 'partial', activeSessions: 0, thinkingSessions: 0, unknownSessions: 0, backlogFiles: 0, journalFiles: 0, steps: 0 } });
  stream.onerror();
  assert.equal(states.at(-1).connection, 'retrying');
  assert.equal(states.at(-1).coverage, 'unknown');
  client.disconnect();
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

test('client validates optional bounded running counts and clears them on gaps', () => {
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
