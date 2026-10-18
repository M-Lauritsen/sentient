import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CATEGORIES, CATEGORY_HEX, CATEGORY_RGB, CATEGORY_INDEX } from '../activity-colors.mjs';
import { VISUAL } from '../visual-settings.mjs';
import { createCategoryBurstPlan, createImpulseBuffer } from '../activity-client.mjs';
import { clearSessionStats, createPageActivityTotals, createSessionStatsDialog, renderSessionRows } from '../session-stats-ui.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const statsUi = await readFile(new URL('../session-stats-ui.mjs', import.meta.url), 'utf8');

class TestElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this._textContent = '';
    this.hidden = false;
    this.listeners = new Map();
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  matches(selector) {
    return selector === 'button[data-session-stats-toggle]' &&
      this.tagName === 'BUTTON' && this.dataset.sessionStatsToggle !== undefined;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  contains(target) {
    return this === target || this.children.some((child) => child.contains(target));
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) =>
      [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.listeners.get('close')?.();
  }

  getBoundingClientRect() {
    return { left: 100, top: 100, right: 600, bottom: 500 };
  }
}

class TestDocument {
  constructor() {
    this.body = new TestElement('body', this);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }
}

function sessionStats(overrides = {}) {
  return {
    kinds: { thinking: 1, step: 2, completion: 0, activity: 3 },
    types: [['assistant.message', 2]],
    otherTypes: 0,
    tools: [['functions.view', 1]],
    otherTools: 0,
    subagents: { started: 1, completed: 0, failed: 0 },
    errors: 0,
    runningMs: 1234,
    unverifiedMs: 0,
    waitingMs: 0,
    turns: { count: 1, lastMs: 900, medianMs: 900, maxMs: 900 },
    ...overrides,
  };
}

test('page category totals use validated grouped metadata, fixed saturating counters, and reload-local state', () => {
  const totals = createPageActivityTotals();
  assert.equal(totals.counts.length, 11);
  assert.ok(totals.counts instanceof Uint32Array);
  const counts = totals.counts;
  const examples = [
    { kind: 'completion' },
    { kind: 'activity', eventType: 'session.error' },
    { kind: 'activity', eventType: 'permission.requested' },
    { kind: 'activity', eventType: 'subagent.started' },
    { kind: 'step', eventType: 'tool.execution_start', toolName: 'powershell' },
    { kind: 'step', eventType: 'tool.execution_start', toolName: 'edit' },
    { kind: 'step', eventType: 'tool.execution_start', toolName: 'view' },
    { kind: 'step' },
    { kind: 'thinking' },
    { kind: 'activity', eventType: 'session.start' },
    { kind: 'activity', eventType: 'unrecognized.event' },
  ];
  for (const [index, activity] of examples.entries()) {
    totals.add({ ...activity, count: index + 1, content: 'DO_NOT_RENDER', sessionId: 'DO_NOT_RENDER' });
  }
  assert.deepEqual([...counts], CATEGORIES.map((_, index) => index + 1));
  totals.add({ kind: 'activity', eventType: 'unrecognized.event' });
  assert.equal(counts[CATEGORY_INDEX.unknown], 12);
  for (const value of [null, {}, { kind: 'invalid' },
    { kind: 'activity' }, { kind: 'thinking', eventType: '<script>' },
    ...[0, -1, 1.5, Infinity, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1].map((count) => ({ kind: 'step', count }))]) {
    totals.add(value);
  }
  assert.deepEqual([...counts], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
  for (let i = 0; i < 5; i++) totals.add({ kind: 'step', count: 1_000_000_000 });
  totals.add({ kind: 'step', count: 10 });
  assert.equal(counts[CATEGORY_INDEX.tool], 0xffffffff, 'saturates instead of wrapping');
  assert.equal(totals.counts, counts, 'counter storage is reused');
  assert.deepEqual([...createPageActivityTotals().counts], Array(11).fill(0), 'new page state starts at zero');
  assert.doesNotMatch(statsUi, /localStorage|sessionStorage|indexedDB|innerHTML/);
});

test('page category accumulation runs on accepted arrival, not frame drain, and excludes hidden/coverage gaps', () => {
  const callback = main.match(/onActivity: \(activity\) => \{([\s\S]*?)\n  \},/)[1];
  const pageActivityTotals = createPageActivityTotals();
  let refreshes = 0;
  const context = vm.createContext({
    document: { hidden: false },
    activityState: { connection: 'connected', sourceStatus: 'available', coverage: 'journal-only' },
    impulseBuffer: { add() {} },
    pageActivityTotals,
    sessionStatsDialog: { refreshActivity() { refreshes++; } },
  });
  vm.runInContext(`function receive(activity) { ${callback} }`, context);
  vm.runInContext("receive({ kind: 'step', count: 37 })", context);
  assert.equal(pageActivityTotals.counts[CATEGORY_INDEX.tool], 37, 'counted before any animation frame');
  assert.equal(refreshes, 1);
  const accepted = context.activityState;
  for (const state of [
    { ...accepted, connection: 'retrying' },
    { ...accepted, connection: 'connecting' },
    { ...accepted, sourceStatus: 'unavailable' },
    { ...accepted, sourceStatus: 'partial', coverage: 'partial' },
    { ...accepted, coverage: 'partial' },
    { ...accepted, coverage: 'unknown' },
  ]) {
    context.activityState = state;
    vm.runInContext("receive({ kind: 'step', count: 100 })", context);
  }
  context.activityState = accepted;
  context.document.hidden = true;
  vm.runInContext("receive({ kind: 'step', count: 100 })", context);
  assert.equal(pageActivityTotals.counts[CATEGORY_INDEX.tool], 37);
  context.document.hidden = false;
  vm.runInContext("receive({ kind: 'step' })", context);
  assert.equal(pageActivityTotals.counts[CATEGORY_INDEX.tool], 38, 'resume adds only new arrivals, without backfill');
  assert.equal(refreshes, 2);
  const frame = main.slice(main.indexOf('function renderObservedImpulses()'), main.indexOf('function renderTimeline'));
  assert.doesNotMatch(frame, /pageActivityTotals/);
});

test('statistics dialog labels all page-wide categories separately from unchanged per-session stats', () => {
  const document = new TestDocument();
  const list = document.createElement('ol');
  const dialog = document.createElement('dialog');
  const content = document.createElement('div');
  const pageActivityTotals = createPageActivityTotals();
  const expandedSessionStats = new Set();
  const sessions = [{ id: 'K3F2QA', status: 'running', elapsedMs: 0, stats: sessionStats() }];
  const controller = createSessionStatsDialog({
    document, dialog, list, content, pageActivityTotals, expandedSessionStats,
    title: document.createElement('h2'), closeButton: document.createElement('button'),
    fallbackFocus: document.body, formatElapsed: String,
  });
  renderSessionRows({
    document, list, sessions, expandedSessionStats, receivedAt: 0,
    formatElapsed: String, statusLabels: { running: 'RUNNING' },
  });
  controller.update(sessions, true);
  controller.open({ target: list.querySelectorAll('button[data-session-stats-toggle]')[0] });
  const sessionText = content.children[0].textContent;
  const section = content.children[1];
  assert.equal(section.tagName, 'SECTION');
  assert.equal(section.getAttribute('aria-label'), 'Activity by category · since page load');
  assert.equal(section.children[0].tagName, 'H3');
  assert.match(section.textContent, /Page-wide/);
  assert.match(section.textContent, /gaps excluded/);
  assert.match(section.textContent, /no backfill/);
  assert.match(section.textContent, /4294967295/);
  const rows = section.children[2].children;
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((row) => row.textContent), CATEGORIES.map((category) => `${category}: 0`));
  pageActivityTotals.add({ kind: 'step', count: 17, content: '<script>private</script>', sessionId: 'private' });
  controller.refreshActivity();
  assert.match(content.children[1].textContent, /tool: 17/);
  assert.equal(content.children[0].textContent, sessionText, 'page totals do not modify per-session meanings');
  assert.doesNotMatch(content.children[1].textContent, /private|K3F2QA|assistant.message|functions.view/);
  controller.update([], false);
  assert.match(content.children[0].textContent, /COVERAGE UNKNOWN/);
  assert.match(content.children[1].textContent, /tool: 17/, 'previously received totals survive a disconnect');
  controller.update([], true);
  assert.match(content.children[0].textContent, /Session no longer observed/);
  assert.match(content.children[1].textContent, /tool: 17/);
  controller.update(sessions, true);
  assert.equal(content.children[0].textContent, sessionText);
  assert.match(content.children[1].textContent, /tool: 17/, 'snapshots do not add totals');
});

test('impulse titles follow observed events with a bottom fade and reduced-motion support', () => {
  assert.match(html, /id="impulse-feed"/);
  assert.match(html, /aria-label="Recent impulses"/);
  assert.match(main, /impulseFeed\.add\(kind, toolName, eventType, count\)/);
  assert.match(css, /mask-image: linear-gradient\(to bottom,/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('live UI has no fabricated/demo activity controls or external dependency URL', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /data-mode|Calm|Storm|click a node/i);
  assert.doesNotMatch(main, /THOUGHTS|stimulate\(|setTimeout\(|\.modes|integrating stimulus/);
  assert.match(main, /createActivityClient/);
  assert.match(main, /state\.activeSessions/);
  assert.match(main, /QUIET · NOT VERIFIED IDLE/);
  assert.match(html, /open-session coverage not verifiable/i);
});

test('category activity and accepted completion preserve ordinary motion and hidden-tab discard', () => {
  assert.match(main, /nodeEnergy/);
  assert.match(main, /nodeHot/);
  assert.match(main, /categoryBurstPlan\.plan\(sceneByCategory\)/);
  assert.match(main, /timeline\.add\(byCategory, performance\.now\(\)\)/);
  assert.match(main, /const pCat = new Uint8Array\(P\)/);
  assert.doesNotMatch(main, /celebrateCompletion|spawnShock|updateShocks|shockGeo|reactTimer|\bshake\b|rippleT/);
  assert.match(main, /if \(!document.hidden\) impulseBuffer.add\(activity\)/);
  assert.match(main, /state.connection !== 'connected'\) impulseBuffer.clear\(\)/);
  assert.match(main, /'visibilitychange', \(\) => \{\s+impulseBuffer.clear\(\)/);
  assert.match(main, /coreGlow\.material\.opacity = VISUAL\.scene\.coreOpacity \+ smoothedLoad \* VISUAL\.scene\.coreLoad/);
  assert.match(main, /bloom\.strength = VISUAL\.scene\.bloomStrength \+ smoothedLoad \* VISUAL\.scene\.bloomLoad/);
  assert.match(main, /floorMat\.uniforms\.uGlow\.value = smoothedLoad \* VISUAL\.scene\.floorGlow/);
  assert.match(main, /maxPulses: 1600/);
});

test('blue running stream follows observed running work and discloses unverified lingering', () => {
  assert.match(html, /RUNNING <b id="running">/);
  assert.match(main, /Math\.min\(activityState\.runningSessions \?\? 0, 32\)/);
  assert.match(main, /!\(state\.runningSessions > 0\)\) thinkingPulseClock\.reset\(\)/);
  assert.match(main, /RUNNING · UNVERIFIED/);
  assert.match(main, /may linger if it ended without a recorded end/);
  assert.match(main, /'visibilitychange'[\s\S]*thinkingPulseClock\.reset\(\)/);
});

test('orbit and zoom controls remain enabled while canvas interactions do not create activity', () => {
  assert.match(main, /new OrbitControls/);
  assert.match(main, /controls\.enablePan = false/);
  assert.match(main, /controls\.minDistance/);
  assert.match(main, /controls\.maxDistance/);
  assert.doesNotMatch(main, /pointerdown|pointerup|stimulate\(/);
});

test('subagent trees use bounded preallocated scene buffers and reset safely', () => {
  assert.match(main, /MAX_ACTIVE_SUBAGENT_BRANCHES = 512/);
  assert.match(main, /MAX_FADING_SUBAGENT_BRANCHES = 64/);
  assert.match(main, /new Float32Array\(MAX_ACTIVE_SUBAGENT_BRANCHES \* 6\)/);
  assert.match(main, /new Float32Array\(MAX_FADING_SUBAGENT_BRANCHES \* 6\)/);
  assert.match(main, /onTree: applySubagentTree/);
  assert.match(main, /if \(tree\.reset \|\| document\.hidden\)/);
  assert.match(main, /reducedMotionQuery\.addEventListener\('change'/);
  assert.match(main, /if \(!item\.subagents\.length\) continue;/);
  assert.match(main, /updateSubagentSummary\(tree\.sessions\)/);
  assert.match(main, /activityState\.coverage === 'partial'/);
  assert.match(main, /activityState\.connection !== 'connected'/);
  assert.match(html, /id="subagent-summary" role="status" aria-live="polite"/);
  assert.match(html, /Delegated work status unavailable until connected/);
  assert.match(css, /\.visually-hidden\s*\{[\s\S]*clip-path: inset\(50%\)/);
  const frame = main.slice(main.indexOf('function frame()'), main.indexOf("window.addEventListener('resize'"));
  assert.match(frame, /renderSubagentTree/);
  assert.doesNotMatch(frame, /new THREE\./);
});

test('session HUD matches the impulse field, shows only active sessions, and fails closed on gaps', () => {
  assert.match(html, /<aside[^>]+id="session-hud"[^>]+aria-label="Active sessions"/);
  assert.match(html, /id="session-list"/);
  assert.match(html, /id="session-list"[^>]*tabindex="0"/);
  assert.match(html, /id="session-state"/);
  assert.match(html, /id="session-more"/);
  assert.match(main, /function renderSessions\(state\)/);
  assert.match(main, /const hasHudProjection = Array\.isArray\(state\.hudSessions\)/);
  assert.match(main, /projectActiveHudSessions\(state\)/);
  assert.match(main, /projectActiveHudSessions/);
  assert.match(main, /state\.hudSessionsTruncated/);
  assert.match(main, /state\.waitingSessionIds/);
  assert.match(main, /No active sessions/);
  assert.match(main, /COVERAGE UNKNOWN/);
  assert.match(main, /RUNNING · UNVERIFIED/);
  assert.match(main, /textContent/);
  assert.match(main, /performance\.now\(\)/);
  assert.match(main, /hudTimer/);
  assert.match(css, /\.session-running/);
  assert.match(css, /\.session-running-unverified/);
  const sessionRenderer = main.slice(main.indexOf('function renderSessions'), main.indexOf('// ---------- interaction ----------'));
  assert.match(sessionRenderer, /renderSessionRows\(/);
  assert.ok(statsUi.indexOf('document.activeElement') < statsUi.indexOf('list.replaceChildren()'),
    'focused stats control is captured before the list is replaced');
  assert.match(sessionRenderer, /hasHudProjection\s*\?\s*state\.hudSessionsTruncated === true : state\.sessionsTruncated === true/);
  assert.match(css, /\.hud-impulses h2, \.hud-sessions h2/);
  assert.match(css, /\.hud-sessions\s*\{[^}]*right:\s*24px/);
  assert.match(css, /#session-list\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(css, /#session-list:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('session statistics use an accessible centered native dialog and text-only content', () => {
  assert.match(main, /renderSessionRows\(/);
  assert.match(main, /createSessionStatsDialog\(/);
  assert.match(main, /clearSessionStats\(/);
  assert.match(html, /<dialog[^>]*id="session-stats-dialog"[^>]*aria-labelledby="session-stats-title"/);
  assert.match(html, /id="session-stats-close"[^>]*aria-label="Close session statistics"/);
  assert.match(statsUi, /dialog\.showModal\(\)/);
  assert.match(statsUi, /setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(statsUi, /document\.createElement\('button'\)/);
  assert.match(statsUi, /setAttribute\('aria-expanded'/);
  assert.match(statsUi, /setAttribute\('aria-controls'/);
  assert.match(statsUi, /toggle\.type = 'button'/);
  assert.match(statsUi, /expandedSessionStats\.clear\(\)/);
  assert.match(statsUi, /since observed · live only/);
  assert.match(statsUi, /None observed/);
  assert.match(statsUi, /stats\.subagents/);
  assert.match(statsUi, /stats\.runningMs/);
  assert.match(statsUi, /turns\.medianMs/);
  assert.match(statsUi, /textContent/);
  assert.doesNotMatch(statsUi, /innerHTML/);
  assert.match(css, /\.session-toggle:focus-visible/);
  assert.match(css, /\.stats-dialog::backdrop/);
});

test('session stats open in an overlay, update live, clear on gaps, and restore the current row focus', () => {
  const document = new TestDocument();
  const list = document.createElement('ol');
  const dialog = document.createElement('dialog');
  const title = document.createElement('h2');
  const content = document.createElement('div');
  const closeButton = document.createElement('button');
  const fallbackFocus = document.createElement('b');
  const expanded = new Set();
  const controller = createSessionStatsDialog({
    document, dialog, title, content, closeButton, list, fallbackFocus,
    formatElapsed: (ms) => `${ms}ms`,
    expandedSessionStats: expanded,
  });
  const render = (stats = sessionStats()) => {
    const sessions = [{ id: 'K3F2QA', status: 'running', elapsedMs: 42, stats }];
    controller.update(sessions, true);
    return renderSessionRows({
    document,
    list,
    sessions,
    expandedSessionStats: expanded,
    receivedAt: 10,
    formatElapsed: (ms) => `${ms}ms`,
    statusLabels: { running: 'RUNNING' },
  });
  };

  render();
  let toggle = list.querySelectorAll('button[data-session-stats-toggle]')[0];
  assert.equal(toggle.type, 'button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'session-stats-dialog');
  assert.equal(toggle.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(list.children[0].children.length, 1, 'no inline details beneath the row');

  controller.open({ target: toggle.children[0] });
  assert.equal(dialog.open, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(title.textContent, /K3F2QA/);
  assert.match(content.textContent, /since observed · live only/);
  assert.match(content.textContent, /assistant\.message \(2\)/);
  assert.match(content.textContent, /functions\.view \(1\)/);
  assert.match(content.textContent, /started 1 · completed 0 · failed 0/);
  assert.match(content.textContent, /last 900ms · median 900ms · max 900ms/);
  closeButton.focus();
  const rows = render(sessionStats({ errors: 4 }));
  toggle = list.querySelectorAll('button[data-session-stats-toggle]')[0];
  assert.equal(document.activeElement, closeButton, 'snapshot updates do not steal focus from the modal');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(content.textContent, /Errors: 4/);
  assert.equal(rows[0].time.textContent, '42ms');

  controller.update([], false);
  assert.match(content.textContent, /COVERAGE UNKNOWN/);
  assert.doesNotMatch(content.textContent, /functions\.view/);
  assert.equal(dialog.open, true);
  render();
  closeButton.listeners.get('click')();
  assert.equal(dialog.open, false);
  assert.equal(content.children.length, 0);
  assert.equal(document.activeElement, list.querySelectorAll('button[data-session-stats-toggle]')[0]);
  assert.equal(expanded.size, 0);
  toggle = list.querySelectorAll('button[data-session-stats-toggle]')[0];
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  controller.open({ target: toggle });
  dialog.listeners.get('click')({ target: dialog, clientX: 200, clientY: 200 });
  assert.equal(dialog.open, true, 'clicking the dialog surface does not dismiss it');
  dialog.listeners.get('click')({ target: dialog, clientX: 10, clientY: 10 });
  assert.equal(dialog.open, false, 'a backdrop click dismisses the modal');
  controller.open({ target: toggle });
  controller.update([{ id: 'K3F2QA', status: 'idle', stats: sessionStats({ errors: 2 }) }], true);
  assert.match(content.textContent, /Errors: 2/, 'selected inactive sessions can still update');
  controller.update([], true);
  assert.match(content.textContent, /Session no longer observed/);
  clearSessionStats(list, expanded);
  assert.equal(list.children.length, 0);
  dialog.close();
  assert.equal(document.activeElement, list, 'removed openers fall back to the list');
  render();
  controller.open({ target: list.querySelectorAll('button[data-session-stats-toggle]')[0] });
  clearSessionStats(list, expanded);
  list.hidden = true;
  dialog.close();
  assert.equal(document.activeElement, fallbackFocus, 'an empty hidden list falls back to the source status');
  list.hidden = false;

  render(sessionStats({
    kinds: { thinking: 0, step: 0, completion: 0, activity: 0 },
    types: [], tools: [],
    turns: { count: 0, lastMs: 0, medianMs: 0, maxMs: 0 },
  }));
  controller.open({ target: list.querySelectorAll('button[data-session-stats-toggle]')[0] });
  assert.match(content.textContent, /thinking 0 · step 0 · completion 0 · activity 0/);
  assert.match(content.textContent, /None observed/);
  assert.match(content.textContent, /0 · no durations observed/);
  dialog.close();

  renderSessionRows({
    document,
    list,
    sessions: [{ id: 'K3F2QA', status: 'running', elapsedMs: 0 }],
    expandedSessionStats: expanded,
    receivedAt: 10,
    formatElapsed: (ms) => `${ms}ms`,
    statusLabels: { running: 'RUNNING' },
  });
  assert.equal(list.querySelectorAll('button[data-session-stats-toggle]').length, 0,
    'legacy rows without stats do not expose a details control');
});

test('stats modal distinguishes colliding opaque handles and fails closed when identity becomes ambiguous', () => {
  const document = new TestDocument();
  const list = document.createElement('ol');
  const dialog = document.createElement('dialog');
  const content = document.createElement('div');
  const expandedSessionStats = new Set();
  const sessions = [1, 7].map((errors) => ({
    id: 'K3F2QA', status: 'running', elapsedMs: 0, stats: sessionStats({ errors }),
  }));
  const controller = createSessionStatsDialog({
    document, dialog, list, content,
    title: document.createElement('h2'),
    closeButton: document.createElement('button'),
    fallbackFocus: document.body,
    formatElapsed: String,
    expandedSessionStats,
  });
  renderSessionRows({
    document, list, sessions, expandedSessionStats, receivedAt: 0,
    formatElapsed: String, statusLabels: { running: 'RUNNING' },
  });
  controller.update(sessions, true, sessions);
  controller.open({ target: list.querySelectorAll('button[data-session-stats-toggle]')[1] });
  assert.match(content.textContent, /Errors: 7/);
  assert.doesNotMatch(content.textContent, /Errors: 1/);
  controller.update(sessions, true, sessions.slice(0, 1));
  assert.match(content.textContent, /Session no longer observed/);
  assert.doesNotMatch(content.textContent, /Errors:/);
});

test('waiting counter and scene affordances stay bounded and activity-free', () => {
  assert.match(html, /WAITING <b id="waiting">0<\/b>/);
  assert.doesNotMatch(html, /notify-control|notify-toggle|notify-status|Notify when waiting/);
  assert.doesNotMatch(main, /Notification|createWaitNotifier|sentient\.notify/);
  assert.match(main, /function renderWaitingMarkers\(sessionIds\)/);
  assert.match(main, /sessionIds\.slice\(0, 8\)/);
  assert.match(main, /\$waiting\.textContent = String\(state\.connection === 'connected' && state\.sourceStatus !== 'unavailable'[\s\S]*?state\.waitingSessions \?\? 0 : 0\)/);
  assert.match(main, /activityState\.sourceStatus !== 'unavailable'\s*&&\s*activityState\.waitingSessions > 0/);
  assert.match(main, /const omitted = Math\.max\(0, \(state\.runningSessions \?\? visibleRunning\) - visibleRunning\)/);
  assert.match(main, /coreGlow\.material\.color\.lerpColors/);
  assert.match(main, /Math\.sin\(now \* 0\.7\)/);
  assert.match(main, /CATEGORY_HEX\.waiting/);
  const markerRenderer = main.slice(main.indexOf('function renderWaitingMarkers'), main.indexOf('function renderSessions'));
  assert.doesNotMatch(markerRenderer, /fireFrom|spawnPulse|celebrateCompletion|impulseBuffer\.add/);
});

function sceneFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const body = main.slice(start);
  const end = /\r?\n}\r?\n/.exec(body);
  assert.ok(end, `${name} has a top-level closing brace`);
  return body.slice(0, end.index + end[0].length);
}

test('pulse and RGB edge writers use category channels, preserve kind motion and reuse buffers', () => {
  const SCENE_RGB = Float32Array.from(CATEGORY_RGB, (channel) =>
    0.9 * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  assert.match(main, /const SCENE_RGB = Float32Array\.from\(CATEGORY_RGB/);
  const context = vm.createContext({
    Math, SCENE_RGB, CATEGORY_INDEX, VISUAL,
    P: 1, T: 2, E: 1,
    pActive: new Uint8Array([1]), pEdge: new Int32Array([0]),
    pFrom: new Int32Array([0]), pT: new Float32Array([0.5]),
    pKind: new Uint8Array([1]), pCat: new Uint8Array([CATEGORY_INDEX.edit]),
    nodePos: new Float32Array([0, 0, 0, 1, 2, 3]),
    pulsePos: new Float32Array(6), pulseCol: new Float32Array(6), pulseSize: new Float32Array(2),
    edgeR: new Float32Array(1), edgeG: new Float32Array(1), edgeBColor: new Float32Array(1),
    edgeBase: new Float32Array([1]), edgeColors: new Float32Array(6),
    edgeLen: [10], pSpeed: [1],
    otherEnd: () => 1,
    pulseGeo: { attributes: { position: {}, aColor: {}, aSize: {} } },
    edgeGeo: { attributes: { color: {} } },
  });
  vm.runInContext([sceneFunction('updatePulses'), sceneFunction('writePulseBuffers'),
    sceneFunction('writeEdgeColors')].join('\n'), context);
  const offset = CATEGORY_INDEX.edit * 3;
  for (let frame = 0; frame < 3600; frame++) {
    // Keep the pulse away from the endpoint to exercise the same buffers.
    context.pT[0] = 0.5;
    vm.runInContext('updatePulses(1 / 60); writePulseBuffers(); writeEdgeColors(1 / 60);', context);
  }
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(context.pulseCol[channel] - SCENE_RGB[offset + channel] * 1.6) < 1e-6);
    const base = [0.012, 0.04, 0.13][channel];
    assert.ok(Math.abs(context.edgeColors[channel] -
      (base + SCENE_RGB[offset + channel] * 0.45 * Math.exp(-2.4 / 60))) < 1e-6);
  }
  for (const name of ['fireFrom', 'updatePulses', 'writePulseBuffers', 'writeEdgeColors',
    'renderSubagentTree', 'renderCompletionCascade', 'renderObservedImpulses', 'renderTimeline']) {
    assert.doesNotMatch(sceneFunction(name), /new |\.filter\(|\.slice\(|\.map\(|\.sort\(|=>/,
      `${name} must not introduce per-frame constructors, array copies or callbacks`);
  }
  assert.match(main, /fireFrom\(to, hops - 1, kind, from, branch, pCat\[s\]\)/);
});

test('timeline is an accessible aggregate HUD canvas with throttled stacked rendering and gap hatching', () => {
  assert.match(html, /id="timeline"[^>]*aria-describedby="timeline-description timeline-state"/);
  assert.match(html, /last 10 min · observed live only/);
  assert.match(html, /aggregate · no session attribution/);
  assert.match(main, /timelineTimer = 0\.5/);
  assert.match(main, /timeline\.setCoverage/);
  assert.match(main, /timeline\.add\(byCategory,/);
  assert.match(main, /timelineContext\.fillRect/);
  assert.match(main, /timelineContext\.lineTo/);
  assert.match(main, /CATEGORY_HEX\[CATEGORIES\[category\]\]/);
  assert.match(css, /\.hud-timeline/);
  assert.match(main, /CATEGORY_INDEX\.subagent/);
  assert.match(main, /CATEGORY_INDEX\.error/);
});

for (const activity of [
  { kind: 'completion', eventType: 'session.task_complete', count: 3 },
  { kind: 'activity', eventType: 'session.idle', count: 3 },
]) {
test(`${activity.eventType} produces one network cascade per frame without explosion effects`, () => {
  const calls = [];
  const impulseBuffer = createImpulseBuffer();
  impulseBuffer.add(activity);
  const context = vm.createContext({
    CATEGORY_INDEX, VISUAL, document: { hidden: false }, performance: { now: () => 1 }, Math, N: 1,
    nodeEnergy: new Float32Array(1), nodeHot: new Float32Array(1),
    adjacency: [[0, 1, 2, 3, 4]],
    otherEnd: (edge) => edge + 1,
    impulseBuffer,
    timeline: { add() {} },
    categoryBurstPlan: createCategoryBurstPlan(),
    impulseIntensity: () => 1,
    impulseFeed: { add() {} },
    fireFrom: (...args) => calls.push(args),
  });
  vm.runInContext([sceneFunction('renderCompletionCascade'), sceneFunction('renderObservedImpulses')].join('\n'), context);
  vm.runInContext('renderObservedImpulses()', context);
  assert.equal(calls.length, 5, 'grouped completions share one central and four neighbouring seeds');
  assert.deepEqual(calls[0], [0, 7, 2, -1, 5, CATEGORY_INDEX.completion]);
  for (let i = 1; i < calls.length; i++) {
    assert.deepEqual(calls[i], [i, 5, 2, 0, 2, CATEGORY_INDEX.completion]);
  }
  assert.equal(context.nodeHot[0], 2.5, 'completion lights up its seed node');
  impulseBuffer.add(activity);
  context.document.hidden = true;
  vm.runInContext('renderObservedImpulses()', context);
  assert.equal(calls.length, 5, 'hidden frames produce no cascade');
  context.document.hidden = false;
  vm.runInContext('renderObservedImpulses()', context);
  assert.equal(calls.length, 5, 'discarded completion does not replay on return');
});
}

test('completion pulses branch and brighten lattice nodes, edges and trails', () => {
  const calls = [];
  const context = vm.createContext({
    Math: Object.assign(Object.create(Math), { random: () => 0.2 }),
    SCENE_RGB: CATEGORY_RGB, VISUAL, P: 1, T: 2,
    pActive: new Uint8Array([1]), pEdge: [0], pFrom: [0], pT: [0],
    pSpeed: [2], pHops: [7], pKind: [2], pCat: [CATEGORY_INDEX.completion],
    edgeLen: [1], edgeR: [0], edgeG: [0], edgeBColor: [0],
    nodeEnergy: [0, 0], activePulses: 1, otherEnd: () => 1,
    fireFrom: (...args) => calls.push(args),
    nodePos: [0, 0, 0, 1, 2, 3],
    pulsePos: new Float32Array(6), pulseCol: new Float32Array(6), pulseSize: new Float32Array(2),
    pulseGeo: { attributes: { position: {}, aColor: {}, aSize: {} } },
  });
  vm.runInContext([sceneFunction('updatePulses'), sceneFunction('writePulseBuffers')].join('\n'), context);
  vm.runInContext('updatePulses(0.5)', context);
  assert.deepEqual(calls, [[1, 6, 2, 0, 2, CATEGORY_INDEX.completion]]);
  assert.equal(context.nodeEnergy[1], 0.9);
  assert.equal(context.edgeR[0], CATEGORY_RGB[CATEGORY_INDEX.completion * 3]);
  context.pActive[0] = 1;
  context.pT[0] = 0.5;
  vm.runInContext('writePulseBuffers()', context);
  assert.ok(Math.abs(context.pulseSize[0] - 3.0) < 1e-6);
});

test('real completion spawning respects pool capacity, reuses slots and ends after bounded hops', () => {
  const P = 1600;
  const context = vm.createContext({
    Math: Object.assign(Object.create(Math), { random: () => 0.2 }),
    P, CATEGORY_INDEX, VISUAL, SCENE_RGB: CATEGORY_RGB,
    pCursor: 0, activePulses: 0,
    pActive: new Uint8Array(P), pEdge: new Int32Array(P), pFrom: new Int32Array(P),
    pT: new Float32Array(P), pSpeed: new Float32Array(P), pHops: new Uint8Array(P),
    pKind: new Uint8Array(P), pCat: new Uint8Array(P),
    edgeA: [0, 1, 2], edgeB: [1, 2, 0], edgeLen: [1, 1, 1],
    adjacency: [[0, 2], [0, 1], [1, 2]], fireEdges: new Int32Array(2),
    edgeR: new Float32Array(3), edgeG: new Float32Array(3), edgeBColor: new Float32Array(3),
    nodeEnergy: new Float32Array(3),
  });
  vm.runInContext(['otherEnd', 'spawnPulse', 'fireFrom', 'updatePulses']
    .map(sceneFunction).join('\n'), context);
  vm.runInContext(`for (let i = 0; i < P; i++) spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion)`, context);
  assert.equal(context.activePulses, P);
  assert.equal(vm.runInContext('spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion)', context), false);
  for (let step = 0; step < 40; step++) {
    vm.runInContext('updatePulses(0.1)', context);
    assert.ok(context.activePulses >= 0 && context.activePulses <= P);
    assert.equal(context.activePulses, context.pActive.reduce((sum, active) => sum + active, 0));
  }
  assert.equal(context.activePulses, 0, 'finite hops extinguish every branch');
  assert.equal(vm.runInContext('spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion)', context), true);
  assert.equal(context.activePulses, 1, 'exhausted pool slots can be reused');
});

test('real timeline drawing stacks category counts and overlays unknown coverage, never creating history', () => {
  const rectangles = [], lines = [];
  const counts = new Uint32Array(120 * CATEGORIES.length);
  counts[CATEGORY_INDEX.edit] = 3;
  counts[CATEGORY_INDEX.read] = 1;
  const coverage = new Uint8Array(120).fill(1);
  coverage[0] = 2;
  const canvasContext = {
    clearRect() {}, beginPath() {}, moveTo() {}, stroke() {},
    fillRect(...args) { rectangles.push([this.fillStyle, ...args]); },
    lineTo(...args) { lines.push(args); },
  };
  const context = vm.createContext({
    Math, CATEGORIES, CATEGORY_HEX, lastTimelineState: '',
    timeline: { read: () => ({ counts, coverage, head: 0, state: 'live' }) },
    timelineContext: canvasContext, timelineCanvas: { width: 960, height: 48 },
    timelineState: { textContent: '' }, timelineLabels: { live: 'Received activity' },
  });
  vm.runInContext(sceneFunction('renderTimeline'), context);
  vm.runInContext('renderTimeline(5000)', context);
  const edit = rectangles.find(([color]) => color === CATEGORY_HEX.edit);
  const read = rectangles.find(([color]) => color === CATEGORY_HEX.read);
  assert.equal(edit[1], 119 * 8, 'newest bucket is at the right');
  assert.equal(edit[4] / read[4], 3);
  assert.ok(Math.abs(edit[4] + read[4] - 46) < 1e-6);
  assert.ok(lines.length > 0, 'partial coverage is hatched, even with observed counts');
  assert.equal(context.timelineState.textContent, 'Received activity');
});
