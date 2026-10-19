import {
  VISUAL_PRESETS,
  VISUAL_SETTING_DEFINITIONS,
  createVisualSettingsModuleSource,
  mergeVisualOverrides,
  resolveVisualSettings,
  visualConfigurationSignature,
} from './visual-config.mjs';

const RELOAD_INTERVAL_MS = 5000;

function clone(value) {
  return structuredClone(value);
}

function valueAt(settings, path) {
  return path.split('.').reduce((value, key) => value?.[key], settings);
}

function setValueAt(settings, path, value) {
  const [group, name] = path.split('.');
  settings[group][name] = clone(value);
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
  initialConfiguration,
  applySettings,
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
  let pendingConflict = null;
  let ignoredSignature = null;
  let reloadPromise = null;
  let reloadController = null;
  let reloadAutomatic = false;
  let pollTimer = null;
  let applyFrame = 0;

  const controls = new Map();
  for (const definition of VISUAL_SETTING_DEFINITIONS) {
    const wrapper = createElement(document, 'label', 'visual-field');
    wrapper.setAttribute('data-setting-path', definition.path);
    const suffix = definition.type === 'hex' ? 'sRGB color'
      : definition.type === 'rgb' ? 'linear RGB'
        : definition.unit === 'unitless' ? '' : definition.unit;
    const title = createElement(document, 'span', 'visual-field-label',
      suffix ? `${definition.label} (${suffix})` : definition.label);
    title.title = `${definition.path}${suffix ? ` · ${suffix}` : ''}`;
    wrapper.append(title);
    const inputs = [];
    const initialValue = valueAt(fileConfiguration.settings, definition.path);
    if (definition.type === 'boolean') {
      const input = createElement(document, 'input');
      input.type = 'checkbox';
      input.checked = initialValue;
      input.setAttribute('aria-label', definition.label);
      wrapper.append(input);
      inputs.push(input);
    } else if (definition.type === 'vector3' || definition.type === 'rgb') {
      const tuple = createElement(document, 'span', 'visual-tuple');
      for (let index = 0; index < 3; index++) {
        const input = createElement(document, 'input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(initialValue[index]);
        input.setAttribute('aria-label', `${definition.label} ${['x', 'y', 'z'][index]}${suffix ? ` (${suffix})` : ''}`);
        tuple.append(input);
        inputs.push(input);
      }
      wrapper.append(tuple);
    } else if (definition.type === 'hex') {
      const input = createElement(document, 'input');
      input.type = 'color';
      input.value = `#${initialValue.toString(16).padStart(6, '0')}`;
      input.setAttribute('aria-label', `${definition.label} (sRGB color)`);
      wrapper.append(input);
      inputs.push(input);
    } else {
      const input = createElement(document, 'input');
      input.type = 'number';
      input.step = definition.constraints.integer ? '1' : 'any';
      if (definition.constraints.minimum !== undefined) input.min = String(definition.constraints.minimum);
      if (definition.constraints.maximum !== undefined) input.max = String(definition.constraints.maximum);
      input.setAttribute('aria-label', suffix ? `${definition.label} (${suffix})` : definition.label);
      wrapper.append(input);
      inputs.push(input);
    }
    const error = createElement(document, 'span', 'visual-field-error');
    error.id = `visual-error-${definition.path.replaceAll('.', '-')}`;
    error.hidden = true;
    wrapper.append(error);
    for (const input of inputs) {
      input.setAttribute('aria-describedby', `${error.id} visual-settings-help`);
      input.addEventListener('input', () => updateFromControl(definition, inputs));
    }
    fields.querySelector(`[data-visual-group="${definition.path.split('.')[0]}"]`).append(wrapper);
    controls.set(definition.path, { definition, inputs, error });
  }

  for (const [preset] of Object.entries(VISUAL_PRESETS)) {
    const option = createElement(document, 'option', '', titleCase(preset));
    option.value = preset;
    presetSelect.append(option);
  }
  presetSelect.value = activePreset;
  opener.setAttribute('aria-expanded', 'false');
  presetSelect.addEventListener('change', () => {
    stagedPreset = presetSelect.value;
    queueApply();
  });
  form.addEventListener('submit', (event) => event.preventDefault());

  function setStatus(message) {
    status.textContent = message;
  }

  function clearErrors() {
    fieldErrors.clear();
    invalidDraftPaths.clear();
    errorSummary.hidden = true;
    errorSummary.textContent = '';
    for (const { error, inputs } of controls.values()) {
      error.hidden = true;
      error.textContent = '';
      for (const input of inputs) input.removeAttribute('aria-invalid');
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
      control.error.textContent = messages.join(' ');
      control.error.hidden = messages.length === 0;
      for (const input of control.inputs) {
        if (messages.length) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }
  }

  function syncControls(settings) {
    for (const [path, control] of controls) {
      const value = valueAt(settings, path);
      if (control.definition.type === 'boolean') {
        control.inputs[0].checked = value;
      } else if (control.definition.type === 'vector3' || control.definition.type === 'rgb') {
        control.inputs.forEach((input, index) => { input.value = String(value[index]); });
      } else if (control.definition.type === 'hex') {
        control.inputs[0].value = `#${value.toString(16).padStart(6, '0')}`;
      } else {
        control.inputs[0].value = String(value);
      }
    }
    presetSelect.value = activePreset;
  }

  function updateFromControl(definition, inputs) {
    let value;
    if (definition.type === 'boolean') {
      value = inputs[0].checked;
    } else if (definition.type === 'hex') {
      value = Number.parseInt(inputs[0].value.slice(1), 16);
    } else if (definition.type === 'vector3' || definition.type === 'rgb') {
      value = inputs.map((input) => input.value === '' ? Number.NaN : Number(input.value));
    } else {
      value = inputs[0].value === '' ? Number.NaN : Number(inputs[0].value);
    }
    const invalid = Array.isArray(value) ? value.some((item) => !Number.isFinite(item))
      : typeof value === 'number' && !Number.isFinite(value);
    if (invalid) {
      invalidDraftPaths.add(definition.path);
      fieldErrors.set(definition.path, [`${definition.label} must contain finite values.`]);
      showErrors([...fieldErrors].flatMap(([path, messages]) =>
        messages.map((message) => ({ path, message }))));
      return;
    }
    invalidDraftPaths.delete(definition.path);
    stagedOverrides = mergeVisualOverrides(stagedOverrides, {
      [definition.path.split('.')[0]]: { [definition.path.split('.')[1]]: value },
    });
    fieldErrors.delete(definition.path);
    queueApply();
  }

  function queueApply() {
    if (applyFrame) cancelFrame(applyFrame);
    applyFrame = requestFrame(() => {
      applyFrame = 0;
      applyStagedPreview();
    });
  }

  function applyStagedPreview() {
    const preset = stagedPreset ?? activePreset;
    const overrides = mergeVisualOverrides(previewOverrides, stagedOverrides);
    const resolved = resolveVisualSettings(
      fileConfiguration.defaults, preset, fileConfiguration.overrides, overrides);
    if (resolved.errors.length) {
      showErrors(resolved.errors);
      setStatus('Preview not applied; correct the highlighted settings.');
      return false;
    }
    try {
      if (applySettings(clone(resolved.settings)) === false) {
        throw new Error('The scene rejected the visual update.');
      }
    } catch (error) {
      setStatus(`Preview not applied: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    activePreset = preset;
    previewOverrides = overrides;
    stagedOverrides = {};
    stagedPreset = null;
    clearErrors();
    syncControls(resolved.settings);
    setStatus('Preview applied. Changes are temporary until exported and saved.');
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
      if (applySettings(clone(next.settings)) === false) {
        throw new Error('The scene rejected the file configuration.');
      }
    } catch (error) {
      setStatus(`File configuration was not applied: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    fileConfiguration = next;
    activePreset = next.preset;
    previewOverrides = {};
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
      dialog.showModal();
      opener.setAttribute('aria-expanded', 'true');
    }
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    opener.setAttribute('aria-expanded', 'false');
    opener.focus();
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
  exportButton.addEventListener('click', () => {
    if (invalidDraftPaths.size || Object.keys(stagedOverrides).length || stagedPreset !== null) {
      setStatus('Resolve pending or invalid edits before exporting.');
      return;
    }
    const overrides = mergeVisualOverrides(fileConfiguration.overrides, previewOverrides);
    const source = createVisualSettingsModuleSource({
      defaults: fileConfiguration.defaults, preset: activePreset, overrides,
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
  return {
    reload: reloadFile,
    get state() {
      return {
        preset: activePreset,
        overrides: clone(previewOverrides),
        dirty: isDirty(),
        fileSignature: fileConfiguration.signature,
      };
    },
  };
}
