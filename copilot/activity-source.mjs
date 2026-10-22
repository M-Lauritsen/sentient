import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validEventType, validToolName } from '../activity/activity-client.mjs';

const MAX_FILES = 512;
const MAX_DIR_ENTRIES = 8192;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_BASELINE_BYTES = 128 * 1024;
const MAX_FILE_READ_PER_POLL = 256 * 1024;
const MAX_TOTAL_READ_PER_POLL = 1024 * 1024;
const MAX_DEDUP_KEYS = 4096;
const MAX_AGENTS_PER_SESSION = 64;
const MAX_TOOLS_PER_AGENT = 64;
const MAX_WAITING_PER_SESSION = 64;
const MAX_SUBAGENTS_PER_SESSION = 64;
const MAX_TREE_SESSIONS = 32;
const MAX_TREE_SUBAGENTS = 16;
const MAX_TREE_RETIREMENTS = 8;
const MAX_HUD_SESSIONS = 32;
const MAX_HUD_ELAPSED_MS = 1_000_000_000;
const MAX_STATS_COUNTER = 1_000_000_000;
const MAX_STATS_IDENTIFIERS = 64;
const MAX_STATS_TOP = 10;
const MAX_TURN_DURATIONS = 50;
const STALE_ACTIVITY_MS = 45_000;
const MAX_STARTS_PER_SESSION = 256;
const SOURCE = 'local-activity-files';
const WAIT_EVENT_TYPES = new Set([
  'permission.requested', 'permission.completed',
  'user_input.requested', 'user_input.completed',
  'elicitation.requested', 'elicitation.completed',
]);
// Event types that change session state; an oversized record of one of these
// cannot be applied without its data, so it stays a coverage gap.
const STATE_EVENT_TYPES = new Set([
  ...WAIT_EVENT_TYPES,
  'assistant.turn_start', 'assistant.turn_end',
  'assistant.reasoning', 'assistant.reasoning_delta',
  'tool.execution_start', 'tool.execution_complete',
  'subagent.started', 'subagent.completed', 'subagent.failed',
  'session.task_complete', 'abort', 'session.error', 'session.shutdown', 'session.idle',
]);
// Copilot writes `type` as the first key; only this bounded prefix is decoded.
const OVERSIZED_TYPE_PREFIX = /^\{"type":"([A-Za-z0-9_.:-]{1,128})"/;
const OVERSIZED_PREFIX_BYTES = 160;
const STATUS_ORDER = ['waiting', 'running', 'running-unverified', 'idle', 'ended'];
const ACTIVITY_KINDS = ['thinking', 'step', 'completion', 'activity'];
const WORK_EVENT_TYPES = new Set([
  'tool.execution_start', 'tool.execution_progress',
  'assistant.reasoning', 'assistant.reasoning_delta', 'assistant.message_delta',
]);

function createStats(statusAt) {
  return {
    kinds: { thinking: 0, step: 0, completion: 0, activity: 0 },
    typeCounts: new Map(),
    otherTypes: 0,
    toolCounts: new Map(),
    otherTools: 0,
    subagents: { started: 0, completed: 0, failed: 0 },
    errors: 0,
    runningMs: 0,
    unverifiedMs: 0,
    waitingMs: 0,
    statusAt,
    turns: { count: 0, lastMs: 0, maxMs: 0, durations: [] },
    openTurns: new Map(),
  };
}

function increment(value) {
  return Math.min(MAX_STATS_COUNTER, value + 1);
}

function addDuration(value, duration) {
  return Math.min(MAX_STATS_COUNTER, value + duration);
}

function topCounts(counts) {
  return [...counts.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || (leftName < rightName ? -1 : leftName > rightName ? 1 : 0))
    .slice(0, MAX_STATS_TOP)
    .map(([name, count]) => [name, count]);
}

function snapshotStats(stats) {
  const sortedDurations = [...stats.turns.durations].sort((left, right) => left - right);
  const middle = Math.floor(sortedDurations.length / 2);
  const medianMs = sortedDurations.length === 0 ? 0
    : sortedDurations.length % 2 === 0
      ? Math.floor((sortedDurations[middle - 1] + sortedDurations[middle]) / 2)
      : sortedDurations[middle];
  return {
    kinds: { ...stats.kinds },
    types: topCounts(stats.typeCounts),
    otherTypes: stats.otherTypes,
    tools: topCounts(stats.toolCounts),
    otherTools: stats.otherTools,
    subagents: { ...stats.subagents },
    errors: stats.errors,
    runningMs: stats.runningMs,
    unverifiedMs: stats.unverifiedMs,
    waitingMs: stats.waitingMs,
    turns: {
      count: stats.turns.count,
      lastMs: stats.turns.lastMs,
      medianMs,
      maxMs: stats.turns.maxMs,
    },
  };
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
}

function eventTime(event) {
  if (typeof event.timestamp !== 'string' || event.timestamp.length > 64) return null;
  const time = Date.parse(event.timestamp);
  return Number.isFinite(time) ? time : null;
}

function attribution(event, data) {
  const agentIds = [event.agentId, data.agentId].filter((value) => value !== undefined);
  const parentIds = [event.parentToolCallId, data.parentToolCallId].filter((value) => value !== undefined);
  if ([...agentIds, ...parentIds].some((value) => !safeId(value))) return null;
  if (new Set(agentIds).size > 1) return null;
  if (agentIds.length) return { key: `agent:${agentIds[0]}`, root: false };
  if (parentIds.length) return { key: `child:${parentIds[0]}`, root: false };
  return { key: 'root', root: true };
}

export function deriveStatus(session, now) {
  if (session.ended) return 'ended';
  if ((session.waitingPermissions?.size ?? 0) + (session.waitingInputs?.size ?? 0) > 0) return 'waiting';
  let running = (session.subagents?.size ?? 0) > 0;
  if (!running) {
    for (const agent of session.agents?.values?.() ?? []) {
      if (agent.active && agent.live) {
        running = true;
        break;
      }
    }
  }
  if (!running) return 'idle';
  // Silence is normal while the model thinks; running ends only on a recorded
  // end, wait, cancellation or error (user decision 2026-10-19).
  return 'running';
}

export class LocalActivitySource extends EventEmitter {
  constructor({
    root = path.join(os.homedir(), '.copilot', 'session-state'),
    pollIntervalMs = 1000,
    maxFiles = MAX_FILES,
    clock = () => Date.now(),
    maxFileReadPerPoll = MAX_FILE_READ_PER_POLL,
    maxTotalReadPerPoll = MAX_TOTAL_READ_PER_POLL,
  } = {}) {
    super();
    this.root = root;
    this.pollIntervalMs = pollIntervalMs;
    this.maxFiles = Math.min(MAX_FILES, Math.max(1, maxFiles));
    this.clock = clock;
    this.maxFileReadPerPoll = Math.min(MAX_FILE_READ_PER_POLL, maxFileReadPerPoll);
    this.maxTotalReadPerPoll = Math.min(MAX_TOTAL_READ_PER_POLL, maxTotalReadPerPoll);
    this.files = new Map();
    this.sessions = new Map();
    this.knownFiles = new Set();
    this.seenKeys = new Set();
    this.seenKeyOrder = [];
    this.steps = 0;
    this.sequence = 0;
    this.sourceStatus = 'unavailable';
    this.fileLimitHit = false;
    this.readIssues = 0;
    this.timer = null;
    this.started = false;
    this.initialBaseline = true;
    this.forceBaseline = false;
    this.candidateCount = 0;
    this.backlogFiles = 0;
    this.lastPollBytesRead = 0;
    this.lastServicedPath = null;
    this.polling = false;
    this.stopped = false;
    this.lastSnapshotJson = null;
    this.pendingActivities = new Map();
  }

  async start() {
    if (this.started) return this.snapshot();
    this.started = true;
    this.stopped = false;
    this.observedSince = this.clock();
    await this.poll();
    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.poll().catch(() => {
          this.readIssues++;
          this.sourceStatus = 'partial';
          this.emitChangeIfNeeded();
        });
      }, this.pollIntervalMs);
      this.timer.unref?.();
    }
    return this.snapshot();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    this.removeAllListeners();
  }

  snapshot() {
    const now = this.clock();
    let activeSessions = 0;
    let thinkingSessions = 0;
    let unknownSessions = 0;
    let runningSessions = 0;
    const unverifiedRunningSessions = 0;
    let waitingSessions = 0;
    for (const state of this.sessions.values()) {
      const stale = now - state.lastEventAt > STALE_ACTIVITY_MS;
      if (state.waitingPermissions.size > 0 || state.waitingInputs.size > 0) {
        waitingSessions++;
      }
      // Running is a separate visual liveness signal: fresh work can restore it
      // without making an incompletely observed turn success-eligible.
      // It never grants success eligibility.
      if (this.isRunning(state)) runningSessions++;
      let active = false;
      let thinking = false;
      let unknown = false;
      for (const agent of state.agents.values()) {
        if (!agent.active) continue;
        if (!agent.eligible || stale) unknown = true;
        else if (agent.waiting || agent.toolCalls.size > 0) active = true;
        else {
          active = true;
          thinking = true;
        }
      }
      if (active) activeSessions++;
      if (thinking) thinkingSessions++;
      if (unknown) unknownSessions++;
    }
    const sourceStatus = this.sourceStatus;
    const sessions = [];
    const treeSessions = [];
    for (const [key, state] of this.sessions) {
      const status = this.syncSessionStatus(state, now);
      sessions.push({
        key,
        status,
        ...(status === 'waiting' ? {
          waitKind: state.waitingPermissions.size > 0
            ? state.waitingInputs.size > 0 ? 'both' : 'permission'
            : 'input',
        } : {}),
        elapsedMs: Math.min(MAX_HUD_ELAPSED_MS, Math.max(0, Math.floor(now - state.statusSince))),
        lastEventAt: state.lastEventAt,
        stats: snapshotStats(state.stats),
      });
      if (treeSessions.length < MAX_TREE_SESSIONS) {
        treeSessions.push({
          file: key,
          status: status === 'running-unverified' ? 'stuck'
            : ['running', 'waiting'].includes(status) ? status : 'quiet',
          subagents: [...state.subagents].map(([callId, subagent]) => ({
            callId,
            ageMs: Math.min(MAX_HUD_ELAPSED_MS, Math.max(0, Math.floor(now - subagent.startedAt))),
          })).slice(0, MAX_TREE_SUBAGENTS),
          subagentsMore: Math.max(0, state.subagents.size - MAX_TREE_SUBAGENTS),
          retired: state.retired.slice(-MAX_TREE_RETIREMENTS),
        });
      }
    }
    sessions.sort((a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      b.lastEventAt - a.lastEventAt);
    const sessionsTruncated = sessions.length > MAX_HUD_SESSIONS;
    // Preserve the observed waiters in the public 32-row projection even when
    // running sessions would otherwise fill every row; the UI can then show
    // their state and build its bounded scene markers.
    const preferredSessions = sessions.length > MAX_HUD_SESSIONS
      ? [
        ...sessions.filter((session) => session.status === 'waiting'),
        ...sessions.filter((session) => session.status !== 'waiting'),
      ]
      : sessions;
    const boundedSessions = preferredSessions.slice(0, MAX_HUD_SESSIONS)
      .map(({ lastEventAt, ...session }) => session);
    const hudCandidates = sessions.filter((session) =>
      session.status === 'running' || session.status === 'running-unverified');
    const hudSessionsTruncated = hudCandidates.length > MAX_HUD_SESSIONS;
    const hudSessions = hudCandidates.slice(0, MAX_HUD_SESSIONS)
      .map(({ lastEventAt, ...session }) => session);
    const waitingSessionKeys = sessions
      .filter((session) => session.status === 'waiting')
      .slice(0, MAX_HUD_SESSIONS)
      .map(({ key }) => key);
    return {
      source: SOURCE,
      sourceStatus,
      coverage: sourceStatus === 'available' && !this.fileLimitHit && this.backlogFiles === 0 ? 'journal-only' : 'partial',
      journalFiles: this.candidateCount,
      activeSessions,
      thinkingSessions,
      unknownSessions,
      runningSessions,
      unverifiedRunningSessions,
      waitingSessions,
      backlogFiles: this.backlogFiles,
      steps: this.steps,
      sequence: this.sequence,
      sessions: boundedSessions,
      sessionsTruncated,
      hudSessions,
      hudSessionsTruncated,
      waitingSessionKeys,
      treeSessions,
    };
  }

  isRunning(session) {
    // A half-written record only pauses coverage; running keeps its last
    // observed state so large in-flight writes do not blink the session off.
    if (session.waitingPermissions.size > 0 || session.waitingInputs.size > 0) return false;
    if (session.subagents.size > 0) return true;
    for (const agent of session.agents.values()) {
      if (agent.active && agent.live) return true;
    }
    return false;
  }

  async poll() {
    if (this.stopped || this.polling) return this.snapshot();
    this.polling = true;
    this.readIssues = 0;
    this.lastPollBytesRead = 0;
    try {
      const rootInfo = await lstat(this.root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        this.sourceStatus = 'unavailable';
        this.forceBaseline = true;
        this.queueAllForBaseline();
        this.candidateCount = 0;
        this.backlogFiles = Math.max(1, this.files.size);
        this.emitChangeIfNeeded();
        return this.snapshot();
      }
      const entries = await readdir(this.root, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .slice(0, MAX_DIR_ENTRIES)
        .map((entry) => path.join(this.root, entry.name));
      const candidates = [];
      for (const directory of directories) {
        try {
          const file = path.join(directory, 'events.jsonl');
          const info = await lstat(file);
          if (info.isFile() && !info.isSymbolicLink()) {
            candidates.push({ file, mtimeMs: info.mtimeMs, size: info.size });
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') this.readIssues++;
        }
      }
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      this.candidateCount = candidates.length;
      this.fileLimitHit = candidates.length > this.maxFiles || entries.length > MAX_DIR_ENTRIES;
      const selected = candidates.slice(0, this.maxFiles);
      selected.sort((a, b) => a.file.localeCompare(b.file));
      const selectedPaths = new Set(selected.map((item) => item.file));
      for (const [file, state] of this.files) {
        if (!selectedPaths.has(file)) {
          this.files.delete(file);
          this.sessions.delete(file);
        }
        void state;
      }
      for (const item of candidates) {
        if (!selectedPaths.has(item.file)) this.rememberFile(item.file);
      }

      let totalRead = 0;
      const lastIndex = selected.findIndex((item) => item.file === this.lastServicedPath);
      const startAt = selected.length && lastIndex >= 0
        ? (lastIndex + 1) % selected.length
        : 0;
      const ordered = selected.slice(startAt).concat(selected.slice(0, startAt));
      let inspected = 0;
      for (const item of ordered) {
        if (totalRead >= this.maxTotalReadPerPoll) {
          this.rememberFile(item.file);
          const skipped = this.files.get(item.file);
          if (skipped && (skipped.observedSize !== item.size || skipped.mtimeMs !== item.mtimeMs)) {
            this.markFileGap(skipped);
          }
          inspected++;
          continue;
        }
        try {
          const knownBefore = this.knownFiles.has(item.file);
          this.rememberFile(item.file);
          const bytesRead = await this.readFile(item.file, totalRead, knownBefore);
          totalRead += bytesRead;
          if (bytesRead > 0) this.lastServicedPath = item.file;
        } catch (error) {
          const failed = this.files.get(item.file);
          if (failed) this.markFileGap(failed);
          this.readIssues++;
        }
        inspected++;
      }
      this.lastPollBytesRead = totalRead;

      let pendingSelected = 0;
      for (const item of selected) {
        const state = this.files.get(item.file);
        if (!state || state.baselineTarget !== null || state.needsBaseline ||
            !state.baselineComplete || state.offset < state.observedSize || state.skipUntilNewline ||
            state.boundaryCheckPending || state.session.pendingRecord) {
          pendingSelected++;
        }
      }
      const unselectedCount = candidates.length - selected.length;
      this.backlogFiles = pendingSelected + unselectedCount;
      if (this.readIssues === 0) {
        this.initialBaseline = false;
        if (pendingSelected === 0) this.forceBaseline = false;
      }
      this.sourceStatus = this.readIssues === 0 && this.backlogFiles === 0 && !this.fileLimitHit
        ? 'available' : 'partial';
      // Per-file issues already invalidated their own session; other sessions'
      // observed state stays valid.
    } catch (error) {
      this.sourceStatus = error?.code === 'ENOENT' ? 'unavailable' : 'partial';
      this.readIssues++;
      this.forceBaseline = true;
      this.queueAllForBaseline();
      this.backlogFiles = Math.max(1, this.files.size);
      this.invalidateAllSessions();
    } finally {
      this.flushActivities();
      this.polling = false;
    }
    this.emitChangeIfNeeded();
    return this.snapshot();
  }

  emitChangeIfNeeded() {
    const snapshot = this.snapshot();
    const comparable = {
      ...snapshot,
      treeSessions: snapshot.treeSessions.map(({ subagents, ...session }) => ({
        ...session,
        subagents: subagents.map(({ ageMs, ...subagent }) => subagent),
      })),
      sessions: snapshot.sessions.map(({ elapsedMs, stats, ...session }) => ({
        ...session,
        stats: {
          ...stats,
          runningMs: 0,
          unverifiedMs: 0,
          waitingMs: 0,
        },
      })),
      hudSessions: snapshot.hudSessions.map(({ elapsedMs, stats, ...session }) => ({
        ...session,
        stats: {
          ...stats,
          runningMs: 0,
          unverifiedMs: 0,
          waitingMs: 0,
        },
      })),
    };
    const after = JSON.stringify(comparable);
    if (after !== this.lastSnapshotJson) {
      this.lastSnapshotJson = after;
      this.emit('change', snapshot);
    }
  }

  rememberFile(file) {
    if (this.knownFiles.has(file)) return;
    this.knownFiles.add(file);
    if (this.knownFiles.size > MAX_DIR_ENTRIES) {
      this.knownFiles.delete(this.knownFiles.values().next().value);
    }
  }

  async readFile(file, usedBudget, previouslyKnown) {
    let state = this.files.get(file);
    let newState = false;
    const info = await stat(file);
    if (!state) {
      state = this.createFileState(file);
      this.files.set(file, state);
      newState = true;
    }
    const previousSize = state.observedSize;
    const previousMtime = state.mtimeMs;
    state.observedSize = info.size;
    let used = 0;
    try {
      const mustBaseline = newState || state.needsBaseline ||
        (!state.baselineComplete && (this.initialBaseline || this.forceBaseline || previouslyKnown));

      if (state.baselineTarget === null && mustBaseline) {
        this.beginBaseline(state, info);
        if (newState && !this.initialBaseline && !this.forceBaseline && !previouslyKnown) {
          state.liveBaselineSince = this.observedSince;
        }
      } else if (info.size < state.offset || state.ino !== info.ino ||
          (info.size === previousSize && previousMtime !== info.mtimeMs) ||
          (state.boundary.length && !state.needsBaseline)) {
        const available = Math.min(
          this.maxFileReadPerPoll - used,
          this.maxTotalReadPerPoll - usedBudget - used,
        );
        if (state.boundary.length && available < state.boundary.length) {
          if (info.size !== previousSize || info.mtimeMs !== previousMtime) {
            this.markFileGap(state);
            this.readIssues++;
          } else {
            state.boundaryCheckPending = true;
          }
          return 0;
        }
        if (state.boundary.length) {
          const check = await this.boundaryMatches(file, state);
          used += check.bytesRead;
          if (check.failed) {
            this.markFileGap(state);
            this.readIssues++;
            return used;
          }
          state.boundaryCheckPending = false;
          if (check.matches && info.size >= state.offset && state.ino === info.ino &&
              !(info.size === previousSize && previousMtime !== info.mtimeMs)) {
            // The existing append boundary is intact; no reset is needed.
          } else {
            this.beginBaseline(state, info);
            this.readIssues++;
          }
        } else if (info.size < state.offset || state.ino !== info.ino ||
            (info.size === previousSize && previousMtime !== info.mtimeMs)) {
          this.beginBaseline(state, info);
          this.readIssues++;
        }
      }

      if (state.baselineTarget !== null && state.session.pendingRecord) {
        state.baselineTarget = info.size;
      }
      const baseline = state.baselineTarget !== null;
      const endOffset = baseline ? state.baselineTarget : info.size;
      const remaining = Math.max(0, endOffset - state.offset);
      const available = Math.min(
        this.maxFileReadPerPoll - used,
        this.maxTotalReadPerPoll - usedBudget - used,
      );
      if (baseline && remaining > 0 && (remaining > available || remaining > this.maxFileReadPerPoll - used)) {
        return used;
      }
      const wanted = baseline ? remaining : Math.min(remaining, available);
      if (wanted > 0) {
        const handle = await open(file, 'r');
        try {
          const buffer = Buffer.allocUnsafe(wanted);
          const { bytesRead } = await handle.read(buffer, 0, wanted, state.offset);
          if (bytesRead > 0) {
            const chunk = buffer.subarray(0, bytesRead);
            state.offset += bytesRead;
            state.size = info.size;
            state.backlogAtRead = state.offset < endOffset;
            if (state.backlogAtRead && !baseline) {
              state.suppressUntilOffset = Math.max(state.suppressUntilOffset ?? 0, endOffset);
              this.invalidateSession(state);
            }
            if (!baseline && state.suppressUntilOffset !== null) {
              state.suppressUntilOffset = Math.max(state.suppressUntilOffset, endOffset);
            }
            const suppressActivity = baseline || state.backlogAtRead || state.needsBaseline ||
              this.forceBaseline || state.suppressUntilOffset !== null;
            used += bytesRead;
            this.syncSessionStatus(state.session, this.clock());
            state.session.pendingRecord = false;
            const consumed = this.consumeBuffer(state, chunk, suppressActivity);
            state.offset -= bytesRead - consumed;
            if (consumed > 0) this.updateBoundary(state, chunk.subarray(0, consumed));
            if (state.suppressUntilOffset !== null && state.offset >= state.suppressUntilOffset) {
              state.suppressUntilOffset = null;
            }
          }
        } finally {
          await handle.close();
        }
      }
      state.ino = info.ino;
      state.mtimeMs = info.mtimeMs;
      if (baseline && state.offset >= state.baselineTarget) this.finishBaseline(state);
      return used;
    } catch (error) {
      this.markFileGap(state);
      this.readIssues++;
      return used;
    }
  }

  createFileState(file) {
    const state = {
      file,
      offset: 0,
      size: 0,
      ino: 0,
      mtimeMs: 0,
      boundary: { digest: '', length: 0 },
      boundaryCheckPending: false,
      baselineTarget: null,
      liveBaselineSince: null,
      baselineStart: null,
      baselineSkipFirstLine: false,
      skipUntilNewline: false,
      baselineComplete: false,
      needsBaseline: false,
      observedSize: 0,
      backlogAtRead: false,
      suppressUntilOffset: null,
      session: this.createSession(),
    };
    this.sessions.set(file, state.session);
    return state;
  }

  createSession() {
    const now = this.clock();
    return {
      agents: new Map(),
      // Live-observed subagent calls (toolCallId -> child attribution key).
      subagents: new Map(),
      retired: [],
      eligibleRootTurn: null,
      completedRootTurn: null,
      // Survives turn_end because session.idle can follow the final assistant turn.
      pendingIdleTurn: null,
      // Run-start times (journal timestamp and/or live clock) for durations.
      starts: new Map(),
      waitingPermissions: new Set(),
      waitingInputs: new Set(),
      lastEventAt: now,
      ended: false,
      pendingRecord: false,
      statusSince: now,
      lastStatus: 'idle',
      stats: createStats(now),
    };
  }

  beginBaseline(state, info) {
    this.resetFileState(state);
    const baselineBytes = Math.min(MAX_BASELINE_BYTES, this.maxFileReadPerPoll, this.maxTotalReadPerPoll);
    state.baselineStart = Math.max(0, info.size - baselineBytes);
    state.offset = state.baselineStart;
    state.baselineTarget = info.size;
    state.baselineSkipFirstLine = state.baselineStart > 0;
    state.skipUntilNewline = false;
    state.baselineComplete = false;
    state.observedSize = info.size;
    state.size = info.size;
    state.ino = info.ino;
    state.needsBaseline = false;
    state.backlogAtRead = false;
    state.skipUntilNewline = false;
  }

  finishBaseline(state) {
    state.baselineTarget = null;
    state.liveBaselineSince = null;
    state.baselineStart = null;
    state.baselineSkipFirstLine = false;
    state.baselineComplete = true;
    state.needsBaseline = false;
    state.backlogAtRead = false;
  }

  resetFileState(state) {
    state.offset = 0;
    state.size = 0;
    state.boundary = { digest: '', length: 0 };
    state.boundaryCheckPending = false;
    state.baselineTarget = null;
    state.liveBaselineSince = null;
    state.baselineStart = null;
    state.baselineSkipFirstLine = false;
    state.skipUntilNewline = false;
    state.baselineComplete = false;
    state.needsBaseline = false;
    state.backlogAtRead = false;
    state.suppressUntilOffset = null;
    state.session = this.createSession();
    this.sessions.set(state.file, state.session);
  }

  async boundaryMatches(file, state) {
    if (!state.offset || !state.boundary.length) return { matches: true, bytesRead: 0, failed: false };
    let handle;
    let bytesRead = 0;
    let matches = false;
    let failed = false;
    try {
      handle = await open(file, 'r');
      const at = Math.max(0, state.offset - state.boundary.length);
      const buffer = Buffer.allocUnsafe(state.boundary.length);
      const result = await handle.read(buffer, 0, buffer.length, at);
      bytesRead = result.bytesRead;
      matches = bytesRead === state.boundary.length &&
        createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex') === state.boundary.digest;
    } catch {
      failed = true;
    } finally {
      if (handle) {
        try { await handle.close(); } catch { failed = true; }
      }
    }
    return { matches: matches && !failed, bytesRead, failed };
  }

  updateBoundary(state, chunk) {
    const tail = chunk.subarray(-64);
    state.boundary = {
      digest: createHash('sha256').update(tail).digest('hex'),
      length: tail.length,
    };
  }

  queueAllForBaseline() {
    for (const state of this.files.values()) {
      state.needsBaseline = true;
      state.baselineTarget = null;
      state.baselineStart = null;
      state.baselineComplete = false;
      state.skipUntilNewline = false;
      state.boundary = { digest: '', length: 0 };
      state.boundaryCheckPending = false;
      this.invalidateSession(state);
    }
  }

  markFileGap(state) {
    state.needsBaseline = true;
    state.baselineTarget = null;
    state.baselineStart = null;
    state.baselineComplete = false;
    state.skipUntilNewline = false;
    state.suppressUntilOffset = null;
    state.boundary = { digest: '', length: 0 };
    state.boundaryCheckPending = false;
    this.invalidateSession(state);
  }

  consumeBuffer(state, buffer, baseline) {
    let start = 0;
    if (state.skipUntilNewline || (baseline && state.baselineSkipFirstLine)) {
      const firstNewline = buffer.indexOf(0x0a);
      if (firstNewline < 0) {
        state.skipUntilNewline = true;
        return buffer.length;
      }
      start = firstNewline + 1;
      state.skipUntilNewline = false;
      state.baselineSkipFirstLine = false;
    }

    let newline;
    while ((newline = buffer.indexOf(0x0a, start)) >= 0) {
      let end = newline;
      if (end > start && buffer[end - 1] === 0x0d) end--;
      const length = end - start;
      if (length > MAX_LINE_BYTES) {
        if (!this.consumeOversizedLine(state, buffer.subarray(start, end), baseline)) {
          this.readIssues++;
          if (!baseline) this.invalidateSession(state);
        }
      } else if (length > 0) {
        this.consumeLine(state, buffer.subarray(start, end).toString('utf8'), baseline);
      }
      start = newline + 1;
    }

    if (start < buffer.length) {
      // Retry a bounded unfinished record from disk, retaining only its offset.
      if (buffer.length - start <= MAX_LINE_BYTES && !state.backlogAtRead) {
        state.session.pendingRecord = true;
        this.expireEligibility(state);
        this.syncSessionStatus(state.session, this.clock());
        return start;
      }
      state.skipUntilNewline = true;
      if (buffer.length - start > MAX_LINE_BYTES) this.readIssues++;
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
    }
    return buffer.length;
  }

  // Classifies a record too large to parse from its leading `type` only. State
  // events still need their data, so only state-neutral types are accepted;
  // nothing beyond the bounded type prefix is decoded or retained.
  consumeOversizedLine(state, record, baseline) {
    const prefix = record.subarray(0, OVERSIZED_PREFIX_BYTES).toString('latin1');
    const type = OVERSIZED_TYPE_PREFIX.exec(prefix)?.[1];
    if (!type || !validEventType(type) || STATE_EVENT_TYPES.has(type)) return false;
    this.processEvent(state, { type }, {}, baseline);
    return true;
  }

  syncSessionStatus(session, now) {
    const elapsed = Math.max(0, Math.floor(now - session.stats.statusAt));
    const status = deriveStatus(session, now);
    if (session.lastStatus === 'running') {
      session.stats.runningMs = addDuration(session.stats.runningMs, elapsed);
    }
    if (session.lastStatus === 'waiting') {
      session.stats.waitingMs = addDuration(session.stats.waitingMs, elapsed);
    }

    session.stats.statusAt = now;
    if (status !== session.lastStatus) {
      session.lastStatus = status;
      session.statusSince = now;
    }
    return status;
  }

  countStatsIdentifier(counts, value, overflowKey, stats) {
    if (counts.has(value)) {
      counts.set(value, increment(counts.get(value)));
    } else if (counts.size < MAX_STATS_IDENTIFIERS) {
      counts.set(value, 1);
    } else {
      stats[overflowKey] = increment(stats[overflowKey]);
    }
  }

  recordPublishedStats(session, kind, type, toolName, data) {
    const stats = session.stats;
    const eventKind = ACTIVITY_KINDS.includes(kind) ? kind : 'activity';
    stats.kinds[eventKind] = increment(stats.kinds[eventKind]);
    this.countStatsIdentifier(stats.typeCounts, type, 'otherTypes', stats);
    if (toolName) this.countStatsIdentifier(stats.toolCounts, toolName, 'otherTools', stats);

    if (type === 'session.error' || type === 'subagent.failed' ||
        (type === 'tool.execution_complete' && data.success === false)) {
      stats.errors = increment(stats.errors);
    }
  }

  recordTurn(session, elapsed) {
    const duration = Math.min(MAX_STATS_COUNTER, Math.max(0, Math.floor(elapsed)));
    const turns = session.stats.turns;
    turns.count = increment(turns.count);
    turns.lastMs = duration;
    turns.maxMs = Math.max(turns.maxMs, duration);
    turns.durations.push(duration);
    if (turns.durations.length > MAX_TURN_DURATIONS) turns.durations.shift();
  }

  consumeLine(state, line, baseline) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
      return;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event) || !validEventType(event.type)) {
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
      return;
    }
    const type = event.type;
    const validData = event.data && typeof event.data === 'object' && !Array.isArray(event.data);
    if (event.data != null && !validData) {
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
      return;
    }
    const data = validData ? event.data : {};
    const eventId = safeId(event.id);
    if (eventId && !this.uniqueKey(state.file, 'event', eventId)) return;
    this.processEvent(state, event, data, baseline);
  }

  processEvent(state, event, data, baseline) {
    const type = event.type;
    const session = state.session;
    const eventAt = this.clock();
    this.syncSessionStatus(session, eventAt);
    if (eventAt - session.lastEventAt > STALE_ACTIVITY_MS) this.expireEligibility(state);
    // Incoming user messages are visible impulses, not fresh evidence that an
    // already-open assistant interval is still computing.
    if (!type.startsWith('user.')) session.lastEventAt = eventAt;
    const attributionInfo = attribution(event, data);
    if (!attributionInfo) {
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
      this.syncSessionStatus(session, eventAt);
      return;
    }
    session.ended = false;
    this.eventDurationMs = undefined;
    const kind = this.applyEvent(state, event, data, baseline, attributionInfo, eventAt);
    this.syncSessionStatus(session, eventAt);
    if (!baseline && kind !== false && !WAIT_EVENT_TYPES.has(type)) {
      const toolName = type.startsWith('tool.') && validToolName(data.toolName) ? data.toolName : undefined;
      this.recordPublishedStats(session, kind || 'activity', type, toolName, data);
      this.publish(kind || 'activity', type, toolName, this.eventDurationMs);
    }
  }

  markStart(session, id, event, eventAt, baseline) {
    const ts = eventTime(event);
    const clock = baseline ? null : eventAt;
    if (ts === null && clock === null) return;
    session.starts.delete(id);
    if (session.starts.size >= MAX_STARTS_PER_SESSION) {
      session.starts.delete(session.starts.keys().next().value);
    }
    session.starts.set(id, { ts, clock });
  }

  // Duration of a run whose start was seen; journal timestamps are preferred
  // because one poll can observe both ends of a short run.
  takeDuration(session, id, event, eventAt, baseline) {
    const start = session.starts.get(id);
    session.starts.delete(id);
    if (!start || baseline) return;
    const ts = eventTime(event);
    const duration = start.ts !== null && ts !== null ? ts - start.ts
      : start.clock !== null ? eventAt - start.clock : NaN;
    if (Number.isFinite(duration) && duration >= 0) {
      this.eventDurationMs = Math.min(MAX_HUD_ELAPSED_MS, Math.floor(duration));
    }
  }

  observeWork(state, key, toolCallId) {
    const session = state.session;
    let agent = session.agents.get(key);
    if (agent) {
      agent.live = true;
    } else {
      if (session.agents.size >= MAX_AGENTS_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return false;
      }
      agent = {
        turnId: null, active: true, eligible: false, live: true, waiting: false, toolCalls: new Set(),
      };
      session.agents.set(key, agent);
    }
    if (toolCallId) {
      if (!agent.toolCalls.has(toolCallId) && agent.toolCalls.size >= MAX_TOOLS_PER_AGENT) {
        this.readIssues++;
        this.invalidateSession(state);
        return false;
      }
      agent.toolCalls.add(toolCallId);
    }
    return true;
  }

  applyEvent(state, event, data, baseline, attributionInfo, eventAt) {
    const type = event.type;
    const session = state.session;
    const { root, key } = attributionInfo;
    const timestamp = eventTime(event);
    const liveBaseline = baseline && state.liveBaselineSince !== null &&
      timestamp !== null && timestamp >= state.liveBaselineSince && timestamp <= eventAt;

    if ((!baseline || liveBaseline) && type !== 'tool.execution_start' && WORK_EVENT_TYPES.has(type) &&
        (type !== 'tool.execution_progress' || safeId(data.toolCallId))) {
      if (!this.observeWork(state, key, type === 'tool.execution_progress' ? safeId(data.toolCallId) : null)) return;
    }

    if (type === 'assistant.turn_start') {
      const turnId = safeId(data.turnId);
      if (!turnId) return;
      // Copilot can restart turn numbering for each interaction and agent.
      const turnKey = JSON.stringify([key, safeId(data.interactionId), turnId]);
      const dedup = this.uniqueKey(state.file, 'turn-start', turnKey);
      if (!dedup) return false;
      if (!session.agents.has(key) && session.agents.size >= MAX_AGENTS_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.agents.set(key, { turnId, active: true, eligible: !baseline, live: !baseline || liveBaseline, waiting: false, toolCalls: new Set() });
      this.markStart(session, `turn\u0000${key}\u0000${turnId}`, event, eventAt, baseline);
      if (!baseline) session.stats.openTurns.set(key, { turnId, startedAt: eventAt });
      if (root) {
        session.eligibleRootTurn = baseline ? null : turnId;
        session.completedRootTurn = null;
        session.pendingIdleTurn = baseline ? null : turnId;
      }
      return 'thinking';
    }

    if (type === 'assistant.turn_end') {
      const turnId = safeId(data.turnId);
      const agent = session.agents.get(key);
      if (agent && (!turnId || agent.turnId === null || agent.turnId === turnId)) {
        const openTurn = session.stats.openTurns.get(key);
        if (turnId && openTurn?.turnId === turnId) {
          this.recordTurn(session, eventAt - openTurn.startedAt);
        }
        if (openTurn?.turnId === agent.turnId) session.stats.openTurns.delete(key);
        this.takeDuration(session, `turn\u0000${key}\u0000${agent.turnId}`, event, eventAt, baseline);
        agent.active = false;
        agent.eligible = false;
        if (root) session.eligibleRootTurn = null;
        session.agents.delete(key);
      }
      return;
    }

    if (type === 'tool.execution_start') {
      const call = safeId(data.toolCallId) || safeId(event.id);
      if (!call) return false;
      if (!this.uniqueKey(state.file, 'tool', call)) return false;
      if ((!baseline || liveBaseline) && !this.observeWork(state, key, call)) return;
      this.markStart(session, `tool\u0000${call}`, event, eventAt, baseline);
      const agent = session.agents.get(key);
      if (agent?.active) {
        if (!agent.toolCalls.has(call) && agent.toolCalls.size >= MAX_TOOLS_PER_AGENT) {
          this.readIssues++;
          this.invalidateSession(state);
          return;
        }
        agent.toolCalls.add(call);
      }
      if (!baseline) {
        this.steps = Math.min(Number.MAX_SAFE_INTEGER, this.steps + 1);
      }
      return 'step';
    }

    if (type === 'tool.execution_complete') {
      const call = safeId(data.toolCallId);
      if (!call) return;
      this.takeDuration(session, `tool\u0000${call}`, event, eventAt, baseline);
      const agent = session.agents.get(key);
      if (agent?.active) {
        const matched = agent.toolCalls.delete(call);
        if (matched && agent.turnId === null && agent.toolCalls.size === 0) session.agents.delete(key);
      }
      return;
    }

    if (type === 'permission.requested') {
      const permission = safeId(data.permissionId) || 'unknown';
      if (!session.waitingPermissions.has(permission) && session.waitingPermissions.size >= MAX_WAITING_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.waitingPermissions.add(permission);
      for (const agent of session.agents.values()) agent.waiting = true;
      return;
    }

    if (type === 'user_input.requested' || type === 'elicitation.requested') {
      const request = safeId(data.requestId) || 'unknown';
      if (!session.waitingInputs.has(request) && session.waitingInputs.size >= MAX_WAITING_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.waitingInputs.add(request);
      return;
    }

    if (type === 'user_input.completed' || type === 'elicitation.completed') {
      session.waitingInputs.delete(safeId(data.requestId) || 'unknown');
      return;
    }

    if (type === 'subagent.started') {
      const call = safeId(data.toolCallId);
      // One running interval per delegated call; duplicates or restarts after
      // an observed end never re-open it. New-session baseline starts may
      // establish liveness, but are never replayed as activity or statistics.
      if (!call || !this.uniqueKey(state.file, 'subagent', call) || (baseline && !liveBaseline)) return;
      if (session.subagents.size >= MAX_SUBAGENTS_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.subagents.set(call, { key, startedAt: eventAt });
      if (!baseline) session.stats.subagents.started = increment(session.stats.subagents.started);
      return;
    }

    if (type === 'subagent.completed' || type === 'subagent.failed') {
      const call = safeId(data.toolCallId);
      if (!call) {
        // An uninterpretable recorded end: drop this session's live state
        // rather than linger. A present-but-invalid identifier is malformed
        // (partial); missing/null lifecycle data stays a safe, valid record.
        if (data.toolCallId != null) this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      if (!baseline) {
        session.stats.subagents[type === 'subagent.failed' ? 'failed' : 'completed'] =
          increment(session.stats.subagents[type === 'subagent.failed' ? 'failed' : 'completed']);
      }
      // The delegating tool call shares this id; its start drives one
      // subagent-sized burst here instead of a second tool burst.
      this.takeDuration(session, `tool\u0000${call}`, event, eventAt, baseline);
      // Retire the delegated call and its child agent even if the child never
      // wrote its own turn end. Duplicate terminal records are no-ops.
      const subagent = session.subagents.get(call);
      const childKey = subagent?.key;
      if (subagent) this.retireSubagent(session, call, type === 'subagent.completed' ? 'completed' : 'failed');
      session.subagents.delete(call);
      for (const retired of [childKey, root ? undefined : key]) {
        if (retired && retired !== 'root') {
          session.agents.delete(retired);
          session.stats.openTurns.delete(retired);
        }
      }
      return;
    }

    if (type === 'permission.completed') {
      session.waitingPermissions.delete(safeId(data.permissionId) || 'unknown');
      if (session.waitingPermissions.size === 0) {
        for (const agent of session.agents.values()) agent.waiting = false;
      }
      return;
    }

    if (type === 'assistant.reasoning' || type === 'assistant.reasoning_delta') {
      const agent = session.agents.get(key);
      if (!baseline && agent?.active && agent.eligible && !agent.waiting && agent.toolCalls.size === 0) {
        return 'thinking';
      }
      return;
    }

    if (type === 'session.task_complete') {
      const agent = session.agents.get('root');
      const taskId = safeId(event.id);
      if (!baseline && root && agent?.active && agent.eligible &&
          !agent.waiting && agent.toolCalls.size === 0 && session.waitingPermissions.size === 0 &&
          session.waitingInputs.size === 0 &&
          this.hasCompleteCoverageFor(state) &&
          session.completedRootTurn !== agent.turnId &&
          data.success === true && data.outcome === 'completed' &&
          taskId && this.uniqueKey(state.file, 'completion', taskId)) {
        session.completedRootTurn = agent.turnId;
        session.pendingIdleTurn = null;
        return 'completion';
      }
      return;
    }

    if (type === 'abort' || type === 'session.error' || type === 'session.shutdown' || type === 'session.idle') {
      if (type === 'session.idle' && !root) return false;
      const idleCascade = type === 'session.idle' && !baseline &&
        session.pendingIdleTurn !== null && this.hasCompleteCoverageFor(state) &&
        session.waitingPermissions.size === 0 && session.waitingInputs.size === 0 &&
        !session.agents.get('root')?.waiting &&
        (session.agents.get('root')?.toolCalls.size ?? 0) === 0;
      session.pendingIdleTurn = null;
      session.ended = type === 'session.shutdown';
      for (const agent of session.agents.values()) {
        agent.active = false;
        agent.eligible = false;
      }
      session.agents.clear();
      session.eligibleRootTurn = null;
      session.waitingPermissions.clear();
      session.waitingInputs.clear();
      for (const callId of session.subagents.keys()) this.retireSubagent(session, callId, 'cleared');
      session.subagents.clear();
      session.stats.openTurns.clear();
      if (type === 'session.idle') return idleCascade ? 'activity' : false;
    }
  }

  uniqueKey(file, category, id) {
    const key = `${file}\u0000${category}\u0000${id}`;
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.add(key);
    this.seenKeyOrder.push(key);
    if (this.seenKeyOrder.length > MAX_DEDUP_KEYS) {
      this.seenKeys.delete(this.seenKeyOrder.shift());
    }
    return true;
  }

  // Staleness only: success eligibility is lost, observed running work is kept
  // as running until a recorded end, wait, cancellation or error.
  expireEligibility(state) {
    state.session.pendingIdleTurn = null;
    for (const agent of state.session.agents.values()) agent.eligible = false;
    state.session.eligibleRootTurn = null;
    state.session.stats.openTurns.clear();
  }

  // Coverage gaps (read errors, truncation, rebaseline, malformed/partial
  // records, backlog, source loss): an end event may have been missed, so live
  // running state is dropped too; only fresh observed work can restore it.
  invalidateSession(state) {
    const now = this.clock();
    this.syncSessionStatus(state.session, now);
    this.expireEligibility(state);
    state.session.ended = false;
    state.session.waitingPermissions.clear();
    state.session.waitingInputs.clear();
    for (const agent of state.session.agents.values()) {
      agent.live = false;
      agent.waiting = false;
    }
    this.clearSubagents(state.session);
    this.syncSessionStatus(state.session, now);
  }

  retireSubagent(session, callId, outcome) {
    session.retired.push({ callId, outcome });
    if (session.retired.length > MAX_TREE_RETIREMENTS) session.retired.shift();
  }

  clearSubagents(session) {
    for (const callId of session.subagents.keys()) this.retireSubagent(session, callId, 'cleared');
    session.subagents.clear();
  }

  invalidateAllSessions() {
    for (const state of this.files.values()) this.invalidateSession(state);
  }

  hasCompleteCoverageFor(state) {
    return state.baselineTarget === null && !state.needsBaseline && !state.backlogAtRead &&
      state.offset >= state.observedSize && this.backlogFiles === 0 && !this.fileLimitHit &&
      !state.skipUntilNewline && !state.session.pendingRecord && !state.boundaryCheckPending && !this.forceBaseline &&
      !this.initialBaseline && this.readIssues === 0;
  }

  publish(kind, eventType, toolName, durationMs) {
    this.sequence++;
    const key = JSON.stringify([kind, eventType, toolName]);
    // At most 64 distinct metadata groups are retained. Flush, never drop, on
    // pressure; the existing per-poll byte budget also bounds total output.
    if (!this.pendingActivities.has(key) && this.pendingActivities.size >= 64) this.flushActivities();
    const previous = this.pendingActivities.get(key);
    const value = previous || { kind, eventType, ...(toolName ? { toolName } : {}), count: 0 };
    value.count++;
    // Grouped runs keep their longest duration as the burst's impact.
    if (durationMs !== undefined) value.durationMs = Math.max(value.durationMs ?? 0, durationMs);
    // Move repeated groups to the newest position for the newest-first feed.
    this.pendingActivities.delete(key);
    this.pendingActivities.set(key, value);
  }

  flushActivities() {
    for (const { count, ...value } of this.pendingActivities.values()) {
      this.emit('activity', count === 1 ? value : { ...value, count });
    }
    this.pendingActivities.clear();
  }
}
