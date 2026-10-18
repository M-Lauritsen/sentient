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
  backlogFiles: 0,
  steps: 0,
});
const ACTIVITY_KINDS = new Set(['thinking', 'step', 'completion', 'activity']);
const SOURCE_STATES = new Set(['available', 'partial', 'unavailable']);
const COVERAGE_STATES = new Set(['journal-only', 'partial']);
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
  // Optional running counts: both present and consistent, or both absent.
  const hasRunning = value.runningSessions !== undefined || value.unverifiedRunningSessions !== undefined;
  if (hasRunning && (!integer(value.runningSessions) || !integer(value.unverifiedRunningSessions) ||
      value.unverifiedRunningSessions > value.runningSessions)) return null;
  return {
    sourceStatus: value.sourceStatus,
    coverage: value.coverage,
    journalFiles: value.journalFiles,
    activeSessions: value.activeSessions,
    thinkingSessions: value.thinkingSessions,
    unknownSessions: value.unknownSessions,
    runningSessions: hasRunning ? value.runningSessions : value.thinkingSessions,
    unverifiedRunningSessions: hasRunning ? value.unverifiedRunningSessions : 0,
    backlogFiles: value.backlogFiles,
    steps: value.steps,
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
  };
}

export function createActivityClient({
  EventSourceImpl = globalThis.EventSource,
  url = '/events',
  onState = () => {},
  onActivity = () => {},
} = {}) {
  let state = { ...EMPTY };
  let streamSequence = -1;
  let streamEpoch = null;
  let needsSnapshot = true;
  let source = null;
  let closed = false;

  const publishState = () => onState({ ...state });
  const handleSnapshot = (message) => {
    if (!integer(message?.sequence) || typeof message?.epoch !== 'string' ||
        message.epoch.length < 16 || message.epoch.length > 64) return;
    const snapshot = projectSnapshot(message.snapshot);
    if (!snapshot) return;
    if (message.epoch === streamEpoch && message.sequence < streamSequence) return;
    streamEpoch = message.epoch;
    streamSequence = message.sequence;
    needsSnapshot = false;
    state = { ...snapshot, connection: 'connected' };
    publishState();
  };
  const handleActivity = (message) => {
    const activity = projectActivity(message);
    if (!integer(message?.sequence) || !activity) return;
    const snapshot = projectSnapshot(message.snapshot);
    if (!snapshot) return;
    if (needsSnapshot || message.epoch !== streamEpoch) {
      needsSnapshot = true;
      state = unknownConnection(state, 'unknown');
      publishState();
      return;
    }
    if (message.sequence <= streamSequence) return;
    if (streamSequence >= 0 && message.sequence !== streamSequence + 1) {
      streamSequence = message.sequence;
      needsSnapshot = true;
      state = unknownConnection(state, 'unknown');
      publishState();
      return;
    }
    streamSequence = message.sequence;
    state = { ...snapshot, connection: 'connected' };
    publishState();
    onActivity(activity);
  };

  return {
    connect() {
      if (closed || source || typeof EventSourceImpl !== 'function') return;
      source = new EventSourceImpl(url);
      source.addEventListener('snapshot', (event) => {
        try { handleSnapshot(JSON.parse(event.data)); } catch { /* malformed stream data is discarded */ }
      });
      source.addEventListener('activity', (event) => {
        try { handleActivity(JSON.parse(event.data)); } catch { /* malformed stream data is discarded */ }
      });
      source.onerror = () => {
        if (closed) return;
        needsSnapshot = true;
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
      state = unknownConnection(state, 'disconnected');
      publishState();
    },
    getState() {
      return { ...state };
    },
  };
}
