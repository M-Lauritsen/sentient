import * as THREE from 'three';
import { getTopologyDesign } from '../network-topology-design/index.mjs';

function connectNearest({ N, nodePos, addEdge }, config) {
  const seen = new Set();
  const k = config.neighbours;
  const maxLen2 = config.maxEdgeLen * config.maxEdgeLen;
  for (let i = 0; i < N; i++) {
    const best = []; // [dist2, j]
    const ix = nodePos[i * 3], iy = nodePos[i * 3 + 1], iz = nodePos[i * 3 + 2];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const dx = nodePos[j * 3] - ix, dy = nodePos[j * 3 + 1] - iy, dz = nodePos[j * 3 + 2] - iz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (best.length < k || d2 < best[best.length - 1][0]) {
        best.push([d2, j]);
        best.sort((a, b) => a[0] - b[0]);
        if (best.length > k) best.pop();
      }
    }
    for (let n = 0; n < best.length; n++) {
      const [d2, j] = best[n];
      if (n > 0 && d2 > maxLen2) continue; // always keep at least one link
      const key = i < j ? i * N + j : j * N + i;
      if (seen.has(key)) continue;
      seen.add(key);
      addEdge(i, j, Math.sqrt(d2));
    }
  }
}

export function buildNetwork(settings, config, { random = Math.random, three = THREE } = {}) {
  const design = getTopologyDesign(settings.topology);
  const N = settings.nodes.count;
  const nodePos = new Float32Array(N * 3);
  const nodeEnergy = new Float32Array(N);
  const nodeHot = new Float32Array(N);
  const nodeSize = new Float32Array(N);
  const layout = design.createLayout({ N, radius: config.radius, random });
  for (let i = 0; i < N; i++) {
    // Size sampling stays interleaved with placement to preserve the random stream.
    layout.placeNode(nodePos, i);
    nodeSize[i] = random() < settings.nodes.largeChance
      ? settings.nodes.largeSizeMin + random() * settings.nodes.largeSizeRange
      : settings.nodes.baseSizeMin + random() * settings.nodes.baseSizeRange;
  }
  const edgeA = [];
  const edgeB = [];
  const edgeLen = [];
  const adjacency = Array.from({ length: N }, () => []);
  function addEdge(a, b, length = Math.hypot(nodePos[a * 3] - nodePos[b * 3],
    nodePos[a * 3 + 1] - nodePos[b * 3 + 1], nodePos[a * 3 + 2] - nodePos[b * 3 + 2])) {
    const e = edgeA.length;
    edgeA.push(a);
    edgeB.push(b);
    edgeLen.push(length);
    adjacency[a].push(e);
    adjacency[b].push(e);
  }
  if (layout.connect) layout.connect({ nodePos, addEdge });
  else connectNearest({ N, nodePos, addEdge }, config);
  if (layout.finishPositions) {
    layout.finishPositions(nodePos);
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e] * 3, b = edgeB[e] * 3;
      edgeLen[e] = Math.hypot(nodePos[a] - nodePos[b],
        nodePos[a + 1] - nodePos[b + 1], nodePos[a + 2] - nodePos[b + 2]);
    }
  }
  const E = edgeA.length;
  const nodeRestPos = design.moving ? nodePos.slice() : null;
  const edgeR = new Float32Array(E);
  const edgeG = new Float32Array(E);
  const edgeBColor = new Float32Array(E);
  const edgeBase = new Float32Array(E);
  let maxNodeDegree = 0;
  for (let i = 0; i < N; i++) maxNodeDegree = Math.max(maxNodeDegree, adjacency[i].length);
  const fireEdges = new Int32Array(maxNodeDegree);
  const edgePositions = new Float32Array(E * 6);
  const edgeColors = new Float32Array(E * 6);
  for (let e = 0; e < E; e++) {
    for (let c = 0; c < 3; c++) {
      edgePositions[e * 6 + c] = nodePos[edgeA[e] * 3 + c];
      edgePositions[e * 6 + 3 + c] = nodePos[edgeB[e] * 3 + c];
    }
    edgeBase[e] = settings.scene.edgeVariationMin + random() * settings.scene.edgeVariationRange;
  }
  let edgeGeo, nodeGeo;
  try {
    edgeGeo = new three.BufferGeometry();
    edgeGeo.setAttribute('position', new three.BufferAttribute(edgePositions, 3)
      .setUsage(nodeRestPos ? three.DynamicDrawUsage : three.StaticDrawUsage));
    edgeGeo.setAttribute('color', new three.BufferAttribute(edgeColors, 3).setUsage(three.DynamicDrawUsage));
    nodeGeo = new three.BufferGeometry();
    nodeGeo.setAttribute('position', new three.BufferAttribute(nodePos, 3)
      .setUsage(nodeRestPos ? three.DynamicDrawUsage : three.StaticDrawUsage));
    nodeGeo.setAttribute('aEnergy', new three.BufferAttribute(nodeEnergy, 1).setUsage(three.DynamicDrawUsage));
    nodeGeo.setAttribute('aHot', new three.BufferAttribute(nodeHot, 1).setUsage(three.DynamicDrawUsage));
    nodeGeo.setAttribute('aSize', new three.BufferAttribute(nodeSize, 1));
    if (nodeRestPos) {
      // Covers the existing wave and helix motion envelopes.
      const bounds = new three.Sphere(new three.Vector3(), Math.hypot(config.radius, config.radius, 4.05));
      nodeGeo.boundingSphere = bounds;
      edgeGeo.boundingSphere = bounds.clone();
    }
  } catch (error) {
    edgeGeo?.dispose();
    nodeGeo?.dispose();
    throw error;
  }
  return {
    N, nodePos, nodeRestPos, nodeEnergy, nodeHot, nodeSize, E, edgeA, edgeB, edgeLen, adjacency,
    edgeR, edgeG, edgeBColor, edgeBase, fireEdges, edgeColors, edgeGeo, nodeGeo,
  };
}

export function updateNetworkGeometry(network, settings, dt, reducedMotion, phases) {
  if (!network.nodeRestPos) return;
  getTopologyDesign(settings.topology).updateMotion(network, settings, dt, reducedMotion, phases);
  const { E, nodePos, edgeA, edgeB, edgeLen, nodeGeo, edgeGeo } = network;
  const positions = edgeGeo.attributes.position.array;
  for (let e = 0; e < E; e++) {
    const a = edgeA[e] * 3, b = edgeB[e] * 3, offset = e * 6;
    for (let c = 0; c < 3; c++) {
      positions[offset + c] = nodePos[a + c];
      positions[offset + 3 + c] = nodePos[b + c];
    }
    edgeLen[e] = Math.hypot(nodePos[a] - nodePos[b],
      nodePos[a + 1] - nodePos[b + 1], nodePos[a + 2] - nodePos[b + 2]);
  }
  nodeGeo.attributes.position.needsUpdate = true;
  edgeGeo.attributes.position.needsUpdate = true;
}
