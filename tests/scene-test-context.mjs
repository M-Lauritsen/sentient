import vm from 'node:vm';
import { buildNetwork as buildNetworkGraph, updateNetworkGeometry } from '../scene/network.mjs';
import { getTopologyDesign, createTopologyMotionState } from '../network-topology-design/index.mjs';
import * as THREE from 'three';
import { CFG } from '../scene/structural-config.mjs';
import { createScenePalette } from '../activity/activity-colors.mjs';
import { createPulseSystem } from '../scene/pulses.mjs';
import { createSubagentRenderer } from '../scene/subagents.mjs';
import { createActivityPresentation } from '../activity/activity-presentation.mjs';
import { createNetworkRenderer } from '../scene/network-renderer.mjs';
import { createAmbience } from '../scene/ambience.mjs';
import { createViewport } from '../scene/viewport.mjs';
import { createActivityStateRenderer, createTimelineRenderer } from '../ui/hud-ui.mjs';
import { VISUAL } from '../visual-settings.mjs';

export function createSceneContext(values) {
  const context = vm.createContext(Object.assign(values, {
    buildNetworkGraph, updateNetworkGeometry, getTopologyDesign, createTopologyMotionState,
  }));
  const components = {};
  const options = () => ({
    THREE, VISUAL,
    brain: new THREE.Group(), scene: new THREE.Scene(), bloom: {},
    pixelRatio: 1, SCENE_RGB: createScenePalette(context.VISUAL ?? VISUAL),
    document: {
      hidden: false, addEventListener() {},
      getElementById: () => ({ addEventListener() {} }),
      createElement: () => ({
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
        }),
      }),
    },
    performance: { now: () => 1000 },
    ...context,
    CFG: { ...CFG, dust: 2, maxPulses: context.P ?? 16, trail: context.T ?? 7, ...context.CFG },
    getNetwork: () => context,
    getActivityState: () => context.activityState,
    getReducedMotion: () => context.reducedMotion,
    random: () => (context.Math ?? Math).random(),
  });
  const expose = (owner) => {
    for (const [name, value] of Object.entries(owner)) {
      if (typeof value === 'function' && !context[name]) context[name] = value;
    }
  };
  const pulseNames = ['otherEnd', 'spawnPulse', 'fireFrom', 'updatePulses', 'writePulseBuffers'];
  const subagentNames = ['addSubagentBranch', 'retireSubagentBranch', 'applySubagentTree',
    'renderSubagentTree', 'updateSubagentSummary'];
  const activityNames = ['renderThinking', 'renderCompletionCascade', 'renderImpactBurst',
    'renderObservedImpulses', 'renderHookPulses', 'renderDemoActivity', 'observedWaitingIds', 'receiveActivity'];
  context.invokeScene = (name, args) => {
    if (pulseNames.includes(name) || name === 'initializePulses') {
      if (!components.pulses) {
        const source = options();
        const owner = components.pulses = createPulseSystem(source);
        const snapshots = Object.fromEntries(Object.keys(owner.buffers)
          .filter(key => ArrayBuffer.isView(context[key]) || Array.isArray(context[key]))
          .map(key => [key, Array.from(context[key])]));
        for (let index = 0; index < (context.activePulses ?? context.pActive?.filter(Boolean).length ?? 0); index++) {
          owner.spawnPulse(0, 0, 0, 0, 0);
        }
        for (const [key, value] of Object.entries(snapshots)) owner.buffers[key].set(value);
        Object.assign(context, owner.buffers);
        for (const key of ['activePulses', 'demoPulses', 'demoSpawn']) {
          Object.defineProperty(context, key, {
            configurable: true,
            get: () => owner[key],
            set: value => {
              if (key === 'demoSpawn') owner.demoSpawn = value;
              else if (value !== owner[key]) throw new Error(`Use real pulse allocation to set ${key}.`);
            },
          });
        }
        expose(owner);
      }
      return name === 'initializePulses' ? components.pulses : components.pulses[name](...args);
    }
    if (subagentNames.includes(name) || name === 'initializeSubagents') {
      if (!components.subagents) {
        const source = options();
        components.subagents = createSubagentRenderer(source);
        Object.assign(context, components.subagents.buffers);
        expose(components.subagents);
      }
      return name === 'initializeSubagents' ? components.subagents : components.subagents[name](...args);
    }
    if (activityNames.includes(name)) {
      if (!components.presentation) {
        const source = options();
        const doc = context.document;
        source.document = {
          get hidden() { return doc.hidden; },
          addEventListener() {},
          getElementById: () => ({ addEventListener() {} }),
        };
        source.hud = {
          timeline: context.timeline, impulseFeed: context.impulseFeed,
          acceptActivity: context.acceptActivity ?? (() => {}),
        };
        source.pulses = {
          fireFrom: (...args) => context.fireFrom(...args),
          otherEnd: (...args) => context.otherEnd(...args),
          get demoPulses() { return context.demoPulses ?? 0; },
          set demoSpawn(value) { context.demoSpawn = value; },
        };
        source.ambience = { renderWaitingMarkers: (...args) => context.renderWaitingMarkers?.(...args) };
        components.presentation = createActivityPresentation(source);
        expose(components.presentation);
      }
      if (name === 'renderObservedImpulses' && !args.length) args = [context.impulseBuffer];
      return components.presentation[name](...args);
    }
    if (name === 'writeEdgeColors' || name === 'decayNodes') {
      if (!components.network) {
        const source = options();
        source.onInstall = () => {};
        source.followMarkers = () => {};
        if (!source.brain.add) source.brain = new THREE.Group();
        components.network = createNetworkRenderer(source);
        components.network.installNetwork({ ...components.network.network, ...context });
        context.edgeLines = components.network.edgeLines;
      }
      return components.network[name](...args);
    }
    if (name === 'buildNetwork') return buildNetworkGraph(args[0], context.CFG, {
      random: () => context.Math.random(), three: context.THREE,
    });
    if (name === 'renderWaitingMarkers' || name === 'radialTexture') {
      if (!components.ambience) {
        components.ambience = createAmbience(options());
        Object.assign(context, components.ambience.resources);
      }
      return components.ambience[name](...args);
    }
    if (name === 'renderTimeline') {
      components.timeline ??= createTimelineRenderer(context);
      return components.timeline(...args);
    }
    if (name === 'renderActivityState') {
      components.status ??= createActivityStateRenderer({
        ...context, onState: value => { context.activityState = value; },
        resetThinking: () => context.thinkingPulseClock.reset(),
        clearImpulses: () => context.impulseBuffer.clear(),
        invalidateObserved: () => {
          context.invokeScene('initializePulses', []).invalidateObserved();
          context.thinkingPulseClock.reset();
          context.impulseBuffer.clear();
        },
      });
      return components.status(...args);
    }
    if (name === 'updateSceneFraming' || name === 'updateFramingTarget') {
      if (!components.viewport) {
        const source = options();
        source.window = context.window;
        source.window.addEventListener ??= () => {};
        source.document = { getElementById: () => context.visualSettingsDialog };
        components.viewport = createViewport(source);
      }
      if (name === 'updateFramingTarget') return components.viewport.setAppearanceOpen(context.framingOpen);
      return components.viewport.updateSceneFraming(...args);
    }
    throw new Error(`No imported component method: ${name}`);
  };
  return context;
}

export function sceneFunction(name) {
  return `function ${name}(...args) { return invokeScene('${name}', args); }\n`;
}
