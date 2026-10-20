import { Color, LinearSRGBColorSpace, SRGBColorSpace } from 'three';
import {
  VISUAL_PRESETS,
  VISUAL_SETTING_DEFINITIONS,
  createVisualSettingsModuleSource,
  mergeVisualOverrides,
  resolveVisualSettings,
  VISUAL_SETTING_PRESENTATION,
  validateVisualSettings,
  visualConfigurationSignature,
} from './visual-config.mjs';

const RELOAD_INTERVAL_MS = 5000;
const PERSONAL_PRESETS_STORAGE_KEY = 'sentient-os.visual-presets.v1';
const PERSONAL_PRESET_PREFIX = 'user:';
const PERSONAL_PRESET_NAME_MAX_LENGTH = 48;

function clone(value) {
  return structuredClone(value);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function personalPresetKey(name) {
  return `${PERSONAL_PRESET_PREFIX}${name}`;
}

function personalPresetNameFromKey(key) {
  return key.startsWith(PERSONAL_PRESET_PREFIX)
    ? key.slice(PERSONAL_PRESET_PREFIX.length) : null;
}

function readPersonalPresets(storage) {
  const source = storage.getItem(PERSONAL_PRESETS_STORAGE_KEY);
  if (source === null) return [];

  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('Saved preset data is not valid JSON. Clear this site’s stored data to reset it.');
  }
  if (!isPlainRecord(data) || data.version !== 1 || !Array.isArray(data.presets)) {
    throw new Error('Saved preset data has an unsupported format. Clear this site’s stored data to reset it.');
  }

  const names = new Set();
  const presets = [];
  for (const preset of data.presets) {
    if (!isPlainRecord(preset) || typeof preset.name !== 'string' ||
        !isPlainRecord(preset.settings)) {
      throw new Error('A saved preset is malformed. Clear this site’s stored data to reset it.');
    }
    const name = preset.name.trim();
    const normalizedName = name.toLowerCase();
    if (!name || name.length > PERSONAL_PRESET_NAME_MAX_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(name) || Object.hasOwn(VISUAL_PRESETS, normalizedName) ||
        names.has(normalizedName)) {
      throw new Error('Saved preset names are invalid or duplicated. Clear this site’s stored data to reset it.');
    }
    const errors = validateVisualSettings(preset.settings);
    if (errors.length) {
      throw new Error(`Saved preset "${name}" is invalid (${errors[0].path}: ${errors[0].message}).`);
    }
    names.add(normalizedName);
    presets.push({ name, settings: clone(preset.settings) });
  }
  return presets;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function valueAt(settings, path) {
  return path.split('.').reduce((value, key) => value?.[key], settings);
}

function pickerValue(definition, value) {
  return `#${definition.type === 'rgb'
    ? new Color().setRGB(...value, LinearSRGBColorSpace).getHexString(SRGBColorSpace)
    : value.toString(16).padStart(6, '0')}`;
}

function pathForError(path) {
  return path.replace(/\[\d+\]$/, '');
}

function titleCase(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function createElement(document, name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function readConfiguration(data) {
  if (!data || !Array.isArray(data.errors) || data.errors.length) {
    return { errors: data?.errors?.length ? data.errors : [
      { path: 'visual-settings.mjs', message: 'Reload did not return a valid configuration.' },
    ] };
  }
  const resolved = resolveVisualSettings(data.defaults, data.preset, data.overrides);
  if (resolved.errors.length) return { errors: resolved.errors };
  return {
    errors: [],
    value: {
      defaults: clone(data.defaults),
      preset: data.preset,
      overrides: clone(data.overrides),
      settings: resolved.settings,
      signature: visualConfigurationSignature(data),
    },
  };
}

function loadConfiguration(signal) {
  return new Promise((resolve, reject) => {
    let worker;
    let timeout;
    const finish = (callback, value) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    };
    const abort = () => finish(reject, new DOMException('Configuration reload was cancelled.', 'AbortError'));
    try {
      worker = new Worker(new URL('./visual-settings-worker.mjs', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => finish(reject, new Error('Configuration reload timed out.')), 10000);
    worker.onmessage = ({ data }) => finish(resolve, data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(reject, new Error(event.message || 'The configuration reload worker failed.'));
    };
    worker.onmessageerror = () => finish(reject, new Error('The configuration reload worker returned unreadable data.'));
  });
}

export function createVisualSettingsPanel({
  document,
  opener,
  dialog,
  form,
  presetSelect,
  fields,
  quickFields,
  searchInput,
  searchStatus,
  clearSearchButton,
  title,
  onOpenChange = () => {},
  status,
  errorSummary,
  conflict,
  useFileButton,
  keepPreviewButton,
  closeButton,
  resetButton,
  exportButton,
  reloadButton,
  autoReloadInput,
  presetNameInput,
  saveAsPresetButton,
  savePresetButton,
  deletePresetButton,
  initialConfiguration,
  applySettings,
  getStorage = () => globalThis.localStorage,
  confirmAction = (message) => globalThis.confirm(message),
  loadFile = loadConfiguration,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  let fileConfiguration = {
    defaults: clone(initialConfiguration.defaults),
    preset: initialConfiguration.preset,
    overrides: clone(initialConfiguration.overrides),
    settings: clone(initialConfiguration.settings),
  };
  fileConfiguration.signature = visualConfigurationSignature(fileConfiguration);
  let activePreset = fileConfiguration.preset;
  let previewOverrides = {};
  let stagedOverrides = {};
  let stagedPreset = null;
  let fieldErrors = new Map();
  let invalidDraftPaths = new Set();
  let previewSettings = clone(initialConfiguration.settings);
  let presetStorage = null;
  let personalPresets = [];
  let presetStorageError = null;
  try {
    presetStorage = getStorage();
    if (!presetStorage) throw new Error('Browser local storage is unavailable.');
    personalPresets = readPersonalPresets(presetStorage);
  } catch (error) {
    presetStorage = null;
    presetStorageError = errorMessage(error);
  }
  let pendingConflict = null;
  let ignoredSignature = null;
  let reloadPromise = null;
  let reloadController = null;
  let reloadAutomatic = false;
  let pollTimer = null;
  let applyFrame = 0;

  const controls = new Map();
  const advancedProjections = [];
  const sections = [
    ['camera', 'Camera'],
    ['network', 'Network · nodes and connections'],
    ['motion', 'Motion · pulses and running stream'],
    ['event-effects', 'Event effects'],
    ['atmosphere', 'Atmosphere · dust, floor and glow'],
  ];
  const sectionHosts = new Map();
  const sectionDetails = new Map();
  for (const [key, label] of sections) {
    const details = createElement(document, 'details', 'visual-settings-section');
    details.open = key === 'camera';
    const summary = createElement(document, 'summary', '', label);
    const host = createElement(document, 'div', 'visual-settings-section-fields');
    const sectionRow = createElement(document, 'div', 'visual-settings-section-row');
    const resetGroup = createElement(document, 'button', 'visual-group-reset', 'Reset section to file');
    resetGroup.type = 'button';
    resetGroup.setAttribute('aria-label', `Reset ${label} settings to file values`);
    resetGroup.addEventListener('click', () => {
      const paths = VISUAL_SETTING_DEFINITIONS
        .filter((definition) => VISUAL_SETTING_PRESENTATION[definition.path].section === key)
        .map(({ path }) => path);
      resetSettingPaths(paths);
    });
    details.append(summary, host);
    sectionRow.append(details, resetGroup);
    fields.append(sectionRow);
    sectionHosts.set(key, host);
    sectionDetails.set(key, details);
  }
  const quickHosts = new Map();
  if (quickFields) {
    for (const [key, label] of [
      ['network', 'Network'],
      ['motion', 'Motion'],
      ['camera', 'Camera'],
      ['atmosphere', 'Atmosphere'],
    ]) {
      const section = createElement(document, 'section', 'visual-quick-section');
      section.append(createElement(document, 'h3', '', label));
      quickFields.append(section);
      quickHosts.set(key, section);
    }
  }

  function displayValue(definition, settings) {
    return definition.path === 'pulses.speedRange'
      ? settings.pulses.speedMin + settings.pulses.speedRange
      : valueAt(settings, definition.path);
  }

  function createProjection(definition, host, quick = false) {
    const presentation = VISUAL_SETTING_PRESENTATION[definition.path];
    const settingHelp = definition.path === 'pulses.speedMin'
      ? `${presentation.helpText} Changing the minimum keeps the displayed maximum fixed when valid.`
      : definition.path === 'pulses.speedRange'
        ? `${presentation.helpText} This displays the maximum; the source stores maximum minus minimum.`
        : definition.path === 'camera.autoRotateSpeed'
          ? `${presentation.helpText} Direction changes the signed multiplier; zero remains stopped.`
          : presentation.helpText;
    const wrapper = createElement(document, 'div', `visual-field${quick ? ' visual-field-quick' : ''}`);
    wrapper.setAttribute('data-setting-path', definition.path);
    wrapper.setAttribute('data-setting-label', presentation.label);
    wrapper.setAttribute('data-setting-help', settingHelp);
    wrapper.setAttribute('data-quick-projection', String(quick));

    const suffix = definition.editor === 'color' ? 'sRGB color'
      : definition.unit === 'unitless' ? '' : definition.unit;
    const label = createElement(document, 'label', 'visual-field-label',
      suffix ? `${presentation.label} (${suffix})` : presentation.label);
    const idSuffix = `${quick ? 'quick-' : ''}${definition.path.replaceAll('.', '-')}`;
    const inputs = [];
    let slider = null;
    let direction = null;
    const help = createElement(document, 'span', 'visual-field-help', settingHelp);
    help.id = `visual-help-${idSuffix}`;
    const error = createElement(document, 'span', 'visual-field-error');
    error.id = `visual-error-${idSuffix}`;
    error.hidden = true;
    const rangeHint = createElement(document, 'span', 'visual-range-hint');
    rangeHint.hidden = true;

    if (definition.type === 'enum') {
      const input = createElement(document, 'select');
      input.id = `visual-input-${idSuffix}`;
      input.setAttribute('aria-label', presentation.label);
      const labels = { always: 'Always visible', active: 'Activity only', hidden: 'Hidden' };
      for (const value of definition.options) {
        const option = createElement(document, 'option', '', labels[value]);
        option.value = value;
        input.append(option);
      }
      inputs.push(input);
    } else if (definition.type === 'boolean') {
      const input = createElement(document, 'input');
      input.id = `visual-input-${idSuffix}`;
      input.type = 'checkbox';
      input.setAttribute('aria-label', presentation.label);
      inputs.push(input);
    } else if (definition.type === 'vector3') {
      const tuple = createElement(document, 'span', 'visual-tuple');
      for (const coordinate of ['x', 'y', 'z']) {
        const input = createElement(document, 'input');
        input.type = 'number';
        input.step = 'any';
        input.id = `visual-input-${idSuffix}-${coordinate}`;
        input.setAttribute('aria-label', `${presentation.label} ${coordinate.toUpperCase()}${suffix ? ` (${suffix})` : ''}`);
        tuple.append(input);
        inputs.push(input);
      }
      wrapper.append(label, tuple);
    } else if (definition.editor === 'color') {
      const input = createElement(document, 'input');
      input.id = `visual-input-${idSuffix}`;
      input.type = 'color';
      input.setAttribute('aria-label', `${presentation.label} (sRGB color)`);
      inputs.push(input);
    } else {
      const input = createElement(document, 'input');
      input.id = `visual-input-${idSuffix}`;
      input.type = 'number';
      input.step = definition.constraints.integer ? '1' : 'any';
      if (definition.constraints.minimum !== undefined) input.min = String(definition.constraints.minimum);
      if (definition.constraints.maximum !== undefined) input.max = String(definition.constraints.maximum);
      input.setAttribute('aria-label', suffix ? `${presentation.label} (${suffix})` : presentation.label);
      inputs.push(input);

      const suggestedRange = presentation.suggestedRange;
      if (suggestedRange) {
        slider = createElement(document, 'input');
        slider.type = 'range';
        slider.min = String(suggestedRange[0]);
        slider.max = String(suggestedRange[1]);
        slider.step = definition.constraints.integer ? '1'
          : String((suggestedRange[1] - suggestedRange[0]) / 100);
        slider.setAttribute('aria-label', `${presentation.label} suggested range`);
      }
      if (definition.path === 'camera.autoRotateSpeed') {
        direction = createElement(document, 'select');
        direction.setAttribute('aria-label', 'Automatic rotation direction');
        for (const [value, text] of [['1', 'Clockwise'], ['-1', 'Counterclockwise']]) {
          const option = createElement(document, 'option', '', text);
          option.value = value;
          direction.append(option);
        }
      }
    }

    if (definition.type !== 'vector3') wrapper.append(label, ...inputs);
    if (inputs[0]?.id) label.htmlFor = inputs[0].id;
    if (direction) wrapper.append(direction);
    if (slider) wrapper.append(slider);
    if (slider || definition.path === 'camera.autoRotateSpeed') {
      rangeHint.textContent = 'Outside the suggested slider range; the exact value is preserved.';
      wrapper.append(rangeHint);
    }
    if (!quick) {
      const pathLabel = createElement(document, 'code', 'visual-field-path', definition.path);
      wrapper.append(pathLabel, help);
      const resetField = createElement(document, 'button', 'visual-field-reset', 'Reset to file');
      resetField.type = 'button';
      resetField.setAttribute('aria-label', `Reset ${presentation.label} to file value`);
      resetField.addEventListener('click', () => resetSettingPaths([definition.path]));
      wrapper.append(resetField);
    } else {
      wrapper.title = `${definition.path} · ${settingHelp}`;
      wrapper.append(help);
    }
    wrapper.append(error);
    for (const input of [...inputs, ...(slider ? [slider] : []), ...(direction ? [direction] : [])]) {
      input.setAttribute('aria-describedby', `${help.id} ${error.id}`);
      input.addEventListener('input', () => updateFromControl(definition, projection, input));
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', () => updateFromControl(definition, projection, input));
      }
    }

    const projection = { definition, presentation, wrapper, inputs, slider, direction, rangeHint, error };
    if (definition.path === 'nodes.count') {
      for (const input of inputs) {
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitStagedPreview();
          }
        });
        input.addEventListener('blur', (event) => {
          const target = event.relatedTarget;
          if (target?.closest?.('.visual-field-reset, .visual-group-reset, #visual-settings-reset')) return;
          commitStagedPreview();
        });
      }
      slider?.addEventListener('change', commitStagedPreview);
    }
    host.append(wrapper);
    return projection;
  }

  for (const definition of VISUAL_SETTING_DEFINITIONS) {
    const presentation = VISUAL_SETTING_PRESENTATION[definition.path];
    const control = { definition, projections: [] };
    const advanced = createProjection(definition, sectionHosts.get(presentation.section));
    control.projections.push(advanced);
    advancedProjections.push(advanced);
    if (presentation.quick && quickFields) {
      control.projections.push(createProjection(definition, quickHosts.get(presentation.section), true));
    }
    controls.set(definition.path, control);
  }

  function updateSearch() {
    if (!searchInput || !searchStatus || !clearSearchButton) return;
    const query = searchInput.value.trim().toLocaleLowerCase();
    const matches = advancedProjections.filter(({ presentation }) =>
      !query || `${presentation.label} ${presentation.helpText} ${presentation.section} ${presentation.label}`
        .toLocaleLowerCase().includes(query));
    const matchedSections = new Set(matches.map(({ presentation }) => presentation.section));
    for (const projection of advancedProjections) {
      projection.wrapper.hidden = Boolean(query) && !matches.includes(projection);
    }
    if (query) {
      for (const [section, details] of sectionDetails) details.open = matchedSections.has(section);
    }
    clearSearchButton.hidden = !query;
    searchStatus.textContent = query
      ? matches.length
        ? `${matches.length} setting${matches.length === 1 ? '' : 's'} found.`
        : 'No settings match. Clear search to show all settings.'
      : `${VISUAL_SETTING_DEFINITIONS.length} settings available.`;
  }

  function syncPresetOptions() {
    const options = Object.keys(VISUAL_PRESETS).map((preset) => {
      const option = createElement(document, 'option', '', titleCase(preset));
      option.value = preset;
      return option;
    });
    for (const preset of personalPresets) {
      const option = createElement(document, 'option', '', preset.name);
      option.value = personalPresetKey(preset.name);
      options.push(option);
    }
    presetSelect.replaceChildren(...options);
  }

  function selectedPersonalPreset(key = activePreset) {
    const name = personalPresetNameFromKey(key);
    return name === null ? null : personalPresets.find((preset) => preset.name === name) ?? null;
  }

  function syncPersonalPresetActions() {
    const selected = selectedPersonalPreset();
    const unavailable = presetStorageError !== null || presetStorage === null;
    saveAsPresetButton.disabled = unavailable;
    savePresetButton.disabled = unavailable || !selected;
    deletePresetButton.disabled = unavailable || !selected;
  }

  syncPresetOptions();
  presetSelect.value = activePreset;
  opener.setAttribute('aria-expanded', 'false');
  searchInput?.addEventListener('input', updateSearch);
  clearSearchButton?.addEventListener('click', () => {
    searchInput.value = '';
    updateSearch();
    searchInput.focus();
  });
  updateSearch();
  presetSelect.addEventListener('change', () => {
    stagedPreset = presetSelect.value;
    queueApply();
  });
  form.addEventListener('submit', (event) => event.preventDefault());

  function setStatus(message) {
    status.textContent = message;
  }

  function applyLiveSettings(settings) {
    if (applySettings(clone(settings)) === false) throw new Error('The scene rejected the visual update.');
  }

  function clearErrors() {
    fieldErrors.clear();
    invalidDraftPaths.clear();
    errorSummary.hidden = true;
    errorSummary.textContent = '';
    for (const { projections } of controls.values()) {
      for (const projection of projections) {
        projection.error.hidden = true;
        projection.error.textContent = '';
        for (const input of [
          ...projection.inputs,
          ...(projection.slider ? [projection.slider] : []),
          ...(projection.direction ? [projection.direction] : []),
        ]) input.removeAttribute('aria-invalid');
      }
    }
  }

  function showErrors(errors) {
    fieldErrors = new Map();
    for (const issue of errors) {
      const paths = [pathForError(issue.path)];
      for (const definition of VISUAL_SETTING_DEFINITIONS) {
        if (issue.message.includes(definition.path)) paths.push(definition.path);
      }
      for (const path of paths) {
        fieldErrors.set(path, [...(fieldErrors.get(path) ?? []), issue.message]);
      }
    }
    errorSummary.textContent = errors.map(({ path, message }) => `${path}: ${message}`).join(' ');
    errorSummary.hidden = errors.length === 0;
    for (const [path, control] of controls) {
      const messages = fieldErrors.get(path) ?? [];
      for (const projection of control.projections) {
        projection.error.textContent = messages.join(' ');
        projection.error.hidden = messages.length === 0;
        for (const input of [
          ...projection.inputs,
          ...(projection.slider ? [projection.slider] : []),
          ...(projection.direction ? [projection.direction] : []),
        ]) {
          if (messages.length) input.setAttribute('aria-invalid', 'true');
          else input.removeAttribute('aria-invalid');
        }
      }
    }
  }

  function syncProjection(projection, settings, preserveInput = null) {
    const { definition, inputs, slider, direction, rangeHint } = projection;
    const value = displayValue(definition, settings);
    if (definition.type === 'boolean') {
      if (inputs[0] !== preserveInput) inputs[0].checked = value;
    } else if (definition.type === 'vector3') {
      inputs.forEach((input, index) => {
        if (input !== preserveInput) input.value = String(value[index]);
      });
    } else if (definition.editor === 'color') {
      if (inputs[0] !== preserveInput) inputs[0].value = pickerValue(definition, value);
    } else if (definition.type === 'enum') {
      if (inputs[0] !== preserveInput) inputs[0].value = value;
    } else {
      if (inputs[0] !== preserveInput) inputs[0].value = String(value);
      if (slider) {
        const [minimum, maximum] = projection.presentation.suggestedRange;
        const sliderValue = direction ? Math.abs(value) : value;
        const inRange = sliderValue >= minimum && sliderValue <= maximum;
        slider.value = String(Math.min(maximum, Math.max(minimum, sliderValue)));
        rangeHint.hidden = inRange;
        if (direction) direction.value = value < 0 ? '-1' : '1';
      }
    }
  }

  function syncControls(settings) {
    for (const { projections } of controls.values()) {
      for (const projection of projections) syncProjection(projection, settings);
    }
    presetSelect.value = activePreset;
    syncPersonalPresetActions();
  }

  function draftSettings() {
    return mergeVisualOverrides(previewSettings, stagedOverrides);
  }

  function syncDraftPaths(paths, preserveInput) {
    const settings = draftSettings();
    for (const path of paths) {
      for (const projection of controls.get(path)?.projections ?? []) {
        syncProjection(projection, settings, preserveInput);
      }
    }
  }

  function updateFromControl(definition, projection, source) {
    const { inputs, slider, direction } = projection;
    let value;
    if (definition.type === 'enum') {
      value = inputs[0].value;
    } else if (definition.type === 'boolean') {
      value = inputs[0].checked;
    } else if (definition.editor === 'color') {
      const hex = inputs[0].value;
      if (!/^#[0-9a-f]{6}$/i.test(hex)) {
        invalidDraftPaths.add(definition.path);
        fieldErrors.set(definition.path, ['Choose a valid sRGB colour (#RRGGBB).']);
        showErrors([...fieldErrors].flatMap(([path, messages]) =>
          messages.map((message) => ({ path, message }))));
        return;
      }
      const number = Number.parseInt(hex.slice(1), 16);
      value = definition.type === 'rgb'
        ? new Color().setHex(number, SRGBColorSpace).toArray() : number;
    } else if (definition.type === 'vector3') {
      value = inputs.map((input) => input.value === '' ? Number.NaN : Number(input.value));
    } else if (definition.path === 'camera.autoRotateSpeed') {
      const current = Number(inputs[0].value);
      value = source === direction
        ? current === 0 ? 0 : Math.abs(current) * Number(direction.value)
        : source === slider
          ? Math.abs(Number(slider.value)) * Number(direction.value)
          : inputs[0].value === '' ? Number.NaN : current;
    } else {
      value = source === slider ? Number(slider.value)
        : inputs[0].value === '' ? Number.NaN : Number(inputs[0].value);
    }
    const invalid = Array.isArray(value) ? value.some((item) => !Number.isFinite(item))
      : typeof value === 'number' && !Number.isFinite(value);
    if (invalid) {
      invalidDraftPaths.add(definition.path);
      fieldErrors.set(definition.path, [`${projection.presentation.label} must contain finite values.`]);
      showErrors([...fieldErrors].flatMap(([path, messages]) =>
        messages.map((message) => ({ path, message }))));
      return;
    }
    invalidDraftPaths.delete(definition.path);
    const current = draftSettings();
    let patch;
    if (definition.path === 'pulses.speedMin') {
      const maximum = current.pulses.speedMin + current.pulses.speedRange;
      patch = { pulses: { speedMin: value, speedRange: maximum - value } };
    } else if (definition.path === 'pulses.speedRange') {
      patch = { pulses: { speedRange: value - current.pulses.speedMin } };
    } else {
      const [group, name] = definition.path.split('.');
      patch = { [group]: { [name]: value } };
    }
    stagedOverrides = mergeVisualOverrides(stagedOverrides, patch);
    fieldErrors.delete(definition.path);
    if (definition.path === 'pulses.speedMin' || definition.path === 'pulses.speedRange') {
      fieldErrors.delete('pulses.speedMin');
      fieldErrors.delete('pulses.speedRange');
    }
    const relatedPaths = definition.path === 'pulses.speedMin' || definition.path === 'pulses.speedRange'
      ? ['pulses.speedMin', 'pulses.speedRange'] : [definition.path];
    syncDraftPaths(relatedPaths, source);
    if (definition.path !== 'nodes.count') queueApply();
  }

  function queueApply() {
    if (applyFrame) cancelFrame(applyFrame);
    applyFrame = requestFrame(() => {
      applyFrame = 0;
      applyStagedPreview();
    });
  }

  function commitStagedPreview(commitCount = true) {
    if (applyFrame) {
      cancelFrame(applyFrame);
      applyFrame = 0;
    }
    if (Object.keys(stagedOverrides).length || stagedPreset !== null) applyStagedPreview(commitCount);
  }

  function resetSettingPaths(paths) {
    if (invalidDraftPaths.size) {
      setStatus('Resolve invalid drafts before resetting a setting or section.');
      return;
    }
    let patch = {};
    for (const path of paths) {
      const [group, name] = path.split('.');
      patch = mergeVisualOverrides(patch, {
        [group]: { [name]: clone(valueAt(fileConfiguration.settings, path)) },
      });
      fieldErrors.delete(path);
    }
    stagedOverrides = mergeVisualOverrides(stagedOverrides, patch);
    syncDraftPaths(paths, null);
    commitStagedPreview(paths.includes('nodes.count'));
  }

  function applyStagedPreview(commitCount = false) {
    if (invalidDraftPaths.size) {
      setStatus('Preview not applied; correct the highlighted settings.');
      return false;
    }
    const preset = stagedPreset ?? activePreset;
    const switchingPersonalPreset = stagedPreset !== null && stagedPreset !== activePreset &&
      (personalPresetNameFromKey(stagedPreset) !== null ||
        personalPresetNameFromKey(activePreset) !== null);
    const stagedOverridesToApply = clone(stagedOverrides);
    let deferredCount;
    if (!commitCount && Object.hasOwn(stagedOverridesToApply.nodes ?? {}, 'count')) {
      deferredCount = stagedOverridesToApply.nodes.count;
      delete stagedOverridesToApply.nodes.count;
      if (!Object.keys(stagedOverridesToApply.nodes).length) delete stagedOverridesToApply.nodes;
    }
    const overrides = mergeVisualOverrides(
      switchingPersonalPreset ? {} : previewOverrides, stagedOverridesToApply);
    const personalPreset = selectedPersonalPreset(preset);
    const resolved = personalPreset
      ? (() => {
        const settings = mergeVisualOverrides(personalPreset.settings, overrides);
        const errors = validateVisualSettings(settings);
        return { settings: errors.length ? null : settings, errors };
      })()
      : personalPresetNameFromKey(preset) !== null
        ? { settings: null, errors: [{ path: 'preset', message: 'The personal preset no longer exists.' }] }
        : resolveVisualSettings(
          fileConfiguration.defaults, preset, fileConfiguration.overrides, overrides);
    if (resolved.errors.length) {
      showErrors(resolved.errors);
      setStatus('Preview not applied; correct the highlighted settings.');
      return false;
    }
    try {
      applyLiveSettings(resolved.settings);
    } catch (error) {
      setStatus(`Preview not applied: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    activePreset = preset;
    previewOverrides = overrides;
    previewSettings = clone(resolved.settings);
    stagedOverrides = deferredCount === undefined ? {} : { nodes: { count: deferredCount } };
    stagedPreset = null;
    clearErrors();
    syncControls(resolved.settings);
    if (deferredCount !== undefined) syncDraftPaths(['nodes.count'], null);
    setStatus(deferredCount === undefined
      ? 'Live preview applied. Changes are temporary until exported and saved.'
      : 'Live preview applied; commit the node count to rebuild the network.');
    return true;
  }

  function isDirty() {
    return activePreset !== fileConfiguration.preset ||
      Object.keys(previewOverrides).length > 0 ||
      Object.keys(stagedOverrides).length > 0 ||
      stagedPreset !== null ||
      invalidDraftPaths.size > 0;
  }

  function installFileConfiguration(next) {
    try {
      applyLiveSettings(next.settings);
    } catch (error) {
      setStatus(`File configuration was not applied: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    fileConfiguration = next;
    activePreset = next.preset;
    previewOverrides = {};
    previewSettings = clone(next.settings);
    stagedOverrides = {};
    stagedPreset = null;
    pendingConflict = null;
    conflict.hidden = true;
    ignoredSignature = null;
    clearErrors();
    syncControls(next.settings);
    setStatus('File configuration applied.');
    return true;
  }

  function showConflict(next) {
    pendingConflict = next;
    conflict.hidden = false;
    setStatus('The file changed while a preview is active. Choose which version to use.');
  }

  function applyReloadResult(data) {
    const result = readConfiguration(data);
    if (result.errors.length) {
      showErrors(result.errors);
      setStatus('File reload failed; the last valid configuration remains active.');
      return false;
    }
    const next = result.value;
    if (next.signature === fileConfiguration.signature) {
      setStatus('File configuration is unchanged.');
      return true;
    }
    if (next.signature === ignoredSignature) return true;
    if (isDirty()) {
      showConflict(next);
      return true;
    }
    return installFileConfiguration(next);
  }

  function reloadFile(automatic = false) {
    if (document.hidden) return Promise.resolve(false);
    if (reloadPromise) return reloadPromise;
    setStatus('Reloading visual-settings.mjs…');
    reloadAutomatic = automatic;
    reloadController = new AbortController();
    reloadPromise = loadFile(reloadController.signal)
      .then((data) => applyReloadResult(data))
      .catch((error) => {
        if (reloadController?.signal.aborted) return false;
        setStatus(`File reload failed; the last valid configuration remains active: ${
          error instanceof Error ? error.message : String(error)}`);
        return false;
      })
      .finally(() => {
        reloadPromise = null;
        reloadController = null;
        reloadAutomatic = false;
        schedulePoll();
      });
    return reloadPromise;
  }

  function schedulePoll() {
    cancelTimer(pollTimer);
    pollTimer = null;
    if (!autoReloadInput.checked || document.hidden) return;
    pollTimer = scheduleTimer(() => {
      pollTimer = null;
      void reloadFile(true);
    }, RELOAD_INTERVAL_MS);
  }

  opener.addEventListener('click', () => {
    if (!dialog.open) {
      dialog.show();
      opener.setAttribute('aria-expanded', 'true');
      onOpenChange(true);
      title?.focus({ preventScroll: true });
    }
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    onOpenChange(false);
    opener.setAttribute('aria-expanded', 'false');
    opener.focus({ preventScroll: true });
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented ||
        event.target?.tagName === 'SELECT') return;
    const nestedDialog = event.target?.closest?.('dialog[open]');
    if (nestedDialog && nestedDialog !== dialog) return;
    event.preventDefault();
    dialog.close();
  });
  resetButton.addEventListener('click', () => {
    const resolved = resolveVisualSettings(
      fileConfiguration.defaults, fileConfiguration.preset, fileConfiguration.overrides);
    if (resolved.errors.length) {
      showErrors(resolved.errors);
      setStatus('The current file configuration cannot be restored.');
      return;
    }
    if (installFileConfiguration({ ...fileConfiguration, settings: resolved.settings })) {
      setStatus('Preview reset to the current file configuration.');
    }
  });
  function validateNewPresetName(rawName, ignoreName = null) {
    if (typeof rawName !== 'string' || !rawName.trim()) return 'Enter a preset name.';
    const name = rawName.trim();
    if (name.length > PERSONAL_PRESET_NAME_MAX_LENGTH) {
      return `Preset names must be ${PERSONAL_PRESET_NAME_MAX_LENGTH} characters or fewer.`;
    }
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'Preset names cannot contain control characters.';
    if (Object.hasOwn(VISUAL_PRESETS, name.toLowerCase())) {
      return 'That name is reserved for a built-in preset.';
    }
    if (personalPresets.some((preset) =>
      preset.name.toLowerCase() === name.toLowerCase() && preset.name !== ignoreName)) {
      return 'A personal preset with that name already exists.';
    }
    return null;
  }

  function persistPersonalPresets(next) {
    try {
      presetStorage.setItem(PERSONAL_PRESETS_STORAGE_KEY, JSON.stringify({
        version: 1,
        presets: next,
      }));
    } catch (error) {
      setStatus(`Personal preset could not be saved: ${errorMessage(error)}`);
      return false;
    }
    personalPresets = next;
    syncPresetOptions();
    syncControls(previewSettings);
    return true;
  }

  function pendingEdits() {
    return invalidDraftPaths.size || Object.keys(stagedOverrides).length ||
      stagedPreset !== null || applyFrame !== 0;
  }

  saveAsPresetButton.addEventListener('click', () => {
    if (presetStorageError || !presetStorage) {
      setStatus(`Personal presets are unavailable: ${presetStorageError ?? 'browser local storage is unavailable.'}`);
      return;
    }
    if (pendingEdits()) {
      setStatus('Apply or correct pending edits before saving a preset.');
      return;
    }
    const name = presetNameInput.value.trim();
    const nameError = validateNewPresetName(name);
    if (nameError) {
      setStatus(nameError);
      return;
    }
    if (!persistPersonalPresets([...personalPresets, { name, settings: clone(previewSettings) }])) return;
    activePreset = personalPresetKey(name);
    previewOverrides = {};
    presetNameInput.value = '';
    syncControls(previewSettings);
    setStatus(`Personal preset "${name}" saved in this browser.`);
  });

  savePresetButton.addEventListener('click', () => {
    const selected = selectedPersonalPreset();
    if (!selected) {
      setStatus('Select one of your personal presets before saving changes.');
      return;
    }
    if (pendingEdits()) {
      setStatus('Apply or correct pending edits before saving a preset.');
      return;
    }
    const updated = personalPresets.map((preset) =>
      preset.name === selected.name ? { ...preset, settings: clone(previewSettings) } : preset);
    if (!persistPersonalPresets(updated)) return;
    setStatus(`Changes to "${selected.name}" saved in this browser.`);
  });

  deletePresetButton.addEventListener('click', () => {
    const selected = selectedPersonalPreset();
    if (!selected) {
      setStatus('Select one of your personal presets before deleting it.');
      return;
    }
    if (pendingEdits()) {
      setStatus('Apply or correct pending edits before deleting a preset.');
      return;
    }
    if (!confirmAction(`Delete personal preset "${selected.name}"?`)) return;
    if (!persistPersonalPresets(personalPresets.filter((preset) => preset.name !== selected.name))) return;
    activePreset = fileConfiguration.preset;
    previewOverrides = clone(previewSettings);
    stagedOverrides = {};
    stagedPreset = null;
    syncControls(previewSettings);
    setStatus(`Personal preset "${selected.name}" deleted. The current preview is unchanged.`);
  });

  exportButton.addEventListener('click', () => {
    if (pendingEdits()) {
      setStatus('Resolve pending or invalid edits before exporting.');
      return;
    }
    const isPersonalPreset = personalPresetNameFromKey(activePreset) !== null;
    const preset = isPersonalPreset ? 'balanced' : activePreset;
    const overrides = isPersonalPreset
      ? clone(previewSettings)
      : mergeVisualOverrides(fileConfiguration.overrides, previewOverrides);
    const source = createVisualSettingsModuleSource({
      defaults: fileConfiguration.defaults, preset, overrides,
    });
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const link = createElement(document, 'a');
    link.href = url;
    link.download = 'visual-settings.mjs';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Downloaded visual-settings.mjs. Save it over the source file to persist the preview.');
  });
  reloadButton.addEventListener('click', () => { void reloadFile(); });
  autoReloadInput.addEventListener('change', () => {
    if (!autoReloadInput.checked && reloadAutomatic) reloadController?.abort();
    schedulePoll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelTimer(pollTimer);
      pollTimer = null;
      if (reloadAutomatic) reloadController?.abort();
      return;
    }
    schedulePoll();
  });
  useFileButton.addEventListener('click', () => {
    if (pendingConflict) installFileConfiguration(pendingConflict);
  });
  keepPreviewButton.addEventListener('click', () => {
    if (!pendingConflict) return;
    ignoredSignature = pendingConflict.signature;
    pendingConflict = null;
    conflict.hidden = true;
    setStatus('Preview kept. Automatic application is suspended for this file version.');
  });
  syncControls(fileConfiguration.settings);
  if (presetStorageError) {
    setStatus(`Personal presets are unavailable: ${presetStorageError}`);
  }
  return {
    reload: reloadFile,
    get state() {
      return {
        preset: activePreset,
        overrides: clone(previewOverrides),
        personalPresets: clone(personalPresets),
        dirty: isDirty(),
        fileSignature: fileConfiguration.signature,
      };
    },
  };
}
