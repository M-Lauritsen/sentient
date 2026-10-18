import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validEventType, validToolName } from '../activity-client.mjs';

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
const STALE_ACTIVITY_MS = 45_000;
const SOURCE = 'local-activity-files';

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
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
    let unverifiedRunningSessions = 0;
    for (const state of this.sessions.values()) {
      const stale = now - state.lastEventAt > STALE_ACTIVITY_MS;
      // Running is a separate visual liveness signal: only work whose start was
      // observed live counts; staleness marks it unverified but does not stop it.
      // It never grants success eligibility.
      if (this.isRunning(state)) {
        runningSessions++;
        if (stale) unverifiedRunningSessions++;
      }
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
      backlogFiles: this.backlogFiles,
      steps: this.steps,
      sequence: this.sequence,
    };
  }

  isRunning(session) {
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
            state.boundaryCheckPending) {
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
      if (this.readIssues > 0) this.invalidateAllSessions();
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
    const after = JSON.stringify(snapshot);
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
            this.updateBoundary(state, chunk);
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
            this.consumeBuffer(state, chunk, suppressActivity);
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
    return {
      agents: new Map(),
      // Live-observed subagent calls (toolCallId -> child attribution key).
      subagents: new Map(),
      eligibleRootTurn: null,
      completedRootTurn: null,
      waitingPermissions: new Set(),
      waitingInputs: new Set(),
      lastEventAt: this.clock(),
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
        return;
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
        this.readIssues++;
        if (!baseline) this.invalidateSession(state);
      } else if (length > 0) {
        this.consumeLine(state, buffer.subarray(start, end).toString('utf8'), baseline);
      }
      start = newline + 1;
    }

    if (start < buffer.length) {
      state.skipUntilNewline = true;
      if (buffer.length - start > MAX_LINE_BYTES) this.readIssues++;
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
    }
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
    const session = state.session;
    if (this.clock() - session.lastEventAt > STALE_ACTIVITY_MS) this.expireEligibility(state);
    // Incoming user messages are visible impulses, not fresh evidence that an
    // already-open assistant interval is still computing.
    if (!type.startsWith('user.')) session.lastEventAt = this.clock();
    const attributionInfo = attribution(event, data);
    if (!attributionInfo) {
      this.readIssues++;
      if (!baseline) this.invalidateSession(state);
      return;
    }
    const kind = this.applyEvent(state, event, data, baseline, attributionInfo);
    if (!baseline && kind !== false) {
      const toolName = type.startsWith('tool.') && validToolName(data.toolName) ? data.toolName : undefined;
      this.publish(kind || 'activity', type, toolName);
    }
  }

  applyEvent(state, event, data, baseline, attributionInfo) {
    const type = event.type;
    const session = state.session;
    const { root, key } = attributionInfo;

    if (type === 'assistant.turn_start') {
      const turnId = safeId(data.turnId);
      if (!turnId) return;
      const dedup = this.uniqueKey(state.file, 'turn-start', turnId);
      if (!dedup) return false;
      if (!session.agents.has(key) && session.agents.size >= MAX_AGENTS_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.agents.set(key, { turnId, active: true, eligible: !baseline, live: !baseline, waiting: false, toolCalls: new Set() });
      if (root) {
        session.eligibleRootTurn = baseline ? null : turnId;
        session.completedRootTurn = null;
      }
      return 'thinking';
    }

    if (type === 'assistant.turn_end') {
      const turnId = safeId(data.turnId);
      const agent = session.agents.get(key);
      if (agent && (!turnId || agent.turnId === turnId)) {
        agent.active = false;
        agent.eligible = false;
        if (root) session.eligibleRootTurn = null;
        session.agents.delete(key);
      }
      return;
    }

    if (type === 'tool.execution_start') {
      const call = safeId(data.toolCallId) || safeId(event.id);
      if (!call) return;
      if (!this.uniqueKey(state.file, 'tool', call)) return false;
      const agent = session.agents.get(key);
      if (agent?.active) {
        if (agent.toolCalls.size >= MAX_TOOLS_PER_AGENT) {
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
      const agent = session.agents.get(key);
      if (agent?.active) agent.toolCalls.delete(call);
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
      // an observed end never re-open it. Baseline starts are never running.
      if (!call || !this.uniqueKey(state.file, 'subagent', call) || baseline) return;
      if (session.subagents.size >= MAX_SUBAGENTS_PER_SESSION) {
        this.readIssues++;
        this.invalidateSession(state);
        return;
      }
      session.subagents.set(call, key);
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
      // Retire the delegated call and its child agent even if the child never
      // wrote its own turn end. Duplicate terminal records are no-ops.
      const childKey = session.subagents.get(call);
      session.subagents.delete(call);
      for (const retired of [childKey, root ? undefined : key]) {
        if (retired && retired !== 'root') session.agents.delete(retired);
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
        return 'completion';
      }
      return;
    }

    if (type === 'abort' || type === 'session.error' || type === 'session.shutdown' || type === 'session.idle') {
      for (const agent of session.agents.values()) {
        agent.active = false;
        agent.eligible = false;
      }
      session.agents.clear();
      session.eligibleRootTurn = null;
      session.waitingPermissions.clear();
      session.waitingInputs.clear();
      session.subagents.clear();
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
  // (shown as unverified) until a recorded end, wait, cancellation or error.
  expireEligibility(state) {
    for (const agent of state.session.agents.values()) agent.eligible = false;
    state.session.eligibleRootTurn = null;
  }

  // Coverage gaps (read errors, truncation, rebaseline, malformed/partial
  // records, backlog, source loss): an end event may have been missed, so live
  // running state is dropped too and never resumes without a new live start.
  invalidateSession(state) {
    this.expireEligibility(state);
    for (const agent of state.session.agents.values()) agent.live = false;
    state.session.subagents.clear();
  }

  invalidateAllSessions() {
    for (const state of this.files.values()) this.invalidateSession(state);
  }

  hasCompleteCoverageFor(state) {
    return state.baselineTarget === null && !state.needsBaseline && !state.backlogAtRead &&
      state.offset >= state.observedSize && this.backlogFiles === 0 && !this.fileLimitHit &&
      !state.skipUntilNewline && !state.boundaryCheckPending && !this.forceBaseline &&
      !this.initialBaseline && this.readIssues === 0;
  }

  publish(kind, eventType, toolName) {
    this.sequence++;
    const key = JSON.stringify([kind, eventType, toolName]);
    // At most 64 distinct metadata groups are retained. Flush, never drop, on
    // pressure; the existing per-poll byte budget also bounds total output.
    if (!this.pendingActivities.has(key) && this.pendingActivities.size >= 64) this.flushActivities();
    const previous = this.pendingActivities.get(key);
    const value = previous || { kind, eventType, ...(toolName ? { toolName } : {}), count: 0 };
    value.count++;
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
