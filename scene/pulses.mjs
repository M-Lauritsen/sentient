import * as THREE from 'three';
import { CATEGORY_INDEX } from '../activity/activity-colors.mjs';
import { getTopologyDesign } from '../network-topology-design/index.mjs';

export function createPulseSystem({ VISUAL, CFG, SCENE_RGB, brain, pixelRatio, getNetwork, random = Math.random }) {
  // ---------- pulses ----------
  const P = CFG.maxPulses;
  const T = CFG.trail;
  const pActive = new Uint8Array(P);
  const pEdge = new Int32Array(P);
  const pFrom = new Int32Array(P);
  const pT = new Float32Array(P);
  const pSpeed = new Float32Array(P);
  const pHops = new Int16Array(P);
  const pKind = new Uint8Array(P);
  const pCat = new Uint8Array(P);
  // Demo pulses render like real ones but are excluded from HUD counters.
  const pDemo = new Uint8Array(P);
  let pCursor = 0;
  let activePulses = 0;
  let demoPulses = 0;
  let demoSpawn = 0;

  const pulsePos = new Float32Array(P * T * 3);
  const pulseCol = new Float32Array(P * T * 3);
  const pulseSize = new Float32Array(P * T);
  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3).setUsage(THREE.DynamicDrawUsage));
  pulseGeo.setAttribute('aColor', new THREE.BufferAttribute(pulseCol, 3).setUsage(THREE.DynamicDrawUsage));
  pulseGeo.setAttribute('aSize', new THREE.BufferAttribute(pulseSize, 1).setUsage(THREE.DynamicDrawUsage));
  const pulseMat = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: VISUAL.pulses.scale * pixelRatio },
      uCoreFalloff: { value: VISUAL.pulses.coreFalloff },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uScale;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z;
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uCoreFalloff;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = pow(smoothstep(0.5, 0.0, d), uCoreFalloff);
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pulsePoints = new THREE.Points(pulseGeo, pulseMat);
  pulsePoints.frustumCulled = false;
  brain.add(pulsePoints);

  function otherEnd(e, n) {
    const { edgeA, edgeB } = getNetwork();
    return edgeA[e] === n ? edgeB[e] : edgeA[e];
  }

  function spawnPulse(from, edge, hops, kind, category) {
    for (let tries = 0; tries < P; tries++) {
      const s = pCursor;
      pCursor = (pCursor + 1) % P;
      if (pActive[s]) continue;
      pActive[s] = 1;
      pEdge[s] = edge;
      pFrom[s] = from;
      pT[s] = 0;
      pSpeed[s] = VISUAL.pulses.speedMin + random() * VISUAL.pulses.speedRange;
      pHops[s] = hops;
      pKind[s] = kind;
      pCat[s] = category;
      pDemo[s] = demoSpawn;
      activePulses++;
      demoPulses += demoSpawn;
      return true;
    }
    return false;
  }

  function fireFrom(node, hops, kind, avoid = -1, count = 1,
    category = kind === 0 ? CATEGORY_INDEX.reasoning : CATEGORY_INDEX.tool) {
    const { adjacency, fireEdges } = getNetwork();
    const edges = adjacency[node];
    let length = 0;
    for (let i = 0; i < edges.length; i++) {
      if (otherEnd(edges[i], node) !== avoid) fireEdges[length++] = edges[i];
    }
    for (let i = length - 1; i > 0; i--) {
      const j = (random() * (i + 1)) | 0;
      const swap = fireEdges[i];
      fireEdges[i] = fireEdges[j];
      fireEdges[j] = swap;
    }
    const n = Math.min(count, length);
    for (let i = 0; i < n; i++) spawnPulse(node, fireEdges[i], hops, kind, category);
  }

  function updatePulses(dt) {
    const { nodeEnergy, edgeLen, edgeR, edgeG, edgeBColor } = getNetwork();
    for (let s = 0; s < P; s++) {
      if (!pActive[s]) continue;
      const e = pEdge[s];
      const kind = pKind[s];
      pT[s] += (pSpeed[s] * dt) / edgeLen[e];
      const rgb = pCat[s] * 3;
      const intensity = kind === 3 ? VISUAL.impact.edgeIntensity
        : kind === 2 ? VISUAL.completion.edgeIntensity
          : kind === 1 ? VISUAL.pulses.stepEdgeIntensity : VISUAL.pulses.thinkingEdgeIntensity;
      edgeR[e] = Math.max(edgeR[e], SCENE_RGB[rgb] * intensity);
      edgeG[e] = Math.max(edgeG[e], SCENE_RGB[rgb + 1] * intensity);
      edgeBColor[e] = Math.max(edgeBColor[e], SCENE_RGB[rgb + 2] * intensity);

      if (pT[s] >= 1) {
        const from = pFrom[s];
        const hops = pHops[s];
        const to = otherEnd(e, from);
        pActive[s] = 0;
        activePulses--;
        demoPulses -= pDemo[s];
        nodeEnergy[to] = Math.min(VISUAL.nodes.energyCap, nodeEnergy[to] + (kind === 3 ? VISUAL.impact.nodeEnergy
          : kind === 2 ? VISUAL.completion.nodeEnergy : VISUAL.pulses.nodeEnergy));
        if (hops > 0) {
          const branch = kind === 3 ? (random() < VISUAL.impact.branchChance ? 2 : 1)
            : kind === 2 ? (random() < VISUAL.completion.branchChance ? 2 : 1) : kind === 0 ? 1 : 0;
          if (branch > 0) {
            demoSpawn = pDemo[s];
            fireFrom(to, hops - 1, kind, from, branch, pCat[s]);
            demoSpawn = 0;
          }
        }
      }
    }
  }

  function writePulseBuffers() {
    const { nodePos } = getNetwork();
    const presentation = getTopologyDesign(VISUAL.topology).presentation;
    for (let s = 0; s < P; s++) {
      const base = s * T;
      if (!pActive[s]) {
        for (let j = 0; j < T; j++) pulseSize[base + j] = 0;
        continue;
      }
      const e = pEdge[s];
      const a = pFrom[s] * 3;
      const b = otherEnd(e, pFrom[s]) * 3;
      const rgb = pCat[s] * 3;
      const head = pKind[s] === 3 ? VISUAL.impact.head
        : pKind[s] === 2 ? VISUAL.pulses.completionHead : VISUAL.pulses.head;
      const spacing = pKind[s] >= 2 ? VISUAL.pulses.completionTrailSpacing : VISUAL.pulses.trailSpacing;
      for (let j = 0; j < T; j++) {
        const idx = base + j;
        const t = pT[s] - j * spacing;
        if (t < 0) {
          pulseSize[idx] = 0;
          continue;
        }
        pulsePos[idx * 3] = nodePos[a] + (nodePos[b] - nodePos[a]) * t;
        pulsePos[idx * 3 + 1] = nodePos[a + 1] + (nodePos[b + 1] - nodePos[a + 1]) * t;
        pulsePos[idx * 3 + 2] = nodePos[a + 2] + (nodePos[b + 2] - nodePos[a + 2]) * t;
        const f = Math.pow(1 - j / T, VISUAL.pulses.trailFalloff);
        let bright = j === 0 ? VISUAL.pulses.headBrightness : f;
        if (presentation.pulseBrightness) {
          bright *= presentation.pulseBrightness(pulsePos[idx * 3 + 1], j === 0, CFG.radius);
        }
        pulseCol[idx * 3] = SCENE_RGB[rgb] * bright;
        pulseCol[idx * 3 + 1] = SCENE_RGB[rgb + 1] * bright;
        pulseCol[idx * 3 + 2] = SCENE_RGB[rgb + 2] * bright;
        pulseSize[idx] = head * (VISUAL.pulses.minTrailSize + (1 - VISUAL.pulses.minTrailSize) * f);
      }
    }
    pulseGeo.attributes.position.needsUpdate = true;
    pulseGeo.attributes.aColor.needsUpdate = true;
    pulseGeo.attributes.aSize.needsUpdate = true;
  }

  function reset() {
    pActive.fill(0);
    pDemo.fill(0);
    pulseSize.fill(0);
    pulseCol.fill(0);
    pulsePos.fill(0);
    pulseGeo.attributes.position.needsUpdate = true;
    pulseGeo.attributes.aSize.needsUpdate = true;
    pulseGeo.attributes.aColor.needsUpdate = true;
    pCursor = 0;
    activePulses = 0;
    demoPulses = 0;
  }

  function applySettings(previous, changed) {
    pulseMat.uniforms.uScale.value = VISUAL.pulses.scale * pixelRatio;
    pulseMat.uniforms.uCoreFalloff.value = VISUAL.pulses.coreFalloff;
    if (changed('pulses.speedMin') || changed('pulses.speedRange')) {
      for (let index = 0; index < P; index++) {
        if (!pActive[index]) continue;
        const fraction = previous.pulses.speedRange > 0
          ? (pSpeed[index] - previous.pulses.speedMin) / previous.pulses.speedRange : 0.5;
        pSpeed[index] = VISUAL.pulses.speedMin +
          Math.min(1, Math.max(0, fraction)) * VISUAL.pulses.speedRange;
      }
    }

  }

  return {
    spawnPulse, fireFrom, otherEnd, updatePulses, writePulseBuffers, reset, applySettings,
    get activePulses() { return activePulses; },
    get demoPulses() { return demoPulses; },
    get demoSpawn() { return demoSpawn; },
    set demoSpawn(value) { demoSpawn = value; },
    invalidateObserved() {
      for (let slot = 0; slot < P; slot++) {
        if (!pActive[slot] || pDemo[slot]) continue;
        pActive[slot] = 0;
        activePulses--;
        pulseSize.fill(0, slot * T, (slot + 1) * T);
      }
    },
    buffers: { P, T, pActive, pEdge, pFrom, pT, pSpeed, pHops, pKind, pCat, pDemo,
      pulsePos, pulseCol, pulseSize, pulseGeo, pulseMat, pulsePoints },
  };
}
