import { projectActivity } from './activity-client.mjs';
import { activityCategory, CATEGORIES, CATEGORY_INDEX } from './activity-colors.mjs';

const MAX_CATEGORY_TOTAL = 0xffffffff;

// Created once per page, independently of sessions, snapshots and frame drains.
// Only projected metadata reaches the fixed counters; no event records are kept.
export function createPageActivityTotals() {
  const counts = new Uint32Array(CATEGORIES.length);
  return {
    counts,
    add(value) {
      const activity = projectActivity(value);
      if (!activity) return;
      const index = CATEGORY_INDEX[activityCategory(activity)];
      counts[index] = Math.min(MAX_CATEGORY_TOTAL, counts[index] + (activity.count ?? 1));
    },
  };
}

function renderPageActivityTotals(document, totals) {
  const section = document.createElement('section');
  section.className = 'page-activity-stats';
  const label = 'Activity by category · since page load';
  section.setAttribute('aria-label', label);
  const heading = document.createElement('h3');
  heading.textContent = label;
  const note = document.createElement('p');
  note.textContent = `Page-wide received totals, not per session · visible live coverage only · hidden/coverage gaps excluded · no backfill. Counts saturate at ${MAX_CATEGORY_TOTAL}. Reload resets totals.`;
  const list = document.createElement('ul');
  for (const [index, category] of CATEGORIES.entries()) {
    const row = document.createElement('li');
    row.textContent = `${category}: ${totals.counts[index]}`;
    list.append(row);
  }
  section.append(heading, note, list);
  return section;
}

export function renderSessionStats(document, stats, formatElapsed) {
  const details = document.createElement('div');
  details.className = 'session-stats';
  const heading = document.createElement('p');
  heading.className = 'session-stats-heading';
  heading.textContent = 'since observed · live only';
  details.append(heading);

  const addLine = (label, value) => {
    const line = document.createElement('p');
    line.textContent = `${label}: ${value}`;
    details.append(line);
  };
  const formatTop = (entries, overflow, label) => {
    const values = entries.map(([identifier, count]) => `${identifier} (${count})`);
    if (overflow > 0) values.push(`other ${label} (${overflow})`);
    return values.length ? values.join(' · ') : 'None observed';
  };
  const kinds = Object.entries(stats.kinds).map(([kind, count]) => `${kind} ${count}`).join(' · ');
  addLine('Events by kind', kinds);
  addLine('Top event types', formatTop(stats.types, stats.otherTypes, 'types'));
  addLine('Top tools', formatTop(stats.tools, stats.otherTools, 'tools'));
  addLine('Subagents', `started ${stats.subagents.started} · completed ${stats.subagents.completed} · failed ${stats.subagents.failed}`);
  addLine('Errors', String(stats.errors));
  addLine('Running · unverified · waiting',
    `${formatElapsed(stats.runningMs)} · ${formatElapsed(stats.unverifiedMs)} · ${formatElapsed(stats.waitingMs)}`);
  const turns = stats.turns;
  addLine('Turns', turns.count
    ? `${turns.count} · last ${formatElapsed(turns.lastMs)} · median ${formatElapsed(turns.medianMs)} · max ${formatElapsed(turns.maxMs)}`
    : '0 · no durations observed');
  return details;
}

export function renderSessionRows({
  document,
  list,
  sessions,
  expandedSessionStats,
  receivedAt,
  formatElapsed,
  statusLabels,
}) {
  const activeElement = document.activeElement;
  const focusedSessionKey = activeElement?.matches?.('button[data-session-stats-toggle]')
    ? activeElement.dataset.sessionKey : null;
  list.replaceChildren();
  const sessionKeyCounts = new Map();
  const sessionKeys = sessions.map((session) => {
    const duplicateIndex = sessionKeyCounts.get(session.id) ?? 0;
    sessionKeyCounts.set(session.id, duplicateIndex + 1);
    return `${session.id}-${duplicateIndex}`;
  });
  const availableStats = new Set(sessions.flatMap((session, index) =>
    session.stats ? [sessionKeys[index]] : []));
  for (const key of expandedSessionStats) {
    if (!availableStats.has(key)) expandedSessionStats.delete(key);
  }

  const rows = [];
  for (const [index, session] of sessions.entries()) {
    const item = document.createElement('li');
    item.className = `session-row session-${session.status}`;
    const sessionKey = sessionKeys[index];
    const id = document.createElement('span');
    id.className = 'session-id';
    id.textContent = `◆ ${session.id}`;
    const status = document.createElement('span');
    status.className = 'session-status';
    status.textContent = statusLabels[session.status];
    const time = document.createElement('time');
    time.className = 'session-elapsed';
    time.textContent = formatElapsed(session.elapsedMs);
    if (session.stats) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'session-toggle';
      toggle.dataset.sessionStatsToggle = '';
      toggle.dataset.sessionKey = sessionKey;
      toggle.dataset.sessionId = session.id;
      toggle.dataset.sessionLabel = `Session ${session.id}, ${status.textContent}, elapsed ${time.textContent}`;
      toggle.setAttribute('aria-controls', 'session-stats-dialog');
      toggle.setAttribute('aria-haspopup', 'dialog');
      const expanded = expandedSessionStats.has(sessionKey);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${toggle.dataset.sessionLabel}; show statistics`);
      toggle.append(id, status, time);
      item.append(toggle);
    } else {
      const summary = document.createElement('div');
      summary.className = 'session-summary';
      summary.append(id, status, time);
      item.append(summary);
    }
    list.append(item);
    rows.push({ time, elapsedMs: session.elapsedMs, receivedAt });
  }
  if (focusedSessionKey) {
    const replacement = [...list.querySelectorAll('button[data-session-stats-toggle]')]
      .find((button) => button.dataset.sessionKey === focusedSessionKey);
    replacement?.focus({ preventScroll: true });
  }
  return rows;
}

export function createSessionStatsDialog({
  document, dialog, title, content, closeButton, list, fallbackFocus, formatElapsed, expandedSessionStats,
  pageActivityTotals = createPageActivityTotals(),
}) {
  let selectedId = null;
  let selectedKey = null;
  let selectedMatchCount = 0;
  let sessions = [];
  let activeSessions = [];
  let coverageKnown = false;

  const render = () => {
    if (!dialog.open) return;
    title.textContent = `Session ${selectedId} · statistics`;
    const activeMatches = activeSessions.filter(({ id }) => id === selectedId);
    const matches = sessions.filter(({ id }) => id === selectedId);
    const occurrence = Number(selectedKey?.split('-').at(-1));
    const session = activeMatches.length === selectedMatchCount
      ? activeMatches[occurrence]
      : selectedMatchCount === 1 && matches.length === 1 ? matches[0] : undefined;
    if (coverageKnown && session?.stats) {
      content.replaceChildren(renderSessionStats(document, session.stats, formatElapsed));
    } else {
      const message = document.createElement('p');
      message.className = 'session-stats';
      message.textContent = !coverageKnown ? 'COVERAGE UNKNOWN · live statistics unavailable'
        : 'Session no longer observed · live statistics unavailable';
      content.replaceChildren(message);
    }
    // Keep historical received totals distinct from unavailable live session stats.
    content.append(renderPageActivityTotals(document, pageActivityTotals));
  };

  const close = () => {
    if (dialog.open) dialog.close();
  };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  dialog.addEventListener('close', () => {
    // A queued close event must not clear a newly opened session.
    if (dialog.open) return;
    expandedSessionStats.clear();
    const buttons = [...list.querySelectorAll('button[data-session-stats-toggle]')];
    for (const button of buttons) button.setAttribute('aria-expanded', 'false');
    const opener = buttons.find((button) => button.dataset.sessionKey === selectedKey);
    (opener ?? (list.hidden ? fallbackFocus : list)).focus({ preventScroll: true });
    selectedId = null;
    selectedKey = null;
    content.replaceChildren();
  });

  return {
    refreshActivity: render,
    open(event) {
      const toggle = event.target.closest?.('button[data-session-stats-toggle]');
      if (!toggle || !list.contains(toggle) || !coverageKnown) return;
      const id = toggle.dataset.sessionId;
      const matches = activeSessions.filter((session) => session.id === id);
      const occurrence = Number(toggle.dataset.sessionKey?.split('-').at(-1));
      if (!matches[occurrence]?.stats) return;
      selectedId = id;
      selectedKey = toggle.dataset.sessionKey;
      selectedMatchCount = matches.length;
      expandedSessionStats.clear();
      expandedSessionStats.add(selectedKey);
      toggle.setAttribute('aria-expanded', 'true');
      if (!dialog.open) dialog.showModal();
      render();
    },
    update(nextSessions, known, nextActiveSessions = nextSessions) {
      sessions = nextSessions;
      activeSessions = nextActiveSessions;
      coverageKnown = known;
      if (dialog.open) expandedSessionStats.add(selectedKey);
      render();
    },
  };
}

export function clearSessionStats(list, expandedSessionStats) {
  list.replaceChildren();
  expandedSessionStats.clear();
}
