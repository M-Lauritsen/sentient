const EMPTY = Object.freeze({
  connection: 'connecting',
  sourceStatus: 'unknown',
  coverage: 'unknown',
  journalFiles: 0,
  activeSessions: 0,
  thinkingSessions: 0,
  unknownSessions: 0,
  runningSessions: 0,
  unverifiedRunningSessions: 0,
  sessions: [],
  treeSessions: [],
  waitingSessions: 0,
  backlogFiles: 0,
  steps: 0,
});
const ACTIVITY_KINDS = new Set(['thinking', 'step', 'completion', 'activity']);
const SOURCE_STATES = new Set(['available', 'partial', 'unavailable']);
const COVERAGE_STATES = new Set(['journal-only', 'partial']);
const SESSION_STATUSES = new Set(['running', 'running-unverified', 'waiting', 'idle', 'ended']);
const IMPULSE_LABELS = new Map([
  ['thinking', 'Thinking'],
  ['step', 'Task step'],
  ['completion', 'Task completed'],
]);

// Blue running-state clock. It follows observed RUNNING work (thinking, tool
// and delegated execution, including unverified long silence), not only
// precise cognition. Legacy snapshots without runningSessions fall back to
// thinkingSessions.
export function createThinkingPulseClock() {
  let accumulated = 0;
  return {
    reset() { accumulated = 0; },
    tick(dt, state, hidden) {
      const count = Number.isSafeInteger(state.runningSessions)
        ? state.runningSessions : state.thinkingSessions;
      const sessions = Number.isSafeInteger(count) ? Math.min(32, Math.max(0, count)) : 0;
      if (hidden || state.connection !== 'connected' ||
          state.sourceStatus === 'unavailable' || sessions === 0) {
        accumulated = 0;
        return 0;
      }
      if (!Number.isFinite(dt) || dt <= 0) return 0;
      accumulated += Math.min(dt, 0.05) * sessions * 6;
      const pulses = Math.floor(accumulated + 1e-9);
      accumulated = Math.max(0, accumulated - pulses);
      return pulses;
    },
  };
}

export function validToolName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/[^A-Za-z0-9_.:/-]/.test(value);
}

export function validEventType(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/[^A-Za-z0-9_.:-]/.test(value);
}

export function projectActivity(value) {
  if (!value || !ACTIVITY_KINDS.has(value.kind) ||
      (value.eventType !== undefined && !validEventType(value.eventType)) ||
      (value.kind === 'activity' && !validEventType(value.eventType)) ||
      (value.count !== undefined && (!integer(value.count) || value.count < 1))) return null;
  const result = { kind: value.kind };
  if (value.eventType !== undefined) result.eventType = value.eventType;
  if ((value.kind === 'step' || value.eventType?.startsWith('tool.')) && validToolName(value.toolName)) {
    result.toolName = value.toolName;
  }
  if (value.count !== undefined) result.count = value.count;
  return result;
}

export function activityColor({ kind, eventType }) {
  // Classify TYPE, never message text. User messages cannot activate cognition.
  if (kind === 'completion') return 'orange';
  if (eventType !== undefined) {
    return /^assistant\.(?:message|reasoning)(?:[._]|$)/.test(eventType) ||
      eventType === 'assistant.turn_start' ? 'blue' : 'orange';
  }
  return kind === 'thinking' ? 'blue' : 'orange';
}

export function impulseIntensity(count) {
  return Math.min(8, 1 + Math.floor(Math.log2(Math.max(1, count))));
}

// One drain per animation frame: fixed counters plus only the latest eight
// metadata labels. Evicted labels still contribute to the visual totals.
export function createImpulseBuffer() {
  let totals = { blue: 0, orange: 0, completions: 0 };
  const entries = new Map();
  return {
    add(value) {
      const activity = projectActivity(value);
      if (!activity) return;
      const count = activity.count ?? 1;
      totals[activity.kind === 'completion' ? 'completions' : activityColor(activity)] += count;
      const key = JSON.stringify([activity.kind, activity.eventType, activity.toolName]);
      const previous = entries.get(key);
      entries.delete(key);
      entries.set(key, { ...activity, count: (previous?.count ?? 0) + count });
      if (entries.size > 8) entries.delete(entries.keys().next().value);
    },
    clear() {
      totals = { blue: 0, orange: 0, completions: 0 };
      entries.clear();
    },
    drain() {
      const result = { ...totals, entries: [...entries.values()] };
      this.clear();
      return result;
    },
  };
}

export function createImpulseFeed(element) {
  return {
    add(kind, toolName, eventType, count = 1) {
      const activity = projectActivity({ kind, toolName, eventType, count });
      if (!activity) return;
      const label = eventType || IMPULSE_LABELS.get(kind);
      if (!label) return;
      const row = element.ownerDocument.createElement('li');
      row.className = `impulse-entry impulse-${kind} impulse-${activityColor(activity)}`;
      row.textContent = label + (activity.toolName ? ` · ${activity.toolName}` : '') +
        (count > 1 ? ` ×${count}` : '');
      element.prepend(row);
      while (element.children.length > 8) element.lastElementChild.remove();
    },
  };
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
}

const TREE_SID = /^[A-Z2-7]{4}$/;
const TREE_STATUSES = new Set(['running', 'waiting', 'stuck', 'quiet']);
const RETIREMENT_OUTCOMES = new Set(['completed', 'failed', 'cleared']);

function projectTreeSessions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) return null;
  const sessionIds = new Set();
  const sessions = [];
  for (const session of value) {
    if (!session || typeof session !== 'object' || !TREE_SID.test(session.sid) ||
        sessionIds.has(session.sid) || !TREE_STATUSES.has(session.status) ||
        !Array.isArray(session.subagents) || session.subagents.length > 16 ||
        !integer(session.subagentsMore) || !Array.isArray(session.retired) || session.retired.length > 8) return null;
    if (session.subagentsMore > 0 && session.subagents.length !== 16) return null;
    sessionIds.add(session.sid);
    const childIds = new Set();
    const subagents = [];
    for (const child of session.subagents) {
      if (!child || typeof child !== 'object' || !TREE_SID.test(child.sid) ||
          childIds.has(child.sid) || !integer(child.ageMs)) return null;
      childIds.add(child.sid);
      subagents.push({ sid: child.sid, ageMs: child.ageMs });
    }
    const retired = [];
    const retiredIds = new Set();
    for (const item of session.retired) {
      if (!item || typeof item !== 'object' || !TREE_SID.test(item.sid) ||
          childIds.has(item.sid) || retiredIds.has(item.sid) ||
          !RETIREMENT_OUTCOMES.has(item.outcome)) return null;
      retiredIds.add(item.sid);
      retired.push({ sid: item.sid, outcome: item.outcome });
    }
    sessions.push({
      sid: session.sid,
      status: session.status,
      subagents,
      subagentsMore: session.subagentsMore,
      retired,
    });
  }
  return sessions;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function projectCountPairs(value, validName) {
  if (!Array.isArray(value) || value.length > 10) return null;
  const seen = new Set();
  const result = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 ||
        !validName(pair[0]) || !integer(pair[1]) || pair[1] < 1 || seen.has(pair[0])) return null;
    seen.add(pair[0]);
    result.push([pair[0], pair[1]]);
  }
  return result;
}

export function projectSessionStats(value) {
  const kindKeys = ['thinking', 'step', 'completion', 'activity'];
  const subagentKeys = ['started', 'completed', 'failed'];
  const turnKeys = ['count', 'lastMs', 'medianMs', 'maxMs'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !exactKeys(value, [
        'kinds', 'types', 'otherTypes', 'tools', 'otherTools', 'subagents',
        'errors', 'runningMs', 'unverifiedMs', 'waitingMs', 'turns',
      ]) ||
      !exactKeys(value.kinds, kindKeys) ||
      !kindKeys.every((key) => integer(value.kinds[key])) ||
      !integer(value.otherTypes) || !integer(value.otherTools) ||
      !exactKeys(value.subagents, subagentKeys) ||
      !subagentKeys.every((key) => integer(value.subagents[key])) ||
      !integer(value.errors) || !integer(value.runningMs) ||
      !integer(value.unverifiedMs) || value.unverifiedMs > value.runningMs ||
      !integer(value.waitingMs) ||
      !exactKeys(value.turns, turnKeys) ||
      !turnKeys.every((key) => integer(value.turns[key]))) return null;
  const types = projectCountPairs(value.types, validEventType);
  const tools = projectCountPairs(value.tools, validToolName);
  if (types === null || tools === null) return null;
  return {
    kinds: Object.fromEntries(kindKeys.map((key) => [key, value.kinds[key]])),
    types,
    otherTypes: value.otherTypes,
    tools,
    otherTools: value.otherTools,
    subagents: Object.fromEntries(subagentKeys.map((key) => [key, value.subagents[key]])),
    errors: value.errors,
    runningMs: value.runningMs,
    unverifiedMs: value.unverifiedMs,
    waitingMs: value.waitingMs,
    turns: Object.fromEntries(turnKeys.map((key) => [key, value.turns[key]])),
  };
}

function projectSessions(value) {
  if (!Array.isArray(value) || value.length > 32) return null;
  const sessions = [];
  for (const session of value) {
    const hasWaitKind = session && Object.hasOwn(session, 'waitKind');
    const hasStats = session && Object.hasOwn(session, 'stats');
    if (!session || typeof session !== 'object' || Array.isArray(session) ||
        Object.keys(session).length !== 3 + Number(hasWaitKind) + Number(hasStats) ||
        !Object.hasOwn(session, 'id') || !Object.hasOwn(session, 'status') ||
        !Object.hasOwn(session, 'elapsedMs') ||
        typeof session.id !== 'string' || !/^[A-Z2-7]{6}$/.test(session.id) ||
        !SESSION_STATUSES.has(session.status) || !integer(session.elapsedMs) ||
        (session.status === 'waiting'
          ? !hasWaitKind || !['permission', 'input', 'both'].includes(session.waitKind)
          : hasWaitKind)) return null;
    const stats = hasStats ? projectSessionStats(session.stats) : undefined;
    if (hasStats && stats === null) return null;
    sessions.push({
      id: session.id,
      status: session.status,
      ...(hasWaitKind ? { waitKind: session.waitKind } : {}),
      elapsedMs: session.elapsedMs,
      ...(hasStats ? { stats } : {}),
    });
  }
  return sessions;
}

export function diffSubagents(previous, next) {
  const result = { added: [], completed: [], failed: [], cleared: [] };
  const nextBySession = new Map(next.map((session) => [session.sid, session]));
  const previousBySession = new Map(previous.map((session) => [session.sid, session]));
  for (const session of previous) {
    const current = nextBySession.get(session.sid);
    for (const child of session.subagents) {
      if (current?.subagents.some((candidate) => candidate.sid === child.sid)) continue;
      const retirement = current?.retired.find((candidate) => candidate.sid === child.sid);
      const outcome = RETIREMENT_OUTCOMES.has(retirement?.outcome) ? retirement.outcome : 'cleared';
      result[outcome].push({ sessionSid: session.sid, sid: child.sid });
    }
  }
  for (const session of next) {
    const previousSession = previousBySession.get(session.sid);
    for (const child of session.subagents) {
      if (!previousSession?.subagents.some((candidate) => candidate.sid === child.sid)) {
        result.added.push({ sessionSid: session.sid, sid: child.sid, ageMs: child.ageMs });
      }
    }
  }
  return result;
}

export function summarizeSubagents(sessions) {
  let visibleBranches = 0;
  let omittedBranches = 0;
  let visibleSessions = 0;
  const statusCounts = new Map();
  for (const session of sessions) {
    const count = session.subagents.length;
    omittedBranches += session.subagentsMore;
    if (!count) continue;
    visibleSessions++;
    visibleBranches += count;
    statusCounts.set(session.status, (statusCounts.get(session.status) ?? 0) + count);
  }
  if (!visibleBranches && !omittedBranches) return 'No observed delegated work.';
  const details = [...statusCounts].map(([status, count]) => `${count} ${status}`).join(', ');
  const sessionLabel = visibleSessions === 1 ? 'session' : 'sessions';
  const branchLabel = omittedBranches === 1 ? 'branch' : 'branches';
  return `Observed delegated work: ${visibleBranches} visible subagent branches across ` +
    `${visibleSessions} ${sessionLabel}${details ? ` (${details})` : ''}` +
    `${omittedBranches ? `; ${omittedBranches} additional ${branchLabel} omitted by display limits` : ''}.`;
}

function projectHudSessions(value) {
  const sessions = projectSessions(value);
  if (sessions === null || sessions.some((session) =>
    session.status !== 'running' && session.status !== 'running-unverified')) return null;
  return sessions;
}

function projectWaitingSessionIds(value) {
  if (!Array.isArray(value) || value.length > 32 ||
      value.some((id) => typeof id !== 'string' || !/^[A-Z2-7]{6}$/.test(id))) return null;
  return [...value];
}

export function projectActiveHudSessions(state) {
  const sessions = Array.isArray(state?.hudSessions) ? state.hudSessions : state?.sessions;
  return Array.isArray(sessions)
    ? sessions.filter((session) =>
      session.status === 'running' || session.status === 'running-unverified')
    : null;
}

function projectSnapshot(value) {
  if (!value || typeof value !== 'object' ||
      !SOURCE_STATES.has(value.sourceStatus) ||
      !COVERAGE_STATES.has(value.coverage) ||
      !['local-activity-files'].includes(value.source) ||
      !integer(value.journalFiles) ||
      !integer(value.activeSessions) ||
      !integer(value.thinkingSessions) ||
      !integer(value.unknownSessions) ||
      !integer(value.backlogFiles) ||
      !integer(value.steps)) return null;
  const hasWaiting = value.waitingSessions !== undefined;
  if (hasWaiting && (!integer(value.waitingSessions) ||
      value.waitingSessions > Math.min(512, value.journalFiles))) return null;
  // Optional running counts: both present and consistent, or both absent.
  const hasRunning = value.runningSessions !== undefined || value.unverifiedRunningSessions !== undefined;
  if (hasRunning && (!integer(value.runningSessions) || !integer(value.unverifiedRunningSessions) ||
      value.unverifiedRunningSessions > value.runningSessions)) return null;
  const hasSessions = value.sessions !== undefined;
  const sessions = hasSessions ? projectSessions(value.sessions) : undefined;
  if (hasSessions && sessions === null) return null;
  const hasTreeSessions = value.treeSessions !== undefined;
  const treeSessions = projectTreeSessions(value.treeSessions);
  if (hasTreeSessions && treeSessions === null) return null;
  if (value.sessionsTruncated !== undefined && typeof value.sessionsTruncated !== 'boolean') return null;
  const hasHudSessions = value.hudSessions !== undefined;
  const hasHudSessionsTruncated = value.hudSessionsTruncated !== undefined;
  if (hasHudSessions !== hasHudSessionsTruncated) return null;
  const hudSessions = hasHudSessions ? projectHudSessions(value.hudSessions) : undefined;
  if (hasHudSessions && (!hasRunning || hudSessions === null ||
      hudSessions.length > value.runningSessions ||
      (value.hudSessionsTruncated
        ? value.runningSessions <= hudSessions.length
        : value.runningSessions !== hudSessions.length))) return null;
  if (hasHudSessionsTruncated && typeof value.hudSessionsTruncated !== 'boolean') return null;
  const hasWaitingSessionIds = value.waitingSessionIds !== undefined;
  const waitingSessionIds = hasWaitingSessionIds
    ? projectWaitingSessionIds(value.waitingSessionIds)
    : hasSessions ? sessions.filter((session) => session.status === 'waiting').map(({ id }) => id)
      : undefined;
  if (hasWaitingSessionIds && (waitingSessionIds === null || !hasWaiting ||
      waitingSessionIds.length !== Math.min(32, value.waitingSessions))) return null;
  if (hasWaiting && hasSessions) {
    const visibleWaiting = sessions.filter((session) => session.status === 'waiting').length;
    if (value.sessionsTruncated === true
      ? value.waitingSessions < visibleWaiting
      : value.waitingSessions !== visibleWaiting) return null;
  }
  return {
    sourceStatus: value.sourceStatus,
    coverage: value.coverage,
    journalFiles: value.journalFiles,
    activeSessions: value.activeSessions,
    thinkingSessions: value.thinkingSessions,
    unknownSessions: value.unknownSessions,
    runningSessions: hasRunning ? value.runningSessions : value.thinkingSessions,
    unverifiedRunningSessions: hasRunning ? value.unverifiedRunningSessions : 0,
    ...(hasWaiting ? { waitingSessions: value.waitingSessions } : {}),
    backlogFiles: value.backlogFiles,
    steps: value.steps,
    ...(hasSessions ? { sessions } : {}),
    treeSessions,
    ...(value.sessionsTruncated !== undefined ? { sessionsTruncated: value.sessionsTruncated } : {}),
    ...(hasHudSessions ? { hudSessions } : {}),
    ...(hasHudSessionsTruncated ? { hudSessionsTruncated: value.hudSessionsTruncated } : {}),
    ...(waitingSessionIds !== undefined ? { waitingSessionIds } : {}),
  };
}

function unknownConnection(state, connection) {
  return {
    ...state,
    connection,
    coverage: 'unknown',
    sourceStatus: 'unknown',
    activeSessions: 0,
    thinkingSessions: 0,
    runningSessions: 0,
    unverifiedRunningSessions: 0,
    waitingSessions: 0,
    sessions: [],
    treeSessions: [],
    sessionsTruncated: false,
    hudSessions: [],
    hudSessionsTruncated: false,
    waitingSessionIds: [],
  };
}

export function createActivityClient({
  EventSourceImpl = globalThis.EventSource,
  url = '/events',
  onState = () => {},
  onActivity = () => {},
  onTree = () => {},
} = {}) {
  let state = { ...EMPTY };
  let streamSequence = -1;
  let streamEpoch = null;
  let needsSnapshot = true;
  let source = null;
  let closed = false;

  const publishState = () => onState({ ...state });
  const publishTree = (sessions, changes, reset) => onTree({ sessions, ...changes, reset });
  const loseTree = () => {
    publishTree([], diffSubagents(state.treeSessions, []), false);
    state = { ...state, treeSessions: [] };
  };
  const markUnknown = () => {
    needsSnapshot = true;
    state = unknownConnection(state, 'unknown');
    publishState();
  };
  const handleSnapshot = (message) => {
    if (!integer(message?.sequence) || typeof message?.epoch !== 'string' ||
        message.epoch.length < 16 || message.epoch.length > 64) {
      markUnknown();
      return;
    }
    const snapshot = projectSnapshot(message.snapshot);
    if (!snapshot) {
      markUnknown();
      return;
    }
    if (message.epoch === streamEpoch && message.sequence < streamSequence) return;
    const reset = needsSnapshot || message.epoch !== streamEpoch;
    const changes = reset ? { added: [], completed: [], failed: [], cleared: [] }
      : diffSubagents(state.treeSessions, snapshot.treeSessions);
    streamEpoch = message.epoch;
    streamSequence = message.sequence;
    needsSnapshot = false;
    state = { ...snapshot, connection: 'connected' };
    publishState();
    publishTree(snapshot.treeSessions, changes, reset);
  };
  const handleActivity = (message) => {
    const activity = projectActivity(message);
    if (!integer(message?.sequence) || !activity) {
      markUnknown();
      return;
    }
    const snapshot = projectSnapshot(message.snapshot);
    if (!snapshot) {
      markUnknown();
      return;
    }
    if (needsSnapshot || message.epoch !== streamEpoch) {
      needsSnapshot = true;
      loseTree();
      state = unknownConnection(state, 'unknown');
      publishState();
      return;
    }
    if (message.sequence <= streamSequence) return;
    if (streamSequence >= 0 && message.sequence !== streamSequence + 1) {
      streamSequence = message.sequence;
      needsSnapshot = true;
      loseTree();
      state = unknownConnection(state, 'unknown');
      publishState();
      return;
    }
    const previousTreeSessions = state.treeSessions;
    const hasTreeSnapshot = Array.isArray(message.snapshot.treeSessions);
    streamSequence = message.sequence;
    state = { ...snapshot, ...(hasTreeSnapshot ? {} : { treeSessions: previousTreeSessions }), connection: 'connected' };
    publishState();
    if (hasTreeSnapshot) {
      publishTree(snapshot.treeSessions, diffSubagents(previousTreeSessions, snapshot.treeSessions), false);
    }
    onActivity(activity);
  };

  return {
    connect() {
      if (closed || source || typeof EventSourceImpl !== 'function') return;
      source = new EventSourceImpl(url);
      source.addEventListener('snapshot', (event) => {
        try { handleSnapshot(JSON.parse(event.data)); } catch { markUnknown(); }
      });
      source.addEventListener('activity', (event) => {
        try { handleActivity(JSON.parse(event.data)); } catch { markUnknown(); }
      });
      source.onerror = () => {
        if (closed) return;
        needsSnapshot = true;
        loseTree();
        state = unknownConnection(state, 'retrying');
        publishState();
      };
      publishState();
    },
    disconnect() {
      closed = true;
      source?.close();
      source = null;
      needsSnapshot = true;
      loseTree();
      state = unknownConnection(state, 'disconnected');
      publishState();
    },
    getState() {
      return { ...state };
    },
  };
}
