import * as THREE from 'three';
import { buildNetwork as buildNetworkGraph, updateNetworkGeometry } from './network.mjs';
import { getTopologyDesign, createTopologyMotionState } from '../network-topology-design/index.mjs';

export function createNetworkRenderer({ VISUAL, CFG, brain, pixelRatio, getReducedMotion, onInstall, followMarkers, random = Math.random, three = THREE }) {
  // ---------- nodes ----------
  function buildNetwork(settings) {
    return buildNetworkGraph(settings, CFG, { random: () => random(), three });
  }

  let currentNetwork = buildNetwork(VISUAL);
  let {
    N, nodePos, nodeRestPos, nodeEnergy, nodeHot, nodeSize, E, edgeA, edgeB, edgeLen, adjacency,
    edgeR, edgeG, edgeBColor, edgeBase, fireEdges, edgeColors, edgeGeo, nodeGeo,
  } = currentNetwork;
  const edgeLines = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  brain.add(edgeLines);
  edgeLines.visible = VISUAL.scene.edgeVisibility !== 'hidden';

  // ---------- node points ----------
  const nodeMat = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: VISUAL.nodes.scale * pixelRatio }, uTime: { value: 0 },
      uSize: { value: VISUAL.nodes.size }, uActiveGrowth: { value: VISUAL.nodes.activeGrowth },
      uIdleBrightness: { value: VISUAL.nodes.idleBrightness },
      uDnaHalfLength: { value: getTopologyDesign(VISUAL.topology).presentation.nodeDissolveHalfLength * CFG.radius },
      uActiveBrightness: { value: VISUAL.nodes.activeBrightness },
      uHotMix: { value: VISUAL.nodes.hotMix },
      uWhiteThreshold: { value: VISUAL.nodes.whiteThreshold },
      uWhiteMix: { value: VISUAL.nodes.whiteMix },
      uTwinkleBase: { value: VISUAL.nodes.twinkleBase },
      uTwinkleAmplitude: { value: VISUAL.nodes.twinkleAmplitude },
      uTwinkleSpeed: { value: VISUAL.nodes.twinkleSpeed },
      uTwinkleSpatial: { value: new THREE.Vector3(...VISUAL.nodes.twinkleSpatial) },
      uCoreFalloff: { value: VISUAL.nodes.coreFalloff },
      uBaseColor: { value: new THREE.Vector3(...VISUAL.nodes.baseColor) },
      uHotColor: { value: new THREE.Vector3(...VISUAL.nodes.hotColor) },
      uWhiteColor: { value: new THREE.Vector3(...VISUAL.nodes.whiteColor) },
    },
    vertexShader: /* glsl */ `
      attribute float aEnergy;
      attribute float aHot;
      attribute float aSize;
      uniform float uScale;
      uniform float uTime;
      uniform float uSize;
      uniform float uActiveGrowth;
      uniform float uDnaHalfLength;
      uniform float uTwinkleBase;
      uniform float uTwinkleAmplitude;
      uniform float uTwinkleSpeed;
      uniform vec3 uTwinkleSpatial;
      varying float vEnergy;
      varying float vHot;
      varying float vTwinkle;
      varying float vDissolve;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vTwinkle = uTwinkleBase + uTwinkleAmplitude * sin(uTime * uTwinkleSpeed + dot(position, uTwinkleSpatial));
        gl_PointSize = aSize * uSize * (1.0 + aEnergy * uActiveGrowth) * uScale / -mv.z;
        vEnergy = aEnergy;
        vHot = aHot;
        vDissolve = uDnaHalfLength > 0.0
          ? 1.0 - 0.85 * smoothstep(0.72, 1.0, abs(position.y) / uDnaHalfLength) : 1.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIdleBrightness;
      uniform float uActiveBrightness;
      uniform float uHotMix;
      uniform float uWhiteThreshold;
      uniform float uWhiteMix;
      uniform float uCoreFalloff;
      uniform vec3 uBaseColor;
      uniform vec3 uHotColor;
      uniform vec3 uWhiteColor;
      varying float vEnergy;
      varying float vHot;
      varying float vTwinkle;
      varying float vDissolve;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float core = pow(smoothstep(0.5, 0.0, d), uCoreFalloff);
        vec3 col = mix(uBaseColor, uHotColor, clamp(vHot * uHotMix, 0.0, 1.0));
        col = mix(col, uWhiteColor, clamp((max(vEnergy, vHot) - uWhiteThreshold) * uWhiteMix, 0.0, 1.0));
        gl_FragColor = vec4(col * core * (uIdleBrightness * vTwinkle + max(vEnergy, vHot) * uActiveBrightness), vDissolve);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const nodePoints = new THREE.Points(nodeGeo, nodeMat);
  brain.add(nodePoints);

  function installNetwork(next) {
    const previousNodeGeo = nodeGeo, previousEdgeGeo = edgeGeo;
    currentNetwork = next;
    ({
      N, nodePos, nodeRestPos, nodeEnergy, nodeHot, nodeSize, E, edgeA, edgeB, edgeLen, adjacency,
      edgeR, edgeG, edgeBColor, edgeBase, fireEdges, edgeColors, edgeGeo, nodeGeo,
    } = next);
    nodePoints.geometry = nodeGeo;
    edgeLines.geometry = edgeGeo;
    previousNodeGeo.dispose();
    previousEdgeGeo.dispose();

    // Old pulse endpoints refer to the previous graph, not observed activity.
    onInstall(next);
  }

  const motionPhases = createTopologyMotionState();

  function updateNetworkMotion(dt) {
    if (!nodeRestPos) return;
    updateNetworkGeometry(currentNetwork, VISUAL, dt, getReducedMotion(), motionPhases);
    followMarkers(nodePos);
  }

  function writeEdgeColors(dt) {
    const presentation = getTopologyDesign(VISUAL.topology).presentation;
    edgeLines.visible = VISUAL.scene.edgeVisibility !== 'hidden';
    const decay = Math.exp(-dt * VISUAL.scene.edgeFade);
    for (let e = 0; e < E; e++) {
      edgeR[e] *= decay;
      edgeG[e] *= decay;
      edgeBColor[e] *= decay;
      const b = VISUAL.scene.edgeVisibility === 'always' ? edgeBase[e] : 0;
      const fade = presentation.edgeBrightness
        ? presentation.edgeBrightness(nodePos, edgeA[e], edgeB[e], CFG.radius) : 1;
      const r = (VISUAL.scene.edgeBaseColor[0] * b + edgeR[e]) * fade;
      const g = (VISUAL.scene.edgeBaseColor[1] * b + edgeG[e]) * fade;
      const bl = (VISUAL.scene.edgeBaseColor[2] * b + edgeBColor[e]) * fade;
      const o = e * 6;
      edgeColors[o] = edgeColors[o + 3] = r;
      edgeColors[o + 1] = edgeColors[o + 4] = g;
      edgeColors[o + 2] = edgeColors[o + 5] = bl;
    }
    edgeGeo.attributes.color.needsUpdate = true;
  }

  function decayNodes(dt) {
    const decay = Math.exp(-dt * VISUAL.nodes.decay);
    for (let i = 0; i < N; i++) {
      nodeEnergy[i] *= decay;
      nodeHot[i] *= decay;
    }
    nodeGeo.attributes.aEnergy.needsUpdate = true;
    nodeGeo.attributes.aHot.needsUpdate = true;
  }

  function applySettings() {
    const nodeUniforms = nodeMat.uniforms;
    nodeUniforms.uScale.value = VISUAL.nodes.scale * pixelRatio;
    nodeUniforms.uSize.value = VISUAL.nodes.size;
    nodeUniforms.uActiveGrowth.value = VISUAL.nodes.activeGrowth;
    nodeUniforms.uIdleBrightness.value = VISUAL.nodes.idleBrightness;
    nodeUniforms.uDnaHalfLength.value = getTopologyDesign(VISUAL.topology).presentation.nodeDissolveHalfLength * CFG.radius;
    nodeUniforms.uActiveBrightness.value = VISUAL.nodes.activeBrightness;
    nodeUniforms.uHotMix.value = VISUAL.nodes.hotMix;
    nodeUniforms.uWhiteThreshold.value = VISUAL.nodes.whiteThreshold;
    nodeUniforms.uWhiteMix.value = VISUAL.nodes.whiteMix;
    nodeUniforms.uTwinkleBase.value = VISUAL.nodes.twinkleBase;
    nodeUniforms.uTwinkleAmplitude.value = VISUAL.nodes.twinkleAmplitude;
    nodeUniforms.uTwinkleSpeed.value = VISUAL.nodes.twinkleSpeed;
    nodeUniforms.uTwinkleSpatial.value.set(...VISUAL.nodes.twinkleSpatial);
    nodeUniforms.uCoreFalloff.value = VISUAL.nodes.coreFalloff;
    nodeUniforms.uBaseColor.value.set(...VISUAL.nodes.baseColor);
    nodeUniforms.uHotColor.value.set(...VISUAL.nodes.hotColor);
    nodeUniforms.uWhiteColor.value.set(...VISUAL.nodes.whiteColor);
    edgeLines.visible = VISUAL.scene.edgeVisibility !== 'hidden';
  }

  return {
    get network() { return currentNetwork; },
    buildNetwork, installNetwork, updateNetworkMotion, writeEdgeColors, decayNodes, applySettings,
    nodeMat, nodePoints, edgeLines,
  };
}
