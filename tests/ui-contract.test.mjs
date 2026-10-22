import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { CATEGORIES, CATEGORY_HEX, CATEGORY_RGB, CATEGORY_INDEX, HOOK_TYPES } from '../activity/activity-colors.mjs';
import { VISUAL } from '../visual-settings.mjs';
import { createCategoryBurstPlan, createImpulseBuffer } from '../activity/activity-client.mjs';
import { clearSessionStats, createPageActivityTotals, createSessionStatsDialog, createTimelineDialog, renderSessionRows } from '../ui/session-stats-ui.mjs';
import { createVisualSettingsPanel } from '../appearance/visual-settings-ui.mjs';
import { resolveVisualSettings } from '../appearance/visual-config.mjs';
import { createSceneContext, sceneFunction } from './scene-test-context.mjs';
import { recordObservedActivity } from '../ui/hud-ui.mjs';
import * as THREE from 'three';
import { createPulseSystem } from '../scene/pulses.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const sourceFiles = ['main.js', 'scene/structural-config.mjs', 'scene/network-renderer.mjs',
  'scene/pulses.mjs', 'scene/subagents.mjs', 'scene/ambience.mjs', 'scene/viewport.mjs',
  'activity/activity-presentation.mjs', 'ui/hud-ui.mjs', 'scene/appearance.mjs'];
const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, (await readFile(new URL('../' + file, import.meta.url), 'utf8')).replace(/^  /gm, '')])));
const main = Object.values(sources).join('\n');

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const statsUi = await readFile(new URL('../ui/session-stats-ui.mjs', import.meta.url), 'utf8');
const workspaceUi = await readFile(new URL('../workspace/workspace-ui.mjs', import.meta.url), 'utf8');
const navigationUi = await readFile(new URL('../ui/navigation-ui.mjs', import.meta.url), 'utf8');
const visualSettingsUi = await readFile(new URL('../appearance/visual-settings-ui.mjs', import.meta.url), 'utf8');

test('Appearance search visibly filters settings and empty groups, then restores them on clear', () => {
  const dom = new JSDOM(html);
  const { document, Event, getComputedStyle } = dom.window;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const ids = {
    opener: 'open', dialog: 'dialog', form: 'form', presetSelect: 'preset',
    fields: 'fields', quickFields: 'quick', searchInput: 'search',
    searchStatus: 'search-status', clearSearchButton: 'search-clear', title: 'title',
    status: 'status', errorSummary: 'errors', conflict: 'conflict',
    useFileButton: 'use-file', keepPreviewButton: 'keep-preview', closeButton: 'close',
    resetButton: 'reset', exportButton: 'export', reloadButton: 'reload',
    autoReloadInput: 'auto-reload', presetNameInput: 'preset-name',
    saveAsPresetButton: 'preset-save-as', savePresetButton: 'preset-save',
    deletePresetButton: 'preset-delete',
  };
  const elements = Object.fromEntries(Object.entries(ids).map(([key, suffix]) =>
    [key, document.getElementById(`visual-settings-${suffix}`)]));
  const resolved = resolveVisualSettings(VISUAL, 'balanced');
  createVisualSettingsPanel({
    document,
    ...elements,
    initialConfiguration: {
      defaults: VISUAL, preset: 'balanced', overrides: {}, settings: resolved.settings,
    },
    getStorage: () => ({ getItem: () => null }),
    applySettings() {},
  });
  elements.dialog.setAttribute('open', '');
  const fields = [...elements.fields.querySelectorAll('[data-setting-path]')];
  const groups = [...elements.fields.querySelectorAll('.visual-settings-section-row')];
  const sections = groups.map((group) => group.querySelector('details'));
  const originalOpen = sections.map((section, index) => {
    section.open = index % 2 === 1;
    return section.open;
  });
  const search = (value) => {
    elements.searchInput.value = value;
    elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const hasDisplay = (element) => getComputedStyle(element).display !== 'none';
  try {
    search('  HeAt  ');
    const hotColor = fields.find((field) => field.dataset.settingPath === 'nodes.hotColor');
    const fov = fields.find((field) => field.dataset.settingPath === 'camera.fov');
    assert.equal(hasDisplay(hotColor), true, 'related controls remain visible');
    assert.equal(hasDisplay(fov), false, 'CSS must not override hidden nonmatching grid rows');
    for (const field of fields.filter(hasDisplay)) {
      assert.match(field.textContent, /heat/i, 'only heat-related controls are shown');
    }
    for (const group of groups) {
      const hasMatches = [...group.querySelectorAll('[data-setting-path]')]
        .some((field) => !field.hidden);
      assert.equal(hasDisplay(group), hasMatches, 'empty sections and their reset buttons disappear');
      if (hasMatches) assert.equal(group.querySelector('details').open, true);
    }
    assert.equal(hasDisplay(elements.quickFields), false, 'Quick duplicates do not clutter results');
    assert.match(elements.searchStatus.textContent, /\d+ settings found/);
    assert.equal(hasDisplay(elements.clearSearchButton), true);

    search('no-such-appearance-setting');
    assert.ok(fields.every((field) => !hasDisplay(field)));
    assert.ok(groups.every((group) => !hasDisplay(group)));
    assert.equal(hasDisplay(elements.quickFields), false);
    assert.match(elements.searchStatus.textContent, /No settings match/);

    elements.clearSearchButton.click();
    assert.ok(fields.every(hasDisplay), 'clearing restores all controls');
    assert.ok(groups.every(hasDisplay), 'clearing restores all sections');
    assert.equal(hasDisplay(elements.quickFields), true);
    assert.equal(hasDisplay(elements.clearSearchButton), false);
    assert.deepEqual(sections.map((section) => section.open), originalOpen,
      'clearing restores every section to its original expansion state');
    assert.equal(document.activeElement, elements.searchInput);

    search('heat');
    search('   ');
    assert.ok(fields.every(hasDisplay), 'deleting the query also restores controls');
    assert.ok(groups.every(hasDisplay));
    assert.equal(hasDisplay(elements.quickFields), true);
    assert.deepEqual(sections.map((section) => section.open), originalOpen);
  } finally {
    dom.window.close();
  }
});

test('Appearance scrolls its header and preset controls while save actions stay in the footer', () => {
  const document = new JSDOM(html).window.document;
  const form = document.querySelector('#visual-settings-form');
  const scroll = form.querySelector('.visual-settings-scroll');
  const footer = form.querySelector('.visual-settings-actions');
  for (const selector of ['.stats-dialog-header', '#visual-settings-preset',
    '#visual-settings-preset-name', '#visual-settings-quick', '#visual-settings-fields']) {
    assert.ok(scroll.contains(form.querySelector(selector)), `${selector} scrolls with content`);
  }
  for (const id of ['visual-settings-preset-save-as', 'visual-settings-preset-save',
    'visual-settings-export', 'visual-settings-reset']) {
    const button = document.getElementById(id);
    assert.ok(footer.contains(button), `${id} remains in footer`);
    assert.equal(button.type, 'button');
    assert.equal(document.querySelectorAll(`#${id}`).length, 1);
  }
  assert.equal(scroll.contains(footer), false);
  assert.equal(footer.parentElement, form);
});

test('source recovery retains the header, running indicators and workspace while marking coverage unknown', () => {
  const context = {
    thinkingPulseClock: { reset() {} },
    impulseBuffer: { clear() {} },
    timeline: { setCoverage(covered) { context.covered = covered; } },
    document: { hidden: false, body: { classList: { toggle() {} } } },
    performance: { now: () => 0 },
    updateSubagentSummary() {},
    renderWaitingMarkers(ids) { context.waitingIds = ids; },
    workspaceUI: { update(state) { context.workspaceState = state; } },
    activityState: null,
  };
  for (const name of ['$journals', '$sessions', '$waiting', '$unknown', '$running',
    '$coverage', '$status', '$subtitle']) context[name] = { textContent: '' };
  createSceneContext(context);
  vm.runInContext(sceneFunction('renderActivityState'), context);
  const connected = { connection: 'connected', sourceStatus: 'available', coverage: 'journal-only',
    activeSessions: 1, runningSessions: 1, waitingSessions: 0, waitingSessionIds: [] };
  context.renderActivityState(connected);
  assert.equal(context.$status.textContent, 'RUNNING');
  const subtitle = context.$subtitle.textContent;
  context.renderActivityState({ ...connected, connection: 'recovering', coverage: 'unknown' });
  assert.equal(context.$status.textContent, 'RUNNING');
  assert.equal(context.$subtitle.textContent, subtitle);
  assert.equal(context.covered, false);
  assert.equal(context.$running.textContent, '1');
  assert.equal(context.workspaceState, connected, 'the workspace is not cleared during the grace period');
  assert.equal(context.activityState.connection, 'recovering');
  assert.match(context.$coverage.textContent, /CONNECTION GAP/);
  assert.equal(context.waitingIds.length, 0);
  context.renderActivityState({ ...connected, connection: 'retrying', coverage: 'unknown',
    activeSessions: 0, runningSessions: 0 });
  assert.equal(context.$status.textContent, 'RECONNECTING · UNKNOWN');
  assert.equal(context.$running.textContent, '0');
  context.renderActivityState(connected);
  assert.equal(context.$status.textContent, 'RUNNING');
  context.P = 3;
  context.T = 2;
  context.pActive = new Uint8Array([1, 1, 1]);
  context.pDemo = new Uint8Array([0, 1, 0]);
  context.activePulses = 3;
  context.pulseSize = new Float32Array(6).fill(1);
  context.renderActivityState({ connection: 'unknown', lifecycleInvalid: true, coverage: 'unknown',
    activeSessions: 0, runningSessions: 0, sessions: [], treeSessions: [] });
  assert.deepEqual([...context.pActive], [0, 1, 0], 'lifecycle loss removes observed motion but not Appearance demo');
  assert.equal(context.activePulses, 1);
  assert.deepEqual([...context.pulseSize], [0, 0, 1, 1, 0, 0]);
  assert.equal(context.$running.textContent, '0');
  assert.equal(context.covered, false);
});

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
      if (child.parentElement) {
        const siblings = child.parentElement.children;
        siblings.splice(siblings.indexOf(child), 1);
      }
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
  const pageActivityTotals = createPageActivityTotals();
  let refreshes = 0;
  const context = createSceneContext({
    document: { hidden: false },
    activityState: { connection: 'connected', sourceStatus: 'available', coverage: 'journal-only' },
    impulseBuffer: { add() {} },
    pageActivityTotals,
    sessionStatsDialog: { refreshActivity() { refreshes++; } },
    workspaceUI: { refresh() {} },
  });
  context.acceptActivity = activity => recordObservedActivity(activity, context.document,
    context.activityState, pageActivityTotals, context.sessionStatsDialog, context.workspaceUI);
  vm.runInContext("function receive(activity) { return invokeScene('receiveActivity', [activity]); }", context);
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
  assert.match(workspaceUi, /element\(document, 'li', `impulse-entry/);
  assert.match(html, /data-workspace-dock="left"/);
  assert.match(main, /impulseFeed\.add\(kind, toolName, eventType, count\)/);
  assert.match(css, /\.workspace-feed,\s*\.workspace-session-list/);
  assert.match(css, /mask-image: linear-gradient\(to bottom,/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('page identity is SENTIENT OS in the browser title and visible heading', () => {
  assert.match(html, /<title>SENTIENT OS<\/title>/);
  assert.match(html, /<h1 class="title">SENTIENT OS<\/h1>/);
});

test('personal visual preset controls are labelled, wired, and storage is disclosed', () => {
  assert.match(html, /aria-label="Personal appearance presets"/);
  assert.match(html, /id="visual-settings-preset-name"/);
  assert.match(html, /id="visual-settings-preset-save-as"/);
  assert.match(html, /id="visual-settings-preset-save"/);
  assert.match(html, /id="visual-settings-preset-delete"/);
  assert.match(main, /saveAsPresetButton: document\.getElementById\('visual-settings-preset-save-as'\)/);
  assert.match(main, /savePresetButton: document\.getElementById\('visual-settings-preset-save'\)/);
  assert.match(main, /deletePresetButton: document\.getElementById\('visual-settings-preset-delete'\)/);
  assert.match(html, /stored in this browser/);
});

test('Appearance is a searchable nonmodal drawer and suspends Workspace interaction', () => {
  assert.match(html, /aria-controls="visual-settings-dialog"/);
  assert.match(html, /aria-label="Quick appearance controls"/);
  assert.match(html, /aria-label="Advanced appearance settings"/);
  assert.match(html, /aria-live="polite"[\s\S]*visual-settings-search-status/);
  assert.match(html, /id="visual-settings-search-clear"/);
  assert.match(html, /<summary>File actions<\/summary>/);
  assert.match(visualSettingsUi, /dialog\.show\(\)/);
  assert.doesNotMatch(visualSettingsUi, /dialog\.showModal\(\)/);
  assert.match(visualSettingsUi, /opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /\.visual-settings-dialog\s*\{[^}]*inset:\s*0 0 0 auto/s);
  assert.match(css, /\.visual-settings-dialog\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.visual-settings-dialog\[open\]\s*\{\s*display:\s*flex/);
  assert.match(css, /\.visual-settings-dialog::backdrop\s*\{\s*background:\s*transparent/);
  assert.match(main, /workspaceUI\.setAppearanceOpen\(open\)/);
  assert.match(workspaceUi, /root\.toggleAttribute\('inert', appearanceOpen\)/);
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
  assert.match(main, /state.connection !== 'connected'\) clearImpulses\(\)/);
  assert.match(main, /'visibilitychange', \(\) => \{\s+impulseBuffer.clear\(\)/);
  assert.match(main, /coreGlow\.material\.opacity = VISUAL\.scene\.coreOpacity \+ smoothedLoad \* VISUAL\.scene\.coreLoad/);
  assert.match(main, /bloom\.strength = VISUAL\.scene\.bloomStrength \+ smoothedLoad \* VISUAL\.scene\.bloomLoad/);
  assert.match(main, /floorMat\.uniforms\.uGlow\.value = smoothedLoad \* VISUAL\.scene\.floorGlow/);
  assert.match(main, /maxPulses: 1600/);
});

test('blue running stream follows observed running work and discloses unverified lingering', () => {
  assert.match(html, /RUNNING\s+<b\s+id="running">/);
  assert.match(main, /Math\.min\(activityState\.runningSessions \?\? 0, VISUAL\.running\.maxSessions\)/);
  assert.match(main, /!\(state\.runningSessions > 0\)\) resetThinking\(\)/);
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
  assert.match(main, /onTree: subagents\.applySubagentTree/);
  assert.match(main, /if \(tree\.reset \|\| document\.hidden\)/);
  assert.match(main, /reducedMotionQuery\.addEventListener\('change'/);
  assert.match(main, /if \(!item\.subagents\.length\) continue;/);
  assert.match(main, /updateSubagentSummary\(tree\.sessions\)/);
  assert.match(main, /activityState\.coverage === 'partial'/);
  assert.match(main, /activityState\.connection !== 'connected'/);
  assert.match(html, /id="subagent-summary"\s+role="status"\s+aria-live="polite"/);
  assert.match(html, /Delegated work status unavailable until connected/);
  assert.match(css, /\.visually-hidden\s*\{[\s\S]*clip-path: inset\(50%\)/);
  const frame = sources['main.js'].split('function frame()')[1].split('createVisualSettingsPanel({')[0];
  assert.match(frame, /renderSubagentTree/);
  assert.doesNotMatch(frame, /new THREE\./);
});

test('workspace modules keep session visibility separate from bounded source state', () => {
  assert.match(html, /data-workspace-dock="left"/);
  assert.match(html, /data-workspace-dock="right"/);
  assert.match(html, /data-workspace-dock="bottom"/);
  assert.match(html, /data-workspace-dock="bottom-left"/);
  assert.match(main, /workspaceUI\.update\(state\)/);
  assert.match(workspaceUi, /projectActiveHudSessions\(activityState\)/);
  assert.match(workspaceUi, /COVERAGE UNKNOWN · ACTIVITY VIEW UNKNOWN/);
  assert.match(workspaceUi, /Session statuses and elapsed time · coverage/);
  assert.doesNotMatch(workspaceUi, /No matching sessions|Additional sessions not shown|workspace-session-more/);
  assert.match(workspaceUi, /instance\.config\.filter === 'waiting'/);
  assert.match(workspaceUi, /SESSION_LABELS/);
  assert.match(workspaceUi, /sessionStatsDialog\?\.registerList/);
  assert.doesNotMatch(workspaceUi, /localStorage|innerHTML/);
  assert.match(css, /\.session-running/);
  assert.match(css, /\.session-running-unverified/);
  assert.ok(statsUi.indexOf('document.activeElement') < statsUi.indexOf('list.replaceChildren()'),
    'focused stats control is captured before the list is replaced');
  assert.match(css, /\.workspace-session-list\s*\{/);
  assert.match(css, /\.workspace-dock-right/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('application menu replaces top launchers and preserves the existing destination controls', () => {
  const menu = html.match(/<nav\s+id="application-navigation"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(menu);
  assert.match(menu, /id="application-menu-toggle"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(menu, /role="menu"[^>]*hidden/);
  for (const [id, label] of [
    ['library-open', 'Library'],
    ['visual-settings-open', 'Appearance'],
    ['workspace-open', 'Workspace'],
    ['help-open', 'Help'],
  ]) {
    assert.match(menu, new RegExp(`id="${id}"[^>]*role="menuitem"`));
    assert.match(menu, new RegExp(`>\\s*${label}\\s*<`));
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
  }
  const sourceHeader = html.match(/<header class="hud hud-top"[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(sourceHeader);
  assert.doesNotMatch(sourceHeader, /library-open|workspace-open|visual-settings-open/);
  assert.match(html, /id="help-dialog"[^>]*aria-labelledby="help-title"/);
  assert.match(navigationUi, /event\.key === 'ArrowDown'/);
  assert.match(navigationUi, /event\.key === 'Escape'/);
  assert.match(main, /createNavigationUI\(\{ document \}\)/);
  assert.match(css, /\.application-menu\s*\{[\s\S]*bottom: calc\(100% \+ 8px\)/);
  assert.match(css, /\.application-navigation\s*\{[\s\S]*right: 24px;[\s\S]*bottom: 22px/);
});

test('session statistics use an accessible centered native dialog and text-only content', () => {
  assert.match(workspaceUi, /renderSessionRows\(/);
  assert.match(main, /createSessionStatsDialog\(/);
  assert.match(workspaceUi, /clearSessionStats\(/);
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

test('session stats open from waiting and ended rows outside the active-session projection', () => {
  const document = new TestDocument();
  const list = document.createElement('ol');
  const dialog = document.createElement('dialog');
  const content = document.createElement('div');
  const expanded = new Set();
  const sessions = [
    { id: 'K3F2QA', status: 'waiting', elapsedMs: 42, stats: sessionStats({ errors: 2 }) },
    { id: 'T4M7QA', status: 'ended', elapsedMs: 84, stats: sessionStats({ errors: 3 }) },
  ];
  const controller = createSessionStatsDialog({
    document, dialog, content,
    title: document.createElement('h2'),
    closeButton: document.createElement('button'),
    fallbackFocus: document.body,
    list,
    expandedSessionStats: expanded,
    formatElapsed: String,
  });
  const showRows = () => renderSessionRows({
    document,
    list,
    sessions,
    expandedSessionStats: expanded,
    receivedAt: 0,
    formatElapsed: String,
    statusLabels: { waiting: 'WAITING', ended: 'ENDED' },
  });
  controller.update(sessions, true, []);
  showRows();
  for (const [index, errors] of [[0, 2], [1, 3]]) {
    const toggle = list.querySelectorAll('button[data-session-stats-toggle]')[index];
    controller.open({ target: toggle });
    assert.equal(dialog.open, true);
    assert.match(content.textContent, new RegExp(`Errors: ${errors}`));
    dialog.close();
    showRows();
  }
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
  assert.match(html, /WAITING\s+<b\s+id="waiting">0<\/b>/);
  assert.doesNotMatch(html, /notify-control|notify-toggle|notify-status|Notify when waiting/);
  assert.doesNotMatch(main, /Notification|createWaitNotifier|sentient\.notify/);
  assert.match(main, /function renderWaitingMarkers\(sessionIds\)/);
  assert.match(main, /sessionIds\.slice\(0, 8\)/);
  assert.match(main, /\$waiting\.textContent = String\(state\.connection === 'connected' && state\.sourceStatus !== 'unavailable'[\s\S]*?state\.waitingSessions \?\? 0 : 0\)/);
  assert.match(main, /activityState\.sourceStatus !== 'unavailable'\s*&&\s*activityState\.waitingSessions > 0/);
  assert.match(main, /coreGlow\.material\.color\.lerpColors/);
  assert.match(main, /Math\.sin\(now \* VISUAL\.waiting\.breathSpeed\)/);
  assert.match(main, /CATEGORY_HEX\.waiting/);
  const markerRenderer = sources['scene/ambience.mjs'].split('function renderWaitingMarkers')[1].split('let smoothedLoad')[0];
  assert.doesNotMatch(markerRenderer, /fireFrom|spawnPulse|celebrateCompletion|impulseBuffer\.add/);
});


test('pulse and RGB edge writers use category channels, preserve kind motion and reuse buffers', () => {
  const SCENE_RGB = Float32Array.from(CATEGORY_RGB, (channel) =>
    0.9 * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  assert.match(main, /const SCENE_RGB = createScenePalette\(VISUAL\)/);
  const context = createSceneContext({
    Math, SCENE_RGB, CATEGORY_INDEX, VISUAL,
    P: 1, T: 2, E: 1,
    pActive: new Uint8Array([1]), pEdge: new Int32Array([0]),
    pFrom: new Int32Array([0]), pT: new Float32Array([0.5]),
    pKind: new Uint8Array([1]), pCat: new Uint8Array([CATEGORY_INDEX.edit]),
    nodePos: new Float32Array([0, 0, 0, 1, 2, 3]),
    pulsePos: new Float32Array(6), pulseCol: new Float32Array(6), pulseSize: new Float32Array(2),
    edgeR: new Float32Array(1), edgeG: new Float32Array(1), edgeBColor: new Float32Array(1),
    edgeBase: new Float32Array([1]), edgeColors: new Float32Array(6),
    edgeLen: [10], edgeA: [0], edgeB: [1], pSpeed: [1],
    otherEnd: () => 1,
    pulseGeo: { attributes: { position: {}, aColor: {}, aSize: {} } },
    edgeGeo: { attributes: { color: {} } },
    edgeLines: { visible: true },
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
    'renderSubagentTree', 'renderCompletionCascade', 'renderObservedImpulses', 'renderTimeline',
    'renderDemoActivity', 'observedWaitingIds', 'updateSceneFraming']) {
    assert.doesNotMatch(main.split('function ' + name + '(')[1].split('\n}\n')[0], /new |\.filter\(|\.slice\(|\.map\(|\.sort\(|=>/,
      `${name} must not introduce per-frame constructors, array copies or callbacks`);
  }
  assert.match(main, /fireFrom\(to, hops - 1, kind, from, branch, pCat\[s\]\)/);
});

test('timeline enlargement reuses live content and restores compact rendering and focus on close', () => {
  const document = new TestDocument();
  const preview = document.createElement('aside');
  const content = document.createElement('div');
  const state = document.createElement('p');
  const canvas = document.createElement('canvas');
  canvas.height = 48;
  content.append(canvas, state);
  preview.append(content);
  const dialog = document.createElement('dialog');
  const dialogContent = document.createElement('div');
  dialog.append(dialogContent);
  const opener = document.createElement('button');
  const closeButton = document.createElement('button');
  const renders = [];
  createTimelineDialog({
    preview, content, canvas, dialog, dialogContent, opener, closeButton,
    redraw: () => renders.push(canvas.height),
  });
  const open = () => opener.listeners.get('click')();
  open();
  assert.equal(dialog.open, true);
  assert.equal(dialogContent.children[0], content);
  assert.equal(preview.contains(canvas), false);
  assert.equal(canvas.height, 160);
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  state.textContent = 'Coverage gap · missing activity is unknown, not zero';
  assert.equal(dialogContent.textContent, state.textContent);
  open();
  assert.deepEqual(renders, [160], 'repeated activation must not reset the canvas');
  dialog.listeners.get('click')({ target: dialog, clientX: 200, clientY: 200 });
  assert.equal(dialog.open, true, 'clicking dialog padding must not dismiss it');
  closeButton.listeners.get('click')();
  assert.equal(dialog.open, false);
  assert.equal(preview.children[0], content);
  assert.equal(dialogContent.contains(canvas), false);
  assert.equal(canvas.height, 48);
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, opener);
  assert.equal(state.textContent, 'Coverage gap · missing activity is unknown, not zero');
  open();
  dialog.close(); // Native Escape dismisses the dialog through the same close event.
  assert.equal(content.parentElement, preview);
  open();
  dialog.listeners.get('click')({ target: dialog, clientX: 0, clientY: 0 });
  assert.equal(dialog.open, false);
  assert.equal(content.parentElement, preview);
  assert.deepEqual(renders, [160, 48, 160, 48, 160, 48]);
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
  const context = createSceneContext({
    CATEGORY_INDEX, HOOK_TYPES, CATEGORIES, VISUAL, document: { hidden: false }, performance: { now: () => 1 }, Math, N: 1,
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
  vm.runInContext([sceneFunction('renderCompletionCascade'), sceneFunction('renderHookPulses'),
    sceneFunction('renderObservedImpulses')].join('\n'), context);
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
  for (const [kind, category, effect, head] of [
    [2, CATEGORY_INDEX.completion, VISUAL.completion, VISUAL.pulses.completionHead],
    [3, CATEGORY_INDEX.subagent, VISUAL.impact, VISUAL.impact.head],
  ]) {
    const network = {
      edgeA: [0, 1, 1], edgeB: [1, 2, 3], edgeLen: [1, 100, 100],
      adjacency: [[0], [0, 1, 2], [1], [2]], fireEdges: new Int32Array(3),
      edgeR: [0, 0, 0], edgeG: [0, 0, 0], edgeBColor: [0, 0, 0],
      nodeEnergy: [0, 0, 0, 0], nodePos: [0, 0, 0, 1, 2, 3, 2, 3, 4, 3, 4, 5],
    };
    const pulses = createPulseSystem({
      VISUAL, CFG: { maxPulses: 4, trail: 2, radius: 10 }, SCENE_RGB: CATEGORY_RGB,
      brain: new THREE.Group(), pixelRatio: 1, getNetwork: () => network, random: () => 0.2,
    });
    pulses.spawnPulse(0, 0, 7, kind, category);
    pulses.updatePulses(0.5);
    const { pActive, pFrom, pHops, pKind, pCat, pT, pulseSize } = pulses.buffers;
    const slots = [...pActive.keys()].filter(slot => pActive[slot]);
    assert.equal(slots.length, 2, 'the arrival creates both forward branches');
    for (const slot of slots) {
      assert.equal(pFrom[slot], 1);
      assert.equal(pHops[slot], 6);
      assert.equal(pKind[slot], kind);
      assert.equal(pCat[slot], category);
      pT[slot] = 0.5;
    }
    assert.equal(network.nodeEnergy[1], effect.nodeEnergy);
    assert.ok(Math.abs(network.edgeR[0] - CATEGORY_RGB[category * 3] * effect.edgeIntensity) < 1e-6);
    pulses.writePulseBuffers();
    assert.ok(Math.abs(pulseSize[slots[0] * 2] - head) < 1e-6);
  }
});

test('real completion spawning respects pool capacity, reuses slots and ends after bounded hops', () => {
  const P = 1600;
  const context = createSceneContext({
    Math: Object.assign(Object.create(Math), { random: () => 0.2 }),
    P, CATEGORY_INDEX, VISUAL, SCENE_RGB: CATEGORY_RGB,
    pCursor: 0, activePulses: 0, demoPulses: 0, demoSpawn: 0, pDemo: new Uint8Array(P),
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

test('demo-tagged pulses and their branches stay separately counted and are released', () => {
  const P = 64;
  const context = createSceneContext({
    Math: Object.assign(Object.create(Math), { random: () => 0.2 }),
    P, CATEGORY_INDEX, VISUAL, SCENE_RGB: CATEGORY_RGB,
    pCursor: 0, activePulses: 0, demoPulses: 0, demoSpawn: 0, pDemo: new Uint8Array(P),
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
  vm.runInContext('spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion)', context);
  vm.runInContext('demoSpawn = 1; spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion); demoSpawn = 0', context);
  assert.equal(context.activePulses, 2);
  assert.equal(context.demoPulses, 1);
  for (let step = 0; step < 40; step++) {
    vm.runInContext('updatePulses(0.1)', context);
    let tagged = 0;
    for (let s = 0; s < P; s++) tagged += context.pActive[s] && context.pDemo[s];
    assert.equal(context.demoPulses, tagged, 'branches inherit the demo tag');
    assert.ok(context.demoPulses <= context.activePulses);
    assert.equal(context.demoSpawn, 0);
  }
  assert.equal(context.activePulses, 0);
  assert.equal(context.demoPulses, 0);
});

test('appearance demo shares scene bursts but never reaches timeline, feed, statistics or HUD counts', () => {
  const calls = [];
  const timelineAdds = [];
  const feedAdds = [];
  const demoFrame = {
    byCategory: new Uint32Array(CATEGORIES.length), sceneByCategory: new Uint32Array(CATEGORIES.length),
    hookCounts: new Uint32Array(HOOK_TYPES.length), entries: [], impacts: [],
  };
  demoFrame.sceneByCategory[CATEGORY_INDEX.edit] = 4;
  const context = createSceneContext({
    CATEGORY_INDEX, HOOK_TYPES, CATEGORIES, VISUAL, document: { hidden: false }, performance: { now: () => 1 }, Math, N: 1,
    nodeEnergy: new Float32Array(1), nodeHot: new Float32Array(1),
    adjacency: [[0, 1, 2, 3, 4]], otherEnd: (edge) => edge + 1,
    impulseBuffer: { drain() { throw new Error('observed buffer must not drain for the demo'); } },
    timeline: { add: (...args) => timelineAdds.push(args) },
    categoryBurstPlan: createCategoryBurstPlan(),
    impulseIntensity: () => 2,
    impulseFeed: { add: (...args) => feedAdds.push(args) },
    fireFrom: (...args) => calls.push(args),
    demoSource: { drain: () => demoFrame },
  });
  vm.runInContext([sceneFunction('renderCompletionCascade'), sceneFunction('renderHookPulses'),
    sceneFunction('renderObservedImpulses')].join('\n'), context);
  vm.runInContext('renderObservedImpulses(demoSource, false)', context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][5], CATEGORY_INDEX.edit);
  assert.deepEqual(timelineAdds, []);
  assert.deepEqual(feedAdds, []);
  const demo = sources['activity/activity-presentation.mjs'].split('function renderDemoActivity')[1].split('function setDemoRunning')[0];
  assert.match(demo, /renderObservedImpulses\(demoSource, false\)/);
  // Waiting markers (which copy IDs) are re-rendered only on transitions, not every frame.
  assert.match(demo, /if \(demoFrame\.active !== wasActive \|\| demoFrame\.waiting !== wasWaiting \|\|\s*\(demoMarkersDirty && demoFrame\.active\)\) \{/);
  assert.match(demo, /const badgeVisible = demoFrame\.active \|\| pulses\.demoPulses > 0;/);
  assert.match(main, /hud\.renderActivityState\(state\);\s*presentation\.markDemoDirty\(\);/);
  // onState fires synchronously during connect(), so the flag must exist before the client is created.
  assert.ok(sources['main.js'].indexOf('const presentation = createActivityPresentation') < sources['main.js'].indexOf('const activityClient ='));
  assert.match(main, /return appearance\.applyVisualSettings\(candidate\);\s*\} finally \{\s*presentation\.markDemoDirty\(\);/);
  assert.doesNotMatch(demo, /impulseBuffer|timeline|pageActivityTotals|sessionStatsDialog|workspaceUI|activityState\s*=/);
  assert.match(main, /\$impulses\.textContent = String\(activePulses - demoPulses\)/);
  assert.match(main, /\$load\.textContent = Math\.round\(smoothedObservedLoad \* 100\)/);
  assert.match(html, /id="visual-settings-demo" type="checkbox"/);
  assert.match(html, /id="demo-badge"[\s\S]*?hidden>[\s\S]*?DEMO · synthetic activity, not observed/);
  assert.match(main, /setDemoRunning\(open && !reducedMotion\)/);
});

test('settings hover focuses the demo and the open panel re-frames the scene without touching camera settings', () => {
  assert.match(main, /previewMode: \(\) => presentation\.previewMode\(reducedMotion\)/);
  assert.match(main, /onPreviewFocus: \(path\) => presentation\.setDemoFocus\(demoFocusForPath\(path\)\)/);
  assert.match(main, /framingOpen = open;\s*updateFramingTarget\(\);/);
  assert.match(main, /bloom\.setSize\(w, h\);\s*updateFramingTarget\(\);/);
  assert.match(main, /updateSceneFraming\(dt\);/);
  assert.match(server, /\['\/appearance\/visual-settings-preview\.mjs', \['appearance\/visual-settings-preview\.mjs'/);

  const calls = [];
  const camera = {
    setViewOffset: (...args) => calls.push(['set', ...args]),
    clearViewOffset: () => calls.push(['clear']),
  };
  const context = createSceneContext({
    Math, camera, window: { innerWidth: 1600, innerHeight: 900 },
    visualSettingsDialog: { getBoundingClientRect: () => ({ width: 620 }) },
    FRAMING_MIN_WIDTH: 900, FRAMING_EASE: 6, reducedMotion: false,
    framingOpen: true, framingTarget: 0, framingOffset: 0, framingApplied: 0, framingWidth: 0, framingHeight: 0,
  });
  vm.runInContext([sceneFunction('updateFramingTarget'), sceneFunction('updateSceneFraming')].join('\n'), context);
  vm.runInContext('updateFramingTarget()', context);
  assert.equal(calls.length, 0, 'opening waits for the ordered frame update');
  vm.runInContext('updateSceneFraming(0.05)', context);
  assert.equal(calls.at(-1)[0], 'set');
  assert.ok(calls.at(-1)[3] > 0 && calls.at(-1)[3] < 310, 'eases toward the target');
  for (let i = 0; i < 120; i++) vm.runInContext('updateSceneFraming(0.05)', context);
  assert.deepEqual(calls.at(-1), ['set', 1600, 900, 310, 0, 1600, 900]);
  const settled = calls.length;
  vm.runInContext('updateSceneFraming(0.05)', context);
  assert.equal(calls.length, settled, 'no projection churn once settled');

  context.window.innerWidth = 800;
  vm.runInContext('updateFramingTarget(); reducedMotion = true; updateSceneFraming(0.05)', context);
  assert.deepEqual(calls.at(-1), ['clear'], 'narrow windows and reduced motion jump back without easing');
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
  const context = createSceneContext({
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
