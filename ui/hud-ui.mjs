import { createImpulseFeed, createActivityTimeline } from '../activity/activity-client.mjs';
import { CATEGORIES, CATEGORY_HEX } from '../activity/activity-colors.mjs';
import { createPageActivityTotals, createSessionStatsDialog, createTimelineDialog } from './session-stats-ui.mjs';
import { createWorkspaceStore } from '../workspace/workspace-model.mjs';
import { createWorkspaceUI } from '../workspace/workspace-ui.mjs';

export function createHud({ VISUAL, document, window, performance, invalidateObserved, resetThinking, clearImpulses, updateSubagentSummary, renderWaitingMarkers }) {
  // ---------- HUD ----------
  const $status = document.getElementById('status');
  const $journals = document.getElementById('journals');
  const $sessions = document.getElementById('sessions');
  const $waiting = document.getElementById('waiting');
  const $unknown = document.getElementById('unknown');
  const $running = document.getElementById('running');
  const $impulses = document.getElementById('impulses');
  const $load = document.getElementById('load');
  const $subtitle = document.getElementById('subtitle');
  const $coverage = document.getElementById('coverage');
  const impulseFeed = createImpulseFeed();
  const timeline = createActivityTimeline(performance.now());
  const timelineCanvas = document.getElementById('timeline');
  const timelineContext = timelineCanvas.getContext('2d');
  const timelineState = document.getElementById('timeline-state');
  const timelineLabels = {
    loading: 'Loading · awaiting live coverage',
    empty: 'No activity received in the observed window · hatching = unknown coverage',
    live: 'Received activity by category · hatching = unknown coverage',
    gap: 'Coverage gap · missing activity is unknown, not zero',
  };
  const renderTimeline = createTimelineRenderer({
    timeline, timelineCanvas, timelineContext, timelineState, timelineLabels,
  });
  const timelineDialog = createTimelineDialog({
    preview: document.querySelector('.hud-timeline'),
    content: document.getElementById('timeline-content'),
    canvas: timelineCanvas,
    dialog: document.getElementById('timeline-dialog'),
    dialogContent: document.getElementById('timeline-dialog-content'),
    opener: document.getElementById('timeline-open'),
    closeButton: document.getElementById('timeline-close'),
    redraw: () => renderTimeline(performance.now()),
  });
  const expandedSessionStats = new Set();
  const pageActivityTotals = createPageActivityTotals();
  let activityState = { connection: 'connecting', sourceStatus: 'unknown', coverage: 'unknown', activeSessions: 0, thinkingSessions: 0, runningSessions: 0, unverifiedRunningSessions: 0, journalFiles: 0, sessions: [] };

  const sessionStatsDialog = createSessionStatsDialog({
    document,
    dialog: document.getElementById('session-stats-dialog'),
    title: document.getElementById('session-stats-title'),
    content: document.getElementById('session-stats-content'),
    closeButton: document.getElementById('session-stats-close'),
    fallbackFocus: $status,
    formatElapsed: (elapsedMs) => {
      const seconds = Math.floor(Math.min(1_000_000_000, Math.max(0, elapsedMs)) / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainder = seconds % 60;
      if (hours >= 1000) return '>999h';
      if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
      return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    },
    expandedSessionStats,
    pageActivityTotals,
  });
  let workspaceStorage = null;
  try {
    workspaceStorage = window.localStorage ?? null;
  } catch {
    workspaceStorage = {
      getItem() { throw new Error('Workspace browser storage is unavailable.'); },
      setItem() { throw new Error('Workspace browser storage is unavailable.'); },
    };
  }
  const workspaceStore = createWorkspaceStore({ storage: workspaceStorage });
  const workspaceUI = createWorkspaceUI({
    document,
    root: document.getElementById('workspace'),
    opener: document.getElementById('workspace-open'),
    store: workspaceStore,
    feed: impulseFeed,
    timelinePreview: document.querySelector('.hud-timeline'),
    closeTimeline: () => timelineDialog.close(),
    sessionStatsDialog,
    pageActivityTotals,
    expandedSessionStats,
  });

  function tickSessionTimes(now = performance.now()) {
    workspaceUI.tickSessionTimes(now);
  }

  document.getElementById('workspace').addEventListener('click', (event) => {
    if (event.target.closest('.workspace-session-list')) sessionStatsDialog.open(event);
  });

  const renderActivityState = createActivityStateRenderer({
    document, performance, timeline, invalidateObserved, resetThinking, clearImpulses,
    updateSubagentSummary, renderWaitingMarkers, workspaceUI, onState: state => { activityState = state; },
    $coverage, $journals, $sessions, $waiting, $unknown, $running, $status, $subtitle,
  });

  let hudTimer = 0;
  let sessionTimer = 0;
  let timelineTimer = 0;
  let smoothedObservedLoad = 0;
  function updateTimeline(dt) {
    timelineTimer -= dt;
    if (timelineTimer <= 0) {
      timelineTimer = 0.5;
      renderTimeline(performance.now());
    }
  }
  function updateCounters(dt, activePulses, demoPulses) {
    hudTimer -= dt;
    const observedLoad = Math.min(1, (activePulses - demoPulses) / VISUAL.scene.loadPulseScale +
      activityState.activeSessions / VISUAL.scene.loadSessionScale);
    smoothedObservedLoad += (observedLoad - smoothedObservedLoad) * Math.min(1, dt * VISUAL.scene.loadSmoothing);
    if (hudTimer <= 0) {
      hudTimer = 0.15;
      $impulses.textContent = String(activePulses - demoPulses);
      $load.textContent = Math.round(smoothedObservedLoad * 100) + '%';
    }
    sessionTimer -= dt;
    if (sessionTimer <= 0) {
      sessionTimer = 1;
      tickSessionTimes(performance.now());
    }
  }
  function acceptActivity(activity) {
    recordObservedActivity(activity, document, activityState, pageActivityTotals, sessionStatsDialog, workspaceUI);
  }

  return {
    get activityState() { return activityState; },
    impulseFeed, timeline, workspaceUI, sessionStatsDialog, pageActivityTotals,
    renderActivityState, renderTimeline, updateTimeline, updateCounters, acceptActivity,
  };
}

export function recordObservedActivity(activity, document, state, totals, statsDialog, workspace) {
  if (!document.hidden && state.connection === 'connected' &&
      state.sourceStatus === 'available' && state.coverage !== 'partial' &&
      state.coverage !== 'unknown') {
    totals.add(activity);
    statsDialog.refreshActivity();
    workspace.refresh();
  }
}

export function createTimelineRenderer({ timeline, timelineCanvas, timelineContext, timelineState, timelineLabels }) {
  let lastTimelineState = '';
  function renderTimeline(now) {
    const view = timeline.read(now);
    if (lastTimelineState !== view.state) {
      lastTimelineState = view.state;
      timelineState.textContent = timelineLabels[view.state];
    }
    if (!timelineContext) return;
    const width = timelineCanvas.width, height = timelineCanvas.height;
    const column = width / 120;
    timelineContext.clearRect(0, 0, width, height);
    let max = 1;
    for (let bucket = 0; bucket < 120; bucket++) {
      let total = 0;
      for (let category = 0; category < CATEGORIES.length; category++) {
        total += view.counts[bucket * CATEGORIES.length + category];
      }
      max = Math.max(max, total);
    }
    for (let x = 0; x < 120; x++) {
      const bucket = (view.head + 1 + x) % 120;
      const offset = bucket * CATEGORIES.length;
      let total = 0;
      for (let category = 0; category < CATEGORIES.length; category++) total += view.counts[offset + category];
      const bar = total > 0 ? (height - 2) * Math.log1p(total) / Math.log1p(max) : 0;
      let y = height;
      for (let category = 0; category < CATEGORIES.length; category++) {
        const count = view.counts[offset + category];
        if (!count) continue;
        const segment = bar * count / total;
        timelineContext.fillStyle = CATEGORY_HEX[CATEGORIES[category]];
        timelineContext.fillRect(x * column, y - segment, column - 1, segment);
        y -= segment;
      }
      if (view.coverage[bucket] !== 1) {
        // Hatch unknown history and partial buckets, even if counts were received.
        timelineContext.fillStyle = 'rgba(159,195,255,0.08)';
        timelineContext.fillRect(x * column, 0, column - 1, height);
        timelineContext.strokeStyle = 'rgba(159,195,255,0.4)';
        timelineContext.beginPath();
        for (let hatch = -height; hatch < height; hatch += 8) {
          timelineContext.moveTo(x * column, Math.max(0, hatch));
          timelineContext.lineTo(x * column + column - 1, Math.min(height, hatch + column));
        }
        timelineContext.stroke();
      }
    }
  }

  return renderTimeline;
}

export function createActivityStateRenderer({
  document, performance, timeline, invalidateObserved, resetThinking, clearImpulses,
  updateSubagentSummary, renderWaitingMarkers, workspaceUI, onState,
  $coverage, $journals, $sessions, $waiting, $unknown, $running, $status, $subtitle,
}) {
  function renderActivityState(state) {
    if (state.lifecycleInvalid) invalidateObserved();
    if (state.connection === 'recovering') {
      onState(state);
      timeline.setCoverage(false, performance.now());
      $coverage.textContent = 'CONNECTION GAP · showing last-known activity';
      document.body.classList.toggle('source-unknown', true);
      return;
    }
    if (state.connection !== 'connected' || state.sourceStatus === 'unavailable' ||
        !(state.runningSessions > 0)) resetThinking();
    if (state.connection !== 'connected') clearImpulses();
    if (state.sourceStatus === 'unavailable') clearImpulses();
    timeline.setCoverage(!document.hidden && state.connection === 'connected' &&
      state.sourceStatus === 'available' && state.coverage !== 'partial' &&
      state.coverage !== 'unknown', performance.now(), state.connection === 'connecting');
    onState(state);
    updateSubagentSummary(state.treeSessions ?? []);
    renderWaitingMarkers(state.connection === 'connected' && state.sourceStatus !== 'unavailable'
      ? state.waitingSessionIds : []);
    workspaceUI.update(state);
    $journals.textContent = String(state.journalFiles ?? 0);
    $sessions.textContent = String(state.activeSessions ?? 0);
    $waiting.textContent = String(state.connection === 'connected' && state.sourceStatus !== 'unavailable'
      ? state.waitingSessions ?? 0 : 0);
    $unknown.textContent = String(state.unknownSessions ?? 0);
    $running.textContent = state.unverifiedRunningSessions > 0
      ? `${state.runningSessions ?? 0} · ${state.unverifiedRunningSessions} UNVERIFIED`
      : String(state.runningSessions ?? 0);
    $coverage.textContent = state.connection !== 'connected'
      ? 'CONNECTION GAP · activity coverage unknown'
      : state.coverage === 'partial'
        ? `PARTIAL · ${state.backlogFiles ?? 0} journal files pending or unobserved · session coverage unknown`
        : 'Local Copilot event files · open-session coverage not verifiable';
    document.body.classList.toggle('has-activity', state.activeSessions > 0 || state.runningSessions > 0);
    document.body.classList.toggle('source-error', state.sourceStatus === 'unavailable' || state.sourceStatus === 'partial');
    document.body.classList.toggle('source-unknown', state.connection !== 'connected' || state.coverage === 'unknown');
    if (state.connection === 'connecting') {
      $status.textContent = 'CONNECTING';
      $subtitle.textContent = 'connecting to local activity files';
    } else if (state.connection === 'retrying' || state.connection === 'unknown') {
      $status.textContent = 'RECONNECTING · UNKNOWN';
      $subtitle.textContent = 'activity not verified during connection gap';
    } else if (state.connection === 'disconnected') {
      $status.textContent = 'DISCONNECTED';
      $subtitle.textContent = 'local activity stream is closed';
    } else if (state.sourceStatus === 'unavailable') {
      $status.textContent = 'SOURCE UNAVAILABLE';
      $subtitle.textContent = 'local Copilot event files are unavailable';
    } else if (state.sourceStatus === 'partial' || state.coverage === 'partial') {
      $status.textContent = 'COVERAGE PARTIAL';
      $subtitle.textContent = state.backlogFiles > 0
        ? 'journal scan is catching up · activity is not fully observed'
        : 'some local event files could not be read';
    } else if (state.runningSessions > 0 && state.unverifiedRunningSessions > 0) {
      $status.textContent = 'RUNNING · UNVERIFIED';
      $subtitle.textContent = 'running task silent over 45s · not verified · may linger if it ended without a recorded end';
    } else if (state.runningSessions > 0) {
      $status.textContent = 'RUNNING';
      $subtitle.textContent = 'observed running work · thinking, tools or delegated agents · coverage is not complete';
    } else if (state.activeSessions > 0) {
      $status.textContent = 'OBSERVED ACTIVITY';
      $subtitle.textContent = 'active intervals in local event files · coverage is not complete';
    } else {
      $status.textContent = 'QUIET · NOT VERIFIED IDLE';
      $subtitle.textContent = 'no observed active interval · other sessions may be unobserved';
    }
  }

  return renderActivityState;
}
