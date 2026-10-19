import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as THREE from 'three';
import { CATEGORY_INDEX, CATEGORY_RGB, CATEGORY_HEX } from '../activity-colors.mjs';
import { createThinkingPulseClock, createImpulseBuffer, createCategoryBurstPlan,
  impulseIntensity } from '../activity-client.mjs';
import { createPageActivityTotals } from '../session-stats-ui.mjs';
import { loadVisualConfiguration, startVisualApplication, validateVisualSettings,
  resolveVisualSettings, VISUAL_PRESETS, VISUAL_SETTING_DEFINITIONS,
  mergeVisualOverrides, visualConfigurationSignature, createVisualSettingsModuleSource } from '../visual-config.mjs';
import { createVisualSettingsPanel } from '../visual-settings-ui.mjs';

const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const settings = async () => structuredClone((await import('../visual-settings.mjs')).VISUAL);

class TestElement {
  children = [];
  listeners = new Map();
  attributes = new Map();
  hidden = false;
  checked = false;
  value = '';
  textContent = '';
  open = false;

  append(...elements) { this.children.push(...elements); }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatch(type) {
    for (const callback of this.listeners.get(type) ?? []) callback({ preventDefault() {} });
  }
  click() { this.dispatch('click'); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  focus() {}
}

function makePanelHarness({ defaults, preset = 'balanced', overrides = {}, loadFile, scheduleTimer, cancelTimer }) {
  const resolved = resolveVisualSettings(defaults, preset, overrides);
  const document = new TestElement();
  document.hidden = false;
  document.createElement = () => new TestElement();
  const groups = new Map();
  const fields = new TestElement();
  fields.querySelector = (selector) => {
    const group = selector.match(/data-visual-group="([^"]+)"/)?.[1];
    return groups.get(group);
  };
  for (const definition of VISUAL_SETTING_DEFINITIONS) {
    const groupName = definition.path.split('.')[0];
    if (!groups.has(groupName)) groups.set(groupName, new TestElement());
  }
  const elements = Object.fromEntries([
    'opener', 'dialog', 'form', 'presetSelect', 'status', 'errorSummary', 'conflict',
    'useFileButton', 'keepPreviewButton', 'closeButton', 'resetButton', 'exportButton',
    'reloadButton', 'autoReloadInput',
  ].map((key) => [key, new TestElement()]));
  const applied = [];
  const options = {
    document,
    ...elements,
    fields,
    initialConfiguration: { defaults, preset, overrides, settings: resolved.settings },
    applySettings: (value) => { applied.push(value); return true; },
    loadFile,
    ...(scheduleTimer ? { scheduleTimer } : {}),
    ...(cancelTimer ? { cancelTimer } : {}),
    requestFrame: (callback) => { queueMicrotask(callback); return 1; },
    cancelFrame() {},
  };
  const panel = createVisualSettingsPanel(options);
  const control = (path) => {
    const wrapper = groups.get(path.split('.')[0]).children
      .find((child) => child.attributes.get('data-setting-path') === path);
    const descendants = (element) => [element, ...element.children.flatMap(descendants)];
    return descendants(wrapper).filter((element) => element.type === 'number' ||
      element.type === 'checkbox' || element.type === 'color');
  };
  return { panel, document, elements, groups, applied, control };
}

function sceneFunction(name) {
  const body = main.slice(main.indexOf(`function ${name}(`));
  const end = /\r?\n}\r?\n/.exec(body);
  assert.ok(end, `${name} is extractable`);
  return body.slice(0, end.index + end[0].length);
}

test('visual settings characterize the latest tuned defaults, not structural capacities or palette', async () => {
  const visual = await settings();
  const configModule = await import('../visual-settings.mjs');
  assert.deepEqual(visual, {
    camera: {
      fov: 50, position: [0, 4, 31], target: [0, 0, 0], damping: 0.06,
      minDistance: 14, maxDistance: 60, autoRotate: true, autoRotateSpeed: 0.35,
    },
    nodes: {
      scale: 95, size: 1, activeGrowth: 2, idleBrightness: 0.4,
      activeBrightness: 1.8, hotMix: 1.4, whiteThreshold: 0.7, whiteMix: 1,
      baseSizeMin: 0.6, baseSizeRange: 1, largeChance: 0.04,
      largeSizeMin: 2.6, largeSizeRange: 1, energyCap: 1.8, decay: 2,
      twinkleBase: 0.75, twinkleAmplitude: 0.25, twinkleSpeed: 1.7,
      twinkleSpatial: [3.1, 0, 2.3], coreFalloff: 2.2,
      baseColor: [0.16, 0.45, 1], hotColor: [1, 0.52, 0.12], whiteColor: [1, 0.92, 0.8],
    },
    pulses: {
      scale: 110, head: 2.2, completionHead: 3, trailSpacing: 0.05,
      completionTrailSpacing: 0.07, speedMin: 4, speedRange: 4,
      headBrightness: 1.6, trailFalloff: 1.6,
      minTrailSize: 0.35, coreFalloff: 1.8, nodeEnergy: 0.5,
      thinkingEdgeIntensity: 0.6, stepEdgeIntensity: 0.45,
    },
    running: {
      pulsesPerSecondPerSession: 6, maxSessions: 32, baseHops: 2,
      maxExtraHops: 5, spread: 1, nodeEnergy: 0.45,
    },
    activity: {
      maxIntensity: 8, maxSpread: 3, reasoningBaseHops: 2, errorHops: 0,
      reasoningEnergy: 0.45, stepHeat: 0.7, stepHeatCap: 1.2,
    },
    subagents: {
      growSeconds: 0.22, fadeSeconds: 2, tipSize: 5, fadingTipSize: 4, anchorSize: 8,
      initialIntensity: 0.55, intensityPerSecond: 0.08, maxIntensity: 1,
      runningAnchorColor: [0.2, 0.6, 1], runningAnchorIntensity: 1.1,
      waitingAnchorIntensity: 0.9, stuckAnchorColor: [0.5, 0.55, 0.65], stuckAnchorIntensity: 0.55,
      quietAnchorColor: [0.16, 0.32, 0.56], quietAnchorIntensity: 0.35,
      clearedLineColor: [0.55, 0.58, 0.64], clearedTipColor: [0.65, 0.68, 0.72],
      failureFlashFraction: 0.12, failureFlashIntensity: 2,
      completionFlashFraction: 0.15, completionFlashBase: 0.6, completionFlashGrowth: 6,
    },
    waiting: {
      markerOpacity: 0.9, markerSize: 0.55, breathSpeed: 0.7,
      colorMixMin: 0.5, colorMixRange: 0.5, opacityBase: 0.025, opacityBreath: 0.025,
    },
    effects: {
      dust: true, floor: true, latticeBreathing: true, waitingGlow: true,
      waitingMarkers: true, subagentTransitions: true,
    },
    dust: {
      scale: 40, color: [0.2, 0.45, 1], twinkleBase: 0.25, twinkleAmplitude: 0.75,
      twinkleSpeed: 0.9, twinklePhase: 7, twinklePower: 3,
      rotationSpeed: -0.02, tiltSpeed: 0.05, tiltAmplitude: 0.1,
    },
    floor: {
      fineSpacing: 2.5, fineIntensity: 0.45, coarseSpacing: 12.5, coarseIntensity: 0.8,
      color: [0.1, 0.32, 1], poolColor: [0.12, 0.32, 0.95],
      poolFade: 0.1, poolBase: 0.06, poolGrid: 0.6,
    },
    completion: {
      hops: 7, neighbourHops: 5, spread: 8, neighbourSeeds: 4,
      neighbourSpread: 2, branchChance: 0.42, seedHeat: 2.5,
      nodeEnergy: 0.9, edgeIntensity: 0.5,
    },
    impact: {
      minMs: 2000, maxMs: 120000, minHops: 1, maxHops: 8, minSpread: 1, maxSpread: 6,
      neighbourSeeds: 4, neighbourHops: 4, neighbourSpread: 2, branchChance: 0.35,
      seedHeat: 2, nodeEnergy: 0.7, edgeIntensity: 0.8, head: 2.6,
    },
    scene: {
      background: 0x020409, categoryBrightness: 0.9,
      edgeBaseColor: [0.012, 0.04, 0.13], edgeVariationMin: 0.45, edgeVariationRange: 0.55,
      breathSpeed: 0.8, breathAmplitude: 0.012,
      loadPulseScale: 500, loadSessionScale: 64, loadSmoothing: 3,
      coreColor: 0x3d8bff, coreSize: 16, haloColor: 0x2a6bff, haloSize: 38,
      glowKnee: 0.25, glowKneeOpacity: 0.35,
      bloomStrength: 0.85, bloomLoad: 0.3, bloomRadius: 0.45, bloomThreshold: 0.12,
      edgeFade: 2.4, coreOpacity: 0.015, coreLoad: 0.12, haloOpacity: 0.025,
      haloLoad: 0.03, dustBrightness: 0.18, floorBrightness: 0.22,
      floorFade: 0.028, floorGlow: 0.5,
    },
  });
  assert.match(main, /import \{ VISUAL as VISUAL_DEFAULTS, VISUAL_PRESET, VISUAL_OVERRIDES,\s*EFFECTIVE_VISUAL as VISUAL \} from '\.\/visual-settings\.mjs'/);
  assert.match(main, /maxPulses: 1600/);
  assert.match(main, /trail: 7/);
  assert.match(main, /CATEGORY_RGB, \(channel\)/);
  assert.equal(configModule.VISUAL_PRESET, 'balanced');
  assert.deepEqual(configModule.VISUAL_ERRORS, []);
  assert.deepEqual(configModule.EFFECTIVE_VISUAL, visual);
});

test('visual settings validate all known paths and reject malformed values without mutating input', async () => {
  const defaults = await settings();
  assert.deepEqual(validateVisualSettings(defaults), []);
  const expectedPaths = Object.entries(defaults).flatMap(([group, values]) =>
    Object.keys(values).map((name) => `${group}.${name}`)).sort();
  assert.deepEqual(VISUAL_SETTING_DEFINITIONS.map(({ path }) => path).sort(), expectedPaths);

  const cases = [
    ['nodes.scale', (value) => { value.nodes.scale = Number.NaN; }],
    ['running.maxSessions', (value) => { value.running.maxSessions = 1.5; }],
    ['nodes.baseColor[2]', (value) => { value.nodes.baseColor = [0.1, 0.2, 1.5]; }],
    ['scene.background', (value) => { value.scene.background = 0x1000000; }],
    ['effects.floor', (value) => { value.effects.floor = 1; }],
    ['scene.bloomRadius', (value) => { value.scene.bloomRadius = 1.1; }],
    ['scene.breathAmplitude', (value) => { value.scene.breathAmplitude = -0.1; }],
    ['floor.fineSpacing', (value) => { value.floor.fineSpacing = 0; }],
    ['camera.minDistance', (value) => { value.camera.minDistance = 70; value.camera.maxDistance = 20; }],
    ['camera.position', (value) => { value.camera.position = [...value.camera.target]; }],
    ['waiting.colorMixMin', (value) => { value.waiting.colorMixMin = 0.6; value.waiting.colorMixRange = 0.5; }],
    ['nodes.twinkleAmplitude', (value) => { value.nodes.twinkleAmplitude = 0.8; }],
    ['impact.minMs', (value) => { value.impact.minMs = 120_001; }],
    ['VISUAL.extra', (value) => { value.extra = true; }],
    ['camera.fov', (value) => { delete value.camera.fov; }],
  ];
  for (const [path, mutate] of cases) {
    const candidate = structuredClone(defaults);
    mutate(candidate);
    const errors = validateVisualSettings(candidate);
    assert.ok(errors.some((error) => error.path === path), `${path} reports its exact setting path`);
  }
  assert.equal(defaults.nodes.scale, 95, 'validation does not mutate the active defaults');
});

test('effect switches leave synthetic feed, timeline, and page totals unchanged', async () => {
  const results = [];
  for (const enabled of [true, false]) {
    const VISUAL = await settings();
    for (const effect of Object.keys(VISUAL.effects)) VISUAL.effects[effect] = enabled;
    const buffer = createImpulseBuffer();
    const totals = createPageActivityTotals();
    const events = [
      { kind: 'thinking', count: 4 },
      { kind: 'step', toolName: 'node', count: 2 },
    ];
    const feed = [], timeline = [], rendered = [];
    for (const event of events) {
      buffer.add(event);
      totals.add(event);
    }
    const context = vm.createContext({
      VISUAL, CATEGORY_INDEX, impulseBuffer: buffer, document: { hidden: false },
      timeline: { add: (counts) => timeline.push(Array.from(counts)) },
      performance: { now: () => 100 }, Math, N: 1,
      impulseFeed: { add: (...entry) => feed.push(entry) },
      categoryBurstPlan: createCategoryBurstPlan(),
      impulseIntensity: (count) => impulseIntensity(count, VISUAL.activity),
      renderImpactBurst() {}, renderCompletionCascade() {},
      fireFrom: (...args) => rendered.push(args),
      nodeEnergy: new Float32Array(1), nodeHot: new Float32Array(1),
    });
    vm.runInContext(sceneFunction('renderObservedImpulses') + '\nrenderObservedImpulses()', context);
    results.push({
      feed, timeline, pageTotals: Array.from(totals.counts), rendered,
    });
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].feed.length, 2);
  assert.equal(results[0].timeline.length, 1);
});

test('presets and overrides resolve deterministically without mutating definitions', async () => {
  const defaults = await settings();
  const balanced = resolveVisualSettings(defaults, 'balanced');
  const subtle = resolveVisualSettings(defaults, 'subtle');
  const intense = resolveVisualSettings(defaults, 'intense');
  assert.deepEqual(balanced.errors, []);
  assert.deepEqual(balanced.settings, defaults);
  assert.deepEqual(subtle.errors, []);
  assert.deepEqual(intense.errors, []);
  assert.equal(subtle.settings.running.pulsesPerSecondPerSession, 2);
  assert.equal(subtle.settings.nodes.idleBrightness, 0.25);
  assert.equal(subtle.settings.scene.bloomStrength, 0.55);
  assert.equal(intense.settings.running.pulsesPerSecondPerSession, 10);
  assert.equal(intense.settings.activity.maxIntensity, 10);
  assert.equal(intense.settings.scene.coreLoad, 0.17);
  assert.equal(defaults.running.pulsesPerSecondPerSession, 6);
  assert.ok(Object.isFrozen(VISUAL_PRESETS.subtle));

  const filePosition = [5, 6, 7];
  const previewPosition = [8, 9, 10];
  const overridden = resolveVisualSettings(defaults, 'subtle',
    { camera: { position: filePosition }, running: { pulsesPerSecondPerSession: 4 } },
    { camera: { position: previewPosition }, running: { pulsesPerSecondPerSession: 8 } });
  assert.deepEqual(overridden.errors, []);
  assert.deepEqual(overridden.settings.camera.position, previewPosition,
    'a vector is replaced as a whole by the highest-precedence override');
  assert.equal(overridden.settings.running.pulsesPerSecondPerSession, 8,
    'temporary overrides win over file and preset values');
  assert.deepEqual(defaults.camera.position, [0, 4, 31]);
  assert.deepEqual(filePosition, [5, 6, 7]);

  const unknownPreset = resolveVisualSettings(defaults, 'unknown');
  assert.equal(unknownPreset.settings, null);
  assert.equal(unknownPreset.errors[0].path, 'preset');
  const unknownKey = resolveVisualSettings(defaults, 'balanced',
    JSON.parse('{"camera":{"__proto__":{"polluted":true}}}'));
  assert.equal(unknownKey.settings, null);
  assert.ok(unknownKey.errors.some((error) => error.path === 'fileOverrides.camera.__proto__'));
});

test('exported settings module preserves defaults and layered overrides as a loadable config', async () => {
  const defaults = await settings();
  const fileOverrides = { scene: { floorGlow: 0.66 }, floor: { color: [0.2, 0.3, 0.4] } };
  const previewOverrides = { floor: { color: [0.7, 0.6, 0.5] } };
  const overrides = mergeVisualOverrides(fileOverrides, previewOverrides);
  assert.deepEqual(overrides, {
    scene: { floorGlow: 0.66 }, floor: { color: [0.7, 0.6, 0.5] },
  });
  assert.equal(visualConfigurationSignature({
    defaults: { b: 2, a: 1 }, preset: 'balanced', overrides: {},
  }), visualConfigurationSignature({
    defaults: { a: 1, b: 2 }, preset: 'balanced', overrides: {},
  }));

  const directory = await mkdtemp(path.join(tmpdir(), 'sentient-visual-export-'));
  try {
    const currentConfig = new URL('../visual-config.mjs', import.meta.url);
    await copyFile(currentConfig, path.join(directory, 'visual-config.mjs'));
    const exportedFile = path.join(directory, 'visual-settings.mjs');
    await writeFile(exportedFile, createVisualSettingsModuleSource({
      defaults, preset: 'subtle', overrides,
    }));
    const exported = await import(`${pathToFileURL(exportedFile).href}?test=${Date.now()}`);
    const expected = resolveVisualSettings(defaults, 'subtle', overrides);
    assert.deepEqual(exported.VISUAL, defaults);
    assert.equal(exported.VISUAL_PRESET, 'subtle');
    assert.deepEqual(exported.VISUAL_OVERRIDES, overrides);
    assert.deepEqual(exported.EFFECTIVE_VISUAL, expected.settings);
    assert.deepEqual(exported.VISUAL_ERRORS, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preview edits apply complete valid settings and reset to the file source', async () => {
  const defaults = await settings();
  const harness = makePanelHarness({ defaults });
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '';
  floorGlow.dispatch('input');
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.elements.errorSummary.hidden, false);

  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.8);
  assert.equal(harness.panel.state.dirty, true);
  assert.equal(harness.elements.errorSummary.hidden, true);

  harness.elements.resetButton.click();
  assert.equal(harness.applied.at(-1).scene.floorGlow, defaults.scene.floorGlow);
  assert.equal(harness.panel.state.dirty, false);

  harness.elements.opener.click();
  assert.equal(harness.elements.opener.attributes.get('aria-expanded'), 'true');
  const escape = { key: 'Escape', preventDefault() { this.defaultPrevented = true; } };
  for (const callback of harness.elements.dialog.listeners.get('cancel')) callback(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.elements.dialog.open, false);
  assert.equal(harness.elements.opener.attributes.get('aria-expanded'), 'false');
});

test('file reload conflicts preserve previews, support both choices, and recover from invalid files', async () => {
  const defaults = await settings();
  const fileVersion = (preset, overrides) => ({ defaults, preset, overrides, errors: [] });
  const versions = [
    fileVersion('subtle', { scene: { floorGlow: 0.65 } }),
    fileVersion('subtle', { scene: { floorGlow: 0.65 } }),
    fileVersion('intense', { scene: { floorGlow: 0.9 } }),
    { errors: [{ path: 'scene.floorGlow', message: 'Must be finite.' }] },
    fileVersion('balanced', { scene: { floorGlow: 0.7 } }),
  ];
  const harness = makePanelHarness({
    defaults,
    loadFile: async () => versions.shift(),
  });
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  const preview = harness.applied.at(-1);

  await harness.panel.reload();
  assert.equal(harness.elements.conflict.hidden, false);
  assert.equal(harness.applied.at(-1), preview);
  harness.elements.keepPreviewButton.click();
  assert.equal(harness.elements.conflict.hidden, true);
  await harness.panel.reload();
  assert.equal(harness.elements.conflict.hidden, true, 'the kept file version is not prompted repeatedly');
  await harness.panel.reload();
  assert.equal(harness.elements.conflict.hidden, false, 'a newer file version prompts again');
  harness.elements.useFileButton.click();
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.9);
  assert.equal(harness.panel.state.dirty, false);

  const lastValid = harness.applied.at(-1);
  assert.equal(await harness.panel.reload(), false);
  assert.equal(harness.applied.at(-1), lastValid);
  assert.match(harness.elements.status.textContent, /last valid configuration remains active/);
  assert.equal(harness.panel.state.dirty, false, 'a reload error is not a dirty preview');
  await harness.panel.reload();
  assert.equal(harness.elements.conflict.hidden, true);
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.7);
});

test('automatic file reload is opt-in, periodic, and paused while hidden', async () => {
  const defaults = await settings();
  const tasks = new Map();
  let nextTask = 0;
  let loads = 0;
  const harness = makePanelHarness({
    defaults,
    loadFile: async () => {
      loads++;
      return { defaults, preset: 'subtle', overrides: {}, errors: [] };
    },
    scheduleTimer: (callback, delay) => {
      const id = ++nextTask;
      tasks.set(id, { callback, delay });
      return id;
    },
    cancelTimer: (id) => tasks.delete(id),
  });
  assert.equal(tasks.size, 0, 'automatic reload starts disabled');
  harness.elements.autoReloadInput.checked = true;
  harness.elements.autoReloadInput.dispatch('change');
  assert.equal([...tasks.values()][0].delay, 5000);
  const scheduled = [...tasks.entries()][0];
  tasks.delete(scheduled[0]);
  scheduled[1].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  assert.equal(harness.panel.state.preset, 'subtle');

  harness.elements.autoReloadInput.checked = false;
  harness.elements.autoReloadInput.dispatch('change');
  assert.equal(tasks.size, 0);
  harness.document.hidden = true;
  harness.elements.autoReloadInput.checked = true;
  harness.elements.autoReloadInput.dispatch('change');
  assert.equal(tasks.size, 0, 'hidden tabs do not schedule reload work');
});

test('visual configuration loader distinguishes import failures from value errors', async () => {
  const syntaxFailure = await loadVisualConfiguration(async () => {
    throw new SyntaxError('Unexpected token');
  });
  assert.equal(syntaxFailure.settings, null);
  assert.match(syntaxFailure.errors[0].message, /Could not load configuration module: Unexpected token/);

  const invalidValues = await loadVisualConfiguration(async () => ({ VISUAL: { camera: {} } }));
  assert.equal(invalidValues.settings, null);
  assert.ok(invalidValues.errors.some((error) => error.path === 'camera.fov'));

  const panel = { hidden: true, textContent: '' };
  let sceneStarted = false;
  const started = await startVisualApplication({ getElementById: () => panel },
    () => Promise.resolve(syntaxFailure), async () => { sceneStarted = true; });
  assert.equal(started, false);
  assert.equal(sceneStarted, false, 'invalid startup never starts the 3D scene');
  assert.equal(panel.hidden, false, 'configuration failures are visible');
  assert.match(panel.textContent, /visual-settings\.mjs: Could not load configuration module/);

  const validPanel = { hidden: true, textContent: '' };
  const validStart = await startVisualApplication({ getElementById: () => validPanel },
    () => Promise.resolve({ errors: [] }), async () => { sceneStarted = true; });
  assert.equal(validStart, true);
  assert.equal(sceneStarted, true, 'a valid configuration starts the scene');
});

test('nondefault running settings drive scene impulses without changing hidden-tab discard', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.running, { pulsesPerSecondPerSession: 20, maxSessions: 2 });
  const calls = [];
  const context = vm.createContext({
    VISUAL, document: { hidden: false }, Math, N: 1,
    activityState: { connection: 'connected', sourceStatus: 'available', runningSessions: 10 },
    thinkingPulseClock: createThinkingPulseClock(VISUAL.running),
    nodeEnergy: new Float32Array(1),
    fireFrom: (...args) => calls.push(args),
  });
  vm.runInContext(sceneFunction('renderThinking'), context);
  for (let frame = 0; frame < 60; frame++) vm.runInContext('renderThinking(1 / 60)', context);
  assert.equal(calls.length, 40, '20 pulses per second times the two-session cap');
  assert.deepEqual(calls[0], [0, 3, 0, -1, 1]);
  context.document.hidden = true;
  vm.runInContext('renderThinking(1 / 60)', context);
  assert.equal(calls.length, 40, 'hidden tabs emit no background impulses');
});

test('nondefault camera settings reach the camera and orbit controls', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.camera, {
    fov: 65, position: [1, 2, 40], target: [3, 4, 5], damping: 0.1,
    minDistance: 12, maxDistance: 80, autoRotate: false, autoRotateSpeed: -0.5,
  });
  const context = vm.createContext({
    VISUAL, THREE, window: { innerWidth: 800, innerHeight: 400 }, renderer: { domElement: {} },
    OrbitControls: class { constructor() { this.target = new THREE.Vector3(); } },
  });
  vm.runInContext(main.slice(main.indexOf('const camera ='), main.indexOf('const composer =')) +
    '\nglobalThis.result = { camera, controls };', context);
  const { camera, controls } = context.result;
  assert.equal(camera.fov, 65);
  assert.equal(camera.aspect, 2);
  assert.deepEqual(camera.position.toArray(), [1, 2, 40]);
  assert.deepEqual(controls.target.toArray(), [3, 4, 5]);
  assert.equal(controls.dampingFactor, 0.1);
  assert.equal(controls.minDistance, 12);
  assert.equal(controls.maxDistance, 80);
  assert.equal(controls.autoRotate, false);
  assert.equal(controls.autoRotateSpeed, -0.5);
  assert.equal(controls.enablePan, false, 'interaction behavior is preserved');
});

test('nondefault glow and waiting-marker settings reach scene materials and sprite sizes', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.scene, {
    coreColor: 0x123456, coreSize: 12, haloColor: 0xabcdef, haloSize: 28,
    glowKnee: 0.4, glowKneeOpacity: 0.6,
  });
  Object.assign(VISUAL.waiting, { markerSize: 0.8, markerOpacity: 0.5 });
  const stops = [];
  const context = vm.createContext({
    VISUAL, THREE, CATEGORY_HEX, brain: new THREE.Group(),
    document: { createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop: (...args) => stops.push(args) }),
        fillRect() {},
      }),
    }) },
  });
  vm.runInContext(main.slice(main.indexOf('function radialTexture(settings = VISUAL)'),
    main.indexOf('// ---------- pulses ----------')) +
    '\nglobalThis.result = { coreGlow, haloGlow, waitingMarkerGroups };', context);
  const { coreGlow, haloGlow, waitingMarkerGroups } = context.result;
  assert.equal(coreGlow.material.color.getHex(), 0x123456);
  assert.equal(coreGlow.scale.x, 12);
  assert.equal(haloGlow.material.color.getHex(), 0xabcdef);
  assert.equal(haloGlow.scale.x, 28);
  assert.deepEqual(stops[1], [0.4, 'rgba(255,255,255,0.6)']);
  assert.equal(waitingMarkerGroups.length, 8, 'marker capacity stays fixed');
  const marker = waitingMarkerGroups[0].children[0];
  assert.equal(marker.scale.x, 0.8);
  assert.equal(marker.material.opacity, 0.5);
  assert.equal(marker.material.color.getHexString(), CATEGORY_HEX.waiting.slice(1));
});

test('dust, floor, and waiting-marker switches hide only their decorative effects', async () => {
  for (const enabled of [true, false]) {
    const VISUAL = await settings();
    VISUAL.effects.dust = enabled;
    const dustContext = vm.createContext({
      VISUAL, THREE, CFG: { dust: 1, radius: 10 }, pixelRatio: 1, scene: new THREE.Scene(),
    });
    vm.runInContext(main.slice(main.indexOf('// ---------- dust ----------'),
      main.indexOf('// ---------- core glow ----------')), dustContext);
    assert.equal(dustContext.dust.visible, enabled);

    VISUAL.effects.floor = enabled;
    const floorContext = vm.createContext({ VISUAL, THREE, scene: new THREE.Scene() });
    vm.runInContext(main.slice(main.indexOf('const floorMat ='),
      main.indexOf('// ---------- HUD ----------')) + '\nglobalThis.result = floor;', floorContext);
    assert.equal(floorContext.result.visible, enabled);
    assert.equal(floorContext.scene.children.includes(floorContext.result), true,
      'the floor remains available and is controlled by rendering visibility');

    VISUAL.effects.waitingMarkers = enabled;
    const groups = Array.from({ length: 8 }, () => ({
      visible: false, position: { set() {} },
    }));
    const markerContext = vm.createContext({
      VISUAL, waitingMarkerGroups: groups, nodePos: new Float32Array([1, 2, 3]), N: 1,
    });
    vm.runInContext(sceneFunction('renderWaitingMarkers') + "\nrenderWaitingMarkers(['AAAA'])", markerContext);
    assert.equal(groups[0].visible, enabled);
    assert.equal(groups.slice(1).some((group) => group.visible), false);
  }
});

test('node size and idle edge variation tuning leaves generated geometry unchanged', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.nodes, {
    largeChance: 0, baseSizeMin: 2, baseSizeRange: 4, largeSizeMin: 6, largeSizeRange: 2,
  });
  Object.assign(VISUAL.scene, { edgeVariationMin: 0.2, edgeVariationRange: 0.4 });
  const source = main.slice(main.indexOf('const N = CFG.nodes;'), main.indexOf('// ---------- edges'));
  const createNodes = () => {
    const context = vm.createContext({
      VISUAL, THREE, CFG: { nodes: 2, radius: 10 },
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    });
    vm.runInContext(source + '\nglobalThis.result = { nodePos, nodeSize };', context);
    return context.result;
  };
  const ordinary = createNodes();
  assert.deepEqual([...ordinary.nodeSize], [4, 4]);
  VISUAL.nodes.largeChance = 1;
  const large = createNodes();
  assert.deepEqual([...large.nodeSize], [7, 7]);
  assert.deepEqual([...large.nodePos], [...ordinary.nodePos], 'size tuning does not move nodes');
  const context = vm.createContext({
    VISUAL, THREE, E: 1, edgeA: [0], edgeB: [1], edgeBase: [0], nodePos: ordinary.nodePos,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
  });
  vm.runInContext(main.slice(main.indexOf('const edgeGeo ='), main.indexOf('const edgeLines =')) +
    '\nglobalThis.positions = edgePositions;', context);
  assert.equal(context.edgeBase[0], 0.4);
  assert.deepEqual([...context.positions], [...ordinary.nodePos]);
});

test('nondefault grouped burst settings control motion, excitation and bounded intensity', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.activity, {
    maxIntensity: 2, maxSpread: 1, reasoningBaseHops: 5, errorHops: 4,
    reasoningEnergy: 0.2, stepHeat: 0.3, stepHeatCap: 0.4,
  });
  VISUAL.nodes.energyCap = 0.3;
  const impulseBuffer = createImpulseBuffer();
  impulseBuffer.add({ kind: 'thinking', count: 8 });
  impulseBuffer.add({ kind: 'step', count: 4 });
  impulseBuffer.add({ kind: 'activity', eventType: 'session.error', count: 2 });
  const calls = [], feed = [];
  const context = vm.createContext({
    VISUAL, CATEGORY_INDEX, impulseBuffer, document: { hidden: false },
    performance: { now: () => 0 }, Math, N: 1,
    nodeEnergy: [0], nodeHot: [0],
    timeline: { add() {} }, categoryBurstPlan: createCategoryBurstPlan(),
    impulseIntensity: (count) => impulseIntensity(count, VISUAL.activity),
    impulseFeed: { add: (...args) => feed.push(args) },
    fireFrom: (...args) => calls.push(args),
  });
  vm.runInContext(sceneFunction('renderObservedImpulses') + '\nrenderObservedImpulses()', context);
  assert.deepEqual(calls, [
    [0, 7, 0, -1, 1, CATEGORY_INDEX.reasoning],
    [0, 2, 1, -1, 1, CATEGORY_INDEX.tool],
    [0, 4, 1, -1, 1, CATEGORY_INDEX.error],
  ]);
  assert.equal(context.nodeEnergy[0], 0.3, 'custom energy cap applies');
  assert.equal(context.nodeHot[0], 0.4, 'custom heat cap applies');
  assert.equal(feed.length, 3, 'appearance tuning does not remove feed events');
  vm.runInContext('renderObservedImpulses()', context);
  assert.equal(calls.length, 3, 'drained events do not replay');
});

test('nondefault subagent appearance controls growth, lighting and retirement without overriding reduced motion', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.subagents, {
    growSeconds: 1, fadeSeconds: 4, tipSize: 7, fadingTipSize: 6, anchorSize: 9,
    initialIntensity: 0.2, intensityPerSecond: 0.1, maxIntensity: 0.4,
    runningAnchorColor: [0.1, 0.2, 0.3], runningAnchorIntensity: 2,
    failureFlashFraction: 0.2, failureFlashIntensity: 3,
  });
  const context = vm.createContext({
    VISUAL, THREE, CATEGORY_INDEX, SCENE_RGB: CATEGORY_RGB, Math,
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: { getElementById: () => ({}) }, pixelRatio: 2,
    performance: { now: () => 0 }, brain: new THREE.Group(), nodePos: new Float32Array([1, 0, 0]),
  });
  vm.runInContext(main.slice(main.indexOf('const MAX_ACTIVE_SUBAGENT_BRANCHES'),
    main.indexOf('function otherEnd')) + `
    const session = { sid: 'AAAA', anchorIndex: 0, status: 'running' };
    subagentAnchors.push(session);
    subagentAnchorBySid.set(session.sid, session);
    addSubagentBranch(session, { sid: 'BBBB', ageMs: 0 }, true);
    renderSubagentTree(0.5);
    globalThis.result = { branchTips, fadingTips, anchorPoints, anchorColors,
      branchLinePositions, branchLineColors, fadingLineColors,
      activeSubagentBranches, fadingSubagentBranches };`, context);
  const result = context.result;
  assert.equal(result.branchTips.material.size, 14);
  assert.equal(result.fadingTips.material.size, 12);
  assert.equal(result.anchorPoints.material.size, 18);
  assert.ok(Math.abs(result.anchorColors[0] - 0.2) < 1e-6);
  const line = result.branchLinePositions;
  const length = Math.hypot(line[3] - line[0], line[4] - line[1], line[5] - line[2]);
  assert.ok(Math.abs(length - result.activeSubagentBranches[0].length / 2) < 1e-6);
  assert.ok(Math.abs(result.branchLineColors[0] - CATEGORY_RGB[CATEGORY_INDEX.subagent * 3] * 0.25) < 1e-6);
  vm.runInContext("retireSubagentBranch('AAAA', 'BBBB', 'failed', 0.5); renderSubagentTree(0.7)", context);
  assert.ok(Math.abs(result.fadingLineColors[0] - CATEGORY_RGB[CATEGORY_INDEX.error * 3] * 2.85) < 1e-6);
  vm.runInContext('renderSubagentTree(4.49)', context);
  assert.equal(result.fadingSubagentBranches.length, 1);
  vm.runInContext('renderSubagentTree(4.5)', context);
  assert.equal(result.fadingSubagentBranches.length, 0, 'custom fade ends at four seconds');
  vm.runInContext(`
    reducedMotion = true;
    addSubagentBranch(session, { sid: 'BBBB', ageMs: 0 }, false);
    renderSubagentTree(0);
    retireSubagentBranch('AAAA', 'BBBB', 'completed', 0);
  `, context);
  assert.equal(result.activeSubagentBranches.length, 0);
  assert.equal(result.fadingSubagentBranches.length, 0, 'reduced motion still suppresses retirement animation');
});

test('disabling subagent transitions keeps current branches but removes growth, flashes, and retirement fades', async () => {
  const VISUAL = await settings();
  VISUAL.effects.subagentTransitions = false;
  const context = vm.createContext({
    VISUAL, THREE, CATEGORY_INDEX, SCENE_RGB: CATEGORY_RGB, Math,
    pixelRatio: 1,
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: { hidden: false, getElementById: () => ({}) },
    performance: { now: () => 0 }, N: 1, brain: new THREE.Group(), nodePos: new Float32Array([1, 0, 0]),
    activityState: { connection: 'connected', sourceStatus: 'available', coverage: 'unknown' },
    subagentSummary: { textContent: '' },
  });
  vm.runInContext(main.slice(main.indexOf('const MAX_ACTIVE_SUBAGENT_BRANCHES'),
    main.indexOf('function otherEnd')) + `
    applySubagentTree({
      reset: false,
      sessions: [{ sid: 'AAAA', status: 'running', subagents: [{ sid: 'BBBB', ageMs: 0 }] }],
      completed: [], failed: [], cleared: [],
      added: [{ sessionSid: 'AAAA', sid: 'BBBB', ageMs: 0 }],
    });
    renderSubagentTree(0.5);
    const branchLength = Math.hypot(
      branchLinePositions[3] - branchLinePositions[0],
      branchLinePositions[4] - branchLinePositions[1],
      branchLinePositions[5] - branchLinePositions[2]);
    const branch = activeSubagentBranches[0];
    retireSubagentBranch('AAAA', 'BBBB', 'failed', 0.5);
    globalThis.result = {
      branchLength, expectedLength: branch.length, growthStart: branch.growthStart,
      activeBranchCount: activeSubagentBranches.length, fadingSubagentBranches, subagentAnchors,
    };`,
    context);
  const result = context.result;
  assert.equal(result.subagentAnchors.length, 1, 'delegated-work visibility is retained');
  assert.ok(Math.abs(result.branchLength - result.expectedLength) < 1e-6,
    'current branches render fully without animated growth');
  assert.equal(result.growthStart, -Infinity);
  assert.equal(result.activeBranchCount, 0, 'retired branches are removed');
  assert.equal(result.fadingSubagentBranches.length, 0, 'retirement fades and flashes are suppressed');
});

test('nondefault node, pulse and floor values reach real material uniforms and shader expressions', async () => {
  const VISUAL = await settings();
  let next = 2;
  for (const group of Object.values(VISUAL)) {
    for (const key of Object.keys(group)) {
      group[key] = Array.isArray(group[key]) ? [next++, next++, next++] : next++;
    }
  }
  const context = vm.createContext({
    VISUAL, pixelRatio: 2,
    THREE: {
      ShaderMaterial: class { constructor(options) { Object.assign(this, options); } },
      Vector3: class { constructor(...values) { this.values = values; } },
    },
  });
  for (const name of ['nodeMat', 'pulseMat', 'floorMat', 'dustMat']) {
    const start = main.indexOf(`${name} = new THREE.ShaderMaterial(`);
    assert.notEqual(start, -1, `${name} exists`);
    // Dust is nested in a setup block; the other material declarations are top-level.
    const closing = name === 'dustMat' ? '\n  });' : '\n});';
    const end = main.indexOf(closing, start);
    assert.notEqual(end, -1, `${name} has a closing delimiter`);
    vm.runInContext(main.slice(start, end + closing.length), context);
  }
  const uniformChecks = [
    ['nodeMat', 'uScale', VISUAL.nodes.scale * 2],
    ['nodeMat', 'uSize', VISUAL.nodes.size],
    ['nodeMat', 'uActiveGrowth', VISUAL.nodes.activeGrowth],
    ['nodeMat', 'uIdleBrightness', VISUAL.nodes.idleBrightness],
    ['nodeMat', 'uActiveBrightness', VISUAL.nodes.activeBrightness],
    ['nodeMat', 'uHotMix', VISUAL.nodes.hotMix],
    ['nodeMat', 'uWhiteThreshold', VISUAL.nodes.whiteThreshold],
    ['nodeMat', 'uWhiteMix', VISUAL.nodes.whiteMix],
    ['pulseMat', 'uScale', VISUAL.pulses.scale * 2],
    ['dustMat', 'uBrightness', VISUAL.scene.dustBrightness],
    ['floorMat', 'uBrightness', VISUAL.scene.floorBrightness],
    ['floorMat', 'uFade', VISUAL.scene.floorFade],
    ['nodeMat', 'uTwinkleBase', VISUAL.nodes.twinkleBase],
    ['nodeMat', 'uTwinkleAmplitude', VISUAL.nodes.twinkleAmplitude],
    ['nodeMat', 'uTwinkleSpeed', VISUAL.nodes.twinkleSpeed],
    ['nodeMat', 'uCoreFalloff', VISUAL.nodes.coreFalloff],
    ['pulseMat', 'uCoreFalloff', VISUAL.pulses.coreFalloff],
    ['dustMat', 'uScale', VISUAL.dust.scale * 2],
    ['dustMat', 'uTwinkleBase', VISUAL.dust.twinkleBase],
    ['dustMat', 'uTwinkleAmplitude', VISUAL.dust.twinkleAmplitude],
    ['dustMat', 'uTwinkleSpeed', VISUAL.dust.twinkleSpeed],
    ['dustMat', 'uTwinklePhase', VISUAL.dust.twinklePhase],
    ['dustMat', 'uTwinklePower', VISUAL.dust.twinklePower],
    ['floorMat', 'uFineSpacing', VISUAL.floor.fineSpacing],
    ['floorMat', 'uFineIntensity', VISUAL.floor.fineIntensity],
    ['floorMat', 'uCoarseSpacing', VISUAL.floor.coarseSpacing],
    ['floorMat', 'uCoarseIntensity', VISUAL.floor.coarseIntensity],
    ['floorMat', 'uPoolFade', VISUAL.floor.poolFade],
    ['floorMat', 'uPoolBase', VISUAL.floor.poolBase],
    ['floorMat', 'uPoolGrid', VISUAL.floor.poolGrid],
  ];
  for (const [material, uniform, expected] of uniformChecks) {
    assert.equal(context[material].uniforms[uniform].value, expected, `${material}.${uniform}`);
    const shaders = context[material].vertexShader + context[material].fragmentShader;
    assert.match(shaders, new RegExp(`uniform float ${uniform};`));
    assert.ok(shaders.match(new RegExp(`\\b${uniform}\\b`, 'g')).length >= 2,
      `${uniform} is used, not merely declared`);
  }
  for (const [material, uniform, expected] of [
    ['nodeMat', 'uTwinkleSpatial', VISUAL.nodes.twinkleSpatial],
    ['nodeMat', 'uBaseColor', VISUAL.nodes.baseColor],
    ['nodeMat', 'uHotColor', VISUAL.nodes.hotColor],
    ['nodeMat', 'uWhiteColor', VISUAL.nodes.whiteColor],
    ['dustMat', 'uColor', VISUAL.dust.color],
    ['floorMat', 'uColor', VISUAL.floor.color],
    ['floorMat', 'uPoolColor', VISUAL.floor.poolColor],
  ]) {
    assert.deepEqual(context[material].uniforms[uniform].value.values, expected);
    const shaders = context[material].vertexShader + context[material].fragmentShader;
    assert.match(shaders, new RegExp(`uniform vec3 ${uniform};`));
    assert.ok(shaders.match(new RegExp(`\\b${uniform}\\b`, 'g')).length >= 2);
  }
  assert.match(context.nodeMat.vertexShader, /aSize \* uSize \* \(1\.0 \+ aEnergy \* uActiveGrowth\)/);
  assert.match(context.nodeMat.fragmentShader, /max\(vEnergy, vHot\) - uWhiteThreshold/);
  assert.match(context.nodeMat.fragmentShader, /uIdleBrightness \* vTwinkle \+ max\(vEnergy, vHot\) \* uActiveBrightness/);
});

test('nondefault pulse speed, head, spacing, brightness and completion controls reach actual writers', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.pulses, {
    speedMin: 2, speedRange: 2, completionHead: 5, completionTrailSpacing: 0.2,
    head: 4, trailSpacing: 0.1, headBrightness: 2, trailFalloff: 2,
  });
  Object.assign(VISUAL.completion, {
    hops: 3, neighbourHops: 1, spread: 1, neighbourSeeds: 1,
    neighbourSpread: 1, branchChance: 0, seedHeat: 1, nodeEnergy: 0.3, edgeIntensity: 0.4,
  });
  const calls = [];
  const context = vm.createContext({
    VISUAL, CATEGORY_INDEX, SCENE_RGB: CATEGORY_RGB,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    P: 1, T: 2, pCursor: 0, activePulses: 0,
    pActive: [0], pEdge: [0], pFrom: [0], pT: [0], pSpeed: [0],
    pHops: [0], pKind: [0], pCat: [0],
    edgeLen: [1], edgeR: [0], edgeG: [0], edgeBColor: [0],
    nodeEnergy: [0, 0], nodeHot: [0, 0],
    adjacency: [[0, 1, 2]], otherEnd: () => 1,
    fireFrom: (...args) => calls.push(args),
    nodePos: [0, 0, 0, 1, 0, 0],
    pulsePos: new Float32Array(6), pulseCol: new Float32Array(6), pulseSize: new Float32Array(2),
    pulseGeo: { attributes: { position: {}, aColor: {}, aSize: {} } },
  });
  vm.runInContext(['spawnPulse', 'updatePulses', 'writePulseBuffers', 'renderCompletionCascade']
    .map(sceneFunction).join('\n'), context);
  vm.runInContext('renderCompletionCascade(0)', context);
  assert.deepEqual(calls.splice(0), [
    [0, 3, 2, -1, 1, CATEGORY_INDEX.completion],
    [1, 1, 2, 0, 1, CATEGORY_INDEX.completion],
  ]);
  assert.equal(context.nodeHot[0], 1);
  vm.runInContext('spawnPulse(0, 0, 3, 2, CATEGORY_INDEX.completion)', context);
  assert.equal(context.pSpeed[0], 3);
  vm.runInContext('updatePulses(0.2); writePulseBuffers()', context);
  assert.ok(Math.abs(context.edgeR[0] - CATEGORY_RGB[CATEGORY_INDEX.completion * 3] * 0.4) < 1e-6);
  assert.equal(context.pulseSize[0], 5);
  assert.ok(Math.abs(context.pulsePos[3] - 0.4) < 1e-6);
  assert.ok(Math.abs(context.pulseCol[0] - CATEGORY_RGB[CATEGORY_INDEX.completion * 3] * 2) < 1e-6);
  assert.ok(Math.abs(context.pulseSize[1] - 5 * (0.35 + 0.65 * 0.25)) < 1e-6);
  vm.runInContext('updatePulses(0.2)', context);
  assert.equal(context.nodeEnergy[1], 0.3);
  assert.deepEqual(calls.splice(0), [[1, 2, 2, 0, 1, CATEGORY_INDEX.completion]]);
  VISUAL.completion.branchChance = 1;
  context.pActive[0] = 1;
  context.pT[0] = 0.9;
  context.activePulses = 1;
  vm.runInContext('updatePulses(0.2)', context);
  assert.deepEqual(calls.splice(0), [[1, 2, 2, 0, 2, CATEGORY_INDEX.completion]]);
  context.pActive[0] = 1;
  context.pKind[0] = 1;
  context.pT[0] = 0.6;
  vm.runInContext('writePulseBuffers()', context);
  assert.equal(context.pulseSize[0], 4);
  assert.ok(Math.abs(context.pulsePos[3] - 0.5) < 1e-6);
});

test('nondefault scene settings reach edge decay, bloom and load-based ambient paths', async () => {
  const VISUAL = await settings();
  const ambience = '{\n' + main.slice(main.indexOf('  // ambience'), main.indexOf('  hudTimer -= dt')) + '\n}';
  for (const key of Object.keys(VISUAL.scene)) {
    VISUAL.scene[key] = Array.isArray(VISUAL.scene[key]) ? [0.2, 0.2, 0.2] : 0.2;
  }
  const bloomContext = vm.createContext({
    VISUAL, window: { innerWidth: 800, innerHeight: 600 },
    THREE: { Vector2: class {} },
    UnrealBloomPass: class {
      constructor(size, strength, radius, threshold) {
        Object.assign(this, { strength, radius, threshold });
      }
    },
  });
  const bloomStart = main.indexOf('const bloom = new UnrealBloomPass(');
  const bloomEnd = main.indexOf(';', bloomStart);
  vm.runInContext(main.slice(bloomStart, bloomEnd + 1) + '\nglobalThis.pass = bloom', bloomContext);
  assert.equal(bloomContext.pass.strength, 0.2);
  assert.equal(bloomContext.pass.radius, 0.2);
  assert.equal(bloomContext.pass.threshold, 0.2);
  const context = vm.createContext({
    VISUAL, Math, E: 1, edgeR: [1], edgeG: [1], edgeBColor: [1],
    edgeBase: [0], edgeColors: new Float32Array(6), edgeGeo: { attributes: { color: {} } },
    dt: 0, now: 0, smoothedLoad: 0.5, activePulses: 0,
    activityState: { activeSessions: 0, connection: 'connected', sourceStatus: 'available', waitingSessions: 0 },
    brain: { scale: { setScalar() {} } },
    coreGlow: { material: { color: { lerpColors() {} } } }, haloGlow: { material: {} },
    baseCoreColor: {}, waitingCoreColor: {}, bloom: {},
    dust: { rotation: {} }, nodeMat: { uniforms: { uTime: {} } },
    dustMat: { uniforms: { uTime: {} } }, floorMat: { uniforms: { uTime: {}, uGlow: {} } },
  });
  vm.runInContext(sceneFunction('writeEdgeColors') + '\nwriteEdgeColors(1)', context);
  assert.ok(Math.abs(context.edgeR[0] - Math.exp(-0.2)) < 1e-6);
  vm.runInContext(ambience, context);
  assert.ok(Math.abs(context.bloom.strength - 0.3) < 1e-6);
  assert.ok(Math.abs(context.coreGlow.material.opacity - 0.3) < 1e-6);
  assert.ok(Math.abs(context.haloGlow.material.opacity - 0.3) < 1e-6);
  assert.equal(context.floorMat.uniforms.uGlow.value, 0.1);
  Object.assign(VISUAL.waiting, {
    breathSpeed: 1, colorMixMin: 0.2, colorMixRange: 0.4, opacityBase: 0.1, opacityBreath: 0.2,
  });
  Object.assign(VISUAL.dust, { rotationSpeed: -0.3, tiltSpeed: 1, tiltAmplitude: 0.4 });
  let scale, blend;
  context.brain.scale.setScalar = (value) => { scale = value; };
  context.coreGlow.material.color.lerpColors = (from, to, value) => { blend = value; };
  context.now = Math.PI / 2;
  context.activityState.waitingSessions = 1;
  vm.runInContext(ambience, context);
  assert.ok(Math.abs(blend - 0.6) < 1e-6);
  assert.ok(Math.abs(context.coreGlow.material.opacity - 0.52) < 1e-6);
  assert.ok(Math.abs(scale - (1 + Math.sin(Math.PI / 10) * 0.2)) < 1e-6);
  assert.ok(Math.abs(context.dust.rotation.y + Math.PI * 0.15) < 1e-6);
  assert.equal(context.dust.rotation.x, 0.4);
  VISUAL.effects.waitingGlow = false;
  VISUAL.effects.latticeBreathing = false;
  vm.runInContext(ambience, context);
  assert.equal(blend, 0, 'waiting glow modulation is removed');
  assert.ok(Math.abs(context.coreGlow.material.opacity - 0.3) < 1e-6,
    'baseline core glow remains when waiting glow is disabled');
  assert.equal(scale, 1, 'disabled lattice breathing leaves the lattice unmodulated');
  context.dt = 0.5;
  context.activePulses = 0.1;
  context.activityState.activeSessions = 0.1;
  vm.runInContext(ambience, context);
  assert.ok(Math.abs(context.smoothedLoad - 0.55) < 1e-6, 'custom load divisors and smoothing apply');
});

test('node decay and ordinary arrival/trail settings alter the actual animation buffers', async () => {
  const VISUAL = await settings();
  Object.assign(VISUAL.nodes, { decay: 1, energyCap: 0.6 });
  Object.assign(VISUAL.pulses, {
    nodeEnergy: 0.8, stepEdgeIntensity: 0.2, thinkingEdgeIntensity: 0.3, minTrailSize: 0.8,
  });
  const context = vm.createContext({
    VISUAL, Math, SCENE_RGB: CATEGORY_RGB, P: 1, T: 2, N: 2, dt: 1,
    pActive: [1], pEdge: [0], pFrom: [0], pT: [0.5], pKind: [1], pCat: [CATEGORY_INDEX.tool],
    pSpeed: [1], pHops: [0], activePulses: 1, edgeLen: [1],
    edgeR: [0], edgeG: [0], edgeBColor: [0],
    nodeEnergy: [1, 0], nodeHot: [1, 0], nodePos: [0, 0, 0, 1, 0, 0],
    nodeGeo: { attributes: { aEnergy: {}, aHot: {} } },
    pulsePos: new Float32Array(6), pulseCol: new Float32Array(6), pulseSize: new Float32Array(2),
    pulseGeo: { attributes: { position: {}, aColor: {}, aSize: {} } }, otherEnd: () => 1,
  });
  vm.runInContext([sceneFunction('updatePulses'), sceneFunction('writePulseBuffers')].join('\n') +
    '\nwritePulseBuffers(); updatePulses(0.5)', context);
  const falloff = Math.pow(0.5, 1.6);
  assert.ok(Math.abs(context.pulseSize[1] - 2.2 * (0.8 + 0.2 * falloff)) < 1e-6);
  assert.equal(context.nodeEnergy[1], 0.6);
  assert.equal(context.edgeR[0], CATEGORY_RGB[CATEGORY_INDEX.tool * 3] * 0.2);
  context.pActive[0] = 1;
  context.pKind[0] = 0;
  context.pT[0] = 0;
  vm.runInContext('updatePulses(0.1)', context);
  assert.equal(context.edgeR[0], CATEGORY_RGB[CATEGORY_INDEX.tool * 3] * 0.3);
  const start = main.indexOf('  const decay = Math.exp(-dt * VISUAL.nodes.decay)');
  vm.runInContext(main.slice(start, main.indexOf('  writeEdgeColors(dt)', start)), context);
  assert.ok(Math.abs(context.nodeEnergy[0] - Math.exp(-1)) < 1e-6);
  assert.ok(Math.abs(context.nodeHot[0] - Math.exp(-1)) < 1e-6);
});
