import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createActivityClient, createImpulseFeed, createImpulseBuffer, impulseIntensity,
  projectActiveHudSessions,
  createThinkingPulseClock } from './activity-client.mjs';
import { clearSessionStats, createSessionStatsDialog, renderSessionRows } from './session-stats-ui.mjs';

const CFG = {
  radius: 10,
  nodes: 1200,
  neighbours: 3,
  maxEdgeLen: 4.5,
  dust: 4000,
  maxPulses: 1600,
  trail: 7,
};

// Pulse kinds: 0 = observed thinking, 1 = observed tool step, 2 = accepted completion.
const KIND_COLOR = [
  [0.45, 0.72, 1.0],
  [1.0, 0.62, 0.22],
  [1.0, 0.5, 0.12],
];

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
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.45, 0.12);
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
const edgeHot = new Float32Array(E); // orange glow
const edgeCool = new Float32Array(E); // blue glow
const edgeBase = new Float32Array(E);

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
  uniforms: { uScale: { value: 95 * pixelRatio }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute float aEnergy;
    attribute float aHot;
    attribute float aSize;
    uniform float uScale;
    uniform float uTime;
    varying float vEnergy;
    varying float vHot;
    varying float vTwinkle;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      vTwinkle = 0.75 + 0.25 * sin(uTime * 1.7 + position.x * 3.1 + position.y * 2.3);
      gl_PointSize = aSize * (1.0 + aEnergy * 2.2) * uScale / -mv.z;
      vEnergy = aEnergy;
      vHot = aHot;
    }`,
  fragmentShader: /* glsl */ `
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
      vec3 col = mix(base, hot, clamp(vHot * 1.4, 0.0, 1.0));
      col = mix(col, white, clamp(max(vEnergy, vHot) - 0.7, 0.0, 1.0));
      gl_FragColor = vec4(col * core * (0.4 * vTwinkle + max(vEnergy, vHot) * 1.8), 1.0);
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
    uniforms: { uTime: { value: 0 }, uScale: { value: 40 * pixelRatio } },
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
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.2, 0.45, 1.0) * vA * 0.18 * smoothstep(0.5, 0.0, d), 1.0);
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
    opacity: 0.015,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
coreGlow.scale.setScalar(16);
brain.add(coreGlow);
const baseCoreColor = new THREE.Color(0x3d8bff);
const waitingCoreColor = new THREE.Color(0xff4fd8);
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
    opacity: 0.025,
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
  uniforms: { uScale: { value: 110 * pixelRatio } },
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

function otherEnd(e, n) {
  return edgeA[e] === n ? edgeB[e] : edgeA[e];
}

function spawnPulse(from, edge, hops, kind) {
  for (let tries = 0; tries < P; tries++) {
    const s = pCursor;
    pCursor = (pCursor + 1) % P;
    if (pActive[s]) continue;
    pActive[s] = 1;
    pEdge[s] = edge;
    pFrom[s] = from;
    pT[s] = 0;
    pSpeed[s] = kind === 2 ? 11 + Math.random() * 5 : 4 + Math.random() * 4;
    pHops[s] = hops;
    pKind[s] = kind;
    activePulses++;
    return true;
  }
  return false;
}

function fireFrom(node, hops, kind, avoid = -1, count = 1) {
  const edges = adjacency[node].filter((e) => otherEnd(e, node) !== avoid);
  for (let i = edges.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  const n = Math.min(count, edges.length);
  for (let i = 0; i < n; i++) spawnPulse(node, edges[i], hops, kind);
}

function updatePulses(dt) {
  for (let s = 0; s < P; s++) {
    if (!pActive[s]) continue;
    const e = pEdge[s];
    const kind = pKind[s];
    pT[s] += (pSpeed[s] * dt) / edgeLen[e];
    if (kind === 2) edgeHot[e] = Math.max(edgeHot[e], 1.0);
    else if (kind === 1) edgeHot[e] = Math.max(edgeHot[e], 0.45);
    else edgeCool[e] = Math.max(edgeCool[e], 0.6);

    if (pT[s] >= 1) {
      const from = pFrom[s];
      const hops = pHops[s];
      const to = otherEnd(e, from);
      pActive[s] = 0;
      activePulses--;
      nodeEnergy[to] = Math.min(1.8, nodeEnergy[to] + (kind === 2 ? 0.9 : 0.5));
      if (hops > 0) {
        const branch = kind === 2 ? (Math.random() < 0.42 ? 2 : 1) : kind === 0 ? 1 : 0;
        if (branch > 0) fireFrom(to, hops - 1, kind, from, branch);
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
    const col = KIND_COLOR[pKind[s]];
    const head = pKind[s] === 2 ? 3.2 : 2.2;
    const spacing = pKind[s] === 2 ? 0.07 : 0.05;
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
      const f = Math.pow(1 - j / T, 1.6);
      const bright = j === 0 ? 1.6 : f;
      pulseCol[idx * 3] = col[0] * bright;
      pulseCol[idx * 3 + 1] = col[1] * bright;
      pulseCol[idx * 3 + 2] = col[2] * bright;
      pulseSize[idx] = head * (0.35 + 0.65 * f);
    }
  }
  pulseGeo.attributes.position.needsUpdate = true;
  pulseGeo.attributes.aColor.needsUpdate = true;
  pulseGeo.attributes.aSize.needsUpdate = true;
}

function writeEdgeColors(dt) {
  const decay = Math.exp(-dt * 2.4);
  for (let e = 0; e < E; e++) {
    edgeHot[e] *= decay;
    edgeCool[e] *= decay;
    const b = edgeBase[e];
    const h = edgeHot[e];
    const c = edgeCool[e];
    const r = 0.012 * b + h * 0.95 + c * 0.2;
    const g = 0.04 * b + h * 0.4 + c * 0.5;
    const bl = 0.13 * b + h * 0.08 + c * 1.0;
    const o = e * 6;
    edgeColors[o] = edgeColors[o + 3] = r;
    edgeColors[o + 1] = edgeColors[o + 4] = g;
    edgeColors[o + 2] = edgeColors[o + 5] = bl;
  }
  edgeGeo.attributes.color.needsUpdate = true;
}

// ---------- shockwaves ----------
const shockGeo = new THREE.SphereGeometry(1, 48, 32);
const shocks = [];
function makeShockMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vRim;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vRim;
      void main() {
        float a = pow(vRim, 3.0) * uOpacity;
        gl_FragColor = vec4(vec3(1.0, 0.5, 0.15) * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
function spawnShock(node) {
  let s = shocks.find((x) => !x.active);
  if (!s) {
    if (shocks.length >= 8) s = shocks[0];
    else {
      s = { mesh: new THREE.Mesh(shockGeo, makeShockMaterial()), center: new THREE.Vector3() };
      brain.add(s.mesh);
      shocks.push(s);
    }
  }
  s.active = true;
  s.r = 0.2;
  s.center.fromArray(nodePos, node * 3);
  s.mesh.position.copy(s.center);
  s.mesh.visible = true;
}
function updateShocks(dt) {
  const maxR = CFG.radius * 2.2;
  for (const s of shocks) {
    if (!s.active) continue;
    s.r += dt * 13;
    const fade = 1 - s.r / maxR;
    if (fade <= 0) {
      s.active = false;
      s.mesh.visible = false;
      continue;
    }
    s.mesh.scale.setScalar(s.r);
    s.mesh.material.uniforms.uOpacity.value = fade * fade * 0.9;
    const cx = s.center.x, cy = s.center.y, cz = s.center.z;
    for (let i = 0; i < N; i++) {
      const dx = nodePos[i * 3] - cx, dy = nodePos[i * 3 + 1] - cy, dz = nodePos[i * 3 + 2] - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (Math.abs(d - s.r) < 0.7)       nodeHot[i] = Math.max(nodeHot[i], 0.65 * fade);
    }
  }
}

// ---------- grid floor ----------
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uRipple: { value: 999 }, uGlow: { value: 0.3 } },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uRipple;
    uniform float uGlow;
    varying vec3 vW;
    float grid(vec2 p, float s) {
      vec2 q = p / s;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      return 1.0 - min(min(g.x, g.y), 1.0);
    }
    void main() {
      float d = length(vW.xz);
      float g = grid(vW.xz, 2.5) * 0.45 + grid(vW.xz, 12.5) * 0.8;
      float fade = exp(-d * 0.028);
      vec3 col = vec3(0.1, 0.32, 1.0) * g * fade * 0.22;
      float ripple = exp(-pow(d - uRipple * 22.0, 2.0) * 0.05) * exp(-uRipple * 1.2);
      float pool = exp(-d * 0.1) * uGlow;
      col += vec3(0.12, 0.32, 0.95) * pool * (0.06 + g * 0.6);
      col += vec3(1.0, 0.45, 0.1) * ripple * (0.1 + g * 1.2);
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
const sessionStatusLabels = {
  running: 'RUNNING',
  'running-unverified': 'RUNNING · UNVERIFIED',
};
let sessionRows = [];
const expandedSessionStats = new Set();

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
let reactTimer = 0;
let shake = 0;
let rippleT = 999;
function celebrateCompletion() {
  const node = (Math.random() * N) | 0;
  nodeHot[node] = 2.5;
  fireFrom(node, 7, 2, -1, Math.min(8, adjacency[node].length));
  for (const e of adjacency[node].slice(0, 4)) fireFrom(otherEnd(e, node), 5, 2, node, 2);
  spawnShock(node);
  reactTimer = 1.8;
  shake = 0.22;
  rippleT = 0;
}

let activityState = { connection: 'connecting', sourceStatus: 'unknown', coverage: 'unknown', activeSessions: 0, thinkingSessions: 0, runningSessions: 0, unverifiedRunningSessions: 0, journalFiles: 0 };
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
  activityState = state;
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
  onActivity: (activity) => {
    if (!document.hidden) impulseBuffer.add(activity);
  },
});
activityClient.connect();

document.addEventListener('visibilitychange', () => {
  impulseBuffer.clear();
  if (document.hidden) {
    thinkingPulseClock.reset();
  }
});

function renderObservedImpulses() {
  const { blue, orange, completions, entries } = impulseBuffer.drain();
  if (document.hidden) return;
  for (const { kind, toolName, eventType, count } of entries) {
    impulseFeed.add(kind, toolName, eventType, count);
  }
  // Counts strengthen a bounded impulse, rather than rendering one per token.
  if (blue > 0) {
    const node = (Math.random() * N) | 0;
    const intensity = impulseIntensity(blue);
    fireFrom(node, 2 + intensity, 0, -1, Math.min(3, intensity));
    nodeEnergy[node] = Math.min(1.8, nodeEnergy[node] + 0.45 * intensity);
  }
  if (orange > 0) {
    const node = (Math.random() * N) | 0;
    const intensity = impulseIntensity(orange);
    fireFrom(node, intensity, 1, -1, Math.min(3, intensity));
    nodeHot[node] = Math.min(1.2, nodeHot[node] + 0.7 * intensity);
  }
  if (completions > 0) celebrateCompletion();
}

// ---------- loop ----------
const clock = new THREE.Clock();
let smoothedLoad = 0;
let hudTimer = 0;
let sessionTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  renderObservedImpulses();
  renderThinking(dt);
  updatePulses(dt);
  updateShocks(dt);

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
  reactTimer = Math.max(0, reactTimer - dt);
  shake *= Math.exp(-dt * 6);
  rippleT += dt;

  const breathe = 1 + Math.sin(now * 0.8) * 0.012;
  brain.scale.setScalar(breathe);
  brain.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  const waitingGlow = activityState.connection === 'connected' &&
    activityState.sourceStatus !== 'unavailable' && activityState.waitingSessions > 0;
  const waitBreath = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.7));
  coreGlow.material.color.lerpColors(baseCoreColor, waitingCoreColor, waitingGlow ? waitBreath : 0);
  coreGlow.material.opacity = 0.015 + smoothedLoad * 0.12 + reactTimer * 0.08;
  if (waitingGlow) coreGlow.material.opacity += 0.025 + waitBreath * 0.025;
  haloGlow.material.opacity = 0.025 + smoothedLoad * 0.03;
  bloom.strength = 0.85 + smoothedLoad * 0.3 + reactTimer * 0.2;
  dust.rotation.y = -now * 0.02;
  dust.rotation.x = Math.sin(now * 0.05) * 0.1;

  nodeMat.uniforms.uTime.value = now;
  dustMat.uniforms.uTime.value = now;
  floorMat.uniforms.uTime.value = now;
  floorMat.uniforms.uRipple.value = rippleT;
  floorMat.uniforms.uGlow.value = smoothedLoad * 0.5 + reactTimer * 0.2;

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
