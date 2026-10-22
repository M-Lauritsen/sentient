import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_SETTING_DEFINITIONS, VISUAL_SETTING_PRESENTATION } from '../appearance/visual-config.mjs';
import {
  DEMO_FOCUSES,
  demoFocusForPath,
  applyPreviewSweep,
  previewSweepValue,
  sweepablePath,
} from '../appearance/visual-settings-preview.mjs';

const definition = (path) => VISUAL_SETTING_DEFINITIONS.find((item) => item.path === path);
const presentation = (path) => VISUAL_SETTING_PRESENTATION[path];

test('settings map to the demo effect they control', () => {
  assert.equal(demoFocusForPath('hooks.startImpact'), 'hooks');
  assert.equal(demoFocusForPath('hooks.otherColor'), 'hooks');
  assert.equal(demoFocusForPath('impact.maxHops'), 'impact');
  assert.equal(demoFocusForPath('completion.spread'), 'completion');
  assert.equal(demoFocusForPath('waiting.markerSize'), 'waiting');
  assert.equal(demoFocusForPath('effects.waitingGlow'), 'waiting');
  assert.equal(demoFocusForPath('effects.waitingMarkers'), 'waiting');
  assert.equal(demoFocusForPath('running.spread'), 'running');
  assert.equal(demoFocusForPath('pulses.thinkingEdgeIntensity'), 'running');
  assert.equal(demoFocusForPath('pulses.head'), 'pulses');
  assert.equal(demoFocusForPath('activity.maxSpread'), 'pulses');
  assert.equal(demoFocusForPath('scene.categoryBrightness'), 'pulses');
  // No synthetic subagent tree exists, so these keep the mixed demo.
  assert.equal(demoFocusForPath('subagents.tipSize'), null);
  assert.equal(demoFocusForPath('nodes.size'), null);
  assert.equal(demoFocusForPath('scene.bloomStrength'), null);
  assert.equal(demoFocusForPath(null), null);
  assert.equal(demoFocusForPath('unknown.path'), null);
  for (const item of VISUAL_SETTING_DEFINITIONS) {
    const focus = demoFocusForPath(item.path);
    assert.ok(focus === null || DEMO_FOCUSES.includes(focus), item.path);
  }
});

test('only cheap, deterministic number and boolean settings are swept', () => {
  for (const path of ['nodes.size', 'scene.bloomStrength', 'pulses.speedMin', 'camera.fov',
    'effects.dust', 'camera.autoRotate', 'impact.maxHops']) {
    assert.equal(sweepablePath(definition(path), presentation(path)), true, path);
  }
  for (const path of ['nodes.count', 'nodes.largeChance', 'nodes.largeSizeMin', 'nodes.largeSizeRange',
    'nodes.baseSizeMin', 'nodes.baseSizeRange', 'scene.edgeVariationMin', 'scene.edgeVariationRange',
    'scene.glowKnee', 'scene.glowKneeOpacity', 'camera.damping', 'camera.minDistance',
    'camera.maxDistance', 'camera.position', 'nodes.twinkleSpatial', 'nodes.baseColor',
    'scene.background', 'scene.edgeVisibility']) {
    assert.equal(sweepablePath(definition(path), presentation(path)), false, path);
  }
  assert.equal(sweepablePath(undefined, undefined), false);
});

test('number sweep starts at the current value and stays inside the suggested range', () => {
  const path = 'scene.bloomStrength';
  const [minimum, maximum] = presentation(path).suggestedRange;
  for (const base of [minimum, 0.2, 0.75, maximum]) {
    assert.ok(Math.abs(previewSweepValue(definition(path), presentation(path), base, 0) - base) < 1e-9);
    let low = Infinity, high = -Infinity;
    for (let ms = 0; ms <= 2400; ms += 50) {
      const value = previewSweepValue(definition(path), presentation(path), base, ms);
      assert.ok(value >= minimum - 1e-9 && value <= maximum + 1e-9, `${base} @${ms}: ${value}`);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    // A visible swing of roughly 70% of the suggested range, even at the edges.
    assert.ok(high - low > (maximum - minimum) * 0.6, `${base}: ${low}..${high}`);
  }
});

test('integer sweeps round and booleans flip about once per second', () => {
  const path = 'impact.maxHops';
  for (let ms = 0; ms <= 2400; ms += 37) {
    assert.ok(Number.isInteger(previewSweepValue(definition(path), presentation(path), 6, ms)));
  }
  const toggle = definition('effects.dust');
  assert.equal(previewSweepValue(toggle, presentation('effects.dust'), true, 0), true);
  assert.equal(previewSweepValue(toggle, presentation('effects.dust'), true, 1100), false);
  assert.equal(previewSweepValue(toggle, presentation('effects.dust'), true, 2100), true);
  assert.equal(previewSweepValue(toggle, presentation('effects.dust'), false, 1100), true);
});

test('sweep honours definition constraints and out-of-range current values', () => {
  const path = 'camera.fov';
  const item = definition(path);
  const [minimum, maximum] = presentation(path).suggestedRange;
  const outside = maximum + 30;
  assert.ok(Math.abs(previewSweepValue(item, presentation(path), outside, 0) - outside) < 1e-9);
  for (let ms = 0; ms <= 2400; ms += 50) {
    const value = previewSweepValue(item, presentation(path), outside, ms);
    if (item.constraints.minimum !== undefined) assert.ok(value >= item.constraints.minimum);
    if (item.constraints.maximum !== undefined) assert.ok(value <= item.constraints.maximum);
    assert.ok(Number.isFinite(value));
  }
  assert.ok(minimum < maximum);
});

test('applyPreviewSweep writes only the swept path into a candidate copy', async () => {
  const { VISUAL } = await import('../visual-settings.mjs');
  const base = structuredClone(VISUAL);
  const candidate = structuredClone(base);
  applyPreviewSweep(candidate, definition('scene.bloomStrength'), presentation('scene.bloomStrength'), 600);
  assert.notEqual(candidate.scene.bloomStrength, base.scene.bloomStrength);
  candidate.scene.bloomStrength = base.scene.bloomStrength;
  assert.deepEqual(candidate, base);
});

test('rotation-speed sweep keeps its direction and turns rotation on so it is visible', async () => {
  const { VISUAL } = await import('../visual-settings.mjs');
  const candidate = structuredClone(VISUAL);
  candidate.camera.autoRotate = false;
  candidate.camera.autoRotateSpeed = -0.5;
  const item = definition('camera.autoRotateSpeed');
  for (let ms = 0; ms <= 2400; ms += 100) {
    const copy = structuredClone(candidate);
    applyPreviewSweep(copy, item, presentation('camera.autoRotateSpeed'), ms);
    assert.equal(copy.camera.autoRotate, true);
    assert.ok(copy.camera.autoRotateSpeed <= 0, `${ms}: ${copy.camera.autoRotateSpeed}`);
  }
});
