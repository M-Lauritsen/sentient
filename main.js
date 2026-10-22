import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createActivityClient, createImpulseFeed, createImpulseBuffer, impulseIntensity, impactBurst,
  createThinkingPulseClock, summarizeSubagents, createCategoryBurstPlan, createActivityTimeline } from './activity-client.mjs';
import { createPageActivityTotals, createSessionStatsDialog, createTimelineDialog } from './session-stats-ui.mjs';
import { createWorkspaceStore } from './workspace-model.mjs';
import { createWorkspaceUI } from './workspace-ui.mjs';
import { CATEGORIES, CATEGORY_HEX, CATEGORY_INDEX, HOOK_TYPES,
  createScenePalette, applyHookColors } from './activity-colors.mjs';
import { VISUAL as VISUAL_DEFAULTS, VISUAL_PRESET, VISUAL_OVERRIDES,
  EFFECTIVE_VISUAL as VISUAL } from './visual-settings.mjs';
import { validateVisualSettings } from './visual-config.mjs';
import { createVisualSettingsPanel } from './visual-settings-ui.mjs';
import { createLibraryDialog } from './copilot-library-ui.mjs';
import { createNavigationUI } from './navigation-ui.mjs';
import { createDemoActivity, DEMO_WAITING_IDS } from './demo-activity.mjs';
import { demoFocusForPath } from './visual-settings-preview.mjs';
import { createPwaLifecycle } from './pwa-lifecycle-client.mjs';

// Structural geometry and fixed buffer capacities; node count can rebuild the network.
const CFG = {
  radius: 10,
  neighbours: 3,
  maxEdgeLen: 4.5,
  dust: 4000,
  maxPulses: 1600,
  trail: 7,
};

// Pulse kinds: 0 = observed thinking, 1 = activity step, 2 = completion cascade,
// 3 = duration-scaled impact burst.
// Motion and category are independent; RGB storage is shared and never rebuilt.
// Shader attributes are linear; apply scene brightness before trail brightness.
const SCENE_RGB = createScenePalette(VISUAL);
applyHookColors(document, VISUAL.hooks);

// ---------- renderer / scene ----------
const container = document.getElementById('app');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('fallback').hidden = false;
  throw err;
}
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(VISUAL.scene.background);

const camera = new THREE.PerspectiveCamera(VISUAL.camera.fov, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(...VISUAL.camera.position);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = VISUAL.camera.damping;
controls.enablePan = false;
controls.minDistance = VISUAL.camera.minDistance;
controls.maxDistance = VISUAL.camera.maxDistance;
controls.autoRotate = VISUAL.camera.autoRotate && VISUAL.topology !== 'dna';
controls.autoRotateSpeed = VISUAL.camera.autoRotateSpeed;
controls.target.set(...VISUAL.camera.target);

let libraryModalOpen = false;
let controlsEnabledBeforeLibrary = true;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight),
  VISUAL.scene.bloomStrength, VISUAL.scene.bloomRadius, VISUAL.scene.bloomThreshold);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const brain = new THREE.Group();
scene.add(brain);

// ---------- nodes ----------
function buildNetwork(settings) {
  const N = settings.nodes.count;
  const nodePos = new Float32Array(N * 3);
  const nodeEnergy = new Float32Array(N);
  const nodeHot = new Float32Array(N);
  const nodeSize = new Float32Array(N);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dir = new THREE.Vector3();
  const topology = settings.topology ?? 'lattice';
  const waveColumns = Math.ceil(Math.sqrt(N));
  const waveRows = Math.ceil(N / waveColumns);
  const waveSpacing = CFG.radius * 2 / Math.max(1, waveColumns - 1);
  const dnaSamples = Math.max(1, Math.floor(N * 0.4));
  const dnaInterior = N - dnaSamples * 2;
  const dnaRungs = Math.min(36, dnaSamples, dnaInterior);
  for (let i = 0; i < N; i++) {
    if (topology === 'dna') {
      if (i < dnaSamples * 2) {
        const t = dnaSamples === 1 ? 0.5 : Math.floor(i / 2) / (dnaSamples - 1);
        const angle = t * Math.PI * 5 + (i % 2) * Math.PI;
        nodePos[i * 3] = Math.cos(angle) * CFG.radius * 0.26;
        nodePos[i * 3 + 1] = (t - 0.5) * CFG.radius * 2.2;
        nodePos[i * 3 + 2] = Math.sin(angle) * CFG.radius * 0.26;
      }
    } else if (topology === 'waves') {
      nodePos[i * 3] = (i % waveColumns - (waveColumns - 1) / 2) * waveSpacing;
      nodePos[i * 3 + 2] = (Math.floor(i / waveColumns) - (waveRows - 1) / 2) * waveSpacing;
    } else if (topology === 'organic') {
      const y = Math.random() * 2 - 1;
      const angle = Math.random() * Math.PI * 2;
      const radial = Math.sqrt(1 - y * y);
      const shell = CFG.radius * (0.3 + 0.7 * Math.cbrt(Math.random()));
      dir.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial)
        .multiplyScalar(shell).toArray(nodePos, i * 3);
    } else {
      const y = 1 - ((i + 0.5) / N) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      dir.set(Math.cos(th) * r, y, Math.sin(th) * r);
      dir.x += (Math.random() - 0.5) * 0.12;
      dir.y += (Math.random() - 0.5) * 0.12;
      dir.z += (Math.random() - 0.5) * 0.12;
      dir.normalize();
      const shell = CFG.radius * (0.3 + 0.7 * Math.pow(Math.random(), 0.28));
      dir.multiplyScalar(shell).toArray(nodePos, i * 3);
    }
    nodeSize[i] = Math.random() < settings.nodes.largeChance
      ? settings.nodes.largeSizeMin + Math.random() * settings.nodes.largeSizeRange
      : settings.nodes.baseSizeMin + Math.random() * settings.nodes.baseSizeRange;
  }

  // Moving styles use explicit graphs rather than spatial shortcuts across folds.
  const edgeA = [];
  const edgeB = [];
  const edgeLen = [];
  const adjacency = Array.from({ length: N }, () => []);
  const seen = new Set();
  function addEdge(a, b) {
    const e = edgeA.length;
    edgeA.push(a);
    edgeB.push(b);
    edgeLen.push(Math.hypot(nodePos[a * 3] - nodePos[b * 3],
      nodePos[a * 3 + 1] - nodePos[b * 3 + 1], nodePos[a * 3 + 2] - nodePos[b * 3 + 2]));
    adjacency[a].push(e);
    adjacency[b].push(e);
  }
  if (topology === 'dna') {
    for (let i = 2; i < dnaSamples * 2; i++) addEdge(i - 2, i);
    let next = dnaSamples * 2;
    if (!dnaInterior) addEdge(0, 1);
    for (let rung = 0; rung < dnaRungs; rung++) {
      const sample = dnaRungs === 1 ? Math.floor((dnaSamples - 1) / 2)
        : Math.round(rung * (dnaSamples - 1) / (dnaRungs - 1));
      const a = sample * 2, b = a + 1;
      const count = Math.floor(dnaInterior / dnaRungs) + (rung < dnaInterior % dnaRungs ? 1 : 0);
      let previous = a;
      for (let j = 1; j <= count; j++) {
        const node = next++;
        const t = j / (count + 1);
        for (let c = 0; c < 3; c++) {
          nodePos[node * 3 + c] = nodePos[a * 3 + c] * (1 - t) + nodePos[b * 3 + c] * t;
        }
        addEdge(previous, node);
        previous = node;
      }
      addEdge(previous, b);
    }
  } else if (topology === 'waves') {
    for (let i = 0; i < N; i++) {
      const column = i % waveColumns;
      if (column + 1 < waveColumns && i + 1 < N) addEdge(i, i + 1);
      if (i + waveColumns < N) addEdge(i, i + waveColumns);
      if (column + 1 < waveColumns && i + waveColumns + 1 < N) {
        addEdge(i, i + waveColumns + 1);
      }
    }
  } else {
    const k = CFG.neighbours;
    const maxLen2 = CFG.maxEdgeLen * CFG.maxEdgeLen;
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
        const e = edgeA.length;
        edgeA.push(i);
        edgeB.push(j);
        edgeLen.push(Math.sqrt(d2));
        adjacency[i].push(e);
        adjacency[j].push(e);
      }
    }
  }
  if (topology === 'dna') {
    for (let i = 0; i < N; i++) {
      const offset = i * 3;
      const end = Math.max(0, Math.min(1, (Math.abs(nodePos[offset + 1]) / (CFG.radius * 1.1) - 0.72) / 0.28));
      const scatter = end * end * (3 - 2 * end) * CFG.radius * 0.28;
      // Stable per-node scatter opens only the tips; the central helix stays exact.
      nodePos[offset] += Math.sin(i * 127.1 + 1.7) * scatter;
      nodePos[offset + 2] += Math.sin(i * 311.7 + 4.3) * scatter;
    }
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e] * 3, b = edgeB[e] * 3;
      edgeLen[e] = Math.hypot(nodePos[a] - nodePos[b],
        nodePos[a + 1] - nodePos[b + 1], nodePos[a + 2] - nodePos[b + 2]);
    }
  }
  const E = edgeA.length;
  const nodeRestPos = topology === 'waves' || topology === 'dna' ? nodePos.slice() : null;
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
    edgeBase[e] = settings.scene.edgeVariationMin + Math.random() * settings.scene.edgeVariationRange;
  }
  let edgeGeo, nodeGeo;
  try {
    edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3)
      .setUsage(nodeRestPos ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3).setUsage(THREE.DynamicDrawUsage));
    nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3)
      .setUsage(nodeRestPos ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage));
    nodeGeo.setAttribute('aEnergy', new THREE.BufferAttribute(nodeEnergy, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aHot', new THREE.BufferAttribute(nodeHot, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nodeSize, 1));
    if (nodeRestPos) {
      // Covers wave crests and the DNA's fixed axial/radial envelope.
      const bounds = new THREE.Sphere(new THREE.Vector3(), Math.hypot(CFG.radius, CFG.radius, 4.05));
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

let {
  N, nodePos, nodeRestPos, nodeEnergy, nodeHot, nodeSize, E, edgeA, edgeB, edgeLen, adjacency,
  edgeR, edgeG, edgeBColor, edgeBase, fireEdges, edgeColors, edgeGeo, nodeGeo,
} = buildNetwork(VISUAL);
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
    uDnaHalfLength: { value: VISUAL.topology === 'dna' ? CFG.radius * 1.1 : 0 },
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
  ({
    N, nodePos, nodeRestPos, nodeEnergy, nodeHot, nodeSize, E, edgeA, edgeB, edgeLen, adjacency,
    edgeR, edgeG, edgeBColor, edgeBase, fireEdges, edgeColors, edgeGeo, nodeGeo,
  } = next);
  nodePoints.geometry = nodeGeo;
  edgeLines.geometry = edgeGeo;
  previousNodeGeo.dispose();
  previousEdgeGeo.dispose();

  // Old pulse endpoints refer to the previous graph, not observed activity.
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
  for (const session of subagentAnchors) session.anchorIndex = hashTreeSid(session.sid) % N;
  for (const branch of [...activeSubagentBranches, ...fadingSubagentBranches]) {
    branch.anchorIndex = hashTreeSid(branch.sessionSid) % N;
  }
}

let wavePhase = 0;
let dnaPhase = 0;

function updateNetworkMotion(dt) {
  if (!nodeRestPos) return;
  if (VISUAL.topology === 'dna') {
    if (!reducedMotion && VISUAL.camera.autoRotate) {
      dnaPhase += dt * VISUAL.camera.autoRotateSpeed * Math.PI / 3;
    }
    for (let i = 0; i < N; i++) {
      const offset = i * 3;
      const x = nodeRestPos[offset], y = nodeRestPos[offset + 1], z = nodeRestPos[offset + 2];
      // A travelling torsion twists around the strand's own axis, not the camera.
      const angle = dnaPhase + 0.22 * (Math.sin(y * 0.5 - dnaPhase) - Math.sin(y * 0.5));
      const cos = Math.cos(angle), sin = Math.sin(angle);
      nodePos[offset] = x * cos - z * sin;
      nodePos[offset + 2] = x * sin + z * cos;
    }
  } else {
    if (!reducedMotion) wavePhase += dt * VISUAL.waves.speed;
    const frequency = Math.PI * 2 / VISUAL.waves.wavelength;
    const amplitude = VISUAL.waves.amplitude;
    for (let i = 0; i < N; i++) {
      const offset = i * 3;
      const x = nodeRestPos[offset], z = nodeRestPos[offset + 2];
      // Displace the sheet from rest heights without cumulative drift.
      nodePos[offset + 1] = nodeRestPos[offset + 1] + amplitude * (
        Math.sin(frequency * (x + z * 0.35) - wavePhase) +
        0.35 * Math.sin(frequency * (z - x * 0.25) + wavePhase * 0.7));
    }
  }
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
  for (const cluster of waitingMarkerGroups) {
    if (!cluster.visible || cluster.userData.anchorIndex === undefined) continue;
    const offset = cluster.userData.anchorIndex * 3;
    cluster.position.fromArray(nodePos, offset);
  }
}

// ---------- dust ----------
{
  const pos = new Float32Array(CFG.dust * 3);
  const phase = new Float32Array(CFG.dust);
  const v = new THREE.Vector3();
  for (let i = 0; i < CFG.dust; i++) {
    v.randomDirection().multiplyScalar(CFG.radius * (0.2 + Math.pow(Math.random(), 0.5) * 1.5));
    v.toArray(pos, i * 3);
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  var dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uScale: { value: VISUAL.dust.scale * pixelRatio },
      uBrightness: { value: VISUAL.scene.dustBrightness },
      uColor: { value: new THREE.Vector3(...VISUAL.dust.color) },
      uTwinkleBase: { value: VISUAL.dust.twinkleBase },
      uTwinkleAmplitude: { value: VISUAL.dust.twinkleAmplitude },
      uTwinkleSpeed: { value: VISUAL.dust.twinkleSpeed },
      uTwinklePhase: { value: VISUAL.dust.twinklePhase },
      uTwinklePower: { value: VISUAL.dust.twinklePower },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uScale;
      uniform float uTwinkleBase;
      uniform float uTwinkleAmplitude;
      uniform float uTwinkleSpeed;
      uniform float uTwinklePhase;
      uniform float uTwinklePower;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = uTwinkleBase + uTwinkleAmplitude * pow(0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aPhase * uTwinklePhase), uTwinklePower);
        gl_PointSize = uScale / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBrightness;
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(uColor * vA * uBrightness * smoothstep(0.5, 0.0, d), 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  var dust = new THREE.Points(geo, dustMat);
  dust.visible = VISUAL.effects.dust;
  scene.add(dust);
}

// ---------- core glow ----------
function radialTexture(settings = VISUAL) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(settings.scene.glowKnee, `rgba(255,255,255,${settings.scene.glowKneeOpacity})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
let glowTex = radialTexture();
const coreGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTex,
    color: VISUAL.scene.coreColor,
    transparent: true,
    opacity: VISUAL.scene.coreOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
coreGlow.scale.setScalar(VISUAL.scene.coreSize);
brain.add(coreGlow);
const baseCoreColor = new THREE.Color(VISUAL.scene.coreColor);
const waitingCoreColor = new THREE.Color(CATEGORY_HEX.waiting);
const waitingMarkerMaterial = new THREE.SpriteMaterial({
  map: glowTex,
  color: CATEGORY_HEX.waiting,
  transparent: true,
  opacity: VISUAL.waiting.markerOpacity,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const waitingMarkerGroups = Array.from({ length: 8 }, () => {
  const cluster = new THREE.Group();
  for (const [x, y, z] of [[0, 0, 0], [0.32, 0.12, 0], [-0.2, -0.26, 0.18]]) {
    const marker = new THREE.Sprite(waitingMarkerMaterial);
    marker.position.set(x, y, z);
    marker.scale.setScalar(VISUAL.waiting.markerSize);
    cluster.add(marker);
  }
  cluster.visible = false;
  brain.add(cluster);
  return cluster;
});
const haloGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTex,
    color: VISUAL.scene.haloColor,
    transparent: true,
    opacity: VISUAL.scene.haloOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
haloGlow.scale.setScalar(VISUAL.scene.haloSize);
brain.add(haloGlow);

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

const MAX_ACTIVE_SUBAGENT_BRANCHES = 512;
const MAX_FADING_SUBAGENT_BRANCHES = 64;
const MAX_SUBAGENT_ANCHORS = 32;
let SUBAGENT_FADE_SECONDS = VISUAL.subagents.fadeSeconds;
let SUBAGENT_GROW_SECONDS = VISUAL.subagents.growSeconds;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (event) => {
  reducedMotion = event.matches;
  if (reducedMotion) {
    for (const branch of activeSubagentBranches) branch.growthStart = -Infinity;
    fadingSubagentBranches.length = 0;
  }
});
const subagentSummary = document.getElementById('subagent-summary');
const branchLinePositions = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 6);
const branchLineColors = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 6);
const branchTipPositions = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 3);
const branchTipColors = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 3);
const fadingLinePositions = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 6);
const fadingLineColors = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 6);
const fadingTipPositions = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 3);
const fadingTipColors = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 3);
const anchorPositions = new Float32Array(MAX_SUBAGENT_ANCHORS * 3);
const anchorColors = new Float32Array(MAX_SUBAGENT_ANCHORS * 3);
const activeSubagentBranches = [];
const subagentBranchByKey = new Map();
const fadingSubagentBranches = [];
const subagentAnchors = [];
const subagentAnchorBySid = new Map();

const branchGeo = new THREE.BufferGeometry();
branchGeo.setAttribute('position', new THREE.BufferAttribute(branchLinePositions, 3).setUsage(THREE.DynamicDrawUsage));
branchGeo.setAttribute('color', new THREE.BufferAttribute(branchLineColors, 3).setUsage(THREE.DynamicDrawUsage));
const branchLines = new THREE.LineSegments(branchGeo, new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
branchLines.frustumCulled = false;
brain.add(branchLines);

const branchTipGeo = new THREE.BufferGeometry();
branchTipGeo.setAttribute('position', new THREE.BufferAttribute(branchTipPositions, 3).setUsage(THREE.DynamicDrawUsage));
branchTipGeo.setAttribute('color', new THREE.BufferAttribute(branchTipColors, 3).setUsage(THREE.DynamicDrawUsage));
const branchTips = new THREE.Points(branchTipGeo, new THREE.PointsMaterial({
  size: VISUAL.subagents.tipSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
branchTips.frustumCulled = false;
brain.add(branchTips);

const fadingGeo = new THREE.BufferGeometry();
fadingGeo.setAttribute('position', new THREE.BufferAttribute(fadingLinePositions, 3).setUsage(THREE.DynamicDrawUsage));
fadingGeo.setAttribute('color', new THREE.BufferAttribute(fadingLineColors, 3).setUsage(THREE.DynamicDrawUsage));
const fadingLines = new THREE.LineSegments(fadingGeo, new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
fadingLines.frustumCulled = false;
brain.add(fadingLines);

const fadingTipGeo = new THREE.BufferGeometry();
fadingTipGeo.setAttribute('position', new THREE.BufferAttribute(fadingTipPositions, 3).setUsage(THREE.DynamicDrawUsage));
fadingTipGeo.setAttribute('color', new THREE.BufferAttribute(fadingTipColors, 3).setUsage(THREE.DynamicDrawUsage));
const fadingTips = new THREE.Points(fadingTipGeo, new THREE.PointsMaterial({
  size: VISUAL.subagents.fadingTipSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
fadingTips.frustumCulled = false;
brain.add(fadingTips);

const anchorGeo = new THREE.BufferGeometry();
anchorGeo.setAttribute('position', new THREE.BufferAttribute(anchorPositions, 3).setUsage(THREE.DynamicDrawUsage));
anchorGeo.setAttribute('color', new THREE.BufferAttribute(anchorColors, 3).setUsage(THREE.DynamicDrawUsage));
const anchorPoints = new THREE.Points(anchorGeo, new THREE.PointsMaterial({
  size: VISUAL.subagents.anchorSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
anchorPoints.frustumCulled = false;
brain.add(anchorPoints);

function hashTreeSid(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function treeBranchKey(sessionSid, sid) {
  return `${sessionSid}:${sid}`;
}

function updateSubagentSummary(sessions) {
  if (activityState.connection !== 'connected' || activityState.sourceStatus === 'unavailable' ||
      activityState.coverage === 'unknown') {
    subagentSummary.textContent = 'Delegated work status unavailable during a connection or source gap.';
    return;
  }
  const summary = summarizeSubagents(sessions);
  subagentSummary.textContent = activityState.coverage === 'partial'
    ? `Partial coverage. ${summary}`
    : summary;
}

function addSubagentBranch(session, child, animate) {
  if (activeSubagentBranches.length >= MAX_ACTIVE_SUBAGENT_BRANCHES) return;
  const hash = hashTreeSid(child.sid);
  const anchorOffset = session.anchorIndex * 3;
  const nx = nodePos[anchorOffset], ny = nodePos[anchorOffset + 1], nz = nodePos[anchorOffset + 2];
  const normalLength = Math.hypot(nx, ny, nz) || 1;
  const normalX = nx / normalLength, normalY = ny / normalLength, normalZ = nz / normalLength;
  const y = ((hash & 0xffff) / 32767.5) - 1;
  const angle = ((hash >>> 16) / 65536) * Math.PI * 2;
  let tangentX = Math.sqrt(Math.max(0, 1 - y * y)) * Math.cos(angle);
  let tangentY = y;
  let tangentZ = Math.sqrt(Math.max(0, 1 - y * y)) * Math.sin(angle);
  const projection = tangentX * normalX + tangentY * normalY + tangentZ * normalZ;
  tangentX -= projection * normalX;
  tangentY -= projection * normalY;
  tangentZ -= projection * normalZ;
  const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
  const directionX = normalX + tangentX / tangentLength * 0.4;
  const directionY = normalY + tangentY / tangentLength * 0.4;
  const directionZ = normalZ + tangentZ / tangentLength * 0.4;
  const directionLength = Math.hypot(directionX, directionY, directionZ);
  const branch = {
    key: treeBranchKey(session.sid, child.sid),
    sid: child.sid,
    sessionSid: session.sid,
    anchorIndex: session.anchorIndex,
    directionX: directionX / directionLength,
    directionY: directionY / directionLength,
    directionZ: directionZ / directionLength,
    length: 2 + ((hash >>> 8) % 2001) / 1000,
    growthStart: animate ? performance.now() / 1000 : -Infinity,
    startedAt: performance.now() / 1000 - child.ageMs / 1000,
    fadeStart: 0,
    outcome: '',
    slot: activeSubagentBranches.length,
  };
  activeSubagentBranches.push(branch);
  subagentBranchByKey.set(branch.key, branch);
}

function retireSubagentBranch(sessionSid, sid, outcome, now) {
  const key = treeBranchKey(sessionSid, sid);
  const branch = subagentBranchByKey.get(key);
  if (!branch) return;
  const slot = branch.slot;
  const last = activeSubagentBranches.pop();
  if (slot < activeSubagentBranches.length) {
    activeSubagentBranches[slot] = last;
    last.slot = slot;
  }
  subagentBranchByKey.delete(key);
  if (reducedMotion || !VISUAL.effects.subagentTransitions) return;
  branch.outcome = outcome;
  branch.fadeStart = now;
  if (fadingSubagentBranches.length >= MAX_FADING_SUBAGENT_BRANCHES) fadingSubagentBranches.shift();
  fadingSubagentBranches.push(branch);
}

function applySubagentTree(tree) {
  const now = performance.now() / 1000;
  subagentAnchors.length = 0;
  subagentAnchorBySid.clear();
  for (const item of tree.sessions) {
    if (!item.subagents.length) continue;
    if (subagentAnchors.length >= MAX_SUBAGENT_ANCHORS) break;
    const session = { sid: item.sid, status: item.status, anchorIndex: hashTreeSid(item.sid) % N };
    subagentAnchors.push(session);
    subagentAnchorBySid.set(session.sid, session);
  }
  updateSubagentSummary(tree.sessions);
  if (tree.reset || document.hidden) {
    activeSubagentBranches.length = 0;
    subagentBranchByKey.clear();
    fadingSubagentBranches.length = 0;
    for (const item of tree.sessions) {
      const session = subagentAnchorBySid.get(item.sid);
      if (!session) continue;
      for (const child of item.subagents) addSubagentBranch(session, child, false);
    }
    return;
  }
  for (const outcome of ['completed', 'failed', 'cleared']) {
    for (const branch of tree[outcome]) retireSubagentBranch(branch.sessionSid, branch.sid, outcome, now);
  }
  for (const branch of tree.added) {
    const session = subagentAnchorBySid.get(branch.sessionSid);
    if (session) addSubagentBranch(session, branch, !reducedMotion && VISUAL.effects.subagentTransitions);
  }
}

function writeTreeColor(colors, offset, r, g, b, intensity) {
  colors[offset] = r * intensity;
  colors[offset + 1] = g * intensity;
  colors[offset + 2] = b * intensity;
}

function writeTreeCategory(colors, offset, category, intensity) {
  const rgb = category * 3;
  writeTreeColor(colors, offset, SCENE_RGB[rgb], SCENE_RGB[rgb + 1], SCENE_RGB[rgb + 2], intensity);
}

function renderSubagentTree(now) {
  for (let i = 0; i < subagentAnchors.length; i++) {
    const session = subagentAnchors[i];
    const offset = session.anchorIndex * 3;
    const colorOffset = i * 3;
    anchorPositions[colorOffset] = nodePos[offset];
    anchorPositions[colorOffset + 1] = nodePos[offset + 1];
    anchorPositions[colorOffset + 2] = nodePos[offset + 2];
    if (session.status === 'running') writeTreeColor(anchorColors, colorOffset,
      ...VISUAL.subagents.runningAnchorColor, VISUAL.subagents.runningAnchorIntensity);
    else if (session.status === 'waiting') writeTreeCategory(anchorColors, colorOffset,
      CATEGORY_INDEX.waiting, VISUAL.subagents.waitingAnchorIntensity);
    else if (session.status === 'stuck') writeTreeColor(anchorColors, colorOffset,
      ...VISUAL.subagents.stuckAnchorColor, VISUAL.subagents.stuckAnchorIntensity);
    else writeTreeColor(anchorColors, colorOffset,
      ...VISUAL.subagents.quietAnchorColor, VISUAL.subagents.quietAnchorIntensity);
  }
  anchorGeo.setDrawRange(0, subagentAnchors.length);
  anchorGeo.attributes.position.needsUpdate = true;
  anchorGeo.attributes.color.needsUpdate = true;

  for (let i = 0; i < activeSubagentBranches.length; i++) {
    const branch = activeSubagentBranches[i];
    const anchorOffset = branch.anchorIndex * 3;
    const lineOffset = i * 6;
    const tipOffset = i * 3;
    const session = subagentAnchorBySid.get(branch.sessionSid);
    const growth = reducedMotion || !VISUAL.effects.subagentTransitions ? 1
      : Math.min(1, Math.max(0, (now - branch.growthStart) / SUBAGENT_GROW_SECONDS));
    const length = branch.length * growth;
    const x = nodePos[anchorOffset], y = nodePos[anchorOffset + 1], z = nodePos[anchorOffset + 2];
    const ex = x + branch.directionX * length;
    const ey = y + branch.directionY * length;
    const ez = z + branch.directionZ * length;
    branchLinePositions[lineOffset] = x;
    branchLinePositions[lineOffset + 1] = y;
    branchLinePositions[lineOffset + 2] = z;
    branchLinePositions[lineOffset + 3] = ex;
    branchLinePositions[lineOffset + 4] = ey;
    branchLinePositions[lineOffset + 5] = ez;
    branchTipPositions[tipOffset] = ex;
    branchTipPositions[tipOffset + 1] = ey;
    branchTipPositions[tipOffset + 2] = ez;
    const intensity = Math.min(VISUAL.subagents.maxIntensity, VISUAL.subagents.initialIntensity +
      (VISUAL.effects.subagentTransitions
        ? Math.max(0, now - branch.startedAt) * VISUAL.subagents.intensityPerSecond : 0));
    // No per-child last-activity attribution crosses the wire. Do not infer it
    // from aggregate events: delegated activity uses its role, waiting its cue.
    const category = session?.status === 'waiting' ? CATEGORY_INDEX.waiting : CATEGORY_INDEX.subagent;
    writeTreeCategory(branchLineColors, lineOffset, category, intensity);
    writeTreeCategory(branchLineColors, lineOffset + 3, category, intensity);
    writeTreeCategory(branchTipColors, tipOffset, category, intensity);
  }
  branchGeo.setDrawRange(0, activeSubagentBranches.length * 2);
  branchTipGeo.setDrawRange(0, activeSubagentBranches.length);
  branchGeo.attributes.position.needsUpdate = true;
  branchGeo.attributes.color.needsUpdate = true;
  branchTipGeo.attributes.position.needsUpdate = true;
  branchTipGeo.attributes.color.needsUpdate = true;

  for (let i = 0; i < fadingSubagentBranches.length;) {
    if (now - fadingSubagentBranches[i].fadeStart >= SUBAGENT_FADE_SECONDS) {
      fadingSubagentBranches[i] = fadingSubagentBranches[fadingSubagentBranches.length - 1];
      fadingSubagentBranches.pop();
    } else i++;
  }
  for (let i = 0; i < fadingSubagentBranches.length; i++) {
    const branch = fadingSubagentBranches[i];
    const offset = branch.anchorIndex * 3;
    const lineOffset = i * 6;
    const age = Math.max(0, (now - branch.fadeStart) / SUBAGENT_FADE_SECONDS);
    const flash = branch.outcome === 'failed' && age < VISUAL.subagents.failureFlashFraction
      ? VISUAL.subagents.failureFlashIntensity : 1;
    const intensity = (1 - age) * flash *
      (branch.outcome === 'completed' && age < VISUAL.subagents.completionFlashFraction
        ? VISUAL.subagents.completionFlashBase + age * VISUAL.subagents.completionFlashGrowth : 1);
    const x = nodePos[offset], y = nodePos[offset + 1], z = nodePos[offset + 2];
    fadingLinePositions[lineOffset] = x;
    fadingLinePositions[lineOffset + 1] = y;
    fadingLinePositions[lineOffset + 2] = z;
    fadingLinePositions[lineOffset + 3] = x + branch.directionX * branch.length;
    fadingLinePositions[lineOffset + 4] = y + branch.directionY * branch.length;
    fadingLinePositions[lineOffset + 5] = z + branch.directionZ * branch.length;
    fadingTipPositions[i * 3] = fadingLinePositions[lineOffset + 3];
    fadingTipPositions[i * 3 + 1] = fadingLinePositions[lineOffset + 4];
    fadingTipPositions[i * 3 + 2] = fadingLinePositions[lineOffset + 5];
    if (branch.outcome === 'failed') {
      writeTreeCategory(fadingLineColors, lineOffset, CATEGORY_INDEX.error, intensity);
      writeTreeCategory(fadingTipColors, i * 3, CATEGORY_INDEX.error, intensity);
    } else if (branch.outcome === 'cleared') {
      writeTreeColor(fadingLineColors, lineOffset, ...VISUAL.subagents.clearedLineColor, intensity);
      writeTreeColor(fadingTipColors, i * 3, ...VISUAL.subagents.clearedTipColor, intensity);
    } else {
      writeTreeCategory(fadingLineColors, lineOffset, CATEGORY_INDEX.subagent, intensity);
      writeTreeCategory(fadingTipColors, i * 3, CATEGORY_INDEX.subagent, intensity);
    }
    fadingLineColors[lineOffset + 3] = fadingLineColors[lineOffset];
    fadingLineColors[lineOffset + 4] = fadingLineColors[lineOffset + 1];
    fadingLineColors[lineOffset + 5] = fadingLineColors[lineOffset + 2];
  }
  fadingGeo.setDrawRange(0, fadingSubagentBranches.length * 2);
  fadingTipGeo.setDrawRange(0, fadingSubagentBranches.length);
  fadingGeo.attributes.position.needsUpdate = true;
  fadingGeo.attributes.color.needsUpdate = true;
  fadingTipGeo.attributes.position.needsUpdate = true;
  fadingTipGeo.attributes.color.needsUpdate = true;
}

function otherEnd(e, n) {
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
    pSpeed[s] = VISUAL.pulses.speedMin + Math.random() * VISUAL.pulses.speedRange;
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
  const edges = adjacency[node];
  let length = 0;
  for (let i = 0; i < edges.length; i++) {
    if (otherEnd(edges[i], node) !== avoid) fireEdges[length++] = edges[i];
  }
  for (let i = length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const swap = fireEdges[i];
    fireEdges[i] = fireEdges[j];
    fireEdges[j] = swap;
  }
  const n = Math.min(count, length);
  for (let i = 0; i < n; i++) spawnPulse(node, fireEdges[i], hops, kind, category);
}

function updatePulses(dt) {
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
        const branch = kind === 3 ? (Math.random() < VISUAL.impact.branchChance ? 2 : 1)
          : kind === 2 ? (Math.random() < VISUAL.completion.branchChance ? 2 : 1) : kind === 0 ? 1 : 0;
        if (branch > 0) {
          demoSpawn = pDemo[s];
          fireFrom(to, hops - 1, kind, from, branch, pCat[s]);
          demoSpawn = 0;
        }
      }
    }
  }
}

function dnaEndDissolve(y) {
  const end = Math.max(0, Math.min(1, (Math.abs(y) / (CFG.radius * 1.1) - 0.72) / 0.28));
  return end * end * (3 - 2 * end);
}

function writePulseBuffers() {
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
      if (VISUAL.topology === 'dna') {
        const dissolve = dnaEndDissolve(pulsePos[idx * 3 + 1]);
        bright *= j === 0 ? 1 - 0.85 * dissolve : (1 - dissolve) ** 4;
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

function writeEdgeColors(dt) {
  edgeLines.visible = VISUAL.scene.edgeVisibility !== 'hidden';
  const decay = Math.exp(-dt * VISUAL.scene.edgeFade);
  for (let e = 0; e < E; e++) {
    edgeR[e] *= decay;
    edgeG[e] *= decay;
    edgeBColor[e] *= decay;
    const b = VISUAL.scene.edgeVisibility === 'always' ? edgeBase[e] : 0;
    const fade = VISUAL.topology === 'dna'
      ? (1 - dnaEndDissolve(Math.max(Math.abs(nodePos[edgeA[e] * 3 + 1]),
        Math.abs(nodePos[edgeB[e] * 3 + 1])))) ** 4 : 1;
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

// ---------- grid floor ----------
const floorMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uGlow: { value: 0 },
    uBrightness: { value: VISUAL.scene.floorBrightness },
    uFade: { value: VISUAL.scene.floorFade },
    uFineSpacing: { value: VISUAL.floor.fineSpacing },
    uFineIntensity: { value: VISUAL.floor.fineIntensity },
    uCoarseSpacing: { value: VISUAL.floor.coarseSpacing },
    uCoarseIntensity: { value: VISUAL.floor.coarseIntensity },
    uColor: { value: new THREE.Vector3(...VISUAL.floor.color) },
    uPoolColor: { value: new THREE.Vector3(...VISUAL.floor.poolColor) },
    uPoolFade: { value: VISUAL.floor.poolFade },
    uPoolBase: { value: VISUAL.floor.poolBase },
    uPoolGrid: { value: VISUAL.floor.poolGrid },
  },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uGlow;
    uniform float uBrightness;
    uniform float uFade;
    uniform float uFineSpacing;
    uniform float uFineIntensity;
    uniform float uCoarseSpacing;
    uniform float uCoarseIntensity;
    uniform vec3 uColor;
    uniform vec3 uPoolColor;
    uniform float uPoolFade;
    uniform float uPoolBase;
    uniform float uPoolGrid;
    varying vec3 vW;
    float grid(vec2 p, float s) {
      vec2 q = p / s;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      return 1.0 - min(min(g.x, g.y), 1.0);
    }
    void main() {
      float d = length(vW.xz);
      float g = grid(vW.xz, uFineSpacing) * uFineIntensity + grid(vW.xz, uCoarseSpacing) * uCoarseIntensity;
      float fade = exp(-d * uFade);
      vec3 col = uColor * g * fade * uBrightness;
      float pool = exp(-d * uPoolFade) * uGlow;
      col += uPoolColor * pool * (uPoolBase + g * uPoolGrid);
      gl_FragColor = vec4(col, 1.0);
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  extensions: { derivatives: true },
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -15;
floor.visible = VISUAL.effects.floor;
scene.add(floor);

// ---------- HUD ----------
const $status = document.getElementById('status');
const $journals = document.getElementById('journals');
const $sessions = document.getElementById('sessions');
const $waiting = document.getElementById('waiting');
const $unknown = document.getElementById('unknown');
const $running = document.getElementById('running');
const $impulses = document.getElementById('impulses');
const $load = document.getElementById('load');
const $subtitle = document.getElementById('subtitle');
const $coverage = document.getElementById('coverage');
const impulseFeed = createImpulseFeed();
const impulseBuffer = createImpulseBuffer();
const categoryBurstPlan = createCategoryBurstPlan();
const timeline = createActivityTimeline(performance.now());
const timelineCanvas = document.getElementById('timeline');
const timelineContext = timelineCanvas.getContext('2d');
const timelineState = document.getElementById('timeline-state');
const timelineLabels = {
  loading: 'Loading · awaiting live coverage',
  empty: 'No activity received in the observed window · hatching = unknown coverage',
  live: 'Received activity by category · hatching = unknown coverage',
  gap: 'Coverage gap · missing activity is unknown, not zero',
};
let lastTimelineState = '';
const timelineDialog = createTimelineDialog({
  preview: document.querySelector('.hud-timeline'),
  content: document.getElementById('timeline-content'),
  canvas: timelineCanvas,
  dialog: document.getElementById('timeline-dialog'),
  dialogContent: document.getElementById('timeline-dialog-content'),
  opener: document.getElementById('timeline-open'),
  closeButton: document.getElementById('timeline-close'),
  redraw: () => renderTimeline(performance.now()),
});
const expandedSessionStats = new Set();
const pageActivityTotals = createPageActivityTotals();
let activityState = { connection: 'connecting', sourceStatus: 'unknown', coverage: 'unknown', activeSessions: 0, thinkingSessions: 0, runningSessions: 0, unverifiedRunningSessions: 0, journalFiles: 0, sessions: [] };

const sessionStatsDialog = createSessionStatsDialog({
  document,
  dialog: document.getElementById('session-stats-dialog'),
  title: document.getElementById('session-stats-title'),
  content: document.getElementById('session-stats-content'),
  closeButton: document.getElementById('session-stats-close'),
  fallbackFocus: $status,
  formatElapsed: (elapsedMs) => {
    const seconds = Math.floor(Math.min(1_000_000_000, Math.max(0, elapsedMs)) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours >= 1000) return '>999h';
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  },
  expandedSessionStats,
  pageActivityTotals,
});
let workspaceStorage = null;
try {
  workspaceStorage = window.localStorage ?? null;
} catch {
  workspaceStorage = {
    getItem() { throw new Error('Workspace browser storage is unavailable.'); },
    setItem() { throw new Error('Workspace browser storage is unavailable.'); },
  };
}
const workspaceStore = createWorkspaceStore({ storage: workspaceStorage });
const workspaceUI = createWorkspaceUI({
  document,
  root: document.getElementById('workspace'),
  opener: document.getElementById('workspace-open'),
  store: workspaceStore,
  feed: impulseFeed,
  timelinePreview: document.querySelector('.hud-timeline'),
  closeTimeline: () => timelineDialog.close(),
  sessionStatsDialog,
  pageActivityTotals,
  expandedSessionStats,
});

const demoActivity = createDemoActivity();
let demoFrame = demoActivity.tick(0, VISUAL);
// Set when observed state or settings re-render the waiting markers without demo IDs.
let demoMarkersDirty = false;

function renderWaitingMarkers(sessionIds) {
  const waiting = Array.isArray(sessionIds) ? sessionIds.slice(0, 8) : [];
  for (let index = 0; index < waitingMarkerGroups.length; index++) {
    const cluster = waitingMarkerGroups[index];
    const id = waiting[index];
    cluster.visible = VISUAL.effects.waitingMarkers && Boolean(id);
    if (!id) continue;
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const node = hash % N;
    cluster.userData.anchorIndex = node;
    cluster.position.set(nodePos[node * 3], nodePos[node * 3 + 1], nodePos[node * 3 + 2]);
  }
}

document.getElementById('workspace').addEventListener('click', (event) => {
  if (event.target.closest('.workspace-session-list')) sessionStatsDialog.open(event);
});

function tickSessionTimes(now = performance.now()) {
  workspaceUI.tickSessionTimes(now);
}

// ---------- interaction ----------
const thinkingPulseClock = createThinkingPulseClock(VISUAL.running);

// Blue running-state stream: observed running work (thinking, tools and
// delegated agents), not a claim of hidden cognition.
function renderThinking(dt) {
  const sessions = Math.min(activityState.runningSessions ?? 0, VISUAL.running.maxSessions);
  const pulses = thinkingPulseClock.tick(dt, activityState, document.hidden);
  for (let i = 0; i < pulses; i++) {
    const node = (Math.random() * N) | 0;
    const hops = VISUAL.running.baseHops + Math.min(VISUAL.running.maxExtraHops, Math.floor(Math.log2(sessions + 1)));
    fireFrom(node, hops, 0, -1, VISUAL.running.spread);
    nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap, nodeEnergy[node] + VISUAL.running.nodeEnergy);
  }
}

function renderActivityState(state) {
  if (state.lifecycleInvalid) {
    for (let slot = 0; slot < P; slot++) {
      if (!pActive[slot] || pDemo[slot]) continue;
      pActive[slot] = 0;
      activePulses--;
      pulseSize.fill(0, slot * T, (slot + 1) * T);
    }
    thinkingPulseClock.reset();
    impulseBuffer.clear();
  }
  if (state.connection === 'recovering') {
    activityState = state;
    timeline.setCoverage(false, performance.now());
    $coverage.textContent = 'CONNECTION GAP · showing last-known activity';
    document.body.classList.toggle('source-unknown', true);
    return;
  }
  if (state.connection !== 'connected' || state.sourceStatus === 'unavailable' ||
      !(state.runningSessions > 0)) thinkingPulseClock.reset();
  if (state.connection !== 'connected') impulseBuffer.clear();
  if (state.sourceStatus === 'unavailable') impulseBuffer.clear();
  timeline.setCoverage(!document.hidden && state.connection === 'connected' &&
    state.sourceStatus === 'available' && state.coverage !== 'partial' &&
    state.coverage !== 'unknown', performance.now(), state.connection === 'connecting');
  activityState = state;
  updateSubagentSummary(state.treeSessions ?? []);
  renderWaitingMarkers(state.connection === 'connected' && state.sourceStatus !== 'unavailable'
    ? state.waitingSessionIds : []);
  workspaceUI.update(state);
  $journals.textContent = String(state.journalFiles ?? 0);
  $sessions.textContent = String(state.activeSessions ?? 0);
  $waiting.textContent = String(state.connection === 'connected' && state.sourceStatus !== 'unavailable'
    ? state.waitingSessions ?? 0 : 0);
  $unknown.textContent = String(state.unknownSessions ?? 0);
  $running.textContent = state.unverifiedRunningSessions > 0
    ? `${state.runningSessions ?? 0} · ${state.unverifiedRunningSessions} UNVERIFIED`
    : String(state.runningSessions ?? 0);
  $coverage.textContent = state.connection !== 'connected'
    ? 'CONNECTION GAP · activity coverage unknown'
    : state.coverage === 'partial'
      ? `PARTIAL · ${state.backlogFiles ?? 0} journal files pending or unobserved · session coverage unknown`
      : 'Local Copilot event files · open-session coverage not verifiable';
  document.body.classList.toggle('has-activity', state.activeSessions > 0 || state.runningSessions > 0);
  document.body.classList.toggle('source-error', state.sourceStatus === 'unavailable' || state.sourceStatus === 'partial');
  document.body.classList.toggle('source-unknown', state.connection !== 'connected' || state.coverage === 'unknown');
  if (state.connection === 'connecting') {
    $status.textContent = 'CONNECTING';
    $subtitle.textContent = 'connecting to local activity files';
  } else if (state.connection === 'retrying' || state.connection === 'unknown') {
    $status.textContent = 'RECONNECTING · UNKNOWN';
    $subtitle.textContent = 'activity not verified during connection gap';
  } else if (state.connection === 'disconnected') {
    $status.textContent = 'DISCONNECTED';
    $subtitle.textContent = 'local activity stream is closed';
  } else if (state.sourceStatus === 'unavailable') {
    $status.textContent = 'SOURCE UNAVAILABLE';
    $subtitle.textContent = 'local Copilot event files are unavailable';
  } else if (state.sourceStatus === 'partial' || state.coverage === 'partial') {
    $status.textContent = 'COVERAGE PARTIAL';
    $subtitle.textContent = state.backlogFiles > 0
      ? 'journal scan is catching up · activity is not fully observed'
      : 'some local event files could not be read';
  } else if (state.runningSessions > 0 && state.unverifiedRunningSessions > 0) {
    $status.textContent = 'RUNNING · UNVERIFIED';
    $subtitle.textContent = 'running task silent over 45s · not verified · may linger if it ended without a recorded end';
  } else if (state.runningSessions > 0) {
    $status.textContent = 'RUNNING';
    $subtitle.textContent = 'observed running work · thinking, tools or delegated agents · coverage is not complete';
  } else if (state.activeSessions > 0) {
    $status.textContent = 'OBSERVED ACTIVITY';
    $subtitle.textContent = 'active intervals in local event files · coverage is not complete';
  } else {
    $status.textContent = 'QUIET · NOT VERIFIED IDLE';
    $subtitle.textContent = 'no observed active interval · other sessions may be unobserved';
  }
}

const activityClient = createActivityClient({
  canAccept: () => lifecycleClient?.checkFresh() ?? false,
  onState: (state) => {
    renderActivityState(state);
    demoMarkersDirty = true;
  },
  onTree: applySubagentTree,
  onActivity: (activity) => {
    if (!document.hidden) impulseBuffer.add(activity);
    // onActivity receives accepted projectActivity() metadata, never raw events.
    // Count at arrival, not from the bounded/evicting visual buffer or snapshots.
    if (!document.hidden && activityState.connection === 'connected' &&
        activityState.sourceStatus === 'available' && activityState.coverage !== 'partial' &&
        activityState.coverage !== 'unknown') {
      pageActivityTotals.add(activity);
      sessionStatsDialog.refreshActivity();
      workspaceUI.refresh();
    }
  },
});
let lifecycleClient;

document.addEventListener('visibilitychange', () => {
  impulseBuffer.clear();
  timeline.setCoverage(!document.hidden && activityState.connection === 'connected' &&
    activityState.sourceStatus === 'available' && activityState.coverage !== 'partial' &&
    activityState.coverage !== 'unknown', performance.now());
  if (document.hidden) {
    thinkingPulseClock.reset();
  } else {
    applySubagentTree({
      sessions: activityState.treeSessions ?? [],
      added: [],
      completed: [],
      failed: [],
      cleared: [],
      reset: true,
    });
  }
});

function renderCompletionCascade(node) {
  const edges = adjacency[node];
  nodeHot[node] = VISUAL.completion.seedHeat;
  fireFrom(node, VISUAL.completion.hops, 2, -1, Math.min(VISUAL.completion.spread, edges.length), CATEGORY_INDEX.completion);
  for (let i = 0; i < Math.min(VISUAL.completion.neighbourSeeds, edges.length); i++) {
    fireFrom(otherEnd(edges[i], node), VISUAL.completion.neighbourHops, 2, node,
      VISUAL.completion.neighbourSpread, CATEGORY_INDEX.completion);
  }
}

function renderImpactBurst(node, category, durationMs) {
  const burst = impactBurst(durationMs, VISUAL.impact);
  if (!burst) return;
  const edges = adjacency[node];
  nodeHot[node] = Math.max(nodeHot[node], burst.seedHeat);
  fireFrom(node, burst.hops, 3, -1, Math.min(burst.spread, edges.length), category);
  for (let i = 0; i < Math.min(burst.neighbourSeeds, edges.length); i++) {
    fireFrom(otherEnd(edges[i], node), burst.neighbourHops, 3, node, burst.neighbourSpread, category);
  }
}

// The appearance demo passes its synthetic source with observed = false so it
// shares scene rendering but never reaches the timeline or impulse feed.
function renderObservedImpulses(source = impulseBuffer, observed = true) {
  const { byCategory, sceneByCategory, hookCounts, entries, impacts } = source.drain();
  if (document.hidden) return;
  if (observed) timeline.add(byCategory, performance.now());
  for (let i = 0; i < impacts.length; i++) {
    renderImpactBurst((Math.random() * N) | 0, impacts[i].category, impacts[i].durationMs);
  }
  for (let i = 0; observed && i < entries.length; i++) {
    const { kind, toolName, eventType, count } = entries[i];
    impulseFeed.add(kind, toolName, eventType, count);
  }
  renderHookPulses(hookCounts);
  // Counts strengthen a bounded impulse, rather than rendering one per token.
  const plan = categoryBurstPlan.plan(sceneByCategory);
  for (let i = 0; i < plan.length; i++) {
    const node = (Math.random() * N) | 0;
    const intensity = impulseIntensity(plan.counts[i], VISUAL.activity);
    const kind = plan.kinds[i];
    const category = plan.categories[i];
    if (kind === 2) {
      renderCompletionCascade(node);
      continue;
    }
    const hops = category === CATEGORY_INDEX.error ? VISUAL.activity.errorHops
      : kind === 0 ? VISUAL.activity.reasoningBaseHops + intensity : intensity;
    fireFrom(node, hops, kind, -1, Math.min(VISUAL.activity.maxSpread, intensity), category);
    if (kind === 0) nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap,
      nodeEnergy[node] + VISUAL.activity.reasoningEnergy * intensity);
    else nodeHot[node] = Math.min(VISUAL.activity.stepHeatCap, nodeHot[node] + VISUAL.activity.stepHeat * intensity);
  }
}

function renderHookPulses(counts) {
  for (let index = 0; index < HOOK_TYPES.length; index++) {
    const strength = VISUAL.hooks[`${HOOK_TYPES[index]}Impact`];
    if (!counts[index] || strength === 0) continue;
    const intensity = Math.min(VISUAL.activity.maxIntensity,
      Math.max(1, Math.round(impulseIntensity(counts[index], VISUAL.activity) * strength)));
    const node = (Math.random() * N) | 0;
    fireFrom(node, intensity, 1, -1, Math.min(VISUAL.activity.maxSpread, intensity),
      CATEGORIES.length + index);
    nodeHot[node] = Math.min(VISUAL.activity.stepHeatCap,
      nodeHot[node] + VISUAL.activity.stepHeat * intensity);
  }
}

const NO_WAITING_IDS = Object.freeze([]);

function observedWaitingIds() {
  return (activityState.connection === 'connected' || activityState.connection === 'recovering') &&
    activityState.sourceStatus !== 'unavailable' ? activityState.waitingSessionIds : NO_WAITING_IDS;
}

// Appearance demo: synthetic scene-only bursts. It bypasses the timeline,
// impulse feed, statistics, activity state and HUD counters.
const demoSource = { drain: () => demoFrame };
const demoThinkingPulseClock = createThinkingPulseClock(VISUAL.running);
const demoThinkingState = { connection: 'connected', sourceStatus: 'available', runningSessions: 0 };
const demoMarkerIds = [];
let demoBadgeVisible = false;

function renderDemoActivity(dt) {
  const wasActive = demoFrame.active;
  const wasWaiting = demoFrame.waiting;
  demoFrame = demoActivity.tick(dt, VISUAL);
  if (demoFrame.active !== wasActive || demoFrame.waiting !== wasWaiting ||
      (demoMarkersDirty && demoFrame.active)) {
    demoMarkersDirty = false;
    const observedIds = observedWaitingIds();
    demoMarkerIds.length = 0;
    for (let i = 0; Array.isArray(observedIds) && i < observedIds.length; i++) demoMarkerIds.push(observedIds[i]);
    for (let i = 0; demoFrame.waiting && i < DEMO_WAITING_IDS.length; i++) demoMarkerIds.push(DEMO_WAITING_IDS[i]);
    renderWaitingMarkers(demoMarkerIds);
  }
  // The badge stays until the last tagged demo pulse has finished.
  const badgeVisible = demoFrame.active || demoPulses > 0;
  if (badgeVisible !== demoBadgeVisible) {
    demoBadgeVisible = badgeVisible;
    demoBadge.hidden = !badgeVisible;
  }
  if (!demoFrame.active) return;
  demoSpawn = 1;
  renderObservedImpulses(demoSource, false);
  demoThinkingState.runningSessions = demoFrame.runningSessions;
  const pulses = demoThinkingPulseClock.tick(dt, demoThinkingState, document.hidden);
  const hops = VISUAL.running.baseHops +
    Math.min(VISUAL.running.maxExtraHops, Math.floor(Math.log2(demoFrame.runningSessions + 1)));
  for (let i = 0; i < pulses; i++) {
    const node = (Math.random() * N) | 0;
    fireFrom(node, hops, 0, -1, VISUAL.running.spread);
    nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap, nodeEnergy[node] + VISUAL.running.nodeEnergy);
  }
  demoSpawn = 0;
}

const demoToggle = document.getElementById('visual-settings-demo');
const demoBadge = document.getElementById('demo-badge');

function setDemoRunning(running) {
  if (running === demoActivity.isRunning()) return;
  if (running) demoActivity.start();
  else {
    demoActivity.stop();
    demoThinkingPulseClock.reset();
  }
  demoToggle.checked = running;
  if (running) {
    demoBadgeVisible = true;
    demoBadge.hidden = false;
  }
}

demoToggle.addEventListener('change', () => setDemoRunning(demoToggle.checked));

function renderTimeline(now) {
  const view = timeline.read(now);
  if (lastTimelineState !== view.state) {
    lastTimelineState = view.state;
    timelineState.textContent = timelineLabels[view.state];
  }
  if (!timelineContext) return;
  const width = timelineCanvas.width, height = timelineCanvas.height;
  const column = width / 120;
  timelineContext.clearRect(0, 0, width, height);
  let max = 1;
  for (let bucket = 0; bucket < 120; bucket++) {
    let total = 0;
    for (let category = 0; category < CATEGORIES.length; category++) {
      total += view.counts[bucket * CATEGORIES.length + category];
    }
    max = Math.max(max, total);
  }
  for (let x = 0; x < 120; x++) {
    const bucket = (view.head + 1 + x) % 120;
    const offset = bucket * CATEGORIES.length;
    let total = 0;
    for (let category = 0; category < CATEGORIES.length; category++) total += view.counts[offset + category];
    const bar = total > 0 ? (height - 2) * Math.log1p(total) / Math.log1p(max) : 0;
    let y = height;
    for (let category = 0; category < CATEGORIES.length; category++) {
      const count = view.counts[offset + category];
      if (!count) continue;
      const segment = bar * count / total;
      timelineContext.fillStyle = CATEGORY_HEX[CATEGORIES[category]];
      timelineContext.fillRect(x * column, y - segment, column - 1, segment);
      y -= segment;
    }
    if (view.coverage[bucket] !== 1) {
      // Hatch unknown history and partial buckets, even if counts were received.
      timelineContext.fillStyle = 'rgba(159,195,255,0.08)';
      timelineContext.fillRect(x * column, 0, column - 1, height);
      timelineContext.strokeStyle = 'rgba(159,195,255,0.4)';
      timelineContext.beginPath();
      for (let hatch = -height; hatch < height; hatch += 8) {
        timelineContext.moveTo(x * column, Math.max(0, hatch));
        timelineContext.lineTo(x * column + column - 1, Math.min(height, hatch + column));
      }
      timelineContext.stroke();
    }
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
let smoothedLoad = 0;
let smoothedObservedLoad = 0;
let hudTimer = 0;
let sessionTimer = 0;
let timelineTimer = 0;

function frame() {
  lifecycleClient?.checkFresh();
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  brain.rotation.x = VISUAL.topology === 'waves' ? 0.55 : 0;
  brain.rotation.z = VISUAL.topology === 'dna' ? -0.55 : 0;
  updateNetworkMotion(dt);
  renderObservedImpulses();
  renderDemoActivity(dt);
  updateSceneFraming(dt);
  renderThinking(dt);
  renderSubagentTree(performance.now() / 1000);
  timelineTimer -= dt;
  if (timelineTimer <= 0) {
    timelineTimer = 0.5;
    renderTimeline(performance.now());
  }
  updatePulses(dt);

  const decay = Math.exp(-dt * VISUAL.nodes.decay);
  for (let i = 0; i < N; i++) {
    nodeEnergy[i] *= decay;
    nodeHot[i] *= decay;
  }
  nodeGeo.attributes.aEnergy.needsUpdate = true;
  nodeGeo.attributes.aHot.needsUpdate = true;

  writeEdgeColors(dt);
  writePulseBuffers();

  // ambience
  const load = Math.min(1, activePulses / VISUAL.scene.loadPulseScale + activityState.activeSessions / VISUAL.scene.loadSessionScale);
  smoothedLoad += (load - smoothedLoad) * Math.min(1, dt * VISUAL.scene.loadSmoothing);

  const breathe = VISUAL.effects.latticeBreathing
    ? 1 + Math.sin(now * VISUAL.scene.breathSpeed) * VISUAL.scene.breathAmplitude : 1;
  brain.scale.setScalar(breathe);
  const waitingGlow = ((activityState.connection === 'connected' || activityState.connection === 'recovering') &&
    activityState.sourceStatus !== 'unavailable' && activityState.waitingSessions > 0) || demoFrame.waiting;
  const waitBreath = VISUAL.waiting.colorMixMin +
    VISUAL.waiting.colorMixRange * (0.5 + 0.5 * Math.sin(now * VISUAL.waiting.breathSpeed));
  const showWaitingGlow = VISUAL.effects.waitingGlow && waitingGlow;
  coreGlow.material.color.lerpColors(baseCoreColor, waitingCoreColor, showWaitingGlow ? waitBreath : 0);
  coreGlow.material.opacity = VISUAL.scene.coreOpacity + smoothedLoad * VISUAL.scene.coreLoad;
  if (showWaitingGlow) coreGlow.material.opacity += VISUAL.waiting.opacityBase + waitBreath * VISUAL.waiting.opacityBreath;
  haloGlow.material.opacity = VISUAL.scene.haloOpacity + smoothedLoad * VISUAL.scene.haloLoad;
  bloom.strength = VISUAL.scene.bloomStrength + smoothedLoad * VISUAL.scene.bloomLoad;
  dust.rotation.y = now * VISUAL.dust.rotationSpeed;
  dust.rotation.x = Math.sin(now * VISUAL.dust.tiltSpeed) * VISUAL.dust.tiltAmplitude;

  nodeMat.uniforms.uTime.value = now;
  dustMat.uniforms.uTime.value = now;
  floorMat.uniforms.uTime.value = now;
  floorMat.uniforms.uGlow.value = smoothedLoad * VISUAL.scene.floorGlow;

  hudTimer -= dt;
  // HUD readouts exclude demo pulses; the scene load above includes them.
  const observedLoad = Math.min(1, (activePulses - demoPulses) / VISUAL.scene.loadPulseScale +
    activityState.activeSessions / VISUAL.scene.loadSessionScale);
  smoothedObservedLoad += (observedLoad - smoothedObservedLoad) * Math.min(1, dt * VISUAL.scene.loadSmoothing);
  if (hudTimer <= 0) {
    hudTimer = 0.15;
    $impulses.textContent = String(activePulses - demoPulses);
    $load.textContent = Math.round(smoothedObservedLoad * 100) + '%';
  }
  sessionTimer -= dt;
  if (sessionTimer <= 0) {
    sessionTimer = 1;
    tickSessionTimes(performance.now());
  }

  if (!libraryModalOpen) controls.update();
  composer.render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  updateFramingTarget();
  framingWidth = 0;
});

// While the Appearance panel covers the right of a wide window, shift the
// projection so the brain stays centred in the uncovered area.
const visualSettingsDialog = document.getElementById('visual-settings-dialog');
const FRAMING_MIN_WIDTH = 900;
const FRAMING_EASE = 6;
let framingOpen = false;
let framingTarget = 0;
let framingOffset = 0;
let framingApplied = 0;
let framingWidth = 0;
let framingHeight = 0;

function updateFramingTarget() {
  framingTarget = 0;
  if (!framingOpen || window.innerWidth < FRAMING_MIN_WIDTH) return;
  const panelWidth = visualSettingsDialog.getBoundingClientRect().width;
  if (panelWidth > 0 && panelWidth < window.innerWidth * 0.75) framingTarget = panelWidth / 2;
}

function updateSceneFraming(dt) {
  if (reducedMotion) framingOffset = framingTarget;
  else framingOffset += (framingTarget - framingOffset) * Math.min(1, dt * FRAMING_EASE);
  if (Math.abs(framingTarget - framingOffset) < 0.5) framingOffset = framingTarget;
  const w = window.innerWidth, h = window.innerHeight;
  if (framingOffset === framingApplied && w === framingWidth && h === framingHeight) return;
  framingApplied = framingOffset;
  framingWidth = w;
  framingHeight = h;
  if (framingOffset === 0) camera.clearViewOffset();
  else camera.setViewOffset(w, h, framingOffset, 0, w, h);
}

function applyVisualSettings(candidate) {
  const errors = validateVisualSettings(candidate);
  if (errors.length) throw new Error(errors.map(({ path, message }) => `${path}: ${message}`).join(' '));

  const previous = structuredClone(VISUAL);
  const topologyChanged = candidate.nodes.count !== N ||
    (candidate.topology ?? 'lattice') !== (VISUAL.topology ?? 'lattice');
  const changed = (path) =>
    JSON.stringify(path.split('.').reduce((value, key) => value[key], previous)) !==
    JSON.stringify(path.split('.').reduce((value, key) => value[key], candidate));
  const nextSceneRgb = createScenePalette(candidate);
  const nextNodeSize = !topologyChanged && (changed('nodes.largeChance') || changed('nodes.largeSizeMin') ||
    changed('nodes.largeSizeRange') || changed('nodes.baseSizeMin') || changed('nodes.baseSizeRange'))
    ? Float32Array.from({ length: N }, () => Math.random() < candidate.nodes.largeChance
      ? candidate.nodes.largeSizeMin + Math.random() * candidate.nodes.largeSizeRange
      : candidate.nodes.baseSizeMin + Math.random() * candidate.nodes.baseSizeRange)
    : null;
  const nextEdgeBase = !topologyChanged && (changed('scene.edgeVariationMin') || changed('scene.edgeVariationRange'))
    ? Float32Array.from({ length: E }, () =>
      candidate.scene.edgeVariationMin + Math.random() * candidate.scene.edgeVariationRange)
    : null;
  const nextGlowTexture = changed('scene.glowKnee') || changed('scene.glowKneeOpacity')
    ? radialTexture(candidate) : null;
  const nextBackground = changed('scene.background') ? new THREE.Color(candidate.scene.background) : null;
  let nextNetwork;
  try {
    nextNetwork = topologyChanged ? buildNetwork(candidate) : null;
  } catch (error) {
    nextGlowTexture?.dispose();
    throw error;
  }

  if (changed('camera.fov')) camera.fov = candidate.camera.fov;
  if (changed('camera.position')) camera.position.set(...candidate.camera.position);
  if (changed('camera.target')) controls.target.set(...candidate.camera.target);
  controls.dampingFactor = candidate.camera.damping;
  controls.minDistance = candidate.camera.minDistance;
  controls.maxDistance = candidate.camera.maxDistance;
  controls.autoRotate = candidate.camera.autoRotate && candidate.topology !== 'dna';
  controls.autoRotateSpeed = candidate.camera.autoRotateSpeed;
  if (changed('camera.fov')) camera.updateProjectionMatrix();

  for (const [group, values] of Object.entries(candidate)) {
    if (group === 'topology') {
      VISUAL.topology = values;
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      VISUAL[group][name] = Array.isArray(value) ? value.slice() : value;
    }
  }

  if (nextNetwork) installNetwork(nextNetwork);
  if (nextBackground) scene.background = nextBackground;
  if (nextNodeSize) {
    nodeSize.set(nextNodeSize);
    nodeGeo.attributes.aSize.needsUpdate = true;
  }
  if (nextEdgeBase) edgeBase.set(nextEdgeBase);
  edgeLines.visible = VISUAL.scene.edgeVisibility !== 'hidden';
  SCENE_RGB.set(nextSceneRgb);
  applyHookColors(document, VISUAL.hooks);

  const nodeUniforms = nodeMat.uniforms;
  nodeUniforms.uScale.value = VISUAL.nodes.scale * pixelRatio;
  nodeUniforms.uSize.value = VISUAL.nodes.size;
  nodeUniforms.uActiveGrowth.value = VISUAL.nodes.activeGrowth;
  nodeUniforms.uIdleBrightness.value = VISUAL.nodes.idleBrightness;
  nodeUniforms.uDnaHalfLength.value = VISUAL.topology === 'dna' ? CFG.radius * 1.1 : 0;
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

  const dustUniforms = dustMat.uniforms;
  dustUniforms.uScale.value = VISUAL.dust.scale * pixelRatio;
  dustUniforms.uBrightness.value = VISUAL.scene.dustBrightness;
  dustUniforms.uColor.value.set(...VISUAL.dust.color);
  dustUniforms.uTwinkleBase.value = VISUAL.dust.twinkleBase;
  dustUniforms.uTwinkleAmplitude.value = VISUAL.dust.twinkleAmplitude;
  dustUniforms.uTwinkleSpeed.value = VISUAL.dust.twinkleSpeed;
  dustUniforms.uTwinklePhase.value = VISUAL.dust.twinklePhase;
  dustUniforms.uTwinklePower.value = VISUAL.dust.twinklePower;
  dust.visible = VISUAL.effects.dust;

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

  if (nextGlowTexture) {
    const previousTexture = glowTex;
    glowTex = nextGlowTexture;
    coreGlow.material.map = glowTex;
    waitingMarkerMaterial.map = glowTex;
    haloGlow.material.map = glowTex;
    coreGlow.material.needsUpdate = true;
    waitingMarkerMaterial.needsUpdate = true;
    haloGlow.material.needsUpdate = true;
    previousTexture.dispose();
  }
  coreGlow.material.color.set(VISUAL.scene.coreColor);
  baseCoreColor.set(VISUAL.scene.coreColor);
  coreGlow.scale.setScalar(VISUAL.scene.coreSize);
  haloGlow.material.color.set(VISUAL.scene.haloColor);
  haloGlow.scale.setScalar(VISUAL.scene.haloSize);
  waitingMarkerMaterial.opacity = VISUAL.waiting.markerOpacity;
  for (const group of waitingMarkerGroups) {
    for (const marker of group.children) marker.scale.setScalar(VISUAL.waiting.markerSize);
  }
  if (changed('subagents.growSeconds')) SUBAGENT_GROW_SECONDS = VISUAL.subagents.growSeconds;
  if (changed('subagents.fadeSeconds')) SUBAGENT_FADE_SECONDS = VISUAL.subagents.fadeSeconds;
  branchTips.material.size = VISUAL.subagents.tipSize * pixelRatio;
  fadingTips.material.size = VISUAL.subagents.fadingTipSize * pixelRatio;
  anchorPoints.material.size = VISUAL.subagents.anchorSize * pixelRatio;

  const floorUniforms = floorMat.uniforms;
  floorUniforms.uBrightness.value = VISUAL.scene.floorBrightness;
  floorUniforms.uFade.value = VISUAL.scene.floorFade;
  floorUniforms.uFineSpacing.value = VISUAL.floor.fineSpacing;
  floorUniforms.uFineIntensity.value = VISUAL.floor.fineIntensity;
  floorUniforms.uCoarseSpacing.value = VISUAL.floor.coarseSpacing;
  floorUniforms.uCoarseIntensity.value = VISUAL.floor.coarseIntensity;
  floorUniforms.uColor.value.set(...VISUAL.floor.color);
  floorUniforms.uPoolColor.value.set(...VISUAL.floor.poolColor);
  floorUniforms.uPoolFade.value = VISUAL.floor.poolFade;
  floorUniforms.uPoolBase.value = VISUAL.floor.poolBase;
  floorUniforms.uPoolGrid.value = VISUAL.floor.poolGrid;
  floor.visible = VISUAL.effects.floor;

  bloom.strength = VISUAL.scene.bloomStrength;
  bloom.radius = VISUAL.scene.bloomRadius;
  bloom.threshold = VISUAL.scene.bloomThreshold;
  renderWaitingMarkers((activityState.connection === 'connected' || activityState.connection === 'recovering') &&
    activityState.sourceStatus !== 'unavailable'
    ? activityState.waitingSessionIds : []);
  if (!libraryModalOpen) controls.update();
  return true;
}

createVisualSettingsPanel({
  document,
  opener: document.getElementById('visual-settings-open'),
  dialog: document.getElementById('visual-settings-dialog'),
  form: document.getElementById('visual-settings-form'),
  presetSelect: document.getElementById('visual-settings-preset'),
  fields: document.getElementById('visual-settings-fields'),
  quickFields: document.getElementById('visual-settings-quick'),
  searchInput: document.getElementById('visual-settings-search'),
  searchStatus: document.getElementById('visual-settings-search-status'),
  clearSearchButton: document.getElementById('visual-settings-search-clear'),
  title: document.getElementById('visual-settings-title'),
  status: document.getElementById('visual-settings-status'),
  errorSummary: document.getElementById('visual-settings-errors'),
  conflict: document.getElementById('visual-settings-conflict'),
  useFileButton: document.getElementById('visual-settings-use-file'),
  keepPreviewButton: document.getElementById('visual-settings-keep-preview'),
  closeButton: document.getElementById('visual-settings-close'),
  resetButton: document.getElementById('visual-settings-reset'),
  exportButton: document.getElementById('visual-settings-export'),
  reloadButton: document.getElementById('visual-settings-reload'),
  autoReloadInput: document.getElementById('visual-settings-auto-reload'),
  presetNameInput: document.getElementById('visual-settings-preset-name'),
  saveAsPresetButton: document.getElementById('visual-settings-preset-save-as'),
  savePresetButton: document.getElementById('visual-settings-preset-save'),
  deletePresetButton: document.getElementById('visual-settings-preset-delete'),
  initialConfiguration: {
    defaults: VISUAL_DEFAULTS,
    preset: VISUAL_PRESET,
    overrides: VISUAL_OVERRIDES,
    settings: VISUAL,
  },
  applySettings: (candidate) => {
    try {
      return applyVisualSettings(candidate);
    } finally {
      demoMarkersDirty = true;
    }
  },
  onOpenChange(open) {
    workspaceUI.setAppearanceOpen(open);
    setDemoRunning(open && !reducedMotion);
    framingOpen = open;
    updateFramingTarget();
  },
  // Hovering or focusing a setting narrows the demo to the matching effect;
  // the hover sweep is motion, so reduced motion keeps only the focus.
  previewMode: () => (!demoActivity.isRunning() ? 'off' : reducedMotion ? 'focus' : 'sweep'),
  onPreviewFocus: (path) => demoActivity.setFocus(demoFocusForPath(path)),
});

createNavigationUI({ document });

const libraryDialog = createLibraryDialog({
  document,
  onModalChange(open) {
    libraryModalOpen = open;
    if (open) {
      controlsEnabledBeforeLibrary = controls.enabled;
      controls.enabled = false;
    } else {
      controls.enabled = controlsEnabledBeforeLibrary;
    }
  },
});

const lifecycleStatus = document.getElementById('lifecycle-status');
lifecycleClient = createPwaLifecycle({
  onInvalidate() {
    activityClient.suspend();
    libraryDialog.invalidate();
  },
  onReady() { activityClient.resume(); },
  onStatus(state) {
    lifecycleStatus.hidden = state === 'owned' || state === 'manual';
    lifecycleStatus.textContent = state === 'checking'
      ? 'Checking local backend · activity coverage unknown.'
      : state === 'busy'
        ? 'Backend capacity reached · activity coverage unknown. Close unused SENTIENT windows/tabs and wait for abandoned leases to expire; retrying automatically.'
        : 'Backend unavailable · activity coverage unknown. Run the SENTIENT launcher (starts server); the browser app shortcut cannot start it.';
  },
});
lifecycleClient.start();

frame();
