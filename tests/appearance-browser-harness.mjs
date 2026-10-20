import { VISUAL as currentVisualSettings } from '/visual-settings.mjs';
import { resolveVisualSettings } from '/visual-config.mjs';
import { createVisualSettingsPanel } from '/visual-settings-ui.mjs';
import { createNavigationUI } from '/navigation-ui.mjs';

const defaults = structuredClone(currentVisualSettings);
defaults.nodes.count = 40;
defaults.nodes.scale = 175;
const initial = resolveVisualSettings(defaults, 'balanced');
if (initial.errors.length) throw new Error(initial.errors[0].message);

const memoryStorage = new Map();
let activeNodeCount = defaults.nodes.count;
let appliedSettings = structuredClone(initial.settings);
let applyCount = 0;
let rebuildCount = 0;
let exportedBlob = null;
const originalCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = (blob) => {
  exportedBlob = blob;
  return originalCreateObjectURL.call(URL, blob);
};
HTMLAnchorElement.prototype.click = function click() {
  if (this.download !== 'visual-settings.mjs') {
    throw new Error('Unexpected synthetic browser download.');
  }
};

const workspace = document.getElementById('workspace');
const workspaceOpener = document.getElementById('workspace-open');
const panel = createVisualSettingsPanel({
  document,
  opener: document.getElementById('visual-settings-open'),
  dialog: document.getElementById('visual-settings-dialog'),
  form: document.getElementById('visual-settings-form'),
  presetSelect: document.getElementById('visual-settings-preset'),
  fields: document.getElementById('visual-settings-fields'),
  quickFields: document.getElementById('visual-settings-quick'),
  searchInput: document.getElementById('visual-settings-search'),
  searchStatus: document.getElementById('visual-settings-search-status'),
  clearSearchButton: document.getElementById('visual-settings-search-clear'),
  title: document.getElementById('visual-settings-title'),
  status: document.getElementById('visual-settings-status'),
  errorSummary: document.getElementById('visual-settings-errors'),
  conflict: document.getElementById('visual-settings-conflict'),
  useFileButton: document.getElementById('visual-settings-use-file'),
  keepPreviewButton: document.getElementById('visual-settings-keep-preview'),
  closeButton: document.getElementById('visual-settings-close'),
  resetButton: document.getElementById('visual-settings-reset'),
  exportButton: document.getElementById('visual-settings-export'),
  reloadButton: document.getElementById('visual-settings-reload'),
  autoReloadInput: document.getElementById('visual-settings-auto-reload'),
  presetNameInput: document.getElementById('visual-settings-preset-name'),
  saveAsPresetButton: document.getElementById('visual-settings-preset-save-as'),
  savePresetButton: document.getElementById('visual-settings-preset-save'),
  deletePresetButton: document.getElementById('visual-settings-preset-delete'),
  initialConfiguration: {
    defaults, preset: 'balanced', overrides: {}, settings: initial.settings,
  },
  getStorage: () => ({
    getItem(key) { return memoryStorage.get(key) ?? null; },
    setItem(key, value) { memoryStorage.set(key, value); },
  }),
  loadFile: async () => ({ defaults, preset: 'balanced', overrides: {}, errors: [] }),
  applySettings(settings) {
    applyCount++;
    appliedSettings = structuredClone(settings);
    if (settings.nodes.count !== activeNodeCount) {
      activeNodeCount = settings.nodes.count;
      rebuildCount++;
    }
    document.getElementById('scene-state').textContent =
      `Synthetic nodes: ${activeNodeCount} · rebuilds: ${rebuildCount}`;
    return true;
  },
  onOpenChange(open) {
    workspace.toggleAttribute('inert', open);
    workspaceOpener.disabled = open;
  },
});

const navigation = createNavigationUI({ document });

window.appearanceHarness = {
  panel,
  get counts() { return { applyCount, rebuildCount, activeNodeCount }; },
  get exportedBlob() { return exportedBlob; },
  async verifyExport() {
    if (!exportedBlob) throw new Error('Export was not captured.');
    const source = await exportedBlob.text();
    const readObject = (name) => {
      const expression = new RegExp(`export const ${name} = ([\\s\\S]*?);`);
      const match = expression.exec(source);
      if (!match) throw new Error(`Export is missing ${name}.`);
      return JSON.parse(match[1]);
    };
    const defaultsFromExport = readObject('VISUAL');
    const presetFromExport = readObject('VISUAL_PRESET');
    const overridesFromExport = readObject('VISUAL_OVERRIDES');
    const resolved = resolveVisualSettings(defaultsFromExport, presetFromExport, overridesFromExport);
    if (resolved.errors.length) throw new Error(resolved.errors[0].message);
    if (defaultsFromExport.nodes.scale !== 175 ||
        overridesFromExport.nodes.count !== 41 ||
        resolved.settings.nodes.scale !== 175 ||
        resolved.settings.nodes.count !== 41 ||
        resolved.settings.dust.scale !== 240.123456 ||
        resolved.settings.dust.rotationSpeed !== -0.06) {
      throw new Error('Exact synthetic values did not survive settings export.');
    }
    return {
      defaultsScale: defaultsFromExport.nodes.scale,
      overrideNodeCount: overridesFromExport.nodes.count,
      effectiveScale: resolved.settings.nodes.scale,
      effectiveNodeCount: resolved.settings.nodes.count,
      dustScale: resolved.settings.dust.scale,
      dustRotationSpeed: resolved.settings.dust.rotationSpeed,
    };
  },
  async verifyFlow() {
    const openButton = document.getElementById('visual-settings-open');
    const dialog = document.getElementById('visual-settings-dialog');
    if (dialog.open || getComputedStyle(dialog).display !== 'none' ||
        dialog.getClientRects().length !== 0) {
      throw new Error('Appearance must start closed and visually hidden.');
    }
    document.getElementById('application-menu-toggle').click();
    if (!navigation.isOpen()) throw new Error('The application menu did not open.');
    openButton.click();
    if (!dialog.open || workspace.hasAttribute('inert') !== true ||
        workspaceOpener.disabled !== true || getComputedStyle(dialog).display !== 'flex') {
      throw new Error('Appearance did not open without suspending Workspace.');
    }
    const fovField = document.querySelector(
      '#visual-settings-fields [data-setting-path="camera.fov"]',
    );
    const fovInput = fovField.querySelector('input[type="number"]');
    const fovDetails = fovField.querySelector('.visual-field-details');
    const fovHelp = fovField.querySelector('.visual-field-help');
    const fovError = fovField.querySelector('.visual-field-error');
    if (fovDetails.open || fovDetails.contains(fovHelp) ||
        fovDetails.contains(fovError) || /Enter a finite/.test(fovHelp.textContent)) {
      throw new Error('Effect descriptions and errors must remain outside technical Details.');
    }
    fovInput.value = '-1';
    fovInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (fovError.hidden || !fovError.getClientRects().length || fovDetails.open) {
      throw new Error('Invalid values must show errors with Details closed.');
    }
    fovInput.value = '65';
    fovInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    fovDetails.querySelector('summary').click();
    if (!fovDetails.open) throw new Error('Native setting Details did not open.');
    const fieldReset = fovDetails.querySelector('.visual-field-reset');
    fieldReset.focus();
    if (document.activeElement !== fieldReset) throw new Error('Field reset cannot receive focus.');
    fieldReset.click();
    if (appliedSettings.camera.fov !== defaults.camera.fov || !fovError.hidden) {
      throw new Error('Reset inside Details did not restore the file value and clear the error.');
    }
    fovDetails.querySelector('summary').click();
    const numericFields = [...document.querySelectorAll(
      '#visual-settings-fields [data-setting-path][data-quick-projection="false"]',
    )].filter((field) => field.querySelectorAll('input[type="number"]').length === 1);
    if (numericFields.length !== 143 || numericFields.some((field) =>
      field.querySelectorAll('input[type="range"]').length !== 1)) {
      throw new Error('Every scalar numeric setting must have one Advanced slider.');
    }
    const dustField = document.querySelector(
      '#visual-settings-fields [data-setting-path="dust.scale"]',
    );
    const dustSlider = dustField.querySelector('input[type="range"]');
    dustSlider.value = '72';
    dustSlider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (dustField.querySelector('input[type="number"]').value !== '72' ||
        appliedSettings.dust.scale !== 72) {
      throw new Error('Dust scale slider did not update the exact value and preview.');
    }
    const rotationSlider = document.querySelector(
      '#visual-settings-fields [data-setting-path="dust.rotationSpeed"] input[type="range"]',
    );
    rotationSlider.value = '-0.06';
    rotationSlider.dispatchEvent(new Event('input', { bubbles: true }));
    const dustInput = dustField.querySelector('input[type="number"]');
    dustInput.value = '240.123456';
    dustInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (appliedSettings.dust.rotationSpeed !== -0.06 ||
        appliedSettings.dust.scale !== 240.123456 ||
        dustInput.value !== '240.123456' || dustSlider.value !== '120') {
      throw new Error('Signed motion or out-of-slider dust scale lost its exact value.');
    }

    const count = document.querySelector(
      '#visual-settings-quick [data-setting-path="nodes.count"] input[type="number"]',
    );
    const countBefore = rebuildCount;
    for (const value of ['60', '61', '41']) {
      count.value = value;
      count.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (rebuildCount !== countBefore) throw new Error('Draft node counts rebuilt before commit.');
    count.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    if (rebuildCount !== countBefore + 1 || activeNodeCount !== 41) {
      throw new Error('Committed node count did not rebuild exactly once.');
    }

    const search = document.getElementById('visual-settings-search');
    search.value = 'node projection scale';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const scale = document.querySelector(
      '#visual-settings-fields [data-setting-path="nodes.scale"] input[type="number"]',
    );
    const scaleSlider = document.querySelector(
      '#visual-settings-fields [data-setting-path="nodes.scale"] input[type="range"]',
    );
    if (scale.value !== '175' || scaleSlider.value !== '150') {
      throw new Error('Out-of-slider exact value was changed.');
    }

    document.getElementById('visual-settings-export').click();
    const exactExport = await this.verifyExport();
    const openedNonmodally = dialog.open && dialog.matches(':modal') === false;
    const closed = new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    document.getElementById('visual-settings-close').click();
    await closed;
    if (!openedNonmodally || workspace.hasAttribute('inert') ||
        workspaceOpener.disabled || activeNodeCount !== 41 ||
        getComputedStyle(dialog).display !== 'none' || dialog.getClientRects().length !== 0) {
      throw new Error('Closing Appearance failed to restore the scene or preserve preview.');
    }
    document.getElementById('application-menu-toggle').click();
    document.getElementById('application-menu-toggle').click();
    document.getElementById('help-open').click();
    const help = document.getElementById('help-dialog');
    if (!navigation.isOpen() || !help.open) {
      throw new Error('Menu destinations are not usable after closing Appearance.');
    }
    help.close();
    return {
      openedNonmodally,
      closedAndHidden: true,
      menuUsableAfterClose: true,
      numericSliders: numericFields.length,
      rebuildsBeforeCommit: countBefore,
      rebuildsAfterCommit: rebuildCount,
      exactExport,
      countAfterClose: activeNodeCount,
      advancedPaths: document.querySelectorAll(
        '#visual-settings-fields [data-setting-path][data-quick-projection="false"]',
      ).length,
    };
  },
};
