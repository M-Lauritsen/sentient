import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createImpulseFeed } from '../activity-client.mjs';
import { createPageActivityTotals } from '../session-stats-ui.mjs';
import { createWorkspaceStore } from '../workspace-model.mjs';
import { createWorkspaceUI } from '../workspace-ui.mjs';

class MemoryStorage {
  values = new Map();
  failWrites = false;

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('synthetic storage denial');
    this.values.set(key, value);
  }
}

function setup({ storage = new MemoryStorage(), width = 1200 } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="workspace-open">Workspace</button>
    <main id="workspace">
      <section data-workspace-dock="left"></section>
      <section data-workspace-dock="right"></section>
      <section data-workspace-dock="bottom-left"></section>
      <section data-workspace-dock="bottom"></section>
      <div data-workspace-assets hidden></div>
    </main>
    <button id="fallback-focus">Fallback</button>
  </body></html>`, { url: 'http://127.0.0.1:43187/' });
  const { document, Event } = dom.window;
  dom.window.matchMedia = () => ({ matches: width <= 760, addEventListener() {} });
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  const registeredLists = new Set();
  const sessionStatsDialog = {
    registerList(list) { registeredLists.add(list); },
    unregisterList(list) { registeredLists.delete(list); },
    update() {},
    open() {},
  };
  const store = createWorkspaceStore({ storage, createId: () => 'profile-saved' });
  const timelinePreview = document.createElement('aside');
  timelinePreview.className = 'hud-timeline';
  const feed = createImpulseFeed();
  const closeTimelineCalls = [];
  const ui = createWorkspaceUI({
    document,
    root: document.getElementById('workspace'),
    opener: document.getElementById('workspace-open'),
    store,
    feed,
    timelinePreview,
    closeTimeline: () => closeTimelineCalls.push(true),
    sessionStatsDialog,
    pageActivityTotals: createPageActivityTotals(),
  });
  return {
    dom,
    document,
    ui,
    store,
    feed,
    storage,
    timelinePreview,
    closeTimelineCalls,
    registeredLists,
  };
}

function connectedState(overrides = {}) {
  return {
    connection: 'connected',
    sourceStatus: 'available',
    coverage: 'complete',
    activeSessions: 3,
    runningSessions: 1,
    waitingSessions: 1,
    sessions: [
      { id: 'AAAAAA', status: 'running', elapsedMs: 12_000 },
      { id: 'BBBBBB', status: 'waiting', waitKind: 'input', elapsedMs: 5_000 },
      { id: 'CCCCCC', status: 'ended', elapsedMs: 20_000 },
    ],
    ...overrides,
  };
}

function dock(document, name) {
  return document.querySelector(`[data-workspace-dock="${name}"]`);
}

test('default dock modules project bounded live data and survive source updates', () => {
  const { document, ui, feed, timelinePreview, registeredLists } = setup();
  const state = connectedState();
  ui.update(state);

  assert.deepEqual([...dock(document, 'left').querySelectorAll('.workspace-module')]
    .map((panel) => panel.dataset.moduleType), ['feed']);
  assert.deepEqual([...dock(document, 'right').querySelectorAll('.workspace-module')]
    .map((panel) => panel.dataset.moduleType), ['sessions']);
  assert.deepEqual([...dock(document, 'bottom-left').querySelectorAll('.workspace-module')]
    .map((panel) => panel.dataset.moduleType), ['timeline']);
  assert.equal(timelinePreview.closest('.workspace-module').dataset.dock, 'bottom-left');
  assert.equal(registeredLists.size, 1);

  feed.add('activity', 'functions.view', 'tool.execution_start', 2);
  assert.match(dock(document, 'left').textContent, /tool\.execution_start · functions\.view ×2/);
  assert.equal(dock(document, 'right').querySelectorAll('.workspace-session-list > li').length, 3);
  assert.match(dock(document, 'right').textContent, /WAITING/);

  const feedPanel = dock(document, 'left').querySelector('.workspace-module');
  feedPanel.querySelector('.workspace-collapse').click();
  assert.equal(feedPanel.querySelector('.workspace-module-content').hidden, true);
  ui.update(connectedState({ connection: 'retrying', coverage: 'unknown', sessions: [] }));
  assert.equal(feedPanel.isConnected, true);
  assert.equal(feedPanel.querySelector('.workspace-module-content').hidden, true);
  assert.match(dock(document, 'right').querySelector('.workspace-session-list')
    .getAttribute('aria-label'), /coverage unknown/);
});

test('feed refresh preserves existing arrivals and only inserts new rows, including identical events', () => {
  const { document, ui, feed } = setup();
  ui.update(connectedState());
  const list = document.querySelector('.workspace-feed');
  feed.add('thinking');
  feed.add('thinking');
  const firstRows = [...list.children];
  assert.equal(firstRows.length, 2);
  assert.deepEqual(firstRows.map((row) => row.textContent), ['Thinking', 'Thinking']);

  ui.update(connectedState({ runningSessions: 2 }));
  ui.refresh();
  assert.ok(firstRows.every((row, index) => list.children[index] === row),
    'refresh must not restart existing arrival animations');

  feed.add('thinking');
  assert.equal(list.children.length, 3);
  assert.notEqual(list.firstElementChild, firstRows[0], 'an identical arrival still gets its own row');
  assert.equal(list.children[1], firstRows[0]);
  assert.equal(list.children[2], firstRows[1]);

  for (let index = 0; index < 5; index++) feed.add('step');
  const fullRows = [...list.children];
  assert.equal(fullRows.length, 8);
  feed.add('completion');
  assert.equal(list.children.length, 8);
  assert.equal(list.firstElementChild.textContent, 'Task completed');
  assert.ok(fullRows.slice(0, 7).every((row, index) => list.children[index + 1] === row));
  assert.equal(fullRows[7].isConnected, false, 'only the expired arrival is removed');

  ui.update(connectedState({ coverage: 'partial' }));
  assert.equal(list.children[1], fullRows[0], 'coverage changes do not rebuild observed activity');
  assert.match(document.querySelector('.workspace-feed-state').textContent, /COVERAGE PARTIAL/);
  const beforeRejected = [...list.children];
  feed.add('private unknown kind');
  assert.ok(beforeRejected.every((row, index) => list.children[index] === row));
});

test('new arrivals roll retained rows down, while refresh and reduced motion leave them still', () => {
  const { document, dom, ui, feed } = setup();
  ui.update(connectedState());
  const list = document.querySelector('.workspace-feed');
  let reducedMotion = false;
  dom.window.matchMedia = () => ({ matches: reducedMotion });
  const rolls = [];
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: [...(this.parentElement?.children ?? [])].indexOf(this) * 26 };
  };
  dom.window.HTMLElement.prototype.animate = function (frames) {
    rolls.push({ label: this.textContent, frames });
  };
  feed.add('thinking');
  feed.add('completion');
  assert.deepEqual(rolls, [{
    label: 'Thinking',
    frames: [{ transform: 'translateY(-26px)' }, { transform: 'translateY(0)' }],
  }]);
  ui.refresh();
  assert.equal(rolls.length, 1, 'ordinary refresh does not restart the roll');
  reducedMotion = true;
  feed.add('step');
  assert.deepEqual([...list.children].map((row) => row.textContent),
    ['Task step', 'Task completed', 'Thinking']);
  assert.equal(rolls.length, 1, 'reduced motion still inserts activity but does not animate it');
});

test('catalogue modules render filtered totals and legend, with one live timeline', () => {
  const { document, ui, store, feed, timelinePreview } = setup();
  ui.update(connectedState());
  const settings = document.querySelector('.workspace-settings-open');
  settings.click();
  const select = document.querySelector('.workspace-catalog select');
  const add = document.querySelector('.workspace-catalog button');

  select.value = 'totals';
  select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  add.click();
  ui.refresh();
  assert.equal(document.querySelectorAll('.page-activity-stats').length, 1);
  assert.equal(document.querySelectorAll('.page-activity-stats li').length, 11);

  select.value = 'legend';
  select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  add.click();
  assert.deepEqual([...document.querySelectorAll('.activity-legend-list')]
    .map((list) => list.children.length), [11, 11]);
  assert.match(store.getState().activeProfile.instances.map(({ type }) => type).join(','), /timeline/);

  select.value = 'timeline';
  select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(add.disabled, true);
  assert.match(document.querySelector('.workspace-catalog-hint').textContent, /one live canvas.*aggregate data only/i);
  assert.equal(document.querySelectorAll('.hud-timeline').length, 1);
  assert.equal(timelinePreview.closest('.workspace-module').dataset.moduleType, 'timeline');
});

test('Add module validates a custom name, type options and dock before rendering and saving', () => {
  const storage = new MemoryStorage();
  const { document, ui, store, feed } = setup({ storage });
  ui.update(connectedState());
  feed.add('thinking');
  document.querySelector('.workspace-settings-open').click();

  const catalog = document.querySelector('.workspace-catalog');
  const type = catalog.querySelector('select[aria-label="Module type"]');
  const name = catalog.querySelector('input[aria-label="Module name"]');
  const dockSelect = catalog.querySelector('select[aria-label="Module dock"]');
  type.value = 'feed';
  type.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  name.value = '  ';
  catalog.querySelector('button').click();
  assert.equal(document.querySelectorAll('.workspace-module').length, 3);
  assert.match(document.querySelector('.workspace-status').textContent, /trimmed characters/i);

  const displayName = '<img src=x onerror=alert(1)>';
  name.value = displayName;
  dockSelect.value = 'bottom';
  const options = catalog.querySelector('.workspace-catalog-options');
  options.querySelector('[data-all-categories]').click();
  const readCategory = options.querySelector('[data-category="read"]');
  readCategory.click();
  assert.equal(options.querySelector('[data-all-categories]').indeterminate, true);
  const density = options.querySelector('select[name="density"]');
  density.value = 'compact';
  const showLegend = options.querySelector('input[name="showLegend"]');
  showLegend.click();
  catalog.querySelector('button').click();

  const panel = document.querySelector('.workspace-module[data-dock="bottom"][data-module-type="feed"]');
  assert.ok(panel);
  assert.equal(panel.querySelector('h2').textContent, displayName);
  assert.equal(panel.querySelector('h2').querySelector('img, script'), null);
  assert.deepEqual(store.getState().activeProfile.instances.map(({ type }) => type),
    ['feed', 'sessions', 'timeline']);
  assert.equal(document.querySelector('.workspace-toolbar button:nth-child(2)').disabled, false);
  document.querySelector('.workspace-toolbar button:nth-child(2)').click();

  const saved = store.getState().activeProfile.instances.find(({ displayName: value }) =>
    value === displayName);
  assert.deepEqual(saved, {
    id: saved.id,
    type: 'feed',
    displayName,
    dock: 'bottom',
    order: 0,
    size: 'standard',
    config: {
      categories: ['read'],
      density: 'compact',
      showLegend: false,
    },
  });
  assert.equal(JSON.stringify(JSON.parse(storage.values.get('sentient-os.workspaces.v1')))
    .includes('Thinking'), false);

  const reloaded = setup({ storage });
  assert.equal(reloaded.feed.getEntries().length, 0);
  assert.ok(reloaded.document.querySelector(
    '.workspace-module[data-dock="bottom"] h2',
  ));
  assert.equal(reloaded.document.querySelector(
    '.workspace-module[data-dock="bottom"] h2',
  ).textContent, displayName);
});

test('independent feed filters reuse one bounded accepted-arrival model', () => {
  const { document, ui, feed } = setup();
  ui.update(connectedState());
  feed.add('activity', 'functions.view', 'tool.execution_start');
  feed.add('thinking');

  document.querySelector('.workspace-settings-open').click();
  const type = document.querySelector('.workspace-catalog select');
  type.value = 'feed';
  type.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  document.querySelector('.workspace-catalog button').click();

  const feeds = [...document.querySelectorAll('.workspace-module[data-module-type="feed"]')];
  assert.equal(feeds.length, 2);
  document.querySelector('.workspace-close').click();
  for (const [panel, category] of [[feeds[0], 'read'], [feeds[1], 'reasoning']]) {
    panel.querySelector('.workspace-module-settings').click();
    panel.querySelector('[data-all-categories]').click();
    panel.querySelector(`[data-category="${category}"]`).click();
  }
  assert.match(feeds[0].querySelector('.workspace-feed').textContent, /tool\.execution_start/);
  assert.doesNotMatch(feeds[0].querySelector('.workspace-feed').textContent, /Thinking/);
  assert.match(feeds[1].querySelector('.workspace-feed').textContent, /Thinking/);
  assert.doesNotMatch(feeds[1].querySelector('.workspace-feed').textContent, /tool\.execution_start/);
  assert.equal(feed.getEntries().length, 2);
});

test('partial coverage does not render definitive empty activity or session results', () => {
  const { document, ui } = setup();
  ui.update(connectedState({ sourceStatus: 'available', coverage: 'partial', sessions: [] }));
  const feed = document.querySelector('.workspace-module[data-module-type="feed"]');
  const sessions = document.querySelector('.workspace-module[data-module-type="sessions"]');
  assert.match(feed.querySelector('.workspace-feed-state').textContent, /COVERAGE PARTIAL/);
  assert.doesNotMatch(feed.querySelector('.workspace-feed').textContent, /No matching activity/);
  assert.equal(sessions.querySelector('.workspace-session-state'), null);
  assert.equal(sessions.querySelector('.workspace-session-list').textContent, '');
  assert.match(sessions.querySelector('.workspace-session-list').getAttribute('aria-label'), /coverage partial/);
  assert.equal(sessions.querySelector('.workspace-module-content').classList.contains('is-unknown'), true);

  document.querySelector('.workspace-settings-open').click();
  const catalog = document.querySelector('.workspace-catalog select');
  catalog.value = 'totals';
  catalog.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  document.querySelector('.workspace-catalog button').click();
  const totals = document.querySelector('.workspace-module[data-module-type="totals"]');
  const coverageNote = totals.querySelector('.workspace-coverage-note');
  assert.match(coverageNote.textContent, /COVERAGE PARTIAL/);

  ui.update(connectedState({ sourceStatus: 'available', coverage: 'journal-only', sessions: [] }));
  assert.equal(feed.querySelector('.workspace-feed-state').hidden, true);
  assert.match(feed.querySelector('.workspace-feed').textContent, /No matching activity/);
  assert.equal(sessions.querySelector('.workspace-session-list').textContent, '');
  assert.equal(sessions.querySelector('.workspace-module-content').classList.contains('is-unknown'), false);
  ui.update(connectedState());
  assert.equal(sessions.querySelector('.workspace-empty'), null);
  assert.equal(sessions.querySelectorAll('.session-row').length, 3);
  assert.equal(coverageNote.hidden, true);
});

test('empty session projections do not display relocated session-state messages', () => {
  const { document, ui } = setup();
  const panel = document.querySelector('[data-module-type="sessions"]');
  const content = panel.querySelector('.workspace-module-content');
  for (const state of [
    connectedState({ sessions: [], sessionsTruncated: true }),
    connectedState({ sessions: [] }),
    connectedState({ sessions: [], coverage: 'unknown' }),
    connectedState({ sessions: [], coverage: 'partial' }),
  ]) {
    ui.update(state);
    assert.equal(content.textContent, '');
    assert.equal(content.querySelector('.workspace-empty, .workspace-session-state'), null);
  }
  ui.update(connectedState());
  assert.equal(content.querySelectorAll('.session-row').length, 3);
});

test('truncated session projections always disclose omitted rows', () => {
  const { document, ui } = setup();
  ui.update(connectedState({ sessionsTruncated: true }));
  const module = document.querySelector('.workspace-module[data-module-type="sessions"]');
  assert.equal(module.querySelector('.workspace-session-more').textContent, 'More sessions not shown');

  ui.update(connectedState({
    activeSessions: 40,
    runningSessions: 30,
    waitingSessions: 10,
    sessionsTruncated: true,
    hudSessionsTruncated: false,
    sessions: [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `WAIT-${index}`, status: 'waiting', elapsedMs: 5_000,
      })),
      ...Array.from({ length: 22 }, (_, index) => ({
        id: `RUN-${index}`, status: 'running', elapsedMs: 12_000,
      })),
    ],
  }));
  const filter = module.querySelector('.workspace-module-options select[name="filter"]');
  filter.value = 'running';
  filter.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(module.querySelector('.workspace-session-more').textContent, '+8 more not shown');
});

test('pointer drag, keyboard movement, and sizes are equivalent layout controls', () => {
  const { document, ui, closeTimelineCalls } = setup();
  ui.update(connectedState());
  const root = document.getElementById('workspace');
  const edit = document.querySelector('.workspace-dialog .workspace-toolbar button:last-child');
  document.querySelector('.workspace-settings-open').click();
  edit.click();

  const feed = dock(document, 'left').querySelector('.workspace-module');
  const handle = feed.querySelector('.workspace-drag-handle');
  assert.equal(handle.hidden, false);
  let captured;
  handle.setPointerCapture = (pointerId) => { captured = pointerId; };
  const rightDock = dock(document, 'right');
  document.elementFromPoint = () => rightDock;
  const pointer = (type, values) => {
    const event = new document.defaultView.Event(type, { bubbles: true, cancelable: true });
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(event, name, { value });
    }
    return event;
  };
  handle.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 7 }));
  handle.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 1, clientY: 1 }));
  handle.dispatchEvent(pointer('pointerup', { pointerId: 7 }));
  assert.equal(captured, 7);
  assert.equal(feed.dataset.dock, 'right');
  assert.equal(document.activeElement, handle);
  assert.equal(closeTimelineCalls.length, 0);

  feed.querySelector('.workspace-module-settings').click();
  const actions = feed.querySelector('.workspace-module-actions');
  actions.querySelector('[data-move-dock="bottom"]').click();
  assert.equal(feed.dataset.dock, 'bottom');
  actions.querySelector('[data-order-delta="1"]').click();
  assert.equal(feed.dataset.dock, 'bottom');
  const size = feed.querySelector('[data-module-size]');
  size.value = 'large';
  size.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(feed.dataset.size, 'large');
  const timeline = dock(document, 'bottom-left').querySelector('.workspace-module[data-module-type="timeline"]');
  timeline.querySelector('.workspace-module-actions [data-move-dock="right"]').click();
  assert.equal(closeTimelineCalls.length, 1);
  assert.equal(document.querySelectorAll('.hud-timeline').length, 1);
  assert.equal(timeline.dataset.dock, 'right');
  assert.equal(root.classList.contains('is-dragging'), false);
});

test('profile CRUD, dirty-switch choices, and reset preserve committed layouts', () => {
  const { document, ui, store } = setup();
  ui.update(connectedState());
  document.querySelector('.workspace-settings-open').click();
  document.querySelector('[aria-label="New profile name"]').value = 'Focus';
  document.querySelector('.workspace-profile-actions button:last-child').click();
  assert.equal(store.getState().activeProfile.name, 'Focus');

  const profileSelect = document.querySelector('.workspace-profile-select');
  const feedPanel = dock(document, 'left').querySelector('.workspace-module');
  feedPanel.querySelector('.workspace-module-settings').click();
  feedPanel.querySelector('[data-remove-module]').click();
  profileSelect.value = 'default';
  profileSelect.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('.workspace-confirmation').hidden, false);
  document.querySelector('.workspace-confirmation button:last-child').click();
  assert.equal(store.getState().activeProfileId, 'profile-saved');
  assert.equal(dock(document, 'left').querySelectorAll('.workspace-module').length, 0);

  profileSelect.value = 'default';
  profileSelect.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  document.querySelector('.workspace-confirmation button:nth-of-type(2)').click();
  assert.equal(store.getState().activeProfileId, 'default');
  assert.equal(dock(document, 'left').querySelectorAll('.workspace-module').length, 1);

  const defaultFeed = dock(document, 'left').querySelector('.workspace-module');
  defaultFeed.querySelector('.workspace-module-settings').click();
  defaultFeed.querySelector('[data-remove-module]').click();
  document.querySelector('.workspace-toolbar button:nth-of-type(2)').click();
  document.querySelector('.workspace-toolbar button:first-of-type').click();
  assert.deepEqual(store.getState().activeProfile.instances.map(({ type, dock }) => [type, dock]), [
    ['feed', 'left'],
    ['sessions', 'right'],
    ['timeline', 'bottom-left'],
  ]);
});

test('lower-left dock accepts pointer and keyboard moves, ordering, sizes and saved reload', () => {
  const { document, ui, storage } = setup();
  ui.update(connectedState());
  document.querySelector('.workspace-settings-open').click();
  document.querySelector('.workspace-toolbar button:last-child').click();
  const feed = document.querySelector('[data-module-type="feed"]');
  const handle = feed.querySelector('.workspace-drag-handle');
  document.elementFromPoint = () => dock(document, 'bottom-left');
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    const event = new document.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      button: { value: 0 }, pointerId: { value: 9 },
      clientX: { value: 20 }, clientY: { value: 700 },
    });
    handle.dispatchEvent(event);
  }
  assert.equal(feed.dataset.dock, 'bottom-left');
  assert.deepEqual([...dock(document, 'bottom-left').children].map((panel) => panel.dataset.moduleType), ['timeline', 'feed']);
  feed.querySelector('.workspace-module-settings').click();
  feed.querySelector('[data-order-delta="-1"]').click();
  assert.deepEqual([...dock(document, 'bottom-left').children].map((panel) => panel.dataset.moduleType), ['feed', 'timeline']);
  feed.querySelector('[data-move-dock="bottom"]').click();
  assert.equal(feed.dataset.dock, 'bottom');
  const lowerLeft = feed.querySelector('[data-move-dock="bottom-left"]');
  assert.equal(lowerLeft.textContent, 'Move to lower left');
  lowerLeft.click();
  const size = feed.querySelector('[data-module-size]');
  size.value = 'compact';
  size.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  feed.querySelector('.workspace-module-settings-footer button').click();
  const reloaded = setup({ storage, width: 390 });
  const saved = reloaded.document.querySelector('[data-module-type="feed"]');
  assert.equal(saved.dataset.dock, 'bottom-left');
  assert.equal(saved.dataset.size, 'compact');
  reloaded.document.getElementById('workspace-open').click();
  assert.equal(reloaded.document.body.classList.contains('workspace-mobile-open'), true);
  assert.equal(saved.parentElement.dataset.workspaceDock, 'bottom-left');
});

test('storage failures remain visibly unsaved and mobile drawer does not rewrite docks', () => {
  const storage = new MemoryStorage();
  const { document, ui, store } = setup({ storage, width: 390 });
  ui.update(connectedState());

  document.getElementById('workspace-open').click();
  assert.equal(document.body.classList.contains('workspace-mobile-open'), true);
  assert.equal(dock(document, 'left').querySelector('.workspace-module').dataset.dock, 'left');
  document.querySelector('.workspace-mobile-close').click();
  assert.equal(document.body.classList.contains('workspace-mobile-open'), false);

  document.querySelector('.workspace-settings-open').click();
  document.querySelector('.workspace-toolbar button:last-child').click();
  const feed = dock(document, 'left').querySelector('.workspace-module');
  feed.querySelector('.workspace-module-actions [data-move-dock="right"]').click();
  storage.failWrites = true;
  document.querySelector('.workspace-toolbar button:first-of-type').click();
  assert.match(document.querySelector('.workspace-status').textContent, /not saved/i);
  assert.equal(store.getState().dirty, true);
  assert.equal(document.querySelector('.workspace-storage-actions button:first-child').hidden, false);
  storage.failWrites = false;
  document.querySelector('.workspace-storage-actions button:first-child').click();
  assert.equal(store.getState().dirty, false);
});

test('workspace opener expanded state tracks both menu and module-settings entry points', () => {
  const { document } = setup();
  const opener = document.getElementById('workspace-open');
  const dialog = document.querySelector('.workspace-dialog');
  document.querySelector('.workspace-settings-open').click();
  assert.equal(dialog.open, true);
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  dialog.close();
  assert.equal(opener.getAttribute('aria-expanded'), 'false');

  opener.click();
  assert.equal(dialog.open, true);
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  dialog.close();
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, opener);
});

test('Appearance temporarily makes Workspace inert without saving or changing its layout', () => {
  const desktop = setup();
  desktop.ui.update(connectedState());
  desktop.document.getElementById('workspace-open').click();
  const dialog = desktop.document.querySelector('.workspace-dialog');
  assert.equal(dialog.open, true);

  desktop.ui.setAppearanceOpen(true);
  assert.equal(desktop.document.getElementById('workspace').hasAttribute('inert'), true);
  assert.equal(desktop.document.getElementById('workspace-open').disabled, true);
  assert.equal(dialog.open, false);
  assert.equal(desktop.store.getState().dirty, false);

  desktop.ui.setAppearanceOpen(false);
  assert.equal(desktop.document.getElementById('workspace').hasAttribute('inert'), false);
  assert.equal(desktop.document.getElementById('workspace-open').disabled, false);
  assert.equal(desktop.store.getState().dirty, false);

  const mobile = setup({ width: 390 });
  mobile.ui.update(connectedState());
  mobile.document.getElementById('workspace-open').click();
  assert.equal(mobile.document.body.classList.contains('workspace-mobile-open'), true);
  mobile.ui.setAppearanceOpen(true);
  assert.equal(mobile.document.body.classList.contains('workspace-mobile-open'), false);
  assert.equal(mobile.store.getState().dirty, false);
});

test('normal viewing keeps configuration hidden for every module and settings have one active disclosure', () => {
  const { document, ui } = setup();
  ui.update(connectedState());
  document.querySelector('.workspace-settings-open').click();
  const type = document.querySelector('.workspace-catalog select');
  for (const value of ['totals', 'legend']) {
    type.value = value;
    type.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    document.querySelector('.workspace-catalog button').click();
  }
  document.querySelector('.workspace-close').click();
  const panels = [...document.querySelectorAll('.workspace-module')];
  assert.equal(panels.length, 5);
  for (const panel of panels) {
    assert.equal(panel.querySelector('.workspace-module-actions').hidden, true);
    assert.equal(panel.querySelector('.workspace-drag-handle').hidden, true);
    assert.equal(panel.querySelector('.workspace-module-layout').hidden, true);
    assert.equal(panel.querySelector('.workspace-module-settings').getAttribute('aria-expanded'), 'false');
    assert.equal(panel.querySelector('.workspace-module-content input, .workspace-module-content select'), null);
  }
  assert.equal(document.querySelector('select[multiple]'), null);
  panels[0].querySelector('.workspace-module-settings').click();
  assert.equal(panels[0].querySelector('.workspace-module-actions').hidden, false);
  panels[1].querySelector('.workspace-module-settings').click();
  assert.equal(panels[0].querySelector('.workspace-module-actions').hidden, true);
  assert.equal(panels[1].querySelector('.workspace-module-actions').hidden, false);
  for (const panel of panels.filter((panel) => ['timeline', 'legend'].includes(panel.dataset.moduleType))) {
    assert.equal(panel.querySelector('.workspace-module-options').childElementCount, 0);
  }
  for (const panel of panels) {
    const toggle = panel.querySelector('.workspace-module-menu-toggle');
    toggle.click();
    panel.querySelector('.workspace-module-settings').click();
    assert.ok(panel.querySelector('.workspace-module-actions').contains(document.activeElement));
    assert.equal(document.activeElement.closest('[hidden]'), null,
      `${panel.dataset.moduleType} must focus a visible settings control`);
  }
});

test('All categories supports all, subset and empty results independently in feed and totals', () => {
  const { document, ui, feed, store } = setup();
  ui.update(connectedState());
  feed.add('activity', 'functions.view', 'tool.execution_start');
  feed.add('thinking');
  document.querySelector('.workspace-settings-open').click();
  document.querySelector('.workspace-catalog select').value = 'totals';
  document.querySelector('.workspace-catalog button').click();
  document.querySelector('.workspace-close').click();
  const panel = document.querySelector('[data-module-type="feed"]');
  const totals = document.querySelector('[data-module-type="totals"]');
  panel.querySelector('.workspace-module-settings').click();
  const all = panel.querySelector('[data-all-categories]');
  assert.equal(all.checked, true);
  assert.equal(all.indeterminate, false);
  assert.equal(panel.querySelector('.workspace-filter-summary'), null);

  panel.querySelector('[data-category="read"]').click();
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true);
  assert.equal(panel.querySelectorAll('.workspace-feed .impulse-entry').length, 1);
  assert.match(panel.querySelector('.workspace-feed').textContent, /Thinking/);
  all.click();
  assert.equal(all.checked, true);
  assert.equal(panel.querySelectorAll('.workspace-feed .impulse-entry').length, 2);
  all.click();
  assert.equal(all.indeterminate, false);
  assert.equal(panel.querySelector('.workspace-filter-summary'), null);
  assert.equal(panel.querySelector('.workspace-feed').textContent, 'Choose categories in Settings.');
  assert.equal(totals.querySelectorAll('.page-activity-stats li:not([hidden])').length, 11);

  ui.update(connectedState({ coverage: 'partial' }));
  assert.match(panel.querySelector('.workspace-feed-state').textContent, /COVERAGE PARTIAL/);
  assert.equal(panel.querySelector('.workspace-feed').textContent, 'Choose categories in Settings.');
  panel.querySelector('.workspace-module-settings-footer button').click();
  assert.deepEqual(store.getState().activeProfile.instances.find(({ type }) => type === 'feed').config.categories, []);
  assert.equal(all.isConnected, true);

  totals.querySelector('.workspace-module-settings').click();
  const allTotals = totals.querySelector('[data-all-categories]');
  allTotals.click();
  assert.equal(totals.querySelectorAll('.page-activity-stats li:not([hidden])').length, 0);
  assert.equal(totals.querySelector('.workspace-empty').hidden, false);
  assert.match(totals.querySelector('.workspace-coverage-note').textContent, /COVERAGE PARTIAL/);
  allTotals.click();
  assert.equal(totals.querySelectorAll('.page-activity-stats li:not([hidden])').length, 11);
  assert.equal(totals.querySelector('.workspace-empty').hidden, true);
  assert.equal(feed.getEntries().length, 2);
});

test('settings retain keyboard focus during arrivals and restore trigger focus on Escape and collapse', () => {
  const { document, ui, feed } = setup();
  ui.update(connectedState());
  const panel = document.querySelector('[data-module-type="feed"]');
  const toggle = panel.querySelector('.workspace-module-settings');
  toggle.click();
  const category = panel.querySelector('[data-category="read"]');
  category.focus();
  category.click();
  feed.add('thinking');
  ui.update(connectedState());
  assert.equal(document.activeElement, category);
  assert.equal(panel.querySelector('[data-category="read"]'), category);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  category.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, true);
  assert.equal(document.activeElement, panel.querySelector('.workspace-module-menu-toggle'));
  toggle.click();
  panel.querySelector('.workspace-collapse').click();
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, true);
  assert.equal(panel.querySelector('.workspace-module-content').hidden, true);
  toggle.click();
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, false);
  assert.equal(panel.querySelector('.workspace-module-content').hidden, true);
  panel.querySelector('.workspace-module-settings-footer button:last-child').click();
  assert.equal(document.activeElement, panel.querySelector('.workspace-module-menu-toggle'));
});

test('module icon menus preserve actions, keyboard navigation and dismissal', () => {
  const { document, ui } = setup();
  ui.update(connectedState());
  const panels = [...document.querySelectorAll('.workspace-module')];
  const panel = panels[0];
  const toggle = panel.querySelector('.workspace-module-menu-toggle');
  const menu = panel.querySelector('[role="menu"]');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const key = (target, value) => target.dispatchEvent(new document.defaultView.KeyboardEvent(
    'keydown', { key: value, bubbles: true, cancelable: true },
  ));
  assert.match(toggle.getAttribute('aria-label'), /Actions for/);
  assert.equal(toggle.textContent, '');
  assert.equal(menu.hidden, true);
  toggle.click();
  assert.equal(menu.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, items[0]);
  key(items[0], 'ArrowUp');
  assert.equal(document.activeElement, items[1]);
  key(items[1], 'ArrowDown');
  assert.equal(document.activeElement, items[0]);
  key(items[0], 'End');
  assert.equal(document.activeElement, items[1]);
  key(items[1], 'Home');
  assert.equal(document.activeElement, items[0]);
  key(items[0], 'Escape');
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, toggle);

  toggle.click();
  items[0].click();
  assert.equal(menu.hidden, true);
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, false);
  assert.equal(document.activeElement.closest('.workspace-module-actions').hidden, false);
  key(document.activeElement, 'Escape');
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, true);
  assert.equal(document.activeElement, toggle);

  toggle.click();
  items[1].click();
  assert.equal(menu.hidden, true);
  assert.equal(panel.querySelector('.workspace-module-content').hidden, true);
  assert.equal(document.activeElement, toggle);
  toggle.click();
  assert.equal(items[1].textContent, 'Expand');
  items[1].click();
  assert.equal(panel.querySelector('.workspace-module-content').hidden, false);

  toggle.click();
  panels[1].querySelector('.workspace-module-menu-toggle').click();
  assert.equal(menu.hidden, true, 'opening another menu closes the first');
  toggle.click();
  document.getElementById('fallback-focus').click();
  assert.equal(menu.hidden, true);
  toggle.click();
  document.getElementById('fallback-focus').focus();
  assert.equal(menu.hidden, true, 'tabbing outside closes the menu');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('layout editing closes the modal, exposes Done and never silently saves drafts', () => {
  const { document, ui, store } = setup();
  ui.update(connectedState());
  const panel = document.querySelector('[data-module-type="feed"]');
  document.getElementById('workspace-open').click();
  document.querySelector('.workspace-toolbar button:last-child').click();
  assert.equal(document.querySelector('.workspace-dialog').open, false);
  const bar = document.querySelector('.workspace-editing-bar');
  const done = bar.querySelector('[aria-label="Finish editing layout"]');
  assert.equal(bar.hidden, false);
  assert.equal(document.activeElement, done);
  panel.querySelector('.workspace-module-settings').click();
  assert.equal(panel.querySelector('.workspace-module-layout').hidden, false);
  panel.querySelector('[data-move-dock="right"]').click();
  done.click();
  assert.equal(panel.querySelector('.workspace-drag-handle').hidden, true);
  assert.equal(panel.querySelector('.workspace-module-layout').hidden, true);
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('span').textContent, 'Unsaved changes');
  assert.equal(store.getState().activeProfile.instances.find(({ type }) => type === 'feed').dock, 'left');
  bar.querySelector('button').click();
  assert.equal(store.getState().activeProfile.instances.find(({ type }) => type === 'feed').dock, 'right');
  assert.equal(bar.hidden, true);
});

test('a failed module Settings save stays visibly unsaved and can be retried there', () => {
  const { document, ui, store, storage } = setup();
  ui.update(connectedState());
  const panel = document.querySelector('[data-module-type="feed"]');
  panel.querySelector('.workspace-module-settings').click();
  panel.querySelector('[data-category="read"]').click();
  storage.failWrites = true;
  const save = panel.querySelector('.workspace-module-settings-footer button');
  save.focus();
  save.click();
  assert.equal(store.getState().dirty, true);
  assert.equal(document.activeElement, save);
  assert.match(panel.querySelector('.workspace-module-save-status').textContent, /not saved/i);
  assert.equal(panel.querySelector('.workspace-module-actions').hidden, false);
  assert.equal(panel.querySelector('.workspace-module-settings-footer button').disabled, false);
  storage.failWrites = false;
  save.click();
  assert.equal(store.getState().dirty, false);
  assert.equal(panel.querySelector('.workspace-module-save-status').textContent, '');
  assert.equal(document.activeElement, panel.querySelector('.workspace-module-settings-footer button:last-child'));
});
