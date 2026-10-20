import { createImpulseFeed } from '/activity-client.mjs';
import { createPageActivityTotals, createTimelineDialog } from '/session-stats-ui.mjs';
import { createWorkspaceStore } from '/workspace-model.mjs';
import { createWorkspaceUI } from '/workspace-ui.mjs';

const document = window.document;
const timelinePreview = document.querySelector('.hud-timeline');
const timelineContent = document.querySelector('#timeline-content');
const timelineCanvas = document.querySelector('#timeline');
const timelineDialog = document.querySelector('#timeline-dialog');
const timelineOpener = document.querySelector('#timeline-open');
const timelineClose = document.querySelector('#timeline-close');
const timelineDialogContent = document.querySelector('#timeline-dialog-content');
const timelineController = createTimelineDialog({
  preview: timelinePreview,
  content: timelineContent,
  canvas: timelineCanvas,
  dialog: timelineDialog,
  dialogContent: timelineDialogContent,
  opener: timelineOpener,
  closeButton: timelineClose,
  redraw() {},
});
const feed = createImpulseFeed();
feed.add('activity', 'functions.view', 'tool.execution_start', 3);
feed.add('thinking');
const pageActivityTotals = createPageActivityTotals();
pageActivityTotals.add({ kind: 'step', count: 17 });
const sessionLists = new Set();
const sessionStatsDialog = {
  registerList(list) { sessionLists.add(list); },
  unregisterList(list) { sessionLists.delete(list); },
  update() {},
};
const store = createWorkspaceStore({ storage: window.localStorage });
const ui = createWorkspaceUI({
  document,
  root: document.querySelector('#workspace'),
  opener: document.querySelector('#workspace-open'),
  store,
  feed,
  timelinePreview,
  closeTimeline: () => timelineController.close(),
  sessionStatsDialog,
  pageActivityTotals,
});
const syntheticState = {
  connection: 'connected',
  sourceStatus: 'available',
  coverage: 'complete',
  activeSessions: 3,
  runningSessions: 1,
  waitingSessions: 1,
  sessions: [
    { id: 'AAAAAA', status: 'running', elapsedMs: 12_000 },
    { id: 'BBBBBB', status: 'waiting', elapsedMs: 5_000 },
    { id: 'CCCCCC', status: 'ended', elapsedMs: 20_000 },
  ],
};
ui.update(syntheticState);

window.workspaceHarness = {
  ui,
  store,
  feed,
  updateSynthetic(next = syntheticState) { ui.update(next); },
  async checkViewports() {
    const viewports = [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'laptop', width: 1024, height: 768 },
      { label: 'tablet', width: 640, height: 800 },
      { label: 'mobile', width: 390, height: 844 },
      { label: '200% zoom equivalent', width: 320, height: 400, zoom: 2 },
    ];
    const results = [];
    for (const viewport of viewports) {
      const frame = document.createElement('iframe');
      frame.title = `${viewport.label} synthetic layout check`;
      frame.style.cssText = `position:fixed;left:-3000px;top:0;visibility:hidden;width:${viewport.width}px;height:${viewport.height}px;border:0`;
      if (viewport.zoom) frame.style.zoom = String(viewport.zoom);
      const loaded = new Promise((resolve, reject) => {
        frame.addEventListener('load', resolve, { once: true });
        frame.addEventListener('error', reject, { once: true });
      });
      frame.src = '/';
      document.body.append(frame);
      await loaded;
      const child = frame.contentWindow;
      const mobile = child.matchMedia('(max-width: 760px)').matches;
      const docksBefore = [...child.document.querySelectorAll('.workspace-module')]
        .map((module) => [module.dataset.moduleType, module.dataset.dock]);
      if (mobile) child.document.querySelector('#workspace-open').click();
      const workspace = child.document.querySelector('#workspace');
      const docks = [...workspace.querySelectorAll('[data-workspace-dock]')];
      const drawerOpen = child.document.body.classList.contains('workspace-mobile-open');
      const drawerScrollable = child.getComputedStyle(workspace).overflowY === 'auto';
      const workspaceDisplay = child.getComputedStyle(workspace).display;
      const workspaceOverflowY = child.getComputedStyle(workspace).overflowY;
      const dockPositions = docks.map((dock) => child.getComputedStyle(dock).position);
      if (mobile) child.document.querySelector('.workspace-mobile-close').click();
      const docksAfter = [...child.document.querySelectorAll('.workspace-module')]
        .map((module) => [module.dataset.moduleType, module.dataset.dock]);
      results.push({
        viewport: viewport.label,
        width: child.innerWidth,
        height: child.innerHeight,
        mobile,
        drawerOpen,
        drawerScrollable,
        workspaceDisplay,
        workspaceOverflowY,
        dockPositions,
        moduleCount: workspace.querySelectorAll('.workspace-module').length,
        desktopDockPreferencesPreserved: JSON.stringify(docksBefore) === JSON.stringify(docksAfter),
        returnFocus: mobile ? child.document.activeElement === child.document.querySelector('#workspace-open') : null,
      });
      frame.remove();
    }
    return results;
  },
  inspect() {
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      modules: [...document.querySelectorAll('.workspace-module')].map((module) => ({
        type: module.dataset.moduleType,
        dock: module.dataset.dock,
        size: module.dataset.size,
        collapsed: module.querySelector('.workspace-module-content').hidden,
      })),
      feedLabels: [...document.querySelectorAll('.workspace-feed .impulse-entry')].map((row) => row.textContent),
      sessionRows: [...document.querySelectorAll('.workspace-session-list .session-row')].length,
      totalsRows: [...document.querySelectorAll('.page-activity-stats li')].length,
      focus: document.activeElement === document.body ? 'BODY' :
        document.activeElement?.getAttribute('aria-label') ||
        document.activeElement?.textContent?.trim() || document.activeElement?.tagName,
      timelineOpen: timelineController.isOpen,
      timelineParent: timelineContent.parentElement?.className,
      mobileWorkspaceOpen: document.body.classList.contains('workspace-mobile-open'),
    };
  },
};
document.querySelector('#harness-status').textContent =
  'Synthetic data only · no Copilot journals read · use Workspace for controls.';
