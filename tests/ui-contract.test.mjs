import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clearSessionStats, createSessionStatsDialog, renderSessionRows } from '../session-stats-ui.mjs';

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

test('blue computation, orange steps, and accepted completion remain visually separate', () => {
  assert.match(main, /nodeEnergy/);
  assert.match(main, /nodeHot/);
  assert.match(main, /if \(blue > 0\)/);
  assert.match(main, /if \(orange > 0\)/);
  assert.match(main, /if \(completions > 0\) celebrateCompletion\(\)/);
  assert.match(main, /if \(!document.hidden\) impulseBuffer.add\(activity\)/);
  assert.match(main, /state.connection !== 'connected'\) impulseBuffer.clear\(\)/);
  assert.match(main, /'visibilitychange', \(\) => \{\s+impulseBuffer.clear\(\)/);
  assert.match(main, /celebrateCompletion/);
  assert.match(main, /maxPulses: 1600/);
  assert.match(main, /shocks\.length >= 8/);
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
  assert.match(main, /0xff4fd8/);
  const markerRenderer = main.slice(main.indexOf('function renderWaitingMarkers'), main.indexOf('function renderSessions'));
  assert.doesNotMatch(markerRenderer, /fireFrom|spawnPulse|celebrateCompletion|impulseBuffer\.add/);
});
