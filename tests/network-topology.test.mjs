import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { VISUAL } from '../visual-settings.mjs';
import { buildNetwork, updateNetworkGeometry } from '../scene/network.mjs';
import { getTopologyDesign, createTopologyMotionState } from '../network-topology-design/index.mjs';

const config = { radius: 10, neighbours: 3, maxEdgeLen: 4.5 };

// Captured from the pre-refactor builder at e0f8321 with seed 123456789.
// Quantize world coordinates/lengths to 1e-6 to avoid platform libm noise.
const baselines = [
  ['lattice', 37, 253, 31, '4540d2453dd83bc477e16f65c3edd27cee2d73810fd239d6c2903cad5666f4bc'],
  ['lattice', 4000, 31547, 7547, 'f001ea8ddf44f721cc574bbc5f4b125d2d662665453d9e2b8979752d11643f67'],
  ['organic', 37, 232, 47, '5a47b7b0bc6759189280de7aaa9f6b8f4e1a38ddf687ef3b49fa108c770968a9'],
  ['organic', 4000, 27603, 7603, '1786f72532e70e5486abc824bfd38b1154bb18031d7bb3a3f070a2ef834fb7a2'],
  ['waves', 37, 160, 86, 'dcd7ea22ab1780673441884245309e032e6387998b30afb22501433e33a14d1f'],
  ['waves', 4000, 19747, 11747, 'e2e668fac2a92b58ea3b21203145517e5fa4cbece008ca8b2476401ddd14a8fe'],
  ['dna', 37, 118, 44, 'e49f149daaa16059d1857714a04738c2f267b3f618a9731cc4e0826d48d9455a'],
  ['dna', 4000, 12034, 4034, 'b45a5f22ffd984b08c93b9ba8754a623a0f7e47b422cba806aebd8ffc72b1685'],
];

for (const [topology, count, expectedCalls, expectedEdges, expectedDigest] of baselines) {
  test(`${topology} at ${count} nodes preserves the seeded graph and random stream`, (t) => {
    let seed = 123456789;
    let calls = 0;
    const random = () => {
      calls++;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const settings = structuredClone(VISUAL);
    settings.topology = topology;
    settings.nodes.count = count;
    const network = buildNetwork(settings, config, { random });
    t.after(() => { network.nodeGeo.dispose(); network.edgeGeo.dispose(); });
    const values = [
      network.N, network.E,
      ...['nodePos', 'nodeRestPos', 'nodeSize', 'edgeA', 'edgeB', 'edgeLen', 'edgeBase']
        .map(key => network[key]
          ? Array.from(network[key], value => Math.round(value * 1e6) / 1e6) : null),
      Array.from(network.adjacency, edges => Array.from(edges)),
    ];
    const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
    assert.equal(calls, expectedCalls, 'node-size and placement sampling keep their ordering');
    assert.equal(network.E, expectedEdges);
    assert.equal(digest, expectedDigest, 'positions, sizes, edge order/lengths and adjacency match');
  });
}

test('missing topology selects lattice and unknown identifiers fail explicitly', (t) => {
  assert.equal(getTopologyDesign(undefined).id, 'lattice');
  assert.throws(() => getTopologyDesign('unregistered'), /Unknown network topology/);
  const legacy = structuredClone(VISUAL);
  delete legacy.topology;
  legacy.nodes.count = 37;
  const network = buildNetwork(legacy, config, { random: () => 0.5 });
  t.after(() => { network.nodeGeo.dispose(); network.edgeGeo.dispose(); });
  assert.equal(network.N, 37);
  assert.equal(network.nodeRestPos, null);
  assert.ok(network.E > 0);
});

test('a late geometry allocation failure disposes both candidate resources', () => {
  const geometries = [];
  class FailingGeometry extends THREE.BufferGeometry {
    constructor() {
      super();
      geometries.push(this);
      this.addEventListener('dispose', () => { this.disposed = true; });
    }
    setAttribute(...args) {
      if (geometries.length === 2) throw new Error('Synthetic node geometry failure');
      return super.setAttribute(...args);
    }
  }
  const settings = structuredClone(VISUAL);
  settings.nodes.count = 37;
  assert.throws(() => buildNetwork(settings, config, {
    random: () => 0.5, three: { ...THREE, BufferGeometry: FailingGeometry },
  }), /Synthetic node geometry failure/);
  assert.equal(geometries.length, 2);
  assert.ok(geometries.every(geometry => geometry.disposed));
});

test('motion phases survive switching and rebuilding while edges track current positions', (t) => {
  const settings = structuredClone(VISUAL);
  settings.nodes.count = 37;
  const phases = createTopologyMotionState();
  assert.deepEqual(phases, { waves: 0, dna: 0 });
  const networks = [];
  t.after(() => {
    for (const network of networks) { network.nodeGeo.dispose(); network.edgeGeo.dispose(); }
  });
  const build = (topology) => {
    settings.topology = topology;
    const network = buildNetwork(settings, config, { random: () => 0.5 });
    networks.push(network);
    return network;
  };
  const sheet = build('waves');
  updateNetworkGeometry(sheet, settings, 1, false, phases);
  const movingSheet = sheet.nodePos.slice();
  assert.equal(phases.waves, settings.waves.speed);
  assert.equal(phases.dna, 0);
  const helix = build('dna');
  updateNetworkGeometry(helix, settings, 1, false, phases);
  const movingHelix = helix.nodePos.slice();
  assert.equal(phases.dna, settings.camera.autoRotateSpeed * Math.PI / 3);
  assert.deepEqual(createTopologyMotionState(), { waves: 0, dna: 0 }, 'phase state belongs to each scene');
  updateNetworkGeometry(helix, settings, 10, true, phases);
  assert.deepEqual(helix.nodePos, movingHelix, 'reduced motion freezes the helix');
  const staticNetwork = build('lattice');
  updateNetworkGeometry(staticNetwork, settings, 10, false, phases);
  assert.equal(phases.waves, settings.waves.speed, 'static styles do not advance wave phase');
  const rebuiltSheet = build('waves');
  updateNetworkGeometry(rebuiltSheet, settings, 0, false, phases);
  assert.deepEqual(rebuiltSheet.nodePos, movingSheet, 'wave phase survives another style and rebuild');
  const rebuiltHelix = build('dna');
  updateNetworkGeometry(rebuiltHelix, settings, 0, false, phases);
  assert.deepEqual(rebuiltHelix.nodePos, movingHelix, 'helix phase survives another style and rebuild');
  for (let e = 0; e < rebuiltHelix.E; e++) {
    const a = rebuiltHelix.edgeA[e] * 3, b = rebuiltHelix.edgeB[e] * 3;
    const positions = rebuiltHelix.nodePos;
    assert.deepEqual(Array.from(rebuiltHelix.edgeGeo.attributes.position.array.slice(e * 6, e * 6 + 6)),
      [...positions.slice(a, a + 3), ...positions.slice(b, b + 3)]);
    assert.equal(rebuiltHelix.edgeLen[e], Math.hypot(positions[a] - positions[b],
      positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]));
  }
});

test('design presentation preserves camera policy, orientation and tip-only fading', () => {
  for (const id of ['lattice', 'organic', 'waves']) {
    const { presentation } = getTopologyDesign(id);
    assert.equal(presentation.autoOrbit, true);
    assert.equal(presentation.rotationX, id === 'waves' ? 0.55 : 0);
    assert.equal(presentation.rotationZ, 0);
    assert.equal(presentation.nodeDissolveHalfLength, 0);
    assert.equal(presentation.pulseBrightness, undefined);
    assert.equal(presentation.edgeBrightness, undefined);
  }
  const { presentation } = getTopologyDesign('dna');
  assert.equal(presentation.autoOrbit, false);
  assert.equal(presentation.rotationX, 0);
  assert.equal(presentation.rotationZ, -0.55);
  assert.equal(presentation.nodeDissolveHalfLength * config.radius, 11);
  for (const y of [-11, 11]) {
    assert.ok(Math.abs(presentation.pulseBrightness(y, true, 10) - 0.15) < 1e-12);
    assert.equal(presentation.pulseBrightness(y, false, 10), 0);
    assert.equal(presentation.edgeBrightness([0, y, 0, 1, y, 0], 0, 1, 10), 0);
  }
  assert.equal(presentation.pulseBrightness(0, true, 10), 1);
  assert.equal(presentation.pulseBrightness(0, false, 10), 1);
  assert.equal(presentation.edgeBrightness([0, 0, 0, 1, 0, 0], 0, 1, 10), 1);
});
