import { createNetworkRenderer } from '../scene/network-renderer.mjs';
import { createPulseSystem } from '../scene/pulses.mjs';
import { createSubagentRenderer } from '../scene/subagents.mjs';
import { createAmbience } from '../scene/ambience.mjs';
import { createAppearanceController } from '../scene/appearance.mjs';

export function installSceneHarness(context) {
  context.reducedMotion = false;
  const networkRenderer = createNetworkRenderer({
    ...context,
    getReducedMotion: () => context.reducedMotion,
    random: () => context.Math.random(),
    three: new Proxy({}, { get: (_, name) => context.THREE[name] }),
    onInstall() { pulses.reset(); subagents.remapAnchors(); },
    followMarkers: (positions) => ambience.followMarkers(positions),
  });
  const getNetwork = () => networkRenderer.network;
  const ambience = createAmbience({
    ...context, getNetwork, random: () => context.Math.random(),
  });
  const pulses = createPulseSystem({
    ...context, getNetwork, random: () => context.Math.random(),
  });
  const subagents = createSubagentRenderer({
    ...context, getNetwork,
    getActivityState: () => context.activityState,
    getReducedMotion: () => context.reducedMotion,
  });
  const appearance = createAppearanceController({
    ...context, networkRenderer, pulses, subagents, ambience, getNetwork,
    getActivityState: () => context.activityState,
    isLibraryOpen: () => context.libraryModalOpen,
    random: () => context.Math.random(),
  });
  Object.assign(context, networkRenderer, ambience, subagents, pulses, appearance,
    pulses.buffers, subagents.buffers, ambience.resources);
  context.updateAmbience = ambience.update;
  for (const key of Object.keys(getNetwork())) {
    Object.defineProperty(context, key, {
      configurable: true, get: () => getNetwork()[key],
    });
  }
  for (const key of ['activePulses', 'demoPulses', 'demoSpawn']) {
    Object.defineProperty(context, key, {
      configurable: true, get: () => pulses[key], set: value => { pulses[key] = value; },
    });
  }
  context.network = () => ({
    ...getNetwork(), ...pulses.buffers, ...subagents.buffers, ...ambience.resources,
    nodePoints: networkRenderer.nodePoints, edgeLines: networkRenderer.edgeLines,
    activePulses: pulses.activePulses,
  });
  return { networkRenderer, pulses, subagents, ambience, appearance };
}
