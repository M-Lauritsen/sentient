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
  createActivityTimeline, impulseIntensity } from '../activity-client.mjs';
import { createPageActivityTotals } from '../session-stats-ui.mjs';
import { loadVisualConfiguration, startVisualApplication, validateVisualSettings,
  resolveVisualSettings, VISUAL_PRESETS, VISUAL_SETTING_DEFINITIONS,
  VISUAL_SETTING_PRESENTATION,
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
  replaceChildren(...elements) { this.children = elements; }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatch(type, values = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }
  click() { this.dispatch('click'); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  show() { this.open = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  focus() {}
}

function makePanelHarness({
  defaults, preset = 'balanced', overrides = {}, loadFile, scheduleTimer, cancelTimer,
  storage = makeMemoryStorage(), applySettings = () => true,
}) {
  const resolved = resolveVisualSettings(defaults, preset, overrides);
  const document = new TestElement();
  document.hidden = false;
  document.createElement = (tagName) =>
    Object.assign(new TestElement(), { tagName: tagName.toUpperCase() });
  const fields = new TestElement();
  const quickFields = new TestElement();
  const elements = Object.fromEntries([
    'opener', 'dialog', 'form', 'presetSelect', 'searchInput', 'searchStatus',
    'clearSearchButton', 'title', 'status', 'errorSummary', 'conflict',
    'useFileButton', 'keepPreviewButton', 'closeButton', 'resetButton', 'exportButton',
    'reloadButton', 'autoReloadInput', 'presetNameInput', 'saveAsPresetButton',
    'savePresetButton', 'deletePresetButton',
  ].map((key) => [key, new TestElement()]));
  const applied = [];
  const options = {
    document,
    ...elements,
    fields,
    quickFields,
    getStorage: () => storage,
    confirmAction: () => true,
    initialConfiguration: { defaults, preset, overrides, settings: resolved.settings },
    applySettings: (value) => {
      const accepted = applySettings(value);
      if (accepted !== false) applied.push(value);
      return accepted;
    },
    loadFile,
    ...(scheduleTimer ? { scheduleTimer } : {}),
    ...(cancelTimer ? { cancelTimer } : {}),
    requestFrame: (callback) => { queueMicrotask(callback); return 1; },
    cancelFrame() {},
  };
  const panel = createVisualSettingsPanel(options);
  const control = (path, { quick = false } = {}) => {
    const root = quick ? quickFields : fields;
    const descendants = (element) => [element, ...element.children.flatMap(descendants)];
    const wrapper = descendants(root).find((child) =>
      child.attributes.get('data-setting-path') === path &&
      child.attributes.get('data-quick-projection') === String(quick));
    return descendants(wrapper).filter((element) => element.type === 'number' ||
      element.type === 'range' || element.type === 'checkbox' ||
      element.type === 'color' || element.tagName === 'SELECT');
  };
  const field = (path, { quick = false } = {}) => {
    const root = quick ? quickFields : fields;
    const descendants = (element) => [element, ...element.children.flatMap(descendants)];
    return descendants(root).find((child) =>
      child.attributes.get('data-setting-path') === path &&
      child.attributes.get('data-quick-projection') === String(quick));
  };
  return { panel, document, elements, fields, quickFields, applied, control, field };
}

function makeMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    values,
  };
}

function sceneFunction(name) {
  const body = main.slice(main.indexOf(`function ${name}(`));
  const end = /\r?\n}\r?\n/.exec(body);
  assert.ok(end, `${name} is extractable`);
  return body.slice(0, end.index + end[0].length);
}

function makeNetworkHarness(VISUAL) {
  const context = vm.createContext({
    VISUAL, THREE, CATEGORY_INDEX, CATEGORY_HEX, CATEGORY_RGB, validateVisualSettings, structuredClone,
    SCENE_RGB: Float32Array.from(CATEGORY_RGB), pixelRatio: 1,
    CFG: { radius: 10, neighbours: 3, maxEdgeLen: 4.5, dust: 2, maxPulses: 16, trail: 7 },
    brain: new THREE.Group(), scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), update() {} }, bloom: {},
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    performance: { now: () => 1000 },
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    libraryModalOpen: false,
    activityState: {
      connection: 'connected', sourceStatus: 'available', coverage: 'complete',
      waitingSessionIds: ['AAAA'], runningSessions: 1, sessions: [],
    },
    document: {
      getElementById: () => ({}),
      createElement: () => ({
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
        }),
      }),
    },
  });
  vm.runInContext(main.slice(main.indexOf('// ---------- nodes ----------'),
    main.indexOf('// ---------- HUD ----------')) +
    sceneFunction('renderWaitingMarkers') + sceneFunction('applyVisualSettings') + `
    globalThis.network = () => ({
      N, E, nodePos, nodeEnergy, nodeHot, nodeSize, adjacency, edgeA, edgeB, edgeLen,
      nodeGeo, nodePoints, edgeGeo, edgeLines, edgeBase, fireEdges, activePulses, pActive, pFrom, pEdge,
      pulsePos, pulseCol, pulseSize, pulseGeo, waitingMarkerGroups,
      subagentAnchors, activeSubagentBranches, fadingSubagentBranches,
    });`, context);
  return context;
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
      count: visual.nodes.count, scale: 120, size: 1, activeGrowth: 2, idleBrightness: 0.4,
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
      background: 0x020409, edgeVisibility: 'always', categoryBrightness: 0.9,
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
  assert.deepEqual(configModule.EFFECTIVE_VISUAL, resolveVisualSettings(
    configModule.VISUAL, configModule.VISUAL_PRESET, configModule.VISUAL_OVERRIDES).settings);
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
    ['scene.edgeBaseColor[0]', (value) => { value.scene.edgeBaseColor = [-0.1, 0.2, 0.3]; }],
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
  assert.equal(defaults.nodes.scale, 120, 'validation does not mutate the active defaults');
});

test('network count and line modes validate exact boundaries without mutating defaults', async () => {
  const defaults = await settings();
  defaults.nodes.count = 1200;
  assert.equal(defaults.nodes.count, 1200);
  assert.equal(defaults.scene.edgeVisibility, 'always');
  for (const count of [2, 4000]) {
    const result = resolveVisualSettings(defaults, 'balanced', { nodes: { count } });
    assert.deepEqual(result.errors, []);
    assert.equal(result.settings.nodes.count, count);
  }
  for (const count of [0, 1, 4001, 2.5, Infinity, '1200']) {
    const result = resolveVisualSettings(defaults, 'balanced', { nodes: { count } });
    assert.equal(result.settings, null);
    assert.ok(result.errors.some(({ path }) => path.endsWith('nodes.count')));
  }
  for (const edgeVisibility of ['always', 'active', 'hidden']) {
    assert.deepEqual(resolveVisualSettings(defaults, 'balanced', {
      scene: { edgeVisibility },
    }).errors, []);
  }
  for (const edgeVisibility of ['sometimes', true, 1, null]) {
    const result = resolveVisualSettings(defaults, 'balanced', { scene: { edgeVisibility } });
    assert.equal(result.settings, null);
    assert.ok(result.errors.some(({ path }) => path.endsWith('scene.edgeVisibility')));
  }
  assert.equal(defaults.nodes.count, 1200);
});

test('startup topology uses the requested count and produces valid connected endpoints', async () => {
  for (const count of [2, 37, 4000]) {
    const VISUAL = await settings();
    VISUAL.nodes.count = count;
    const context = vm.createContext({
      VISUAL, THREE, CFG: { radius: 10, neighbours: 3, maxEdgeLen: 4.5 },
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    });
    vm.runInContext(sceneFunction('buildNetwork') + '\nglobalThis.result = buildNetwork(VISUAL);', context);
    const result = context.result;
    assert.equal(result.N, count);
    assert.equal(result.nodePos.length, count * 3);
    assert.equal(result.nodeEnergy.length, count);
    assert.equal(result.adjacency.length, count);
    assert.ok(result.adjacency.every((edges) => edges.length > 0));
    assert.ok([...result.nodePos].every(Number.isFinite));
    for (let edge = 0; edge < result.edgeA.length; edge++) {
      const a = result.edgeA[edge], b = result.edgeB[edge];
      assert.ok(a >= 0 && a < count && b >= 0 && b < count && a !== b);
      assert.ok(result.adjacency[a].includes(edge) && result.adjacency[b].includes(edge));
    }
  }
});

test('live network rebuild changes actual topology, disposes old geometry, and preserves activity state', async () => {
  const VISUAL = await settings();
  VISUAL.nodes.count = 37;
  const context = makeNetworkHarness(VISUAL);
  const originalState = structuredClone(context.activityState);
  context.pageActivityTotals = createPageActivityTotals();
  context.pageActivityTotals.add({ kind: 'step', count: 3 });
  context.timeline = createActivityTimeline(0);
  context.timeline.setCoverage(true, 0);
  context.timeline.add(context.pageActivityTotals.counts, 1000);
  context.impulseBuffer = createImpulseBuffer();
  context.impulseBuffer.add({ kind: 'step', count: 3 });
  const originalTimeline = structuredClone(context.timeline.read(1000));
  const originalTotals = Array.from(context.pageActivityTotals.counts);
  vm.runInContext(`
    const session = { sid: 'AAAA', status: 'running', anchorIndex: N - 1 };
    subagentAnchors.push(session);
    subagentAnchorBySid.set(session.sid, session);
    addSubagentBranch(session, { sid: 'BBBB', ageMs: 5000 }, false);
    addSubagentBranch(session, { sid: 'CCCC', ageMs: 3000 }, false);
    retireSubagentBranch('AAAA', 'CCCC', 'completed', 1);
    fireFrom(N - 1, 2, 0);
    writePulseBuffers();
  `, context);
  const unchanged = context.network();
  context.candidate = structuredClone(VISUAL);
  vm.runInContext('applyVisualSettings(candidate)', context);
  assert.equal(context.network().nodeGeo, unchanged.nodeGeo, 'unchanged count does not rebuild');
  assert.equal(context.network().activePulses, unchanged.activePulses);
  for (const count of [2, 4000, 37]) {
    const before = context.network();
    let nodesDisposed = 0, edgesDisposed = 0;
    before.nodeGeo.addEventListener('dispose', () => nodesDisposed++);
    before.edgeGeo.addEventListener('dispose', () => edgesDisposed++);
    context.candidate = structuredClone(VISUAL);
    context.candidate.nodes.count = count;
    context.candidate.scene.edgeVisibility = 'active';
    vm.runInContext('applyVisualSettings(candidate)', context);
    const next = context.network();
    assert.equal(next.N, count);
    assert.equal(VISUAL.nodes.count, count);
    assert.equal(next.nodeGeo.attributes.position.count, count);
    assert.equal(next.nodeGeo.attributes.aEnergy.count, count);
    assert.equal(next.nodeGeo.attributes.aHot.count, count);
    assert.equal(next.nodeGeo.attributes.aSize.count, count);
    assert.equal(next.edgeGeo.attributes.position.count, next.E * 2);
    assert.equal(next.nodePoints.geometry, next.nodeGeo);
    assert.equal(next.edgeLines.geometry, next.edgeGeo);
    assert.equal(nodesDisposed, 1);
    assert.equal(edgesDisposed, 1);
    assert.equal(next.activePulses, 0);
    assert.ok([...next.pActive, ...next.pulseSize, ...next.pulseCol].every((value) => value === 0));
    assert.equal(next.subagentAnchors.length, 1);
    assert.equal(next.activeSubagentBranches.length, 1);
    assert.equal(next.fadingSubagentBranches.length, 1);
    for (const branch of [...next.subagentAnchors, ...next.activeSubagentBranches,
      ...next.fadingSubagentBranches]) {
      assert.ok(branch.anchorIndex >= 0 && branch.anchorIndex < count);
    }
    assert.equal(next.activeSubagentBranches[0].startedAt, -4);
    assert.deepEqual(context.activityState, originalState);
    assert.deepEqual(context.timeline.read(1000), originalTimeline);
    assert.deepEqual(Array.from(context.pageActivityTotals.counts), originalTotals);
    vm.runInContext(`
      renderSubagentTree(1);
      fireFrom(N - 1, 2, 0);
    `, context);
    assert.ok(context.network().activePulses > 0);
    vm.runInContext(`
      updatePulses(0.1);
      writePulseBuffers();
      writeEdgeColors(0.1);
    `, context);
    assert.ok([...next.pulsePos, ...next.waitingMarkerGroups[0].position.toArray()].every(Number.isFinite));
    for (let edge = 0; edge < next.E; edge++) {
      assert.ok(next.edgeA[edge] < count && next.edgeB[edge] < count);
      assert.ok(next.adjacency[next.edgeA[edge]].includes(edge));
      assert.ok(next.adjacency[next.edgeB[edge]].includes(edge));
    }
    assert.ok(next.fireEdges.length >= Math.max(...next.adjacency.map((edges) => edges.length)));
  }
  assert.equal(context.impulseBuffer.drain().byCategory[CATEGORY_INDEX.tool], 3,
    'pending observed activity is not discarded with visual pulses');
});

test('failed or invalid network rebuild keeps the previous network and settings intact', async () => {
  const VISUAL = await settings();
  VISUAL.nodes.count = 37;
  const context = makeNetworkHarness(VISUAL);
  const before = context.network();
  context.candidate = structuredClone(VISUAL);
  context.candidate.nodes.count = 1;
  assert.throws(() => vm.runInContext('applyVisualSettings(candidate)', context), /nodes.count/);
  assert.equal(context.network().nodeGeo, before.nodeGeo);
  assert.equal(VISUAL.nodes.count, 37);

  context.candidate.nodes.count = 60;
  let discardedGeometries = 0;
  context.THREE = {
    ...THREE,
    BufferGeometry: class extends THREE.BufferGeometry {
      setAttribute() { throw new Error('Synthetic geometry allocation failure'); }
      dispose() { discardedGeometries++; super.dispose(); }
    },
  };
  assert.throws(() => vm.runInContext('applyVisualSettings(candidate)', context), /allocation failure/);
  assert.equal(context.network().nodeGeo, before.nodeGeo);
  assert.equal(context.network().edgeGeo, before.edgeGeo);
  assert.equal(context.network().N, 37);
  assert.equal(VISUAL.nodes.count, 37);
  assert.equal(discardedGeometries, 1, 'partially built geometry is disposed');
});

test('line modes change rendered edges only and preserve decaying activity', async () => {
  for (const mode of ['always', 'active', 'hidden']) {
    const VISUAL = await settings();
    VISUAL.scene.edgeVisibility = mode;
    VISUAL.scene.edgeBaseColor = [0.2, 0.4, 0.6];
    const context = vm.createContext({
      VISUAL, Math, E: 2, edgeR: [1, 0], edgeG: [0.5, 0], edgeBColor: [0.25, 0],
      edgeBase: [1, 1], edgeColors: new Float32Array(12),
      edgeLines: { visible: true }, edgeGeo: { attributes: { color: {} } },
    });
    vm.runInContext(sceneFunction('writeEdgeColors') + '\nwriteEdgeColors(1)', context);
    assert.equal(context.edgeLines.visible, mode !== 'hidden');
    const decay = Math.exp(-VISUAL.scene.edgeFade);
    assert.ok(Math.abs(context.edgeR[0] - decay) < 1e-6);
    const idle = mode === 'always' ? 0.2 : 0;
    assert.ok(Math.abs(context.edgeColors[0] - (decay + idle)) < 1e-6);
    assert.ok(Math.abs(context.edgeColors[6] - idle) < 1e-6);
  }
});

test('count preview, reload, reset and export apply count live without a page refresh', async (t) => {
  const defaults = await settings();
  defaults.nodes.count = 1200;
  const harness = makePanelHarness({
    defaults,
    loadFile: async () => ({
      defaults, preset: 'balanced', overrides: { nodes: { count: 800 } }, errors: [],
    }),
  });
  const [count] = harness.control('nodes.count');
  count.value = '600';
  count.dispatch('input');
  assert.equal(harness.applied.length, 0, 'numeric count drafts wait for Enter or blur');
  count.dispatch('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).nodes.count, 600);
  assert.equal(harness.panel.state.overrides.nodes.count, 600);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
  const [mode] = harness.control('scene.edgeVisibility');
  mode.value = 'hidden';
  mode.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).scene.edgeVisibility, 'hidden');
  assert.equal(harness.applied.at(-1).nodes.count, 600);
  let exportedBlob;
  t.mock.method(URL, 'createObjectURL', (blob) => { exportedBlob = blob; return 'blob:synthetic'; });
  harness.elements.exportButton.click();
  const exported = await exportedBlob.text();
  assert.match(exported, /"count": 600/);
  assert.match(exported, /"edgeVisibility": "hidden"/);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
  harness.elements.resetButton.click();
  assert.equal(harness.applied.at(-1).nodes.count, 1200);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
  await harness.panel.reload();
  assert.equal(count.value, '800');
  assert.equal(harness.applied.at(-1).nodes.count, 800);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
  harness.elements.resetButton.click();
  assert.equal(harness.applied.at(-1).nodes.count, 800);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
});

test('repeated node-count drafts defer topology rebuild until one final commit', async () => {
  const defaults = await settings();
  defaults.nodes.count = 37;
  const context = makeNetworkHarness(structuredClone(defaults));
  let rebuilds = 0;
  const harness = makePanelHarness({
    defaults,
    applySettings(candidate) {
      const oldGeometry = context.network().nodeGeo;
      context.candidate = candidate;
      const accepted = vm.runInContext('applyVisualSettings(candidate)', context);
      if (accepted && context.network().nodeGeo !== oldGeometry) rebuilds++;
      return accepted;
    },
  });
  const originalGeometry = context.network().nodeGeo;
  const [count] = harness.control('nodes.count');
  for (const value of ['60', '61', '62']) {
    count.value = value;
    count.dispatch('input');
  }
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.72';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rebuilds, 0);
  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied.at(-1).nodes.count, 37);
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.72);
  assert.equal(count.value, '62');
  assert.equal(context.network().nodeGeo, originalGeometry);

  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  descendants(harness.field('scene.floorGlow')).find((element) =>
    element.className === 'visual-field-reset').click();
  assert.equal(rebuilds, 0);
  assert.equal(harness.applied.length, 2);
  assert.equal(harness.applied.at(-1).nodes.count, 37);
  assert.equal(harness.applied.at(-1).scene.floorGlow, defaults.scene.floorGlow);
  assert.equal(count.value, '62');

  count.dispatch('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rebuilds, 1);
  assert.equal(context.network().N, 62);
  assert.equal(harness.applied.length, 3);
  assert.equal(harness.applied.at(-1).nodes.count, 62);
});

test('invalid finite-draft input blocks otherwise valid live edits from partially applying', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const [floorGlow] = harness.control('scene.floorGlow');
  const [nodeSize] = harness.control('nodes.size');
  floorGlow.value = '';
  floorGlow.dispatch('input');
  nodeSize.value = '1.2';
  nodeSize.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.applied.length, 0);
  assert.equal(harness.elements.errorSummary.hidden, false);
  assert.equal(nodeSize.value, '1.2');

  floorGlow.value = '0.72';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied[0].scene.floorGlow, 0.72);
  assert.equal(harness.applied[0].nodes.size, 1.2);
});

test('selecting personal presets applies saved node counts live', async () => {
  const defaults = await settings();
  defaults.nodes.count = 37;
  const context = makeNetworkHarness(structuredClone(defaults));
  const harness = makePanelHarness({
    defaults,
    applySettings(candidate) {
      context.candidate = candidate;
      return vm.runInContext('applyVisualSettings(candidate)', context);
    },
  });
  const [count] = harness.control('nodes.count');
  count.value = '60';
  count.dispatch('input');
  count.dispatch('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.presetNameInput.value = 'Sixty nodes';
  harness.elements.saveAsPresetButton.click();
  harness.elements.resetButton.click();
  assert.equal(harness.applied.at(-1).nodes.count, 37);
  assert.equal(context.network().N, 37);
  harness.elements.presetSelect.value = 'user:Sixty nodes';
  harness.elements.presetSelect.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).nodes.count, 60);
  assert.equal(context.network().N, 60);
  assert.doesNotMatch(harness.elements.status.textContent, /refresh/i);
});

test('panel reports a failed live rebuild and can recover without discarding the active network', async () => {
  const defaults = await settings();
  defaults.nodes.count = 37;
  const context = makeNetworkHarness(structuredClone(defaults));
  const harness = makePanelHarness({
    defaults,
    applySettings(candidate) {
      context.candidate = candidate;
      return vm.runInContext('applyVisualSettings(candidate)', context);
    },
  });
  const before = context.network();
  context.THREE = {
    ...THREE,
    BufferGeometry: class { constructor() { throw new Error('Synthetic rebuild failure'); } },
  };
  const [count] = harness.control('nodes.count');
  count.value = '60';
  count.dispatch('input');
  count.dispatch('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.network().nodeGeo, before.nodeGeo);
  assert.equal(context.network().N, 37);
  assert.match(harness.elements.status.textContent, /Preview not applied: Synthetic rebuild failure/);
  assert.equal(harness.applied.length, 0);
  context.THREE = THREE;
  count.dispatch('input');
  count.dispatch('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.network().N, 60);
  assert.match(harness.elements.status.textContent, /Live preview applied/);
});

test('invalid count and line-mode drafts preserve the last applied preview', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  for (const [path, value] of [['nodes.count', '4001'], ['scene.edgeVisibility', 'invalid']]) {
    const [input] = harness.control(path);
    input.value = value;
    input.dispatch('input');
    if (path === 'nodes.count') input.dispatch('blur');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.applied.length, 0);
    assert.equal(harness.elements.errorSummary.hidden, false);
    assert.equal(input.attributes.get('aria-invalid'), 'true');
    harness.elements.resetButton.click();
    harness.applied.length = 0;
  }
});

test('all advanced paths appear once and quick controls share the same canonical draft', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const advanced = descendants(harness.fields).filter((element) =>
    element.attributes.get('data-setting-path') &&
    element.attributes.get('data-quick-projection') === 'false');
  const paths = advanced.map((element) => element.attributes.get('data-setting-path'));
  assert.equal(paths.length, 166);
  assert.equal(new Set(paths).size, 166);
  assert.deepEqual([...paths].sort(),
    VISUAL_SETTING_DEFINITIONS.map(({ path }) => path).sort());

  const quickPaths = VISUAL_SETTING_DEFINITIONS
    .filter(({ path }) => VISUAL_SETTING_PRESENTATION[path].quick)
    .map(({ path }) => path);
  for (const path of quickPaths) {
    assert.ok(harness.field(path, { quick: true }), `${path} has a Quick projection`);
  }

  const [quickSize] = harness.control('nodes.size', { quick: true });
  const [advancedSize] = harness.control('nodes.size');
  quickSize.value = '1.25';
  quickSize.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(advancedSize.value, '1.25');
  assert.equal(harness.applied.at(-1).nodes.size, 1.25);

  harness.elements.searchInput.value = 'node projection scale';
  harness.elements.searchInput.dispatch('input');
  assert.equal(harness.field('nodes.scale').hidden, false);
  assert.equal(harness.field('nodes.count').hidden, true);
  assert.match(harness.elements.searchStatus.textContent, /1 setting found/i);
  harness.elements.clearSearchButton.click();
  assert.equal(harness.field('nodes.count').hidden, false);
});

test('every scalar numeric setting renders a slider with finite valid guidance and steps', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const numeric = VISUAL_SETTING_DEFINITIONS.filter(({ type }) => type === 'number');
  assert.equal(numeric.length, 140);
  for (const { path, constraints } of numeric) {
    const controls = harness.control(path);
    const sliders = controls.filter(({ type }) => type === 'range');
    assert.equal(sliders.length, 1, `${path} has one Advanced slider`);
    const [slider] = sliders;
    const minimum = Number(slider.min);
    const maximum = Number(slider.max);
    const step = Number(slider.step);
    assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum) &&
      minimum < maximum, `${path} has a finite increasing range`);
    assert.ok(Number.isFinite(step) && step > 0 && step <= maximum - minimum,
      `${path} has a usable step`);
    if (constraints.minimum !== undefined) assert.ok(minimum >= constraints.minimum, path);
    if (constraints.maximum !== undefined) assert.ok(maximum <= constraints.maximum, path);
    if (constraints.exclusiveMinimum !== undefined) assert.ok(minimum > constraints.exclusiveMinimum, path);
    if (constraints.exclusiveMaximum !== undefined) assert.ok(maximum < constraints.exclusiveMaximum, path);
    if (constraints.integer) {
      assert.ok(Number.isInteger(minimum) && Number.isInteger(maximum), path);
      assert.equal(step, 1, path);
    }
  }
});

test('new sliders preview scale, signed motion, spacing, duration and integer values', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  for (const [path, value] of [
    ['dust.scale', 72],
    ['dust.rotationSpeed', -0.06],
    ['floor.coarseSpacing', 25],
    ['subagents.growSeconds', 0.5],
    ['impact.maxMs', 150000],
    ['running.maxSessions', 64],
  ]) {
    const [input, slider] = harness.control(path);
    slider.value = String(value);
    slider.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    const [group, name] = path.split('.');
    assert.equal(input.value, String(value), path);
    assert.equal(harness.applied.at(-1)[group][name], value, path);
    assert.equal(harness.elements.errorSummary.hidden, true, path);
  }

  const lastValid = harness.applied.at(-1);
  const [power] = harness.control('dust.twinklePower');
  power.value = '0';
  power.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1), lastValid);
  assert.equal(power.attributes.get('aria-invalid'), 'true');
});

test('suggested sliders update exact values and invalid drafts do not partially apply', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const [scaleInput, scaleSlider] = harness.control('nodes.scale');
  scaleSlider.value = '130';
  scaleSlider.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scaleInput.value, '130');
  assert.equal(harness.applied.at(-1).nodes.scale, 130);

  const lastValid = harness.applied.at(-1);
  scaleInput.value = '-1';
  scaleInput.dispatch('input');
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1), lastValid);
  assert.equal(harness.elements.errorSummary.hidden, false);
  assert.equal(scaleInput.attributes.get('aria-invalid'), 'true');
});

test('field and section resets restore the loaded file values', async () => {
  const defaults = await settings();
  const overrides = {
    nodes: { scale: 105, size: 1.1 },
    scene: { floorGlow: 0.7 },
  };
  const fileSettings = resolveVisualSettings(defaults, 'balanced', overrides).settings;
  const harness = makePanelHarness({ defaults, overrides });
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.9';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.9);

  descendants(harness.field('scene.floorGlow')).find((element) =>
    element.className === 'visual-field-reset').click();
  assert.equal(harness.applied.at(-1).scene.floorGlow, fileSettings.scene.floorGlow);

  const [scale] = harness.control('nodes.scale');
  const [size] = harness.control('nodes.size');
  scale.value = '125';
  scale.dispatch('input');
  size.value = '1.4';
  size.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).nodes.scale, 125);
  assert.equal(harness.applied.at(-1).nodes.size, 1.4);

  const networkRow = descendants(harness.fields).find((element) =>
    element.className === 'visual-settings-section-row' &&
    descendants(element).some((child) =>
      child.tagName === 'SUMMARY' && child.textContent === 'Network · nodes and connections'));
  networkRow.children.find((child) => child.className === 'visual-group-reset').click();
  assert.deepEqual(harness.applied.at(-1), fileSettings);
});

test('out-of-slider values survive navigation, preview, personal preset save, and exact export', async (t) => {
  const defaults = await settings();
  defaults.nodes.scale = 175;
  defaults.dust.scale = 240.123456;
  defaults.dust.rotationSpeed = -0.25;
  const storage = makeMemoryStorage();
  const harness = makePanelHarness({ defaults, storage });
  const [scaleInput, scaleSlider] = harness.control('nodes.scale');
  assert.equal(scaleInput.value, '175');
  assert.equal(scaleSlider.value, '150');
  assert.equal(harness.field('nodes.scale').children
    .find((element) => element.className === 'visual-range-hint').hidden, false);
  const [dustScale, dustSlider] = harness.control('dust.scale');
  assert.equal(dustScale.value, '240.123456');
  assert.equal(dustSlider.value, '120');
  const [dustRotation, rotationSlider] = harness.control('dust.rotationSpeed');
  assert.equal(dustRotation.value, '-0.25');
  assert.equal(rotationSlider.value, '-0.1');

  harness.elements.searchInput.value = 'glow strength';
  harness.elements.searchInput.dispatch('input');
  harness.elements.searchInput.value = '';
  harness.elements.searchInput.dispatch('input');
  assert.equal(scaleInput.value, '175');
  harness.elements.opener.click();
  harness.elements.closeButton.click();
  assert.equal(scaleInput.value, '175');

  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).nodes.scale, 175);
  harness.elements.presetNameInput.value = 'Exact scale';
  harness.elements.saveAsPresetButton.click();
  const saved = JSON.parse(storage.values.values().next().value).presets[0].settings;
  assert.equal(saved.nodes.scale, 175);
  assert.equal(saved.dust.scale, 240.123456);
  assert.equal(saved.dust.rotationSpeed, -0.25);
  assert.equal(harness.panel.state.preset, 'user:Exact scale');

  let exportedBlob;
  t.mock.method(URL, 'createObjectURL', (blob) => {
    exportedBlob = blob;
    return 'blob:exact-visual-settings';
  });
  harness.elements.exportButton.click();
  const source = await exportedBlob.text();
  const readExport = (name) => {
    const match = new RegExp(`export const ${name} = ([\\s\\S]*?);`).exec(source);
    assert.ok(match, `export includes ${name}`);
    return JSON.parse(match[1]);
  };
  const exportedDefaults = readExport('VISUAL');
  const exportedPreset = readExport('VISUAL_PRESET');
  const exportedOverrides = readExport('VISUAL_OVERRIDES');
  const exportedSettings = resolveVisualSettings(
    exportedDefaults, exportedPreset, exportedOverrides);
  assert.equal(exportedDefaults.nodes.scale, 175);
  assert.equal(exportedOverrides.nodes.scale, 175);
  assert.equal(exportedSettings.settings.nodes.scale, 175);
  assert.equal(exportedSettings.settings.dust.scale, 240.123456);
  assert.equal(exportedSettings.settings.dust.rotationSpeed, -0.25);
  assert.equal(exportedSettings.settings.scene.floorGlow, 0.8);
});

test('paired pulse speed edits preserve maximum and reject invalid ranges atomically', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const [minimum] = harness.control('pulses.speedMin');
  const [maximum] = harness.control('pulses.speedRange');

  maximum.value = '10';
  maximum.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).pulses.speedMin, 4);
  assert.equal(harness.applied.at(-1).pulses.speedRange, 6);
  assert.equal(minimum.value, '4');
  assert.equal(maximum.value, '10');

  minimum.value = '6';
  minimum.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).pulses.speedMin, 6);
  assert.equal(harness.applied.at(-1).pulses.speedRange, 4);

  const lastValid = harness.applied.at(-1);
  maximum.value = '5';
  maximum.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1), lastValid);
  assert.equal(harness.elements.errorSummary.hidden, false);
  assert.equal(maximum.attributes.get('aria-invalid'), 'true');
});

test('rotation direction preserves the signed value and zero remains stopped', async () => {
  const harness = makePanelHarness({ defaults: await settings() });
  const [speed] = harness.control('camera.autoRotateSpeed');
  const direction = harness.control('camera.autoRotateSpeed')
    .find((element) => element.tagName === 'SELECT');
  direction.value = '-1';
  direction.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).camera.autoRotateSpeed, -0.35);

  speed.value = '0';
  speed.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  direction.value = '1';
  direction.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.at(-1).camera.autoRotateSpeed, 0);
});

test('all colour settings use sRGB pickers while preserving stored formats and untouched precision', async () => {
  const defaults = await settings();
  const harness = makePanelHarness({ defaults });
  const colours = VISUAL_SETTING_DEFINITIONS.filter(({ type }) => type === 'rgb' || type === 'hex');
  for (const definition of colours) {
    assert.equal(definition.editor, 'color');
    const inputs = harness.control(definition.path);
    assert.equal(inputs.length, 1, definition.path);
    const [picker] = inputs;
    assert.equal(picker.type, 'color', definition.path);
    assert.match(picker.attributes.get('aria-label'), /sRGB color/);
    const [group, name] = definition.path.split('.');
    const original = defaults[group][name];
    const expected = definition.type === 'rgb'
      ? new THREE.Color().setRGB(...original, THREE.LinearSRGBColorSpace).getHexString()
      : original.toString(16).padStart(6, '0');
    assert.equal(picker.value, `#${expected}`);
    picker.value = '#123456';
    picker.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    const actual = harness.applied.at(-1)[group][name];
    if (definition.type === 'rgb') {
      assert.deepEqual(actual, new THREE.Color(0x123456).toArray());
    } else {
      assert.equal(actual, 0x123456);
    }
    harness.elements.resetButton.click();
    assert.deepEqual(harness.applied.at(-1), defaults, 'reset preserves full original precision');
    assert.equal(picker.value, `#${expected}`);
  }
  assert.equal(harness.control('camera.position').length, 3, 'non-colour vectors stay numeric');
  assert.ok(harness.control('camera.position').every(({ type }) => type === 'number'));
});

test('picker edits survive export and reload with correct linear conversion and invalid drafts rejected', async (t) => {
  const defaults = await settings();
  const harness = makePanelHarness({
    defaults,
    loadFile: async () => ({
      defaults, preset: 'balanced', overrides: {
        scene: { edgeBaseColor: [0.003, 0.25, 1], background: 0xabcdef },
      }, errors: [],
    }),
  });
  const [picker] = harness.control('scene.edgeBaseColor');
  picker.value = '#808080';
  picker.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  const linear = new THREE.Color(0x808080).toArray();
  assert.deepEqual(harness.applied.at(-1).scene.edgeBaseColor, linear);
  assert.equal(picker.value, '#808080');
  let blob;
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:synthetic'; });
  harness.elements.exportButton.click();
  const source = await blob.text();
  const module = { exports: {} };
  vm.runInNewContext(source.replace(/^import .*$/m, '')
    .replaceAll('export const ', 'const ') + '\nmodule.exports = VISUAL_OVERRIDES;', {
    module, resolveVisualSettings,
  });
  assert.deepEqual([...module.exports.scene.edgeBaseColor], linear);
  const lastValid = harness.applied.at(-1);
  picker.value = '#zzzzzz';
  picker.dispatch('input');
  assert.equal(harness.applied.at(-1), lastValid);
  assert.equal(picker.attributes.get('aria-invalid'), 'true');
  harness.elements.resetButton.click();
  await harness.panel.reload();
  assert.equal(picker.value, `#${new THREE.Color().setRGB(0.003, 0.25, 1).getHexString()}`);
  assert.equal(harness.control('scene.background')[0].value, '#abcdef');
  assert.deepEqual(harness.applied.at(-1).scene.edgeBaseColor, [0.003, 0.25, 1]);
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

test('users can create, reapply, update, and delete personal presets across reloads', async (t) => {
  const defaults = await settings();
  const storage = makeMemoryStorage();
  const first = makePanelHarness({ defaults, storage });
  const [floorGlow] = first.control('scene.floorGlow');
  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  first.elements.presetNameInput.value = 'Night shift';
  first.elements.saveAsPresetButton.click();

  assert.equal(first.elements.presetSelect.value, 'user:Night shift');
  assert.equal(first.panel.state.preset, 'user:Night shift');
  assert.equal(first.elements.savePresetButton.disabled, false);
  assert.equal(first.elements.deletePresetButton.disabled, false);

  floorGlow.value = '0.4';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  first.elements.savePresetButton.click();
  const stored = JSON.parse(storage.values.values().next().value);
  assert.equal(stored.presets[0].settings.scene.floorGlow, 0.4);

  const second = makePanelHarness({ defaults, storage });
  assert.ok(second.elements.presetSelect.children.some((option) =>
    option.value === 'user:Night shift'));
  second.elements.presetSelect.value = 'user:Night shift';
  second.elements.presetSelect.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.applied.at(-1).scene.floorGlow, 0.4);
  const [secondFloorGlow] = second.control('scene.floorGlow');
  secondFloorGlow.value = '';
  secondFloorGlow.dispatch('input');
  second.elements.deletePresetButton.click();
  assert.equal(JSON.parse(storage.values.values().next().value).presets.length, 1);
  assert.equal(second.panel.state.preset, 'user:Night shift');
  assert.match(second.elements.status.textContent, /correct pending edits/i);
  secondFloorGlow.value = '0.4';
  secondFloorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  let exportedBlob;
  t.mock.method(URL, 'createObjectURL', (blob) => { exportedBlob = blob; return 'blob:personal-preset'; });
  second.elements.exportButton.click();
  const source = await exportedBlob.text();
  const exportedModule = { exports: {} };
  vm.runInNewContext(source.replace(/^import .*$/m, '')
    .replaceAll('export const ', 'const ') +
    '\nmodule.exports = { VISUAL_PRESET, VISUAL_OVERRIDES };', {
    module: exportedModule, resolveVisualSettings,
  });
  assert.equal(exportedModule.exports.VISUAL_PRESET, 'balanced');
  assert.equal(exportedModule.exports.VISUAL_OVERRIDES.scene.floorGlow, 0.4);

  second.elements.deletePresetButton.click();
  assert.equal(second.elements.presetSelect.value, 'balanced');
  assert.equal(second.elements.deletePresetButton.disabled, true);
  assert.equal(JSON.parse(storage.values.values().next().value).presets.length, 0);
  assert.equal(second.applied.at(-1).scene.floorGlow, 0.4,
    'deleting the selected preset keeps the current preview intact');
});

test('personal preset names and browser storage failures are reported without losing the preview', async () => {
  const defaults = await settings();
  const unavailableStorage = {
    getItem() { return null; },
    setItem() { throw new Error('Quota exceeded'); },
  };
  const harness = makePanelHarness({ defaults, storage: unavailableStorage });
  const [floorGlow] = harness.control('scene.floorGlow');
  floorGlow.value = '0.8';
  floorGlow.dispatch('input');
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.presetNameInput.value = 'balanced';
  harness.elements.saveAsPresetButton.click();
  assert.match(harness.elements.status.textContent, /name.*reserved/i);
  assert.equal(harness.elements.presetSelect.children.some((option) =>
    option.value === 'user:balanced'), false);

  harness.elements.presetNameInput.value = 'My preset';
  harness.elements.saveAsPresetButton.click();
  assert.match(harness.elements.status.textContent, /quota exceeded/i);
  assert.equal(harness.elements.presetSelect.children.some((option) =>
    option.value === 'user:My preset'), false);
  assert.equal(harness.panel.state.preset, 'balanced');
  assert.equal(harness.applied.at(-1).scene.floorGlow, 0.8);
});

test('malformed saved personal presets fail closed without disabling built-in previews', async () => {
  const harness = makePanelHarness({
    defaults: await settings(),
    storage: { getItem: () => 'not-json', setItem() {} },
  });
  assert.match(harness.elements.status.textContent, /not valid JSON/i);
  assert.equal(harness.elements.saveAsPresetButton.disabled, true);
  assert.equal(harness.elements.savePresetButton.disabled, true);
  assert.equal(harness.elements.deletePresetButton.disabled, true);

  harness.elements.presetSelect.value = 'subtle';
  harness.elements.presetSelect.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.panel.state.preset, 'subtle');
  assert.equal(harness.applied.at(-1).running.pulsesPerSecondPerSession, 2);
});

test('exported settings module preserves defaults and layered overrides as a loadable config', async () => {
  const defaults = await settings();
  const fileOverrides = {
    nodes: { count: 800 }, scene: { floorGlow: 0.66, edgeVisibility: 'active' },
    floor: { color: [0.2, 0.3, 0.4] },
  };
  const previewOverrides = { floor: { color: [0.7, 0.6, 0.5] } };
  const overrides = mergeVisualOverrides(fileOverrides, previewOverrides);
  assert.deepEqual(overrides, {
    nodes: { count: 800 }, scene: { floorGlow: 0.66, edgeVisibility: 'active' },
    floor: { color: [0.7, 0.6, 0.5] },
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
    count: 2, largeChance: 0, baseSizeMin: 2, baseSizeRange: 4, largeSizeMin: 6, largeSizeRange: 2,
  });
  Object.assign(VISUAL.scene, { edgeVariationMin: 0.2, edgeVariationRange: 0.4 });
  const createNodes = () => {
    const context = vm.createContext({
      VISUAL, THREE, CFG: { radius: 10, neighbours: 3, maxEdgeLen: 4.5 },
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    });
    vm.runInContext(sceneFunction('buildNetwork') + '\nglobalThis.result = buildNetwork(VISUAL);', context);
    return context.result;
  };
  const ordinary = createNodes();
  assert.deepEqual([...ordinary.nodeSize], [4, 4]);
  VISUAL.nodes.largeChance = 1;
  const large = createNodes();
  assert.deepEqual([...large.nodeSize], [7, 7]);
  assert.deepEqual([...large.nodePos], [...ordinary.nodePos], 'size tuning does not move nodes');
  assert.ok(Math.abs(ordinary.edgeBase[0] - 0.4) < 1e-6);
  assert.deepEqual([...ordinary.edgeGeo.attributes.position.array], [...ordinary.nodePos]);
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
    if (typeof VISUAL.scene[key] === 'string') continue;
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
    edgeLines: { visible: true },
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
