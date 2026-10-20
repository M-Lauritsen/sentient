import {
  createDefaultWorkspace,
  createWorkspaceStore,
  WORKSPACE_MODULES,
} from './workspace-model.mjs';
import { CATEGORIES, CATEGORY_GLYPH, CATEGORY_HEX } from './activity-colors.mjs';
import { renderPageActivityTotals, renderSessionRows, clearSessionStats } from './session-stats-ui.mjs';
import { projectActiveHudSessions } from './activity-client.mjs';

const DOCKS = ['left', 'right', 'bottom-left', 'bottom'];
const SIZE_LABELS = { compact: 'Compact', standard: 'Standard', large: 'Large' };
const SESSION_LABELS = {
  running: 'RUNNING',
  'running-unverified': 'RUNNING · UNVERIFIED',
  waiting: 'WAITING',
  idle: 'IDLE',
  ended: 'ENDED',
};

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(document, label, className = '') {
  const node = element(document, 'button', className, label);
  node.type = 'button';
  return node;
}

function clone(value) {
  return structuredClone(value);
}

function sortInstances(instances) {
  return [...instances].sort((a, b) =>
    DOCKS.indexOf(a.dock) - DOCKS.indexOf(b.dock) || a.order - b.order);
}

function reorder(instances, id, dock, index = Number.MAX_SAFE_INTEGER) {
  const source = instances.find((instance) => instance.id === id);
  if (!source) return instances;
  const result = instances.filter((instance) => instance.id !== id);
  const destination = result.filter((instance) => instance.dock === dock)
    .sort((a, b) => a.order - b.order);
  const position = Math.max(0, Math.min(destination.length, index));
  destination.splice(position, 0, { ...source, dock });
  for (const [order, instance] of destination.entries()) instance.order = order;
  for (const targetDock of DOCKS) {
    if (targetDock === dock) continue;
    result.filter((instance) => instance.dock === targetDock)
      .sort((a, b) => a.order - b.order)
      .forEach((instance, order) => { instance.order = order; });
  }
  result.push(...destination.filter((instance) => !result.some((entry) => entry.id === instance.id)));
  return result;
}

function setOrder(instances, id, delta) {
  const instance = instances.find((item) => item.id === id);
  if (!instance) return instances;
  const dockItems = instances.filter((item) => item.dock === instance.dock)
    .sort((a, b) => a.order - b.order);
  const index = dockItems.findIndex((item) => item.id === id);
  const next = Math.max(0, Math.min(dockItems.length - 1, index + delta));
  if (next === index) return instances;
  [dockItems[index], dockItems[next]] = [dockItems[next], dockItems[index]];
  dockItems.forEach((item, order) => { item.order = order; });
  return instances;
}

function formatStatus(state) {
  if (state.error) return state.error.message;
  if (state.storageStatus === 'memory-only') return 'Workspace changes are available in this page only.';
  if (state.storageStatus === 'not-saved') return state.error?.message ?? 'Workspace changes were not saved.';
  if (state.storageStatus === 'recovery') return state.error?.message ?? 'Temporary defaults are in use.';
  return '';
}

function observationStatus(state) {
  if (state.connection !== 'connected' || state.sourceStatus === 'unavailable' ||
      state.sourceStatus === 'unknown' || state.coverage === 'unknown' ||
      state.sourceStatus !== 'available' && state.sourceStatus !== 'partial') {
    return 'unknown';
  }
  return state.sourceStatus === 'partial' || state.coverage === 'partial' ? 'partial' : '';
}

export function createWorkspaceUI({
  document,
  root,
  opener,
  store = createWorkspaceStore(),
  feed,
  timelinePreview,
  closeTimeline = () => {},
  sessionStatsDialog,
  pageActivityTotals,
  expandedSessionStats = new Set(),
}) {
  const docks = new Map(DOCKS.map((name) => [
    name,
    root.querySelector(`[data-workspace-dock="${name}"]`),
  ]));
  const assets = root.querySelector('[data-workspace-assets]');
  if (!assets || [...docks.values()].some((dock) => !dock)) {
    throw new Error('Workspace dock containers are missing.');
  }
  if (timelinePreview) assets.append(timelinePreview);

  const storeState = store.getState();
  let profiles = clone(storeState.profiles);
  let activeProfileId = storeState.activeProfileId;
  let draft = clone(profiles.find((profile) => profile.id === activeProfileId));
  let activityState = {
    connection: 'connecting',
    sourceStatus: 'unknown',
    coverage: 'unknown',
    sessions: [],
  };
  let currentSessionRows = [];
  let isEditing = false;
  let openSettingsId = null;
  let activeDrag = null;
  let pendingSwitch = null;
  let idSequence = 0;
  const moduleViews = new Map();
  const collapsed = new Set();

  const dialog = element(document, 'dialog', 'workspace-dialog');
  dialog.setAttribute('aria-labelledby', 'workspace-dialog-title');
  const dialogHeader = element(document, 'header', 'workspace-dialog-header');
  const dialogTitle = element(document, 'h2', '', 'Workspace');
  dialogTitle.id = 'workspace-dialog-title';
  const closeButton = button(document, 'Close', 'workspace-close');
  closeButton.setAttribute('aria-label', 'Close workspace controls');
  dialogHeader.append(dialogTitle, closeButton);
  const editor = element(document, 'div', 'workspace-editor');
  const status = element(document, 'p', 'workspace-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  dialog.append(dialogHeader, editor);
  document.body.append(dialog);

  const profileLabel = element(document, 'label', 'workspace-label', 'Profile');
  const profileSelect = element(document, 'select', 'workspace-profile-select');
  profileLabel.append(profileSelect);
  const saveButton = button(document, 'Save changes');
  const resetButton = button(document, 'Reset layout');
  const editButton = button(document, 'Edit layout');
  editButton.setAttribute('aria-pressed', 'false');
  const profileActions = element(document, 'section', 'workspace-profile-actions');
  profileActions.setAttribute('aria-label', 'Workspace profile actions');
  const renameInput = element(document, 'input');
  renameInput.type = 'text';
  renameInput.maxLength = 48;
  renameInput.setAttribute('aria-label', 'Profile name');
  const renameButton = button(document, 'Rename');
  const deleteButton = button(document, 'Delete profile');
  const newProfileInput = element(document, 'input');
  newProfileInput.type = 'text';
  newProfileInput.maxLength = 48;
  newProfileInput.setAttribute('aria-label', 'New profile name');
  newProfileInput.placeholder = 'New profile name';
  const saveAsButton = button(document, 'Save as');
  profileActions.append(renameInput, renameButton, deleteButton, newProfileInput, saveAsButton);
  const storageActions = element(document, 'div', 'workspace-storage-actions');
  const retrySaveButton = button(document, 'Retry save');
  const recoverButton = button(document, 'Replace corrupt workspace');
  storageActions.append(retrySaveButton, recoverButton);

  const catalog = element(document, 'section', 'workspace-catalog');
  catalog.setAttribute('aria-label', 'Add a module');
  const catalogLabel = element(document, 'label', 'workspace-label', 'Add module');
  const catalogSelect = element(document, 'select');
  catalogSelect.setAttribute('aria-label', 'Module type');
  for (const [type, definition] of Object.entries(WORKSPACE_MODULES)) {
    const option = element(document, 'option', '', definition.label);
    option.value = type;
    catalogSelect.append(option);
  }
  const addButton = button(document, 'Add module');
  catalogLabel.append(catalogSelect);
  catalog.append(catalogLabel, addButton);
  const tools = element(document, 'div', 'workspace-toolbar');
  tools.append(profileLabel, saveButton, resetButton, editButton);
  editor.append(tools, profileActions, storageActions, catalog, status);

  const dirtyConfirmation = element(document, 'section', 'workspace-confirmation');
  dirtyConfirmation.hidden = true;
  dirtyConfirmation.setAttribute('aria-labelledby', 'workspace-confirmation-title');
  const confirmTitle = element(document, 'h3', '', 'Unsaved workspace changes');
  confirmTitle.id = 'workspace-confirmation-title';
  const confirmText = element(document, 'p', '', 'Save these changes before switching profiles?');
  const saveAndSwitchButton = button(document, 'Save');
  const discardAndSwitchButton = button(document, 'Discard');
  const cancelSwitchButton = button(document, 'Cancel');
  dirtyConfirmation.append(confirmTitle, confirmText, saveAndSwitchButton,
    discardAndSwitchButton, cancelSwitchButton);
  editor.append(dirtyConfirmation);

  const mobileClose = button(document, 'Return to scene', 'workspace-mobile-close');
  mobileClose.addEventListener('click', () => closeMobileDrawer());
  root.prepend(mobileClose);
  const settingsButton = button(document, 'Workspace settings', 'workspace-settings-open');
  settingsButton.addEventListener('click', () => openEditor());
  root.prepend(settingsButton);

  const editingBar = element(document, 'div', 'workspace-editing-bar');
  editingBar.hidden = true;
  const editingLabel = element(document, 'span');
  const editingSave = button(document, 'Save changes');
  const editingDone = button(document, 'Done');
  editingDone.setAttribute('aria-label', 'Finish editing layout');
  editingBar.append(editingLabel, editingSave, editingDone);
  root.prepend(editingBar);

  function isDirty() {
    const original = profiles.find((profile) => profile.id === activeProfileId);
    return store.getState().dirty || !original || JSON.stringify(original) !== JSON.stringify(draft);
  }

  function hasDraftChanges() {
    const original = profiles.find((profile) => profile.id === activeProfileId);
    return !original || JSON.stringify(original) !== JSON.stringify(draft);
  }

  function updateStateFromStore(message = '') {
    const state = store.getState();
    profiles = clone(state.profiles);
    activeProfileId = state.activeProfileId;
    draft = clone(profiles.find((profile) => profile.id === activeProfileId));
    status.textContent = message || formatStatus(state);
    renderEditor();
    renderModules();
  }

  function showStoreResult(result, successMessage) {
    if (result.ok) {
      updateStateFromStore(successMessage);
      return true;
    }
    const nextState = result.state ?? store.getState();
    profiles = clone(nextState.profiles);
    activeProfileId = nextState.activeProfileId;
    const current = profiles.find((profile) => profile.id === activeProfileId);
    if (current) draft = clone(current);
    status.textContent = result.error?.message ?? formatStatus(nextState) ?? 'Workspace changes were not saved.';
    renderEditor();
    renderModules();
    return false;
  }

  function closeMobileDrawer() {
    document.body.classList.remove('workspace-mobile-open');
    opener.setAttribute('aria-expanded', 'false');
    opener.focus({ preventScroll: true });
  }

  function openEditor() {
    if (!dialog.open) dialog.showModal();
  }

  function closeEditor() {
    if (dialog.open) dialog.close();
  }

  function nextOrder(dock) {
    return draft.instances.filter((instance) => instance.dock === dock).length;
  }

  function changeInstances(next, focusId = null) {
    draft.instances = next;
    status.textContent = 'Unsaved changes';
    renderModules();
    renderEditor();
    if (focusId && !dialog.open) focusModule(focusId);
  }

  function focusModule(id) {
    const view = moduleViews.get(id);
    (view ? isEditing ? view.handle : view.settingsToggle : settingsButton)
      .focus({ preventScroll: true });
  }

  function moveInstance(id, dock, index) {
    if (!DOCKS.includes(dock)) return;
    if (draft.instances.find((instance) => instance.id === id)?.type === 'timeline') closeTimeline();
    changeInstances(reorder(draft.instances, id, dock, index), id);
  }

  function updateInstance(id, update) {
    const next = clone(draft.instances);
    const instance = next.find((item) => item.id === id);
    if (!instance) return;
    Object.assign(instance, update);
    changeInstances(next);
  }

  function removeInstance(id) {
    const view = moduleViews.get(id);
    const instance = draft.instances.find((item) => item.id === id);
    if (instance?.type === 'timeline') {
      closeTimeline();
      if (timelinePreview) assets.append(timelinePreview);
    }
    const next = draft.instances.filter((item) => item.id !== id);
    next.forEach((item) => {
      const dockItems = next.filter((candidate) => candidate.dock === item.dock)
        .sort((a, b) => a.order - b.order);
      dockItems.forEach((candidate, order) => { candidate.order = order; });
    });
    if (view?.list) sessionStatsDialog?.unregisterList?.(view.list);
    collapsed.delete(id);
    changeInstances(next);
    const neighbor = next.find((item) => item.dock === instance?.dock);
    if (!dialog.open) {
      if (neighbor) focusModule(neighbor.id);
      else opener.focus({ preventScroll: true });
    }
  }

  function addModule(type) {
    const definition = WORKSPACE_MODULES[type];
    if (!definition || draft.instances.length >= 12) return;
    if (type === 'timeline' && draft.instances.some((instance) => instance.type === 'timeline')) {
      status.textContent = 'Only one timeline can be in the workspace.';
      return;
    }
    const config = clone(definition.defaultConfig);
    const instance = {
      id: `module-${(++idSequence).toString(36)}-${Date.now().toString(36)}`,
      type,
      displayName: definition.label,
      dock: definition.defaultDock,
      order: nextOrder(definition.defaultDock),
      size: 'standard',
      config,
    };
    changeInstances([...draft.instances, instance], instance.id);
    status.textContent = 'Unsaved changes';
  }

  function beginProfileSwitch(profileId) {
    if (!profiles.some((profile) => profile.id === profileId) || profileId === activeProfileId) return;
    if (store.getState().dirty) {
      status.textContent = store.getState().recoveryRequired
        ? 'Temporary workspace changes must be explicitly saved before switching profiles.'
        : 'Workspace changes are not saved. Retry saving before switching profiles.';
      profileSelect.value = activeProfileId;
      return;
    }
    if (hasDraftChanges()) {
      pendingSwitch = profileId;
      dirtyConfirmation.hidden = false;
      profileSelect.value = activeProfileId;
      saveAndSwitchButton.focus({ preventScroll: true });
      return;
    }
    switchProfile(profileId);
  }

  function switchProfile(profileId) {
    closeTimeline();
    openSettingsId = null;
    const result = store.selectProfile(profileId);
    showStoreResult(result, `Switched to ${profiles.find((profile) => profile.id === profileId)?.name ?? 'workspace'}.`);
    pendingSwitch = null;
    dirtyConfirmation.hidden = true;
    profileSelect.focus({ preventScroll: true });
  }

  function saveDraft() {
    const result = store.updateProfile(activeProfileId, {
      name: draft.name,
      instances: draft.instances,
    });
    return showStoreResult(result, 'Workspace saved.');
  }

  function setModuleSettings(id, open, restoreFocus = false) {
    openSettingsId = open ? id : null;
    for (const [viewId, view] of moduleViews) {
      const expanded = viewId === openSettingsId;
      view.controls.hidden = !expanded;
      view.settingsToggle.setAttribute('aria-expanded', String(expanded));
    }
    if (restoreFocus) moduleViews.get(id)?.settingsToggle.focus({ preventScroll: true });
  }

  function makeModuleView(instance) {
    const panel = element(document, 'section', 'workspace-module');
    panel.dataset.instanceId = instance.id;
    panel.dataset.moduleType = instance.type;
    const header = element(document, 'header', 'workspace-module-header');
    const handle = button(document, '↕', 'workspace-drag-handle');
    handle.setAttribute('aria-label', `Move ${instance.displayName}`);
    handle.setAttribute('aria-hidden', 'true');
    handle.tabIndex = -1;
    const title = element(document, 'h2', '', instance.displayName);
    title.id = `workspace-title-${instance.id}`;
    const settingsToggle = button(document, 'Settings', 'workspace-module-settings');
    settingsToggle.setAttribute('aria-label', `Settings for ${instance.displayName}`);
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-controls', `workspace-settings-${instance.id}`);
    const collapseButton = button(document, 'Collapse', 'workspace-collapse');
    collapseButton.setAttribute('aria-expanded', 'true');
    collapseButton.setAttribute('aria-controls', `workspace-content-${instance.id}`);
    header.append(handle, title, settingsToggle, collapseButton);
    panel.setAttribute('aria-labelledby', title.id);
    panel.append(header);
    const content = element(document, 'div', 'workspace-module-content');
    content.id = `workspace-content-${instance.id}`;
    const filterSummary = element(document, 'p', 'workspace-filter-summary');
    content.append(filterSummary);
    const controls = element(document, 'section', 'workspace-module-actions');
    controls.id = `workspace-settings-${instance.id}`;
    controls.setAttribute('aria-label', `${instance.displayName} settings`);
    controls.hidden = true;
    const options = element(document, 'div', 'workspace-module-options');
    const layout = element(document, 'fieldset', 'workspace-module-layout');
    layout.append(element(document, 'legend', '', 'Layout'));
    const movement = element(document, 'div', 'workspace-module-movement');
    for (const dock of DOCKS) {
      const move = button(document, `Move to ${dock === 'bottom-left' ? 'lower left' : dock}`);
      move.dataset.moveDock = dock;
      movement.append(move);
    }
    const earlier = button(document, 'Move earlier');
    earlier.dataset.orderDelta = '-1';
    const later = button(document, 'Move later');
    later.dataset.orderDelta = '1';
    movement.append(earlier, later);
    const sizeLabel = element(document, 'label', 'workspace-label', 'Size');
    const sizeSelect = element(document, 'select');
    sizeSelect.dataset.moduleSize = '';
    for (const [size, label] of Object.entries(SIZE_LABELS)) {
      const option = element(document, 'option', '', label);
      option.value = size;
      sizeSelect.append(option);
    }
    sizeLabel.append(sizeSelect);
    const remove = button(document, 'Remove from workspace');
    remove.dataset.removeModule = '';
    movement.append(sizeLabel);
    layout.append(movement);
    const saveStatus = element(document, 'p', 'workspace-module-save-status');
    saveStatus.setAttribute('role', 'status');
    const save = button(document, 'Save changes');
    const closeSettings = button(document, 'Close settings');
    const footer = element(document, 'div', 'workspace-module-settings-footer');
    footer.append(save, closeSettings);
    controls.append(options, layout, remove, saveStatus, footer);
    panel.append(controls, content);
    const view = { panel, header, handle, title, settingsToggle, collapseButton, content,
      filterSummary, controls, options, layout, saveStatus, save };

    settingsToggle.addEventListener('click', () => {
      setModuleSettings(instance.id, openSettingsId !== instance.id);
    });
    closeSettings.addEventListener('click', () => setModuleSettings(instance.id, false, true));
    save.addEventListener('click', () => {
      const restoreFocus = document.activeElement === save;
      if (saveDraft() && restoreFocus) closeSettings.focus({ preventScroll: true });
    });
    collapseButton.addEventListener('click', () => {
      setModuleSettings(instance.id, false);
      if (collapsed.has(instance.id)) collapsed.delete(instance.id);
      else collapsed.add(instance.id);
      renderModules();
      collapseButton.focus({ preventScroll: true });
    });
    controls.addEventListener('click', (event) => event.stopPropagation());
    controls.addEventListener('pointerdown', (event) => event.stopPropagation());
    controls.addEventListener('change', (event) => {
      if (event.target === sizeSelect) updateInstance(instance.id, { size: sizeSelect.value });
    });
    options.addEventListener('change', (event) => {
      if (event.target.matches('[data-all-categories]')) {
        for (const field of options.querySelectorAll('[data-category]')) {
          field.checked = event.target.checked;
        }
      }
      if (event.target.matches('[data-module-config]')) {
        const config = readConfig(view);
        if (config) {
          syncCategorySelection(view, config.categories);
          view.configSignature = JSON.stringify(config);
          updateInstance(instance.id, { config });
        }
      }
    });
    movement.addEventListener('click', (event) => {
      const moveDock = event.target.closest('[data-move-dock]')?.dataset.moveDock;
      if (moveDock) {
        moveInstance(instance.id, moveDock, Number.MAX_SAFE_INTEGER);
        return;
      }
      const delta = Number(event.target.closest('[data-order-delta]')?.dataset.orderDelta);
      if (Number.isInteger(delta) && delta) {
        const next = clone(draft.instances);
        setOrder(next, instance.id, delta);
        changeInstances(next, instance.id);
        return;
      }
    });
    remove.addEventListener('click', () => removeInstance(instance.id));
    handle.addEventListener('pointerdown', (event) => startDrag(event, instance.id));
    handle.addEventListener('pointermove', dragMove);
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', cancelDrag);
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeDrag) cancelDrag(event);
    });
    return view;
  }

  function readConfig(view) {
    const config = {};
    if (view.options.querySelector('[data-all-categories]')) {
      config.categories = [...view.options.querySelectorAll('[data-category]:checked')]
        .map((field) => field.value);
    }
    for (const field of view.options.querySelectorAll('[data-module-config]')) {
      if (field.matches('[data-all-categories], [data-category]')) continue;
      if (field.type === 'checkbox') config[field.name] = field.checked;
      else if (field.type === 'select-one') config[field.name] = field.value;
    }
    const instance = draft.instances.find((item) => item.id === view.panel.dataset.instanceId);
    return instance ? { ...instance.config, ...config } : null;
  }

  function addConfigSelect(view, labelText, name, options, value) {
    const label = element(document, 'label', 'workspace-label', labelText);
    const select = element(document, 'select');
    select.name = name;
    select.dataset.moduleConfig = '';
    for (const [optionValue, optionLabel] of options) {
      const option = element(document, 'option', '', optionLabel);
      option.value = optionValue;
      option.selected = value === optionValue;
      select.append(option);
    }
    label.append(select);
    view.options.append(label);
  }

  function syncCategorySelection(view, categories) {
    const all = view.options.querySelector('[data-all-categories]');
    if (!all) return;
    all.checked = categories.length === CATEGORIES.length;
    all.indeterminate = categories.length > 0 && !all.checked;
  }

  function renderConfig(view, instance) {
    const { options } = view;
    options.replaceChildren();
    if (instance.type === 'feed' || instance.type === 'totals') {
      const categories = element(document, 'fieldset', 'workspace-category-options');
      categories.append(element(document, 'legend', '', 'Categories'));
      const allLabel = element(document, 'label', 'workspace-category-all', 'All categories');
      const all = element(document, 'input');
      all.type = 'checkbox';
      all.dataset.allCategories = '';
      all.dataset.moduleConfig = '';
      allLabel.prepend(all);
      categories.append(allLabel);
      const grid = element(document, 'div', 'workspace-category-grid');
      for (const category of CATEGORIES) {
        const label = element(document, 'label', '',
          category.charAt(0).toUpperCase() + category.slice(1));
        const checkbox = element(document, 'input');
        checkbox.type = 'checkbox';
        checkbox.value = category;
        checkbox.dataset.category = category;
        checkbox.dataset.moduleConfig = '';
        checkbox.checked = instance.config.categories.includes(category);
        label.prepend(checkbox);
        grid.append(label);
      }
      categories.append(grid);
      options.append(categories);
      syncCategorySelection(view, instance.config.categories);
    }
    if (instance.type === 'feed') {
      addConfigSelect(view, 'Density', 'density',
        [['compact', 'Compact'], ['comfortable', 'Comfortable']], instance.config.density);
      const label = element(document, 'label', 'workspace-label', 'Show legend');
      const checkbox = element(document, 'input');
      checkbox.type = 'checkbox';
      checkbox.name = 'showLegend';
      checkbox.dataset.moduleConfig = '';
      checkbox.checked = instance.config.showLegend;
      label.append(checkbox);
      options.append(label);
    } else if (instance.type === 'sessions') {
      addConfigSelect(view, 'Session filter', 'filter',
        [['all', 'All sessions'], ['running', 'Running'], ['waiting', 'Waiting']], instance.config.filter);
      addConfigSelect(view, 'Density', 'density',
        [['compact', 'Compact'], ['comfortable', 'Comfortable']], instance.config.density);
    } else if (instance.type === 'totals') {
      addConfigSelect(view, 'Presentation', 'presentation',
        [['compact', 'Compact'], ['list', 'List']], instance.config.presentation);
    }
  }

  function renderLegend(content) {
    const list = element(document, 'ul', 'activity-legend-list');
    for (const category of CATEGORIES) {
      const row = element(document, 'li', `legend-row impulse-cat-${category}`);
      row.dataset.category = category;
      const swatch = element(document, 'span', 'legend-swatch', CATEGORY_GLYPH[category]);
      swatch.style.backgroundColor = CATEGORY_HEX[category];
      const name = element(document, 'span', 'legend-name', category);
      row.append(swatch, name);
      list.append(row);
    }
    content.append(list);
  }

  function renderContent(view, instance) {
    const { content } = view;
    view.filterSummary.hidden = !['feed', 'totals', 'sessions'].includes(instance.type);
    view.filterSummary.textContent = instance.config.categories
      ? instance.config.categories.length === CATEGORIES.length ? 'All categories'
        : instance.config.categories.length ? `${instance.config.categories.length} categories`
          : 'No categories selected'
      : instance.type === 'sessions' ? {
        all: 'All sessions', running: 'Running', waiting: 'Waiting',
      }[instance.config.filter] : '';
    if (instance.type === 'timeline') {
      if (timelinePreview && timelinePreview.parentElement !== content) content.append(timelinePreview);
    } else if (instance.type === 'feed') {
      let list = content.querySelector('ol.workspace-feed');
      if (!list) {
        const details = element(document, 'details', 'workspace-feed-legend');
        const summary = element(document, 'summary', '', 'Activity legend');
        const legend = element(document, 'div');
        renderLegend(legend);
        details.append(summary, legend);
        view.feedState = element(document, 'p', 'workspace-feed-state');
        view.feedState.setAttribute('role', 'status');
        view.feedState.setAttribute('aria-live', 'polite');
        list = element(document, 'ol', 'workspace-feed');
        view.feedRows = new Map();
        content.append(view.feedState, list, details);
      }
      const legend = content.querySelector('.workspace-feed-legend');
      legend.hidden = !instance.config.showLegend;
      list.classList.toggle('is-compact', instance.config.density === 'compact');
      renderFeed(list, instance.config.categories, view.feedState, view.feedRows);
    } else if (instance.type === 'sessions') {
      let state = content.querySelector('.workspace-session-state');
      if (!state) {
        state = element(document, 'p', 'workspace-session-state');
        state.setAttribute('role', 'status');
        const list = element(document, 'ol', 'workspace-session-list');
        list.tabIndex = 0;
        list.setAttribute('aria-label', 'Session statuses and elapsed time');
        list.setAttribute('aria-live', 'off');
        content.append(state, list, view.more);
        view.list = list;
        sessionStatsDialog?.registerList?.(list);
      }
      const list = view.list;
      const coverage = observationStatus(activityState);
      const unknown = coverage !== '';
      content.classList.toggle('is-unknown', unknown);
      list.classList.toggle('is-compact', instance.config.density === 'compact');
      if (unknown) {
        clearSessionStats(list, new Set());
        list.hidden = true;
        view.more.textContent = '';
        state.textContent = coverage === 'partial'
          ? 'COVERAGE PARTIAL · SESSION COVERAGE UNKNOWN' : 'COVERAGE UNKNOWN';
        view.rows = [];
      } else {
        let sessions = Array.isArray(activityState.sessions) ? activityState.sessions : [];
        if (instance.config.filter === 'running') {
          sessions = sessions.filter(({ status }) => status === 'running' || status === 'running-unverified');
        } else if (instance.config.filter === 'waiting') {
          sessions = sessions.filter(({ status }) => status === 'waiting');
        }
        const expected = instance.config.filter === 'running'
          ? activityState.runningSessions
          : instance.config.filter === 'waiting'
            ? activityState.waitingSessions
            : activityState.sessions?.length;
        const truncated = activityState.sessionsTruncated === true;
        const omitted = Math.max(0, (expected ?? sessions.length) - sessions.length);
        list.hidden = sessions.length === 0;
        state.textContent = sessions.length ? ''
          : truncated ? 'Additional sessions not shown' : 'No matching sessions';
        const filteredRows = renderSessionRows({
          document,
          list,
          sessions,
          expandedSessionStats,
          receivedAt: performance.now(),
          formatElapsed: formatSessionElapsed,
          statusLabels: SESSION_LABELS,
          pruneExpanded: false,
        });
        view.rows = filteredRows;
        view.more.textContent = sessions.length && truncated
          ? omitted > 0 ? `+${omitted} more not shown` : 'More sessions not shown'
          : '';
      }
    } else if (instance.type === 'totals') {
      const totals = renderPageActivityTotals(document, pageActivityTotals);
      let coverageNote = content.querySelector('.workspace-coverage-note');
      if (!coverageNote) {
        coverageNote = element(document, 'p', 'workspace-coverage-note');
        coverageNote.setAttribute('role', 'status');
        coverageNote.setAttribute('aria-live', 'polite');
        content.prepend(coverageNote);
      }
      const coverage = observationStatus(activityState);
      coverageNote.hidden = !coverage;
      coverageNote.textContent = coverage === 'partial'
        ? 'COVERAGE PARTIAL · totals include observed live arrivals only'
        : coverage === 'unknown' ? 'COVERAGE UNKNOWN · totals may be incomplete' : '';
      const selected = new Set(instance.config.categories);
      let empty = content.querySelector('.workspace-empty');
      if (!empty) {
        empty = element(document, 'p', 'workspace-empty', 'Choose categories in Settings.');
        content.append(empty);
      }
      empty.hidden = selected.size > 0;
      for (const row of totals.querySelectorAll('li')) {
        const category = row.textContent.split(':', 1)[0];
        row.hidden = !selected.has(category);
      }
      totals.classList.toggle('is-list', instance.config.presentation === 'list');
      const current = content.querySelector('.page-activity-stats');
      current?.replaceWith(totals);
      if (!current) content.append(totals);
    } else if (instance.type === 'legend' && !content.querySelector('.activity-legend-list')) {
      renderLegend(content);
    }
  }

  function formatSessionElapsed(elapsedMs) {
    const seconds = Math.floor(Math.min(1_000_000_000, Math.max(0, elapsedMs)) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours >= 1000) return '>999h';
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function renderFeed(list, categories, state, rows) {
    if (!feed) return;
    const entries = (feed.getEntries?.() ?? []).filter((entry) => categories.includes(entry.category));
    const coverage = observationStatus(activityState);
    state.hidden = !coverage;
    state.textContent = coverage === 'partial'
      ? 'COVERAGE PARTIAL · ACTIVITY VIEW INCOMPLETE'
      : coverage === 'unknown' ? 'COVERAGE UNKNOWN · ACTIVITY VIEW UNKNOWN' : '';
    const retainedIds = new Set(entries.map(({ id }) => id));
    for (const [id, row] of rows) {
      if (retainedIds.has(id)) continue;
      row.remove();
      rows.delete(id);
    }
    const showEmpty = !categories.length || !entries.length && !coverage;
    let empty = list.querySelector('.workspace-empty');
    if (!showEmpty) empty?.remove();
    for (const [index, entry] of entries.entries()) {
      let row = rows.get(entry.id);
      if (!row) {
        row = element(document, 'li', `impulse-entry impulse-${entry.kind} impulse-cat-${entry.category}`,
          entry.label);
        row.dataset.category = entry.category;
        row.dataset.glyph = entry.glyph;
        rows.set(entry.id, row);
      }
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    }
    if (showEmpty) {
      if (!empty) {
        empty = element(document, 'li', 'workspace-empty');
        list.append(empty);
      }
      empty.textContent = categories.length ? 'No matching activity' : 'Choose categories in Settings.';
    }
  }

  function renderModules() {
    const currentIds = new Set(draft.instances.map(({ id }) => id));
    let focusedPanelRemoved = false;
    for (const [id, view] of moduleViews) {
      if (currentIds.has(id)) continue;
      focusedPanelRemoved ||= view.panel.contains(document.activeElement);
      if (timelinePreview && view.panel.contains(timelinePreview)) assets.append(timelinePreview);
      view.panel.remove();
      if (view.list) sessionStatsDialog?.unregisterList?.(view.list);
      moduleViews.delete(id);
      if (openSettingsId === id) openSettingsId = null;
    }
    const dockIndices = new Map(DOCKS.map((name) => [name, 0]));
    for (const instance of sortInstances(draft.instances)) {
      let view = moduleViews.get(instance.id);
      if (!view) {
        view = makeModuleView(instance);
        view.expandedStats = expandedSessionStats;
        view.rows = [];
        view.more = element(document, 'p', 'workspace-session-more');
        if (instance.type === 'sessions') view.content.append(view.more);
        moduleViews.set(instance.id, view);
      }
      view.panel.dataset.moduleType = instance.type;
      view.panel.dataset.size = instance.size;
      view.panel.dataset.dock = instance.dock;
      view.title.textContent = instance.displayName;
      view.handle.setAttribute('aria-label', `Move ${instance.displayName}`);
      view.controls.querySelector('[data-module-size]').value = instance.size;
      view.handle.hidden = !isEditing;
      view.handle.setAttribute('aria-hidden', String(!isEditing));
      view.handle.tabIndex = isEditing ? 0 : -1;
      view.layout.hidden = !isEditing;
      view.controls.hidden = openSettingsId !== instance.id;
      view.settingsToggle.setAttribute('aria-expanded', String(!view.controls.hidden));
      view.save.disabled = !isDirty();
      view.saveStatus.textContent = formatStatus(store.getState()) || (isDirty()
        ? 'Unsaved changes · Save changes saves the workspace.' : '');
      view.collapseButton.textContent = collapsed.has(instance.id) ? 'Expand' : 'Collapse';
      view.collapseButton.setAttribute('aria-expanded', String(!collapsed.has(instance.id)));
      view.content.hidden = collapsed.has(instance.id);
      view.panel.classList.toggle('is-unknown', observationStatus(activityState) !== '');
      renderContent(view, instance);
      const configSignature = JSON.stringify(instance.config);
      if (view.configSignature !== configSignature) {
        renderConfig(view, instance);
        view.configSignature = configSignature;
      }
      const dock = docks.get(instance.dock);
      const index = dockIndices.get(instance.dock);
      const current = dock.children[index];
      if (current !== view.panel) dock.insertBefore(view.panel, current ?? null);
      dockIndices.set(instance.dock, index + 1);
    }
    const allExpanded = new Set([...moduleViews.values()].flatMap(({ expandedStats }) =>
      [...(expandedStats ?? [])]));
    const availableKeys = new Set([...moduleViews.values()]
      .filter(({ list }) => list)
      .flatMap(({ list }) => [...list.querySelectorAll('[data-session-key]')]
        .map((toggle) => toggle.dataset.sessionKey)));
    for (const key of allExpanded) {
      if (!availableKeys.has(key)) {
        for (const view of moduleViews.values()) view.expandedStats?.delete(key);
      }
    }
    currentSessionRows = [...moduleViews.values()].flatMap((view) => view.rows ?? []);
    if (focusedPanelRemoved) {
      const first = sortInstances(draft.instances)[0];
      if (!dialog.open) focusModule(first?.id);
    }
  }

  function renderEditor() {
    const current = profiles.find((profile) => profile.id === activeProfileId);
    profileSelect.replaceChildren();
    for (const profile of profiles) {
      const option = element(document, 'option', '', profile.name);
      option.value = profile.id;
      option.selected = profile.id === activeProfileId;
      profileSelect.append(option);
    }
    renameInput.value = draft.name;
    deleteButton.disabled = activeProfileId === 'default';
    renameInput.disabled = activeProfileId === 'default';
    renameButton.disabled = activeProfileId === 'default';
    saveButton.disabled = !isDirty();
    editingBar.hidden = !isEditing && !isDirty();
    editingLabel.textContent = formatStatus(store.getState()) ||
      (isEditing ? 'Editing layout' : 'Unsaved changes');
    editingSave.disabled = !isDirty();
    editingDone.hidden = !isEditing;
    const state = store.getState();
    discardAndSwitchButton.disabled = state.dirty;
    retrySaveButton.hidden = !state.dirty || state.recoveryRequired;
    recoverButton.hidden = !state.recoveryRequired;
    status.textContent ||= formatStatus(store.getState());
    const hasTimeline = draft.instances.some((instance) => instance.type === 'timeline');
    const selectedType = catalogSelect.value || 'feed';
    const timelineOption = [...catalogSelect.options].find((option) => option.value === 'timeline');
    if (timelineOption) {
      timelineOption.disabled = hasTimeline;
      timelineOption.textContent = hasTimeline ? 'Timeline (already in workspace)' : 'Timeline';
    }
    addButton.disabled = draft.instances.length >= 12 ||
      (selectedType === 'timeline' && hasTimeline);
    if (!current) status.textContent = 'The active workspace profile is missing.';
  }

  function startDrag(event, id) {
    if (!isEditing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activeDrag = { id, pointerId: event.pointerId, handle: event.currentTarget, target: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    root.classList.add('is-dragging');
  }

  function dragMove(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.preventDefault();
    const target = document.elementFromPoint?.(event.clientX, event.clientY);
    const dock = target?.closest?.('[data-workspace-dock]');
    for (const container of docks.values()) container.classList.remove('is-drop-target');
    if (dock) {
      dock.classList.add('is-drop-target');
      const beforePanel = target.closest?.('.workspace-module');
      const before = beforePanel?.dataset.instanceId;
      activeDrag.target = {
        dock: dock.dataset.workspaceDock,
        before: before === activeDrag.id ? null : before,
      };
    } else activeDrag.target = null;
  }

  function finishDrag(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const { id, target } = activeDrag;
    clearDrag();
    if (!target) return;
    const destination = draft.instances.filter((instance) => instance.dock === target.dock)
      .sort((a, b) => a.order - b.order);
    const index = target.before
      ? destination.findIndex((instance) => instance.id === target.before)
      : destination.length;
    moveInstance(id, target.dock, index < 0 ? destination.length : index);
  }

  function clearDrag() {
    if (activeDrag?.handle.hasPointerCapture?.(activeDrag.pointerId)) {
      activeDrag.handle.releasePointerCapture(activeDrag.pointerId);
    }
    activeDrag = null;
    root.classList.remove('is-dragging');
    for (const dock of docks.values()) dock.classList.remove('is-drop-target');
  }

  function cancelDrag(event) {
    if (!activeDrag) return;
    event.preventDefault?.();
    clearDrag();
  }

  function setEditing(value) {
    isEditing = value;
    root.classList.toggle('is-editing', value);
    if (!value) clearDrag();
    editButton.textContent = value ? 'Finish editing layout' : 'Edit layout';
    editButton.setAttribute('aria-pressed', String(value));
    renderEditor();
    renderModules();
  }

  function requestSwitch(profileId) {
    beginProfileSwitch(profileId);
  }

  opener.addEventListener('click', () => {
    const isMobile = document.defaultView?.matchMedia?.('(max-width: 760px)')?.matches ??
      document.documentElement.clientWidth <= 760;
    if (isMobile) {
      const opening = !document.body.classList.contains('workspace-mobile-open');
      document.body.classList.toggle('workspace-mobile-open', opening);
      opener.setAttribute('aria-expanded', String(opening));
      if (opening) mobileClose.focus({ preventScroll: true });
      else opener.focus({ preventScroll: true });
      return;
    }
    openEditor();
  });
  closeButton.addEventListener('click', closeEditor);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeEditor();
  });
  dialog.addEventListener('close', () =>
    (isEditing ? editingDone : opener).focus({ preventScroll: true }));
  settingsButton.addEventListener('click', openEditor);
  profileSelect.addEventListener('change', () => requestSwitch(profileSelect.value));
  saveButton.addEventListener('click', saveDraft);
  retrySaveButton.addEventListener('click', () => {
    const result = store.retrySave();
    showStoreResult(result, 'Workspace saved.');
  });
  recoverButton.addEventListener('click', () => {
    const result = store.replaceCorruptStorage();
    showStoreResult(result, 'Workspace recovery saved.');
  });
  resetButton.addEventListener('click', () => {
    draft.instances = clone(createDefaultWorkspace().profiles[0].instances);
    status.textContent = 'Unsaved changes';
    renderEditor();
    renderModules();
  });
  editButton.addEventListener('click', () => {
    setEditing(!isEditing);
    closeEditor();
    (isEditing ? editingDone : opener).focus({ preventScroll: true });
  });
  editingSave.addEventListener('click', () => {
    if (saveDraft() && !isEditing) opener.focus({ preventScroll: true });
  });
  editingDone.addEventListener('click', () => {
    setEditing(false);
    opener.focus({ preventScroll: true });
  });
  catalogSelect.addEventListener('change', renderEditor);
  addButton.addEventListener('click', () => addModule(catalogSelect.value));
  renameButton.addEventListener('click', () => {
    draft.name = renameInput.value;
    status.textContent = 'Unsaved changes';
    renderEditor();
  });
  saveAsButton.addEventListener('click', () => {
    const result = store.createProfile(newProfileInput.value, clone(draft.instances));
    if (showStoreResult(result, 'Workspace profile created.')) newProfileInput.value = '';
  });
  deleteButton.addEventListener('click', () => {
    if (deleteButton.dataset.confirmDelete !== 'yes') {
      deleteButton.dataset.confirmDelete = 'yes';
      deleteButton.textContent = 'Confirm delete profile';
      return;
    }
    deleteButton.dataset.confirmDelete = 'no';
    deleteButton.textContent = 'Delete profile';
    const result = store.deleteProfile(activeProfileId);
    showStoreResult(result, 'Workspace profile deleted.');
  });
  saveAndSwitchButton.addEventListener('click', () => {
    if (!pendingSwitch || !saveDraft()) return;
    switchProfile(pendingSwitch);
  });
  discardAndSwitchButton.addEventListener('click', () => {
    if (!pendingSwitch) return;
    const target = pendingSwitch;
    switchProfile(target);
  });
  cancelSwitchButton.addEventListener('click', () => {
    pendingSwitch = null;
    dirtyConfirmation.hidden = true;
    profileSelect.value = activeProfileId;
    profileSelect.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activeDrag) cancelDrag(event);
    else if (openSettingsId && !dialog.open &&
        moduleViews.get(openSettingsId)?.panel.contains(event.target)) {
      event.preventDefault();
      setModuleSettings(openSettingsId, false, true);
    }
  });
  feed?.subscribe?.(() => renderModules());

  updateStateFromStore();

  return {
    update(nextState) {
      activityState = nextState ?? activityState;
      const known = observationStatus(activityState) === '';
      sessionStatsDialog?.update?.(
        activityState.sessions ?? [],
        known,
        projectActiveHudSessions(activityState) ?? [],
      );
      renderModules();
    },
    refresh() {
      renderModules();
    },
    tickSessionTimes(now) {
      for (const row of currentSessionRows) {
        row.time.textContent = formatSessionElapsed(row.elapsedMs + now - row.receivedAt);
      }
    },
    close() {
      closeTimeline();
      closeEditor();
    },
    store,
  };
}
