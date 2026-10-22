import { createImpulseFeed } from '/activity/activity-client.mjs';
import { createPageActivityTotals, createTimelineDialog } from '/ui/session-stats-ui.mjs';
import { createWorkspaceStore } from '/workspace/workspace-model.mjs';
import { createWorkspaceUI } from '/workspace/workspace-ui.mjs';
import { createNavigationUI } from '/ui/navigation-ui.mjs';

const document = window.document;
const navigationUI = createNavigationUI({ document });
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
      child.document.querySelector('#application-menu-toggle').click();
      const titleRect = child.document.querySelector('.title').getBoundingClientRect();
      const menuRect = child.document.querySelector('#application-menu').getBoundingClientRect();
      const toggleRect = child.document.querySelector('#application-menu-toggle').getBoundingClientRect();
      const sourceRect = child.document.querySelector('.hud-top').getBoundingClientRect();
      const coverageRect = child.document.querySelector('#coverage').getBoundingClientRect();
      const overlaps = (a, b) => a.left < b.right && a.right > b.left &&
        a.top < b.bottom && a.bottom > b.top;
      const menuControls = [...child.document.querySelectorAll(
        '.workspace-dock-right button, .workspace-dock-right input, .workspace-dock-right select, ' +
        '.workspace-dock-right summary, .workspace-dock-bottom-left button, ' +
        '.workspace-dock-bottom-left input, .workspace-dock-bottom-left select, ' +
        '.workspace-dock-bottom-left summary',
      )].map((control) => control.getBoundingClientRect());
      if (mobile) child.document.querySelector('#workspace-open').click();
      const workspace = child.document.querySelector('#workspace');
      const docks = [...workspace.querySelectorAll('[data-workspace-dock]')];
      const menu = child.document.querySelector('#application-menu');
      const menuToggle = child.document.querySelector('#application-menu-toggle');
      const menuToggleRect = menuToggle.getBoundingClientRect();
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
        menuOpen: menuToggle.getAttribute('aria-expanded') === 'true' && !menu.hidden,
        menuInViewport: menuRect.left >= 0 && menuRect.right <= child.innerWidth &&
          menuToggleRect.left >= 0 && menuToggleRect.right <= child.innerWidth &&
          menuRect.top >= 0 && menuRect.bottom <= child.innerHeight,
        menuOverlapsBranding: overlaps(menuRect, titleRect) || overlaps(menuToggleRect, titleRect),
        menuOverlapsDockControl: menuControls.some((control) =>
          overlaps(menuRect, control) || overlaps(menuToggleRect, control)),
        brandingOverlapsDockControl: menuControls.some((control) => overlaps(titleRect, control)),
        menuOverlapsSourceOrCoverage: [sourceRect, coverageRect].some((region) =>
          overlaps(menuRect, region) || overlaps(menuToggleRect, region)),
        desktopDockPreferencesPreserved: JSON.stringify(docksBefore) === JSON.stringify(docksAfter),
        returnFocus: mobile ? child.document.activeElement === child.document.querySelector('#workspace-open') : null,
      });
      frame.remove();
    }
    return results;
  },
  inspect() {
    return {
      menuOpen: navigationUI.isOpen(),
      menuExpanded: document.querySelector('#application-menu-toggle').getAttribute('aria-expanded'),
      menuItems: [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()),
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
  async checkNavigation() {
    const toggle = document.querySelector('#application-menu-toggle');
    const menu = document.querySelector('#application-menu');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const press = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    }));
    navigationUI.close();
    toggle.focus();
    press(toggle, 'ArrowDown');
    const opensAtFirst = document.activeElement === items[0] &&
      toggle.getAttribute('aria-expanded') === 'true' && !menu.hidden;
    press(items[0], 'ArrowDown');
    const arrowDownMovesFocus = document.activeElement === items[1];
    press(items[1], 'End');
    const endMovesFocus = document.activeElement === items.at(-1);
    press(items.at(-1), 'Escape');
    const escapeRestoresToggle = document.activeElement === toggle && menu.hidden &&
      toggle.getAttribute('aria-expanded') === 'false';
    toggle.click();
    items.at(-1).click();
    const helpOpensWithFocus = document.querySelector('#help-dialog').open &&
      document.activeElement === document.querySelector('#help-close');
    document.querySelector('#help-close').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const helpCloseRestoresItem = document.activeElement === items.at(-1) && !menu.hidden &&
      toggle.getAttribute('aria-expanded') === 'true';
    return {
      opensAtFirst,
      arrowDownMovesFocus,
      endMovesFocus,
      escapeRestoresToggle,
      helpOpensWithFocus,
      helpCloseRestoresItem,
    };
  },
};
document.querySelector('#harness-status').textContent =
  'Synthetic data only · no Copilot journals read · use Workspace for controls.';
