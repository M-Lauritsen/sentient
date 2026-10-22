import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VISUAL as defaults } from '../visual-settings.mjs';
import { CFG } from '../scene/structural-config.mjs';
import { createScenePalette, CATEGORY_INDEX } from '../activity-colors.mjs';
import { installSceneHarness } from './scene-harness.mjs';

function fixture() {
  const VISUAL = structuredClone(defaults);
  VISUAL.nodes.count = 37;
  const context = {
    VISUAL, THREE, CFG: { ...CFG, dust: 2, maxPulses: 16 },
    Math: { random: () => 0.5 }, pixelRatio: 1, libraryModalOpen: false,
    SCENE_RGB: createScenePalette(VISUAL),
    brain: new THREE.Group(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), update() {} }, bloom: {},
    performance: { now: () => 1000 },
    activityState: { connection: 'connected', sourceStatus: 'available', waitingSessionIds: ['SYNTH-A'] },
    document: {
      documentElement: { style: { setProperty() {} } },
      getElementById: () => ({}),
      createElement: () => ({
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
        }),
      }),
    },
  };
  return { context, ...installSceneHarness(context) };
}

test('appearance prepares and disposes a failed candidate without touching active resources or settings', () => {
  const { context, ambience, pulses, appearance, networkRenderer } = fixture();
  const original = structuredClone(context.VISUAL);
  const settingsIdentity = context.VISUAL;
  const cameraIdentity = context.VISUAL.camera;
  const geometry = networkRenderer.network.nodeGeo;
  const texture = ambience.resources.coreGlow.material.map;
  let oldDisposals = 0;
  texture.addEventListener('dispose', () => oldDisposals++);
  const prepared = [];
  const radialTexture = ambience.radialTexture;
  ambience.radialTexture = candidate => {
    const texture = radialTexture(candidate);
    const record = { texture, disposed: 0 };
    texture.addEventListener('dispose', () => record.disposed++);
    prepared.push(record);
    return texture;
  };
  pulses.spawnPulse(0, 0, 2, 1, CATEGORY_INDEX.tool);
  const candidate = structuredClone(context.VISUAL);
  candidate.nodes.count++;
  candidate.scene.glowKnee = 0.3;
  context.THREE = {
    ...THREE,
    BufferGeometry: class extends THREE.BufferGeometry {
      setAttribute() { throw new Error('Synthetic candidate allocation failure'); }
    },
  };
  assert.throws(() => appearance.applyVisualSettings(candidate), /candidate allocation failure/);
  assert.deepEqual(context.VISUAL, original);
  assert.equal(context.VISUAL, settingsIdentity);
  assert.equal(context.VISUAL.camera, cameraIdentity);
  assert.equal(networkRenderer.network.nodeGeo, geometry);
  assert.equal(pulses.activePulses, 1);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].disposed, 1);
  assert.equal(oldDisposals, 0);
  assert.equal(ambience.resources.coreGlow.material.map, texture);

  context.THREE = THREE;
  appearance.applyVisualSettings(candidate);
  assert.notEqual(networkRenderer.network.nodeGeo, geometry);
  assert.equal(pulses.activePulses, 0);
  assert.equal(context.VISUAL, settingsIdentity);
  assert.equal(context.VISUAL.camera, cameraIdentity);
  assert.equal(oldDisposals, 1);
  assert.equal(prepared[1].disposed, 0);
  for (const material of [ambience.resources.coreGlow.material,
    ambience.resources.haloGlow.material, ambience.resources.waitingMarkerMaterial]) {
    assert.equal(material.map, prepared[1].texture, 'all glow sprites share the committed texture');
  }
});

test('live owner application remaps in-flight speeds and resamples sizes without rebuilding the graph', () => {
  const { context, pulses, appearance, networkRenderer } = fixture();
  const geometry = networkRenderer.network.nodeGeo;
  const positions = networkRenderer.network.nodePos.slice();
  pulses.spawnPulse(0, 0, 2, 1, CATEGORY_INDEX.tool);
  pulses.spawnPulse(0, 0, 2, 1, CATEGORY_INDEX.tool);
  pulses.buffers.pSpeed[1] = 0;
  const candidate = structuredClone(context.VISUAL);
  candidate.pulses.speedMin = 10;
  candidate.pulses.speedRange = 2;
  candidate.nodes.baseSizeMin = 1.6;
  appearance.applyVisualSettings(candidate);
  assert.equal(networkRenderer.network.nodeGeo, geometry);
  assert.deepEqual(networkRenderer.network.nodePos, positions);
  assert.equal(pulses.activePulses, 2);
  assert.equal(pulses.buffers.pSpeed[0], 11, 'the old midpoint remains the midpoint');
  assert.equal(pulses.buffers.pSpeed[1], 10, 'out-of-range speed fractions are clamped');
  for (const size of networkRenderer.network.nodeSize) assert.ok(Math.abs(size - 2.1) < 1e-6);
});
