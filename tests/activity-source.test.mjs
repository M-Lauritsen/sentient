import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile, readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalActivitySource } from '../copilot/activity-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentient-journals-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function event(type, data = {}, extras = {}) {
  return JSON.stringify({ id: `event-${Math.random()}`, type, timestamp: new Date().toISOString(), data, ...extras }) + '\n';
}

test('all valid event families and future types emit metadata once, including empty lifecycle data', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (value) => observed.push(value));
  await source.start();
  const types = ['user.message', 'assistant.message', 'assistant.message_delta',
    'assistant.reasoning_delta', 'tool.execution_progress', 'tool.execution_complete',
    'permission.requested', 'permission.completed', 'subagent.started', 'subagent.completed',
    'session.start', 'session.error', 'session.shutdown', 'abort', 'future.new_event'];
  const records = types.map((type, i) => event(type, i % 2 ? null : {
    content: 'PRIVATE', result: 'PRIVATE', arguments: 'PRIVATE',
  }, { id: `family-${i}` }));
  await appendFile(file, records.join('') + records.join(''));
  await source.poll();
  assert.deepEqual(observed.map((value) => value.eventType), types);
  assert.ok(observed.every((value) => value.kind === 'activity'));
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE|content|result|arguments|family-/);
  assert.equal(source.snapshot().thinkingSessions, 0);
  assert.equal(source.snapshot().sourceStatus, 'available');
});

test('invalid event identifiers are rejected with partial coverage; missing data is safe', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (value) => observed.push(value));
  await source.start();
  await appendFile(file, ['', 'x'.repeat(129), 'assistant.message\n', '<PRIVATE>', 'private text', '🧠']
    .map((type) => event(type)).join('') +
    JSON.stringify({ id: 'missing-data', type: 'session.start' }) + '\n');
  await source.poll();
  assert.deepEqual(observed, [{ kind: 'activity', eventType: 'session.start' }]);
  assert.equal(source.snapshot().sourceStatus, 'partial');
});

test('token bursts are counted without per-token publication or retained content', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  let changes = 0;
  source.on('activity', (value) => observed.push(value));
  source.on('change', () => changes++);
  await source.start();
  changes = 0;
  await appendFile(file, Array.from({ length: 1000 }, (_, i) =>
    event('assistant.message_delta', { content: 'PRIVATE' }, { id: `delta-${i}` })).join(''));
  await source.poll();
  assert.deepEqual(observed, [{ kind: 'activity', eventType: 'assistant.message_delta', count: 1000 }]);
  assert.ok(changes <= 1);
  assert.ok(source.seenKeys.size <= 4096);
  assert.equal(source.pendingActivities.size, 0);
});

test('distinct-type pressure flushes bounded groups without dropping any events', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (value) => {
    assert.ok(source.pendingActivities.size <= 64);
    observed.push(value);
  });
  await source.start();
  await appendFile(file, Array.from({ length: 200 }, (_, i) => event(`future.type${i}`)).join(''));
  await source.poll();
  assert.equal(observed.reduce((sum, value) => sum + (value.count ?? 1), 0), 200);
  assert.equal(new Set(observed.map((value) => value.eventType)).size, 200);
  assert.equal(source.pendingActivities.size, 0);
});

test('tool logical dedup stays once while progress and complete are separate counted work', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (value) => observed.push(value));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'turn' }) +
    event('tool.execution_start', { toolCallId: 'call', toolName: 'functions.view' }) +
    event('tool.execution_start', { toolCallId: 'call', toolName: 'functions.view' }) +
    event('tool.execution_progress', { toolCallId: 'call', toolName: 'functions.view', result: 'PRIVATE' }) +
    event('tool.execution_complete', { toolCallId: 'call', toolName: 'functions.view', result: 'PRIVATE' }));
  await source.poll();
  assert.deepEqual(observed.map((value) => value.kind), ['thinking', 'step', 'activity', 'activity']);
  assert.deepEqual(observed.slice(1).map((value) => value.toolName),
    ['functions.view', 'functions.view', 'functions.view']);
  assert.equal(source.snapshot().steps, 1);
  assert.equal(source.snapshot().thinkingSessions, 1);
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE|call|turn"/);
});

test('incoming user messages do not refresh cognition or make a stale turn success-eligible', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'session'));
  const file = path.join(root, 'session', 'events.jsonl');
  await writeFile(file, '');
  let now = 1;
  const source = new LocalActivitySource({ root, pollIntervalMs: 0, clock: () => now });
  t.after(() => source.stop());
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'turn' }));
  await source.poll();
  now += 40000;
  await appendFile(file, event('user.message', { content: 'PRIVATE' }));
  await source.poll();
  now += 6000;
  assert.equal(source.snapshot().thinkingSessions, 0);
  assert.equal(source.snapshot().unknownSessions, 1);
});

test('step details project only bounded tool identifiers, never arguments or display titles', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'session-a');
  await mkdir(directory);
  const file = path.join(directory, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity));
  await source.start();
  const names = ['functions.view', 'github-mcp-server/search_code', undefined,
    '<script>alert(1)</script>', 'x'.repeat(129), { name: 'functions.view' }, 'toString', 'functions.view\n'];
  for (const [index, toolName] of names.entries()) {
    await appendFile(file, event('tool.execution_start', {
      toolCallId: `detail-${index}`, toolName,
      arguments: { path: 'PRIVATE PATH', command: 'PRIVATE COMMAND' },
      displayName: 'PRIVATE TITLE',
    }));
  }
  await source.poll();
  assert.deepEqual(observed.map(({ toolName }) => toolName),
    ['functions.view', 'github-mcp-server/search_code', 'toString', undefined]);
  assert.equal(observed.reduce((total, value) => total + (value.count ?? 1), 0), names.length);
  assert.ok(observed.every((activity) => activity.kind === 'step'));
  assert.ok(observed.every((activity) => Object.keys(activity).every((key) => ['kind', 'toolName', 'eventType', 'count'].includes(key))));
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE|arguments|displayName/);
});

test('startup baselines existing records without replaying steps or celebrations', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  await writeFile(path.join(session, 'events.jsonl'), [
    event('assistant.turn_start', { turnId: 'old-turn' }),
    event('tool.execution_start', { toolCallId: 'old-call' }),
    event('session.task_complete', { success: true, outcome: 'completed' }),
    event('assistant.message_delta', { content: 'PRIVATE' }),
    event('future.event', null),
  ].join(''));
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity));
  const before = await readFile(path.join(session, 'events.jsonl'));
  await source.start();
  assert.equal(observed.length, 0);
  assert.deepEqual(await readFile(path.join(session, 'events.jsonl')), before);
  assert.equal(source.snapshot().journalFiles, 1);
  assert.equal(source.snapshot().activeSessions, 0);
  assert.equal(source.snapshot().coverage, 'journal-only');
});

test('observed concurrent turns increase active sessions; tools emit one orange step', async (t) => {
  const root = await fixture(t);
  const first = path.join(root, 'session-a');
  const second = path.join(root, 'session-b');
  await mkdir(first);
  await writeFile(path.join(first, 'events.jsonl'), '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity.kind));
  await source.start();

  await appendFile(path.join(first, 'events.jsonl'), event('assistant.turn_start', { turnId: 'turn-a' }));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 1);
  assert.deepEqual(observed, ['thinking']);

  await mkdir(second);
  const secondFile = path.join(second, 'events.jsonl');
  await writeFile(secondFile, '');
  await source.poll();
  await appendFile(secondFile, event('assistant.turn_start', { turnId: 'turn-b' }));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 2);
  assert.equal(source.snapshot().thinkingSessions, 2);

  const toolStart = event('tool.execution_start', { toolCallId: 'call-a', turnId: 'turn-a', arguments: 'NEVER FORWARD THIS' });
  await appendFile(path.join(first, 'events.jsonl'), toolStart + toolStart);
  await source.poll();
  assert.equal(observed.filter((kind) => kind === 'step').length, 1);
  assert.equal(source.snapshot().thinkingSessions, 1);
  assert.equal(source.snapshot().steps, 1);
});

test('strict root task completion celebrates only within a fully observed successful interval', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity.kind));
  await source.start();

  let serial = 0;
  for (const [payload, extras] of [
    [{ success: true, outcome: 'completed' }, { agentId: 'subagent' }],
    [{ success: false, outcome: 'completed' }, {}],
    [{ success: true, outcome: 'blocked' }, {}],
    [{ success: true }, {}],
    [{ success: true, outcome: 'completed' }, { agentId: 'x'.repeat(257) }],
    [{ success: true, outcome: 'completed' }, { parentToolCallId: 42 }],
  ]) {
    const turnId = `ineligible-${serial++}`;
    await appendFile(file, event('assistant.turn_start', { turnId }) +
      event('session.task_complete', payload, extras) +
      event('assistant.turn_end', { turnId }));
    await source.poll();
  }
  assert.equal(observed.filter((kind) => kind === 'completion').length, 0);

  const success = event('session.task_complete', { success: true, outcome: 'completed', summary: 'PRIVATE SUMMARY' }, { id: 'accepted-task' });
  await appendFile(file,
    event('assistant.turn_start', { turnId: 'eligible' }) + success + success);
  await source.poll();
  assert.equal(observed.filter((kind) => kind === 'completion').length, 1);
  await appendFile(file, event('session.task_complete', { success: true, outcome: 'completed' }, { id: 'different-success-id' }));
  await source.poll();
  assert.equal(observed.filter((kind) => kind === 'completion').length, 1);
  assert.equal(JSON.stringify(source.snapshot()).includes('PRIVATE SUMMARY'), false);
});

test('permission waits, errors, aborts, and turn end do not create success or endless blue activity', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity.kind));
  await source.start();

  await appendFile(file, event('assistant.turn_start', { turnId: 'turn-a' }) +
    event('permission.requested', { permissionId: 'permission-a' }));
  await source.poll();
  assert.equal(source.snapshot().thinkingSessions, 0);
  await appendFile(file, event('permission.completed', { permissionId: 'permission-a' }));
  await source.poll();
  assert.equal(source.snapshot().thinkingSessions, 1);
  await appendFile(file, event('session.error', { message: 'PRIVATE ERROR' }));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 0);
  assert.equal(observed.includes('completion'), false);
  assert.equal(JSON.stringify(source.snapshot()).includes('PRIVATE ERROR'), false);
});

test('truncation resets eligibility and malformed lines do not stop later sessions', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', (activity) => observed.push(activity.kind));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'before-truncate' }));
  await source.poll();
  await writeFile(file, 'not json\n' + event('session.task_complete', { success: true, outcome: 'completed' }));
  await source.poll();
  assert.equal(observed.filter((kind) => kind === 'completion').length, 0);
  await appendFile(file, event('assistant.turn_start', { turnId: 'fresh' }) +
    event('session.task_complete', { success: true, outcome: 'completed' }));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 1);
  assert.equal(observed.filter((kind) => kind === 'completion').length, 1);
});

test('stale active intervals become unknown and cannot celebrate late completion', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  let now = 100;
  const source = new LocalActivitySource({ root, pollIntervalMs: 0, clock: () => now });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', ({ kind }) => observed.push(kind));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'turn-long' }));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 1);
  now += 46_000;
  assert.equal(source.snapshot().activeSessions, 0);
  assert.equal(source.snapshot().unknownSessions, 1);
  await appendFile(file, event('session.task_complete', { success: true, outcome: 'completed' }));
  await source.poll();
  assert.equal(observed.includes('completion'), false);
});

test('startup tail baselines honor the aggregate byte budget across files', async (t) => {
  const root = await fixture(t);
  for (let index = 0; index < 8; index++) {
    const directory = path.join(root, `session-${index}`);
    await mkdir(directory);
    await writeFile(path.join(directory, 'events.jsonl'), event('ignored.event', { padding: 'x'.repeat(180) }));
  }
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxTotalReadPerPoll: 256,
    maxFileReadPerPoll: 256,
  });
  t.after(() => source.stop());
  await source.start();
  assert.ok(source.lastPollBytesRead <= 256);
  let maximumRead = source.lastPollBytesRead;
  for (let index = 0; index < 20; index++) {
    await source.poll();
    maximumRead = Math.max(maximumRead, source.lastPollBytesRead);
  }
  assert.ok(maximumRead <= 256);
  assert.equal(source.snapshot().backlogFiles, 0);
  assert.equal(source.snapshot().sourceStatus, 'available');
});

test('split UTF-8 records are safely discarded without retaining content; later records recover', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxFileReadPerPoll: 256,
    maxTotalReadPerPoll: 1024,
  });
  t.after(() => source.stop());
  const activity = [];
  source.on('activity', ({ kind }) => activity.push(kind));
  await source.start();
  const bytes = Buffer.from(JSON.stringify({
    id: 'split-utf8-event',
    type: 'assistant.turn_start',
    data: { turnId: 'split-turn', ignoredText: `${'x'.repeat(30)}🧠${'x'.repeat(100)} PRIVATE` },
  }) + '\n');
  const emojiOffset = bytes.indexOf(Buffer.from('🧠'));
  await appendFile(file, bytes.subarray(0, emojiOffset + 2));
  await source.poll();
  await appendFile(file, bytes.subarray(emojiOffset + 2));
  await source.poll();
  assert.equal(source.snapshot().activeSessions, 0);
  assert.deepEqual(activity, []);
  await appendFile(file, JSON.stringify({ id: 'small-event', type: 'assistant.turn_start', data: { turnId: 'recovered', ignored: '🌌' } }) + '\n');
  for (let i = 0; i < 3; i++) {
    await source.poll();
    if (source.snapshot().backlogFiles === 0) break;
  }
  assert.equal(source.snapshot().activeSessions, 1);
  assert.deepEqual(activity, ['thinking']);
  assert.equal([...source.files.values()].some((state) => Object.hasOwn(state, 'pending')), false);
  assert.equal([...source.files.values()].some((state) => Buffer.isBuffer(state.boundary)), false);
  assert.equal(JSON.stringify([...source.files.values()]).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(source.snapshot()).includes('PRIVATE'), false);
});

test('read budget includes hashed append-boundary checks', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxFileReadPerPoll: 100,
    maxTotalReadPerPoll: 1000,
  });
  t.after(() => source.stop());
  await source.start();
  await appendFile(file, event('ignored.event', { padding: 'x'.repeat(300) }));
  await source.poll();
  assert.ok(source.lastPollBytesRead <= 100);
  await source.poll();
  assert.ok(source.lastPollBytesRead <= 100);
});

test('aggregate-budget deferral invalidates a changed file before later catch-up', async (t) => {
  const root = await fixture(t);
  const first = path.join(root, 'session-a');
  const second = path.join(root, 'session-b');
  await mkdir(first);
  await mkdir(second);
  const firstFile = path.join(first, 'events.jsonl');
  const secondFile = path.join(second, 'events.jsonl');
  await writeFile(firstFile, '');
  await writeFile(secondFile, '');
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxFileReadPerPoll: 256,
    maxTotalReadPerPoll: 320,
  });
  t.after(() => source.stop());
  const activity = [];
  source.on('activity', ({ kind }) => activity.push(kind));
  await source.start();

  const primingEvent = event('ignored.event', { tag: 'prime' });
  await appendFile(firstFile, primingEvent);
  await appendFile(secondFile, primingEvent);
  await source.poll();
  assert.equal([...source.files.values()].every((state) => state.boundary.length === 64), true);
  assert.deepEqual(activity, ['activity']); // two newly observed priming events, grouped
  activity.length = 0;

  const exactLength = (length) => {
    const base = { id: 'filler', type: 'ignored.event', data: { padding: '' } };
    const padding = length - Buffer.byteLength(JSON.stringify(base) + '\n');
    assert.ok(padding >= 0);
    return JSON.stringify({ ...base, data: { padding: 'x'.repeat(padding) } }) + '\n';
  };
  const filler = exactLength(148);
  assert.equal(Buffer.byteLength(filler), 148);
  await appendFile(firstFile, filler);
  await appendFile(secondFile, event('assistant.turn_start', { turnId: 'deferred-turn' }));
  await source.poll();
  assert.equal(source.snapshot().coverage, 'partial');
  assert.deepEqual(activity, ['activity']); // live filler in the serviced file
  activity.length = 0;

  for (let i = 0; i < 5 && source.snapshot().backlogFiles; i++) await source.poll();
  assert.equal(source.snapshot().coverage, 'journal-only');
  assert.deepEqual(activity, []);
  await appendFile(secondFile, event('assistant.turn_start', { turnId: 'fresh-after-gap' }));
  for (let i = 0; i < 3; i++) {
    await source.poll();
    if (activity.length) break;
  }
  assert.deepEqual(activity, ['thinking']);
});

test('backlog catch-up suppresses the final chunk and resumes only for new events', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxFileReadPerPoll: 256,
    maxTotalReadPerPoll: 1024,
  });
  t.after(() => source.stop());
  const activity = [];
  source.on('activity', ({ kind }) => activity.push(kind));
  await source.start();
  await appendFile(file, event('ignored.event', { padding: 'x'.repeat(300) }) +
    event('tool.execution_start', { toolCallId: 'backlogged-tool' }));
  await source.poll();
  assert.deepEqual(activity, []);
  for (let i = 0; i < 5 && source.snapshot().backlogFiles; i++) await source.poll();
  assert.deepEqual(activity, []);
  await appendFile(file, event('assistant.turn_start', { turnId: 'fresh-turn' }));
  await source.poll();
  await appendFile(file, event('tool.execution_start', { toolCallId: 'fresh-tool' }));
  await source.poll();
  assert.deepEqual(activity, ['thinking', 'step']);
});

test('a per-file read failure recovers through a suppressing baseline', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const activity = [];
  source.on('activity', ({ kind }) => activity.push(kind));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'pre-gap' }));
  await source.poll();

  const readFileNormally = source.readFile.bind(source);
  source.readFile = async (target, ...args) => {
    if (target === file) throw Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
    return readFileNormally(target, ...args);
  };
  await source.poll();
  source.readFile = readFileNormally;
  await appendFile(file, event('tool.execution_start', { toolCallId: 'gap-tool' }));
  await source.poll();
  assert.equal(activity.includes('step'), false);
  assert.equal(source.snapshot().coverage, 'journal-only');

  await appendFile(file, event('assistant.turn_start', { turnId: 'post-gap' }) +
    event('tool.execution_start', { toolCallId: 'post-gap-tool' }));
  await source.poll();
  assert.deepEqual(activity, ['thinking', 'thinking', 'step']);
});

test('failed boundary reads charge bytes before recovery and respect both limits', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({
    root,
    pollIntervalMs: 0,
    maxFileReadPerPoll: 256,
    maxTotalReadPerPoll: 256,
  });
  t.after(() => source.stop());
  const activity = [];
  source.on('activity', ({ kind }) => activity.push(kind));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'before-boundary-failure' }));
  await source.poll();

  const boundaryMatches = source.boundaryMatches.bind(source);
  source.boundaryMatches = async () => ({ matches: false, bytesRead: 32, failed: true });
  await appendFile(file, event('tool.execution_start', { toolCallId: 'during-boundary-failure' }));
  await source.poll();
  assert.equal(source.lastPollBytesRead, 32);
  assert.ok(source.lastPollBytesRead <= 256);
  source.boundaryMatches = boundaryMatches;

  await source.poll();
  assert.equal(source.snapshot().coverage, 'journal-only');
  assert.equal(activity.includes('step'), false);
});

test('session-file cap reports partial coverage instead of claiming idle completeness', async (t) => {
  const root = await fixture(t);
  for (const id of ['session-a', 'session-b']) {
    const directory = path.join(root, id);
    await mkdir(directory);
    await writeFile(path.join(directory, 'events.jsonl'), '');
  }
  const source = new LocalActivitySource({ root, pollIntervalMs: 0, maxFiles: 1 });
  t.after(() => source.stop());
  await source.start();
  assert.equal(source.snapshot().coverage, 'partial');
  assert.equal(source.snapshot().journalFiles, 2);
  assert.equal(source.snapshot().backlogFiles, 1);
});

test('source loss invalidates active success eligibility and recovers without stopping other sessions', async (t) => {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, '');
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', ({ kind }) => observed.push(kind));
  await source.start();
  await appendFile(file, event('assistant.turn_start', { turnId: 'before-gap' }));
  await source.poll();

  const hiddenRoot = `${root}-offline`;
  await rename(root, hiddenRoot);
  await source.poll();
  assert.equal(source.snapshot().sourceStatus, 'unavailable');
  await appendFile(path.join(hiddenRoot, 'session-a', 'events.jsonl'),
    event('session.task_complete', { success: true, outcome: 'completed' }));
  await rename(hiddenRoot, root);
  await source.poll();
  assert.equal(source.snapshot().sourceStatus, 'available');
  assert.equal(observed.includes('completion'), false);
});

// ---- Observed running work (user decision 2026-10-18: keep pulsing observed
// running tasks through long silence; mark stale running state unverified) ----

async function runningFixture(t, initial = '') {
  const root = await fixture(t);
  const session = path.join(root, 'session-a');
  await mkdir(session);
  const file = path.join(session, 'events.jsonl');
  await writeFile(file, initial);
  const clock = { now: 1_000 };
  const source = new LocalActivitySource({ root, pollIntervalMs: 0, clock: () => clock.now });
  t.after(() => source.stop());
  const observed = [];
  source.on('activity', ({ kind }) => observed.push(kind));
  await source.start();
  return { root, file, clock, source, observed };
}

function running(source) {
  const { runningSessions, unverifiedRunningSessions } = source.snapshot();
  return [runningSessions, unverifiedRunningSessions];
}

test('observed delegated task keeps running through >2 min silent tool/subagent work, then stops at recorded ends', async (t) => {
  const { file, clock, source, observed } = await runningFixture(t);
  assert.deepEqual(running(source), [0, 0]);
  await appendFile(file, event('assistant.turn_start', { turnId: 'root-turn' }) +
    event('tool.execution_start', { toolCallId: 'task-1', toolName: 'task', turnId: 'root-turn' }) +
    event('subagent.started', { toolCallId: 'task-1', executionMode: 'sync', agentDescription: 'PRIVATE' }, { agentId: 'child-1' }) +
    event('assistant.turn_start', { turnId: 'child-turn', parentToolCallId: 'task-1' }, { agentId: 'child-1' }) +
    event('tool.execution_start', { toolCallId: 'npm-test', toolName: 'powershell', parentToolCallId: 'task-1' }, { agentId: 'child-1' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  assert.equal(source.snapshot().activeSessions, 1);
  assert.equal(source.snapshot().thinkingSessions, 0, 'tool work is running, not precise cognition');

  clock.now += 150_000; // a silent long host tool inside the delegated task
  assert.deepEqual(running(source), [1, 1], 'still running, but marked unverified');
  assert.equal(source.snapshot().unknownSessions, 1);
  assert.equal(source.snapshot().activeSessions, 0);
  assert.equal(source.snapshot().thinkingSessions, 0);

  await appendFile(file,
    event('tool.execution_complete', { toolCallId: 'npm-test', parentToolCallId: 'task-1' }, { agentId: 'child-1' }) +
    event('assistant.turn_end', { turnId: 'child-turn' }, { agentId: 'child-1' }) +
    event('subagent.completed', { toolCallId: 'task-1' }, { agentId: 'child-1' }) +
    event('tool.execution_complete', { toolCallId: 'task-1', turnId: 'root-turn' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0], 'fresh evidence clears the unverified marker');
  await appendFile(file, event('session.task_complete', { success: true, outcome: 'completed' }));
  await source.poll();
  assert.equal(observed.includes('completion'), false, 'stale interval never celebrates');
  await appendFile(file, event('assistant.turn_end', { turnId: 'root-turn' }));
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  assert.equal(source.snapshot().unknownSessions, 0);
  clock.now += 150_000;
  assert.deepEqual(running(source), [0, 0]);
});

test('background subagent keeps running after the root turn ends until its own recorded end', async (t) => {
  const { file, clock, source } = await runningFixture(t);
  await appendFile(file, event('assistant.turn_start', { turnId: 'root-turn' }) +
    event('tool.execution_start', { toolCallId: 'task-bg', toolName: 'task' }) +
    event('subagent.started', { toolCallId: 'task-bg', executionMode: 'background' }, { agentId: 'bg' }) +
    event('tool.execution_complete', { toolCallId: 'task-bg' }) +
    event('assistant.turn_end', { turnId: 'root-turn' }) +
    event('assistant.turn_start', { turnId: 'bg-1' }, { agentId: 'bg' }) +
    event('assistant.turn_end', { turnId: 'bg-1' }, { agentId: 'bg' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  clock.now += 130_000;
  assert.deepEqual(running(source), [1, 1]);
  const completed = event('subagent.completed', { toolCallId: 'task-bg' }, { agentId: 'bg' });
  await appendFile(file, completed + completed.replace(/"id":"[^"]+"/, '"id":"duplicate-completion"'));
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  await appendFile(file, event('subagent.started', { toolCallId: 'task-bg' }, { agentId: 'bg' }));
  await source.poll();
  assert.deepEqual(running(source), [0, 0], 'an ended subagent call does not re-open');
});

test('subagent tree records only live starts and distinguishes completed, failed and cleared retirements', async (t) => {
  const { file, source } = await runningFixture(t,
    event('subagent.started', { toolCallId: 'historic-call' }, { agentId: 'historic-agent' }));
  assert.deepEqual(source.snapshot().sessions[0].subagents, [], 'baseline starts are not represented');
  assert.deepEqual(source.snapshot().sessions[0].retired, []);

  await appendFile(file,
    event('subagent.started', { toolCallId: 'completed-call' }, { agentId: 'completed-agent' }) +
    event('subagent.started', { toolCallId: 'failed-call' }, { agentId: 'failed-agent' }) +
    event('subagent.started', { toolCallId: 'cleared-call' }, { agentId: 'cleared-agent' }));
  await source.poll();
  let session = source.snapshot().sessions[0];
  assert.deepEqual(session.subagents.map(({ callId }) => callId),
    ['completed-call', 'failed-call', 'cleared-call']);
  assert.ok(session.subagents.every(({ ageMs }) => ageMs === 0));

  await appendFile(file,
    event('subagent.completed', { toolCallId: 'completed-call' }, { agentId: 'completed-agent' }) +
    event('subagent.failed', { toolCallId: 'failed-call' }, { agentId: 'failed-agent' }));
  await source.poll();
  session = source.snapshot().sessions[0];
  assert.deepEqual(session.subagents.map(({ callId }) => callId), ['cleared-call']);
  assert.deepEqual(session.retired.map(({ callId, outcome }) => [callId, outcome]), [
    ['completed-call', 'completed'],
    ['failed-call', 'failed'],
  ]);

  await appendFile(file, event('abort', null));
  await source.poll();
  session = source.snapshot().sessions[0];
  assert.deepEqual(session.subagents, []);
  assert.deepEqual(session.retired.map(({ callId, outcome }) => [callId, outcome]), [
    ['completed-call', 'completed'],
    ['failed-call', 'failed'],
    ['cleared-call', 'cleared'],
  ]);
});

test('subagent tree display and retirement history respect bounded caps', async (t) => {
  const { file, source } = await runningFixture(t);
  const starts = Array.from({ length: 17 }, (_, i) =>
    event('subagent.started', { toolCallId: `call-${i}` }, { agentId: `agent-${i}` })).join('');
  await appendFile(file, starts);
  await source.poll();
  let session = source.snapshot().sessions[0];
  assert.equal(session.subagents.length, 16);
  assert.equal(session.subagentsMore, 1);
  assert.equal(session.retired.length, 0);

  await appendFile(file, Array.from({ length: 17 }, (_, i) =>
    event('subagent.completed', { toolCallId: `call-${i}` }, { agentId: `agent-${i}` })).join(''));
  await source.poll();
  session = source.snapshot().sessions[0];
  assert.deepEqual(session.subagents, []);
  assert.equal(session.retired.length, 8);
  assert.deepEqual(session.retired.map(({ outcome }) => outcome), Array(8).fill('completed'));
});

test('subagent tree includes no more than 32 journal-session anchors', async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 33; i++) {
    const directory = path.join(root, `session-${String(i).padStart(2, '0')}`);
    await mkdir(directory);
    await writeFile(path.join(directory, 'events.jsonl'), '');
  }
  const source = new LocalActivitySource({ root, pollIntervalMs: 0 });
  t.after(() => source.stop());
  await source.start();
  assert.equal(source.snapshot().sessions.length, 32);
});

test('user waits pause running pulses; tool waits do not', async (t) => {
  const { file, source } = await runningFixture(t);
  await appendFile(file, event('assistant.turn_start', { turnId: 'turn' }) +
    event('tool.execution_start', { toolCallId: 'tool', toolName: 'powershell' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  for (const [request, complete, data] of [
    ['permission.requested', 'permission.completed', { permissionId: 'p1' }],
    ['user_input.requested', 'user_input.completed', { requestId: 'u1', question: 'PRIVATE' }],
    ['elicitation.requested', 'elicitation.completed', { requestId: 'e1', message: 'PRIVATE' }],
  ]) {
    await appendFile(file, event(request, data));
    await source.poll();
    assert.deepEqual(running(source), [0, 0], `${request} waits for the user`);
    assert.equal(source.snapshot().activeSessions, 1);
    await appendFile(file, event(complete, data));
    await source.poll();
    assert.deepEqual(running(source), [1, 0], `${complete} resumes observed work`);
  }
});

test('abort, error, shutdown and idle each clear observed running work', async (t) => {
  const { file, source } = await runningFixture(t);
  for (const [index, type] of ['abort', 'session.error', 'session.shutdown', 'session.idle'].entries()) {
    await appendFile(file, event('assistant.turn_start', { turnId: `turn-${index}` }) +
      event('tool.execution_start', { toolCallId: `task-${index}`, toolName: 'task' }) +
      event('subagent.started', { toolCallId: `task-${index}` }, { agentId: `child-${index}` }) +
      event('assistant.turn_start', { turnId: `child-${index}` }, { agentId: `child-${index}` }));
    await source.poll();
    assert.deepEqual(running(source), [1, 0]);
    await appendFile(file, event(type, null));
    await source.poll();
    assert.deepEqual(running(source), [0, 0], type);
  }
});

test('startup baseline open turns, tools and subagents never become running pulses', async (t) => {
  const { file, clock, source, observed } = await runningFixture(t,
    event('assistant.turn_start', { turnId: 'historic' }) +
    event('tool.execution_start', { toolCallId: 'historic-task', toolName: 'task' }) +
    event('subagent.started', { toolCallId: 'historic-task' }, { agentId: 'historic-child' }) +
    event('assistant.turn_start', { turnId: 'historic-child' }, { agentId: 'historic-child' }));
  assert.deepEqual(running(source), [0, 0]);
  clock.now += 200_000;
  assert.deepEqual(running(source), [0, 0]);
  await appendFile(file, event('tool.execution_start', { toolCallId: 'late-tool', toolName: 'powershell' }) +
    event('tool.execution_progress', { toolCallId: 'late-tool' }, { agentId: 'historic-child' }));
  await source.poll();
  assert.deepEqual(running(source), [0, 0], 'live events inside a historic interval do not make it running');
  assert.equal(observed.includes('completion'), false);
});

test('truncation, read failure and source loss reset live running without resuming it', async (t) => {
  const { root, file, source } = await runningFixture(t);
  const start = (turnId) => appendFile(file, event('assistant.turn_start', { turnId }) +
    event('tool.execution_start', { toolCallId: `${turnId}-tool`, toolName: 'powershell' }));

  await start('before-truncate');
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  await writeFile(file, event('tool.execution_progress', { toolCallId: 'x' }));
  await source.poll();
  assert.deepEqual(running(source), [0, 0], 'truncation rebaselines');

  await start('before-read-failure');
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  const readFileNormally = source.readFile.bind(source);
  source.readFile = async () => { throw Object.assign(new Error('synthetic'), { code: 'EIO' }); };
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  source.readFile = readFileNormally;
  await appendFile(file, event('tool.execution_progress', { toolCallId: 'before-read-failure-tool' }));
  await source.poll();
  await source.poll();
  assert.deepEqual(running(source), [0, 0], 'recovery does not resume the pre-gap interval');

  await start('before-loss');
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  await rename(root, `${root}-offline`);
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  await rename(`${root}-offline`, root);
  await source.poll();
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  await start('after-recovery');
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
});

test('concurrent running agents count once per session; separate sessions add', async (t) => {
  const { root, file, source } = await runningFixture(t);
  await appendFile(file, event('assistant.turn_start', { turnId: 'root' }) +
    event('tool.execution_start', { toolCallId: 'a', toolName: 'task' }) +
    event('tool.execution_start', { toolCallId: 'b', toolName: 'task' }) +
    event('subagent.started', { toolCallId: 'a' }, { agentId: 'child-a' }) +
    event('subagent.started', { toolCallId: 'b' }, { agentId: 'child-b' }) +
    event('assistant.turn_start', { turnId: 'ca' }, { agentId: 'child-a' }) +
    event('assistant.turn_start', { turnId: 'cb' }, { agentId: 'child-b' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  const second = path.join(root, 'session-b');
  await mkdir(second);
  await writeFile(path.join(second, 'events.jsonl'), '');
  await source.poll();
  await appendFile(path.join(second, 'events.jsonl'), event('assistant.turn_start', { turnId: 'other' }));
  await source.poll();
  assert.deepEqual(running(source), [2, 0]);
});

test('subagent failure/completion retires its open child even without a child turn end', async (t) => {
  const { file, source } = await runningFixture(t);
  for (const terminal of ['subagent.failed', 'subagent.completed']) {
    await appendFile(file, event('assistant.turn_start', { turnId: `root-${terminal}` }) +
      event('tool.execution_start', { toolCallId: `call-${terminal}`, toolName: 'task' }) +
      event('subagent.started', { toolCallId: `call-${terminal}`, executionMode: 'background' }, { agentId: `child-${terminal}` }) +
      event('tool.execution_complete', { toolCallId: `call-${terminal}` }) +
      event('assistant.turn_end', { turnId: `root-${terminal}` }) +
      event('assistant.turn_start', { turnId: `child-${terminal}` }, { agentId: `child-${terminal}` }) +
      event('tool.execution_start', { toolCallId: `long-${terminal}`, toolName: 'powershell' }, { agentId: `child-${terminal}` }));
    await source.poll();
    assert.deepEqual(running(source), [1, 0]);
    const end = event(terminal, { toolCallId: `call-${terminal}`, error: 'PRIVATE' }, { agentId: `child-${terminal}` });
    await appendFile(file, end + end.replace(/"id":"[^"]+"/, `"id":"dup-${terminal}"`));
    await source.poll();
    assert.deepEqual(running(source), [0, 0], terminal);
    assert.equal(source.snapshot().activeSessions, 0);
  }
});

test('malformed subagent terminal records mark partial and drop running until a new live start', async (t) => {
  const { file, source } = await runningFixture(t);
  await appendFile(file, event('assistant.turn_start', { turnId: 'root' }) +
    event('subagent.started', { toolCallId: 'call' }, { agentId: 'child' }) +
    event('assistant.turn_start', { turnId: 'child' }, { agentId: 'child' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  await appendFile(file, event('subagent.completed', { toolCallId: 42 }, { agentId: 'child' }));
  await source.poll();
  assert.equal(source.snapshot().sourceStatus, 'partial');
  assert.deepEqual(running(source), [0, 0]);
  await appendFile(file, event('tool.execution_progress', { toolCallId: 'x' }, { agentId: 'child' }));
  await source.poll();
  assert.deepEqual(running(source), [0, 0]);
  await appendFile(file, event('assistant.turn_start', { turnId: 'fresh' }));
  await source.poll();
  assert.deepEqual(running(source), [1, 0]);
  await appendFile(file, event('subagent.started', { toolCallId: 'call-2' }, { agentId: 'child-2' }) +
    event('subagent.failed', null, { agentId: 'child-2' }));
  await source.poll();
  assert.equal(source.snapshot().sourceStatus, 'available', 'missing lifecycle data is not malformed');
  assert.deepEqual(running(source), [0, 0], 'but an unattributable end still drops running state');
});

test('pending user input or elicitation blocks success celebration', async (t) => {
  const { file, source, observed } = await runningFixture(t);
  for (const [request, complete] of [['user_input.requested', 'user_input.completed'],
    ['elicitation.requested', 'elicitation.completed']]) {
    await appendFile(file, event('assistant.turn_start', { turnId: request }) +
      event(request, { requestId: `r-${request}` }) +
      event('session.task_complete', { success: true, outcome: 'completed' }));
    await source.poll();
    assert.equal(observed.includes('completion'), false, request);
    await appendFile(file, event(complete, { requestId: `r-${request}` }) + event('assistant.turn_end', { turnId: request }));
    await source.poll();
  }
  await appendFile(file, event('assistant.turn_start', { turnId: 'clean' }) +
    event('session.task_complete', { success: true, outcome: 'completed' }));
  await source.poll();
  assert.equal(observed.filter((kind) => kind === 'completion').length, 1);
});

test('null subagent terminal identifiers stop only their session and keep coverage available', async (t) => {
  const { root, file, source } = await runningFixture(t);
  const other = path.join(root, 'session-b', 'events.jsonl');
  await mkdir(path.dirname(other));
  await writeFile(other, '');
  await source.poll();
  await appendFile(other, event('assistant.turn_start', { turnId: 'unrelated' }));
  for (const terminal of ['subagent.completed', 'subagent.failed']) {
    await appendFile(file, event('assistant.turn_start', { turnId: terminal }) +
      event('subagent.started', { toolCallId: `call-${terminal}` }, { agentId: `child-${terminal}` }));
    await source.poll();
    assert.deepEqual(running(source), [2, 0]);
    await appendFile(file, event(terminal, { toolCallId: null }, { agentId: `child-${terminal}` }));
    await source.poll();
    assert.equal(source.snapshot().sourceStatus, 'available', terminal);
    assert.deepEqual(running(source), [1, 0], `${terminal}: unrelated session keeps running`);
  }
});
