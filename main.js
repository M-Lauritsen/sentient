import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createActivityClient, createImpulseFeed, createImpulseBuffer, impulseIntensity,
  createThinkingPulseClock, summarizeSubagents, createCategoryBurstPlan, createActivityTimeline,
  projectActiveHudSessions } from './activity-client.mjs';
import { clearSessionStats, createPageActivityTotals, createSessionStatsDialog, renderSessionRows } from './session-stats-ui.mjs';
import { CATEGORIES, CATEGORY_HEX, CATEGORY_INDEX, CATEGORY_RGB } from './activity-colors.mjs';
import { VISUAL } from './visual-settings.mjs';

// Structural geometry and fixed buffer capacities, not visual tuning.
const CFG = {
  radius: 10,
  nodes: 1200,
  neighbours: 3,
  maxEdgeLen: 4.5,
  dust: 4000,
  maxPulses: 1600,
  trail: 7,
};

// Pulse kinds: 0 = observed thinking, 1 = activity step, 2 = completion cascade.
// Motion and category are independent; RGB storage is shared and never rebuilt.
// Shader attributes are linear; cap the palette at 0.9 before trail brightness.
const SCENE_RGB = Float32Array.from(CATEGORY_RGB, (channel) =>
  0.9 * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

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
scene.background = new THREE.Color(0x020409);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 4, 31);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 14;
controls.maxDistance = 60;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.target.set(0, 0, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight),
  VISUAL.scene.bloomStrength, VISUAL.scene.bloomRadius, VISUAL.scene.bloomThreshold);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const brain = new THREE.Group();
scene.add(brain);

// ---------- nodes ----------
const N = CFG.nodes;
const nodePos = new Float32Array(N * 3);
const nodeEnergy = new Float32Array(N);
const nodeHot = new Float32Array(N);
const nodeSize = new Float32Array(N);
{
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
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
    nodeSize[i] = Math.random() < 0.04 ? 2.6 + Math.random() : 0.6 + Math.random() * 1.0;
  }
}

// ---------- edges (k nearest neighbours) ----------
const edgeA = [];
const edgeB = [];
const edgeLen = [];
const adjacency = Array.from({ length: N }, () => []);
{
  const seen = new Set();
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
const E = edgeA.length;
const edgeR = new Float32Array(E);
const edgeG = new Float32Array(E);
const edgeBColor = new Float32Array(E);
const edgeBase = new Float32Array(E);
let maxNodeDegree = 0;
for (let i = 0; i < N; i++) maxNodeDegree = Math.max(maxNodeDegree, adjacency[i].length);
const fireEdges = new Int32Array(maxNodeDegree);

const edgeGeo = new THREE.BufferGeometry();
const edgePositions = new Float32Array(E * 6);
const edgeColors = new Float32Array(E * 6);
for (let e = 0; e < E; e++) {
  for (let c = 0; c < 3; c++) {
    edgePositions[e * 6 + c] = nodePos[edgeA[e] * 3 + c];
    edgePositions[e * 6 + 3 + c] = nodePos[edgeB[e] * 3 + c];
  }
  edgeBase[e] = 0.45 + Math.random() * 0.55;
}
edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3).setUsage(THREE.DynamicDrawUsage));
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

// ---------- node points ----------
const nodeGeo = new THREE.BufferGeometry();
nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
nodeGeo.setAttribute('aEnergy', new THREE.BufferAttribute(nodeEnergy, 1).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute('aHot', new THREE.BufferAttribute(nodeHot, 1).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nodeSize, 1));
const nodeMat = new THREE.ShaderMaterial({
  uniforms: {
    uScale: { value: VISUAL.nodes.scale * pixelRatio }, uTime: { value: 0 },
    uSize: { value: VISUAL.nodes.size }, uActiveGrowth: { value: VISUAL.nodes.activeGrowth },
    uIdleBrightness: { value: VISUAL.nodes.idleBrightness },
    uActiveBrightness: { value: VISUAL.nodes.activeBrightness },
    uHotMix: { value: VISUAL.nodes.hotMix },
    uWhiteThreshold: { value: VISUAL.nodes.whiteThreshold },
    uWhiteMix: { value: VISUAL.nodes.whiteMix },
  },
  vertexShader: /* glsl */ `
    attribute float aEnergy;
    attribute float aHot;
    attribute float aSize;
    uniform float uScale;
    uniform float uTime;
    uniform float uSize;
    uniform float uActiveGrowth;
    varying float vEnergy;
    varying float vHot;
    varying float vTwinkle;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      vTwinkle = 0.75 + 0.25 * sin(uTime * 1.7 + position.x * 3.1 + position.y * 2.3);
      gl_PointSize = aSize * uSize * (1.0 + aEnergy * uActiveGrowth) * uScale / -mv.z;
      vEnergy = aEnergy;
      vHot = aHot;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uIdleBrightness;
    uniform float uActiveBrightness;
    uniform float uHotMix;
    uniform float uWhiteThreshold;
    uniform float uWhiteMix;
    varying float vEnergy;
    varying float vHot;
    varying float vTwinkle;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float core = pow(smoothstep(0.5, 0.0, d), 2.2);
      vec3 base = vec3(0.16, 0.45, 1.0);
      vec3 hot = vec3(1.0, 0.52, 0.12);
      vec3 white = vec3(1.0, 0.92, 0.8);
      vec3 col = mix(base, hot, clamp(vHot * uHotMix, 0.0, 1.0));
      col = mix(col, white, clamp((max(vEnergy, vHot) - uWhiteThreshold) * uWhiteMix, 0.0, 1.0));
      gl_FragColor = vec4(col * core * (uIdleBrightness * vTwinkle + max(vEnergy, vHot) * uActiveBrightness), 1.0);
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
brain.add(new THREE.Points(nodeGeo, nodeMat));

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
      uTime: { value: 0 }, uScale: { value: 40 * pixelRatio },
      uBrightness: { value: VISUAL.scene.dustBrightness },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 0.9 + aPhase * 7.0), 3.0);
        gl_PointSize = uScale / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBrightness;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.2, 0.45, 1.0) * vA * uBrightness * smoothstep(0.5, 0.0, d), 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  var dust = new THREE.Points(geo, dustMat);
  scene.add(dust);
}

// ---------- core glow ----------
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = radialTexture();
const coreGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTex,
    color: 0x3d8bff,
    transparent: true,
    opacity: VISUAL.scene.coreOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
coreGlow.scale.setScalar(16);
brain.add(coreGlow);
const baseCoreColor = new THREE.Color(0x3d8bff);
const waitingCoreColor = new THREE.Color(CATEGORY_HEX.waiting);
const waitingMarkerMaterial = new THREE.SpriteMaterial({
  map: glowTex,
  color: 0xff4fd8,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const waitingMarkerGroups = Array.from({ length: 8 }, () => {
  const cluster = new THREE.Group();
  for (const [x, y, z] of [[0, 0, 0], [0.32, 0.12, 0], [-0.2, -0.26, 0.18]]) {
    const marker = new THREE.Sprite(waitingMarkerMaterial);
    marker.position.set(x, y, z);
    marker.scale.setScalar(0.55);
    cluster.add(marker);
  }
  cluster.visible = false;
  brain.add(cluster);
  return cluster;
});
const haloGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTex,
    color: 0x2a6bff,
    transparent: true,
    opacity: VISUAL.scene.haloOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
haloGlow.scale.setScalar(38);
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
let pCursor = 0;
let activePulses = 0;

const pulsePos = new Float32Array(P * T * 3);
const pulseCol = new Float32Array(P * T * 3);
const pulseSize = new Float32Array(P * T);
const pulseGeo = new THREE.BufferGeometry();
pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3).setUsage(THREE.DynamicDrawUsage));
pulseGeo.setAttribute('aColor', new THREE.BufferAttribute(pulseCol, 3).setUsage(THREE.DynamicDrawUsage));
pulseGeo.setAttribute('aSize', new THREE.BufferAttribute(pulseSize, 1).setUsage(THREE.DynamicDrawUsage));
const pulseMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: VISUAL.pulses.scale * pixelRatio } },
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
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float a = pow(smoothstep(0.5, 0.0, d), 1.8);
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
const SUBAGENT_FADE_SECONDS = 2;
const SUBAGENT_GROW_SECONDS = 0.22;
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
  size: 5 * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
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
  size: 4 * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
fadingTips.frustumCulled = false;
brain.add(fadingTips);

const anchorGeo = new THREE.BufferGeometry();
anchorGeo.setAttribute('position', new THREE.BufferAttribute(anchorPositions, 3).setUsage(THREE.DynamicDrawUsage));
anchorGeo.setAttribute('color', new THREE.BufferAttribute(anchorColors, 3).setUsage(THREE.DynamicDrawUsage));
const anchorPoints = new THREE.Points(anchorGeo, new THREE.PointsMaterial({
  size: 8 * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
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
  if (reducedMotion) return;
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
    if (session) addSubagentBranch(session, branch, !reducedMotion);
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
    if (session.status === 'running') writeTreeColor(anchorColors, colorOffset, 0.2, 0.6, 1, 1.1);
    else if (session.status === 'waiting') writeTreeCategory(anchorColors, colorOffset, CATEGORY_INDEX.waiting, 0.9);
    else if (session.status === 'stuck') writeTreeColor(anchorColors, colorOffset, 0.5, 0.55, 0.65, 0.55);
    else writeTreeColor(anchorColors, colorOffset, 0.16, 0.32, 0.56, 0.35);
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
    const growth = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - branch.growthStart) / SUBAGENT_GROW_SECONDS));
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
    const intensity = Math.min(1, 0.55 + Math.max(0, now - branch.startedAt) * 0.08);
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
    const flash = branch.outcome === 'failed' && age < 0.12 ? 2 : 1;
    const intensity = (1 - age) * flash *
      (branch.outcome === 'completed' && age < 0.15 ? 0.6 + age * 6 : 1);
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
      writeTreeColor(fadingLineColors, lineOffset, 0.55, 0.58, 0.64, intensity);
      writeTreeColor(fadingTipColors, i * 3, 0.65, 0.68, 0.72, intensity);
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
    activePulses++;
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
    const intensity = kind === 2 ? VISUAL.completion.edgeIntensity : kind === 1 ? 0.45 : 0.6;
    edgeR[e] = Math.max(edgeR[e], SCENE_RGB[rgb] * intensity);
    edgeG[e] = Math.max(edgeG[e], SCENE_RGB[rgb + 1] * intensity);
    edgeBColor[e] = Math.max(edgeBColor[e], SCENE_RGB[rgb + 2] * intensity);

    if (pT[s] >= 1) {
      const from = pFrom[s];
      const hops = pHops[s];
      const to = otherEnd(e, from);
      pActive[s] = 0;
      activePulses--;
      nodeEnergy[to] = Math.min(1.8, nodeEnergy[to] + (kind === 2 ? VISUAL.completion.nodeEnergy : 0.5));
      if (hops > 0) {
        const branch = kind === 2 ? (Math.random() < VISUAL.completion.branchChance ? 2 : 1) : kind === 0 ? 1 : 0;
        if (branch > 0) fireFrom(to, hops - 1, kind, from, branch, pCat[s]);
      }
    }
  }
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
    const head = pKind[s] === 2 ? VISUAL.pulses.completionHead : VISUAL.pulses.head;
    const spacing = pKind[s] === 2 ? VISUAL.pulses.completionTrailSpacing : VISUAL.pulses.trailSpacing;
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
      const bright = j === 0 ? VISUAL.pulses.headBrightness : f;
      pulseCol[idx * 3] = SCENE_RGB[rgb] * bright;
      pulseCol[idx * 3 + 1] = SCENE_RGB[rgb + 1] * bright;
      pulseCol[idx * 3 + 2] = SCENE_RGB[rgb + 2] * bright;
      pulseSize[idx] = head * (0.35 + 0.65 * f);
    }
  }
  pulseGeo.attributes.position.needsUpdate = true;
  pulseGeo.attributes.aColor.needsUpdate = true;
  pulseGeo.attributes.aSize.needsUpdate = true;
}

function writeEdgeColors(dt) {
  const decay = Math.exp(-dt * VISUAL.scene.edgeFade);
  for (let e = 0; e < E; e++) {
    edgeR[e] *= decay;
    edgeG[e] *= decay;
    edgeBColor[e] *= decay;
    const b = edgeBase[e];
    const r = 0.012 * b + edgeR[e];
    const g = 0.04 * b + edgeG[e];
    const bl = 0.13 * b + edgeBColor[e];
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
    varying vec3 vW;
    float grid(vec2 p, float s) {
      vec2 q = p / s;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      return 1.0 - min(min(g.x, g.y), 1.0);
    }
    void main() {
      float d = length(vW.xz);
      float g = grid(vW.xz, 2.5) * 0.45 + grid(vW.xz, 12.5) * 0.8;
      float fade = exp(-d * uFade);
      vec3 col = vec3(0.1, 0.32, 1.0) * g * fade * uBrightness;
      float pool = exp(-d * 0.1) * uGlow;
      col += vec3(0.12, 0.32, 0.95) * pool * (0.06 + g * 0.6);
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
const $sessionHud = document.getElementById('session-hud');
const $sessionState = document.getElementById('session-state');
const $sessionList = document.getElementById('session-list');
const $sessionMore = document.getElementById('session-more');
const impulseFeed = createImpulseFeed(document.getElementById('impulse-feed'));
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
const sessionStatusLabels = {
  running: 'RUNNING',
  'running-unverified': 'RUNNING · UNVERIFIED',
};
let sessionRows = [];
const expandedSessionStats = new Set();
const pageActivityTotals = createPageActivityTotals();

function formatSessionElapsed(elapsedMs) {
  const seconds = Math.floor(Math.min(1_000_000_000, Math.max(0, elapsedMs)) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours >= 1000) return '>999h';
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function tickSessionTimes(now = performance.now()) {
  for (const row of sessionRows) {
    row.time.textContent = formatSessionElapsed(row.elapsedMs + now - row.receivedAt);
  }
}

const sessionStatsDialog = createSessionStatsDialog({
  document,
  dialog: document.getElementById('session-stats-dialog'),
  title: document.getElementById('session-stats-title'),
  content: document.getElementById('session-stats-content'),
  closeButton: document.getElementById('session-stats-close'),
  list: $sessionList,
  fallbackFocus: $status,
  formatElapsed: formatSessionElapsed,
  expandedSessionStats,
  pageActivityTotals,
});

function renderWaitingMarkers(sessionIds) {
  const waiting = Array.isArray(sessionIds) ? sessionIds.slice(0, 8) : [];
  for (let index = 0; index < waitingMarkerGroups.length; index++) {
    const cluster = waitingMarkerGroups[index];
    const id = waiting[index];
    cluster.visible = Boolean(id);
    if (!id) continue;
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const node = hash % N;
    cluster.position.set(nodePos[node * 3], nodePos[node * 3 + 1], nodePos[node * 3 + 2]);
  }
}

$sessionList.addEventListener('click', (event) => {
  sessionStatsDialog.open(event);
});

function renderSessions(state) {
  renderWaitingMarkers(state.connection === 'connected' && state.sourceStatus !== 'unavailable'
    ? state.waitingSessionIds : []);
  const hasHudProjection = Array.isArray(state.hudSessions);
  const sessionRecords = projectActiveHudSessions(state);
  const unknown = state.connection !== 'connected' || state.sourceStatus !== 'available' ||
    state.coverage === 'unknown';
  sessionStatsDialog.update(
    state.sessions ?? [], !unknown, sessionRecords ?? []);
  if (!sessionRecords) {
    $sessionHud.hidden = true;
    clearSessionStats($sessionList, expandedSessionStats);
    $sessionState.textContent = '';
    $sessionMore.textContent = '';
    sessionRows = [];
    return;
  }
  $sessionHud.hidden = false;
  $sessionHud.classList.toggle('is-unknown', unknown);
  $sessionMore.textContent = '';
  sessionRows = [];
  if (unknown) {
    clearSessionStats($sessionList, expandedSessionStats);
    $sessionList.hidden = true;
    $sessionState.textContent = 'COVERAGE UNKNOWN';
    return;
  }

  const sessions = sessionRecords;
  $sessionList.hidden = sessions.length === 0;
  $sessionState.textContent = sessions.length ? '' : 'No active sessions';
  const receivedAt = performance.now();
  sessionRows = renderSessionRows({
    document,
    list: $sessionList,
    sessions,
    expandedSessionStats,
    receivedAt,
    formatElapsed: formatSessionElapsed,
    statusLabels: sessionStatusLabels,
  });
  const visibleRunning = sessions.length;
  const omitted = Math.max(0, (state.runningSessions ?? visibleRunning) - visibleRunning);
  const truncated = hasHudProjection
    ? state.hudSessionsTruncated === true : state.sessionsTruncated === true;
  if (truncated && omitted > 0) $sessionMore.textContent = `+${omitted} more not shown`;
}

// ---------- interaction ----------
let activityState = { connection: 'connecting', sourceStatus: 'unknown', coverage: 'unknown', activeSessions: 0, thinkingSessions: 0, runningSessions: 0, unverifiedRunningSessions: 0, journalFiles: 0, sessions: [] };
const thinkingPulseClock = createThinkingPulseClock();

// Blue running-state stream: observed running work (thinking, tools and
// delegated agents), not a claim of hidden cognition.
function renderThinking(dt) {
  const sessions = Math.min(activityState.runningSessions ?? 0, 32);
  const pulses = thinkingPulseClock.tick(dt, activityState, document.hidden);
  for (let i = 0; i < pulses; i++) {
    const node = (Math.random() * N) | 0;
    const hops = 2 + Math.min(5, Math.floor(Math.log2(sessions + 1)));
    fireFrom(node, hops, 0, -1, 1);
    nodeEnergy[node] = Math.min(1.8, nodeEnergy[node] + 0.45);
  }
}

function renderActivityState(state) {
  if (state.connection !== 'connected' || state.sourceStatus === 'unavailable' ||
      !(state.runningSessions > 0)) thinkingPulseClock.reset();
  if (state.connection !== 'connected') impulseBuffer.clear();
  if (state.sourceStatus === 'unavailable') impulseBuffer.clear();
  timeline.setCoverage(!document.hidden && state.connection === 'connected' &&
    state.sourceStatus === 'available' && state.coverage !== 'partial' &&
    state.coverage !== 'unknown', performance.now(), state.connection === 'connecting');
  activityState = state;
  updateSubagentSummary(state.treeSessions ?? []);
  renderSessions(state);
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
  onState: renderActivityState,
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
    }
  },
});
activityClient.connect();

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

function renderObservedImpulses() {
  const { byCategory, sceneByCategory, entries } = impulseBuffer.drain();
  if (document.hidden) return;
  timeline.add(byCategory, performance.now());
  for (let i = 0; i < entries.length; i++) {
    const { kind, toolName, eventType, count } = entries[i];
    impulseFeed.add(kind, toolName, eventType, count);
  }
  // Counts strengthen a bounded impulse, rather than rendering one per token.
  const plan = categoryBurstPlan.plan(sceneByCategory);
  for (let i = 0; i < plan.length; i++) {
    const node = (Math.random() * N) | 0;
    const intensity = impulseIntensity(plan.counts[i]);
    const kind = plan.kinds[i];
    const category = plan.categories[i];
    if (kind === 2) {
      renderCompletionCascade(node);
      continue;
    }
    const hops = category === CATEGORY_INDEX.error ? 0 : kind === 0 ? 2 + intensity : intensity;
    fireFrom(node, hops, kind, -1, Math.min(3, intensity), category);
    if (kind === 0) nodeEnergy[node] = Math.min(1.8, nodeEnergy[node] + 0.45 * intensity);
    else nodeHot[node] = Math.min(1.2, nodeHot[node] + 0.7 * intensity);
  }
}

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
let hudTimer = 0;
let sessionTimer = 0;
let timelineTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  renderObservedImpulses();
  renderThinking(dt);
  renderSubagentTree(performance.now() / 1000);
  timelineTimer -= dt;
  if (timelineTimer <= 0) {
    timelineTimer = 0.5;
    renderTimeline(performance.now());
  }
  updatePulses(dt);

  const decay = Math.exp(-dt * 2.0);
  for (let i = 0; i < N; i++) {
    nodeEnergy[i] *= decay;
    nodeHot[i] *= decay;
  }
  nodeGeo.attributes.aEnergy.needsUpdate = true;
  nodeGeo.attributes.aHot.needsUpdate = true;

  writeEdgeColors(dt);
  writePulseBuffers();

  // ambience
  const load = Math.min(1, activePulses / 500 + activityState.activeSessions / 64);
  smoothedLoad += (load - smoothedLoad) * Math.min(1, dt * 3);

  const breathe = 1 + Math.sin(now * 0.8) * 0.012;
  brain.scale.setScalar(breathe);
  const waitingGlow = activityState.connection === 'connected' &&
    activityState.sourceStatus !== 'unavailable' && activityState.waitingSessions > 0;
  const waitBreath = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.7));
  coreGlow.material.color.lerpColors(baseCoreColor, waitingCoreColor, waitingGlow ? waitBreath : 0);
  coreGlow.material.opacity = VISUAL.scene.coreOpacity + smoothedLoad * VISUAL.scene.coreLoad;
  if (waitingGlow) coreGlow.material.opacity += 0.025 + waitBreath * 0.025;
  haloGlow.material.opacity = VISUAL.scene.haloOpacity + smoothedLoad * VISUAL.scene.haloLoad;
  bloom.strength = VISUAL.scene.bloomStrength + smoothedLoad * VISUAL.scene.bloomLoad;
  dust.rotation.y = -now * 0.02;
  dust.rotation.x = Math.sin(now * 0.05) * 0.1;

  nodeMat.uniforms.uTime.value = now;
  dustMat.uniforms.uTime.value = now;
  floorMat.uniforms.uTime.value = now;
  floorMat.uniforms.uGlow.value = smoothedLoad * VISUAL.scene.floorGlow;

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.15;
    $impulses.textContent = String(activePulses);
    $load.textContent = Math.round(smoothedLoad * 100) + '%';
  }
  sessionTimer -= dt;
  if (sessionTimer <= 0) {
    sessionTimer = 1;
    tickSessionTimes(performance.now());
  }

  controls.update();
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
});

frame();
