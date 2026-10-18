import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CATEGORY_INDEX, CATEGORY_RGB } from '../activity-colors.mjs';

const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const settings = async () => structuredClone((await import('../visual-settings.mjs')).VISUAL);

function sceneFunction(name) {
  const body = main.slice(main.indexOf(`function ${name}(`));
  const end = /\r?\n}\r?\n/.exec(body);
  assert.ok(end, `${name} is extractable`);
  return body.slice(0, end.index + end[0].length);
}

test('visual settings characterize the latest tuned defaults, not structural capacities or palette', async () => {
  const visual = await settings();
  assert.deepEqual(visual, {
    nodes: {
      scale: 95, size: 1, activeGrowth: 2, idleBrightness: 0.4,
      activeBrightness: 1.8, hotMix: 1.4, whiteThreshold: 0.7, whiteMix: 1,
    },
    pulses: {
      scale: 110, head: 2.2, completionHead: 3, trailSpacing: 0.05,
      completionTrailSpacing: 0.07, speedMin: 4, speedRange: 4,
      headBrightness: 1.6, trailFalloff: 1.6,
    },
    completion: {
      hops: 7, neighbourHops: 5, spread: 8, neighbourSeeds: 4,
      neighbourSpread: 2, branchChance: 0.42, seedHeat: 2.5,
      nodeEnergy: 0.9, edgeIntensity: 1,
    },
    scene: {
      bloomStrength: 0.85, bloomLoad: 0.3, bloomRadius: 0.45, bloomThreshold: 0.12,
      edgeFade: 2.4, coreOpacity: 0.015, coreLoad: 0.12, haloOpacity: 0.025,
      haloLoad: 0.03, dustBrightness: 0.18, floorBrightness: 0.22,
      floorFade: 0.028, floorGlow: 0.5,
    },
  });
  assert.match(main, /import \{ VISUAL \} from '\.\/visual-settings\.mjs'/);
  assert.match(main, /maxPulses: 1600/);
  assert.match(main, /trail: 7/);
  assert.match(main, /CATEGORY_RGB, \(channel\)/);
});

test('nondefault node, pulse and floor values reach real material uniforms and shader expressions', async () => {
  const VISUAL = await settings();
  let next = 2;
  for (const group of Object.values(VISUAL)) {
    for (const key of Object.keys(group)) group[key] = next++;
  }
  const context = vm.createContext({
    VISUAL, pixelRatio: 2,
    THREE: { ShaderMaterial: class { constructor(options) { Object.assign(this, options); } } },
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
  ];
  for (const [material, uniform, expected] of uniformChecks) {
    assert.equal(context[material].uniforms[uniform].value, expected, `${material}.${uniform}`);
    const shaders = context[material].vertexShader + context[material].fragmentShader;
    assert.match(shaders, new RegExp(`uniform float ${uniform};`));
    assert.ok(shaders.match(new RegExp(`\\b${uniform}\\b`, 'g')).length >= 2,
      `${uniform} is used, not merely declared`);
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
  for (const key of Object.keys(VISUAL.scene)) VISUAL.scene[key] = 0.2;
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
  vm.runInContext(main.slice(main.indexOf('  // ambience'), main.indexOf('  hudTimer -= dt')), context);
  assert.ok(Math.abs(context.bloom.strength - 0.3) < 1e-6);
  assert.ok(Math.abs(context.coreGlow.material.opacity - 0.3) < 1e-6);
  assert.ok(Math.abs(context.haloGlow.material.opacity - 0.3) < 1e-6);
  assert.equal(context.floorMat.uniforms.uGlow.value, 0.1);
});
