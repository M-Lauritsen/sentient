import * as THREE from 'three';
import { validateVisualSettings } from '../appearance/visual-config.mjs';
import { createScenePalette, applyHookColors } from '../activity/activity-colors.mjs';
import { getTopologyDesign } from '../network-topology-design/index.mjs';

export function createAppearanceController({ VISUAL, SCENE_RGB, document, scene, camera, controls, bloom, networkRenderer, pulses, subagents, ambience, getNetwork, getActivityState, isLibraryOpen, random = Math.random }) {
  function applyVisualSettings(candidate) {
    const { N, E, nodeSize, nodeGeo, edgeBase } = getNetwork();
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
      ? Float32Array.from({ length: N }, () => random() < candidate.nodes.largeChance
        ? candidate.nodes.largeSizeMin + random() * candidate.nodes.largeSizeRange
        : candidate.nodes.baseSizeMin + random() * candidate.nodes.baseSizeRange)
      : null;
    const nextEdgeBase = !topologyChanged && (changed('scene.edgeVariationMin') || changed('scene.edgeVariationRange'))
      ? Float32Array.from({ length: E }, () =>
        candidate.scene.edgeVariationMin + random() * candidate.scene.edgeVariationRange)
      : null;
    const nextGlowTexture = changed('scene.glowKnee') || changed('scene.glowKneeOpacity')
      ? ambience.radialTexture(candidate) : null;
    const nextBackground = changed('scene.background') ? new THREE.Color(candidate.scene.background) : null;
    let nextNetwork;
    try {
      nextNetwork = topologyChanged ? networkRenderer.buildNetwork(candidate) : null;
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
    controls.autoRotate = candidate.camera.autoRotate && getTopologyDesign(candidate.topology).presentation.autoOrbit;
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

    if (nextNetwork) networkRenderer.installNetwork(nextNetwork);
    if (nextBackground) scene.background = nextBackground;
    if (nextNodeSize) {
      nodeSize.set(nextNodeSize);
      nodeGeo.attributes.aSize.needsUpdate = true;
    }
    if (nextEdgeBase) edgeBase.set(nextEdgeBase);
    SCENE_RGB.set(nextSceneRgb);
    applyHookColors(document, VISUAL.hooks);

    networkRenderer.applySettings();

    pulses.applySettings(previous, changed);

    ambience.applySettings(nextGlowTexture);
    subagents.applySettings(changed);

    bloom.strength = VISUAL.scene.bloomStrength;
    bloom.radius = VISUAL.scene.bloomRadius;
    bloom.threshold = VISUAL.scene.bloomThreshold;
    ambience.renderWaitingMarkers((getActivityState().connection === 'connected' || getActivityState().connection === 'recovering') &&
      getActivityState().sourceStatus !== 'unavailable'
      ? getActivityState().waitingSessionIds : []);
    if (!isLibraryOpen()) controls.update();
    return true;
  }

  return {
    applyVisualSettings,
  };
}
