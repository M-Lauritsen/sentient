import { createHud } from './hud-ui.mjs';
import { createActivityPresentation } from './activity-presentation.mjs';
import { createAppearanceController } from './scene/appearance.mjs';
import { CFG } from './scene/structural-config.mjs';
import { createNetworkRenderer } from './scene/network-renderer.mjs';
import { createPulseSystem } from './scene/pulses.mjs';
import { createSubagentRenderer } from './scene/subagents.mjs';
import { createAmbience } from './scene/ambience.mjs';
import { createViewport } from './scene/viewport.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createActivityClient } from './activity-client.mjs';
import { createScenePalette, applyHookColors } from './activity-colors.mjs';
import { VISUAL as VISUAL_DEFAULTS, VISUAL_PRESET, VISUAL_OVERRIDES,
  EFFECTIVE_VISUAL as VISUAL } from './visual-settings.mjs';
import { createVisualSettingsPanel } from './visual-settings-ui.mjs';
import { createLibraryDialog } from './copilot-library-ui.mjs';
import { createNavigationUI } from './navigation-ui.mjs';
import { demoFocusForPath } from './visual-settings-preview.mjs';
import { createPwaLifecycle } from './pwa-lifecycle-client.mjs';
import { getTopologyDesign } from './network-topology-design/index.mjs';

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
controls.autoRotate = VISUAL.camera.autoRotate && getTopologyDesign(VISUAL.topology).presentation.autoOrbit;
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

const networkRenderer = createNetworkRenderer({
  VISUAL, CFG, brain, pixelRatio, getReducedMotion: () => reducedMotion,
  onInstall() { pulses.reset(); subagents.remapAnchors(); },
  followMarkers: (positions) => ambience.followMarkers(positions),
});
const getNetwork = () => networkRenderer.network;
const ambience = createAmbience({ VISUAL, CFG, brain, scene, bloom, pixelRatio, getNetwork, document });
const pulses = createPulseSystem({ VISUAL, CFG, SCENE_RGB, brain, pixelRatio, getNetwork });
const subagents = createSubagentRenderer({
  VISUAL, SCENE_RGB, brain, pixelRatio, getNetwork, getActivityState: () => hud.activityState,
  getReducedMotion: () => reducedMotion, document, performance,
});
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (event) => {
  reducedMotion = event.matches;
  if (reducedMotion) subagents.finishTransitions();
});
const viewport = createViewport({
  window, document, camera, renderer, composer, bloom, getReducedMotion: () => reducedMotion,
});

const hud = createHud({
  VISUAL, document, window, performance,
  invalidateObserved: () => { pulses.invalidateObserved(); presentation.resetThinking(); presentation.clearImpulses(); },
  resetThinking: () => presentation.resetThinking(),
  clearImpulses: () => presentation.clearImpulses(),
  updateSubagentSummary: subagents.updateSubagentSummary,
  renderWaitingMarkers: ambience.renderWaitingMarkers,
});
const presentation = createActivityPresentation({
  VISUAL, document, performance, hud, pulses, subagents, ambience, getNetwork,
  getActivityState: () => hud.activityState,
});
const appearance = createAppearanceController({
  VISUAL, SCENE_RGB, document, scene, camera, controls, bloom, networkRenderer, pulses, subagents, ambience,
  getNetwork, getActivityState: () => hud.activityState, isLibraryOpen: () => libraryModalOpen,
});

const activityClient = createActivityClient({
  canAccept: () => lifecycleClient?.checkFresh() ?? false,
  onState: (state) => {
    hud.renderActivityState(state);
    presentation.markDemoDirty();
  },
  onTree: subagents.applySubagentTree,
  onActivity: presentation.receiveActivity,
});
let lifecycleClient;

// ---------- loop ----------
const clock = new THREE.Clock();

function frame() {
  lifecycleClient?.checkFresh();
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  const design = getTopologyDesign(VISUAL.topology).presentation;
  brain.rotation.x = design.rotationX;
  brain.rotation.z = design.rotationZ;
  networkRenderer.updateNetworkMotion(dt);
  presentation.renderObservedImpulses();
  presentation.renderDemoActivity(dt);
  viewport.updateSceneFraming(dt);
  presentation.renderThinking(dt);
  subagents.renderSubagentTree(performance.now() / 1000);
  hud.updateTimeline(dt);
  pulses.updatePulses(dt);

  networkRenderer.decayNodes(dt);

  networkRenderer.writeEdgeColors(dt);
  pulses.writePulseBuffers();

  ambience.update(dt, now, pulses.activePulses, hud.activityState, presentation.demoFrame);
  networkRenderer.nodeMat.uniforms.uTime.value = now;

  hud.updateCounters(dt, pulses.activePulses, pulses.demoPulses);

  if (!libraryModalOpen) controls.update();
  composer.render();
  requestAnimationFrame(frame);
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
      return appearance.applyVisualSettings(candidate);
    } finally {
      presentation.markDemoDirty();
    }
  },
  onOpenChange(open) {
    hud.workspaceUI.setAppearanceOpen(open);
    presentation.setDemoRunning(open && !reducedMotion);
    viewport.setAppearanceOpen(open);
  },
  // Hovering or focusing a setting narrows the demo to the matching effect;
  // the hover sweep is motion, so reduced motion keeps only the focus.
  previewMode: () => presentation.previewMode(reducedMotion),
  onPreviewFocus: (path) => presentation.setDemoFocus(demoFocusForPath(path)),
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
