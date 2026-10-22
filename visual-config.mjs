import { HOOK_DEFAULTS } from './activity-colors.mjs';

export const WAVE_DEFAULTS = Object.freeze({ amplitude: 1.6, wavelength: 10, speed: 0.8 });

const SHAPE = {
  waves: {
    number: 'amplitude wavelength speed',
  },
  hooks: {
    hex: 'startColor endColor otherColor',
    number: 'startImpact endImpact otherImpact',
  },
  camera: {
    number: 'fov damping minDistance maxDistance autoRotateSpeed',
    vector3: 'position target',
    boolean: 'autoRotate',
  },
  nodes: {
    number: 'count scale size activeGrowth idleBrightness activeBrightness hotMix whiteThreshold whiteMix baseSizeMin baseSizeRange largeChance largeSizeMin largeSizeRange energyCap decay twinkleBase twinkleAmplitude twinkleSpeed coreFalloff',
    vector3: 'twinkleSpatial',
    rgb: 'baseColor hotColor whiteColor',
  },
  pulses: {
    number: 'scale head completionHead trailSpacing completionTrailSpacing speedMin speedRange headBrightness trailFalloff minTrailSize coreFalloff nodeEnergy thinkingEdgeIntensity stepEdgeIntensity',
  },
  running: {
    number: 'pulsesPerSecondPerSession maxSessions baseHops maxExtraHops spread nodeEnergy',
  },
  activity: {
    number: 'maxIntensity maxSpread reasoningBaseHops errorHops reasoningEnergy stepHeat stepHeatCap',
  },
  subagents: {
    number: 'growSeconds fadeSeconds tipSize fadingTipSize anchorSize initialIntensity intensityPerSecond maxIntensity runningAnchorIntensity waitingAnchorIntensity stuckAnchorIntensity quietAnchorIntensity failureFlashFraction failureFlashIntensity completionFlashFraction completionFlashBase completionFlashGrowth',
    rgb: 'runningAnchorColor stuckAnchorColor quietAnchorColor clearedLineColor clearedTipColor',
  },
  waiting: {
    number: 'markerOpacity markerSize breathSpeed colorMixMin colorMixRange opacityBase opacityBreath',
  },
  dust: {
    number: 'scale twinkleBase twinkleAmplitude twinkleSpeed twinklePhase twinklePower rotationSpeed tiltSpeed tiltAmplitude',
    rgb: 'color',
  },
  floor: {
    number: 'fineSpacing fineIntensity coarseSpacing coarseIntensity poolFade poolBase poolGrid',
    rgb: 'color poolColor',
  },
  completion: {
    number: 'hops neighbourHops spread neighbourSeeds neighbourSpread branchChance seedHeat nodeEnergy edgeIntensity',
  },
  impact: {
    number: 'minMs maxMs minHops maxHops minSpread maxSpread neighbourSeeds neighbourHops neighbourSpread branchChance seedHeat nodeEnergy edgeIntensity head',
  },
  scene: {
    enum: 'edgeVisibility',
    number: 'categoryBrightness edgeVariationMin edgeVariationRange breathSpeed breathAmplitude loadPulseScale loadSessionScale loadSmoothing coreSize haloSize glowKnee glowKneeOpacity bloomStrength bloomLoad bloomRadius bloomThreshold edgeFade coreOpacity coreLoad haloOpacity haloLoad dustBrightness floorBrightness floorFade floorGlow',
    rgb: 'edgeBaseColor',
    hex: 'background coreColor haloColor',
  },
  effects: {
    boolean: 'dust floor latticeBreathing waitingGlow waitingMarkers subagentTransitions',
  },
};

const INTEGER_PATHS = new Set([
  'nodes.count',
  'running.maxSessions', 'running.baseHops', 'running.maxExtraHops', 'running.spread',
  'activity.maxIntensity', 'activity.maxSpread', 'activity.reasoningBaseHops', 'activity.errorHops',
  'completion.hops', 'completion.neighbourHops', 'completion.spread', 'completion.neighbourSeeds',
  'completion.neighbourSpread', 'impact.minHops', 'impact.maxHops', 'impact.minSpread',
  'impact.maxSpread', 'impact.neighbourSeeds', 'impact.neighbourHops', 'impact.neighbourSpread',
]);
const POSITIVE_PATHS = new Set([
  'camera.minDistance', 'camera.maxDistance',
  'nodes.coreFalloff', 'pulses.trailFalloff', 'pulses.coreFalloff',
  'subagents.growSeconds', 'subagents.fadeSeconds',
  'dust.twinklePower', 'floor.fineSpacing', 'floor.coarseSpacing',
  'scene.loadPulseScale', 'scene.loadSessionScale',
  'impact.minMs', 'impact.maxMs',
]);
const ZERO_TO_ONE_PATHS = new Set([
  'camera.damping', 'nodes.largeChance', 'nodes.twinkleBase',
  'pulses.trailSpacing', 'pulses.completionTrailSpacing', 'pulses.minTrailSize',
  'subagents.failureFlashFraction', 'subagents.completionFlashFraction',
  'waiting.markerOpacity', 'waiting.colorMixMin', 'waiting.colorMixRange',
  'waiting.opacityBase', 'waiting.opacityBreath',
  'dust.twinkleBase', 'dust.twinkleAmplitude',
  'completion.branchChance', 'impact.branchChance',
  'scene.glowKneeOpacity', 'scene.bloomRadius', 'scene.bloomThreshold',
  'scene.coreOpacity', 'scene.coreLoad', 'scene.haloOpacity', 'scene.haloLoad',
]);
const OPACITY_PATHS = new Set([
  'waiting.markerOpacity', 'waiting.opacityBase', 'waiting.opacityBreath',
  'scene.glowKneeOpacity', 'scene.coreOpacity', 'scene.coreLoad',
  'scene.haloOpacity', 'scene.haloLoad',
]);
const SIGNED_PATHS = new Set(['camera.autoRotateSpeed', 'dust.rotationSpeed']);
const HEX_PATHS = new Set(['scene.background', 'scene.coreColor', 'scene.haloColor']);
const STRICT_UNIT_PATHS = new Set(['scene.glowKnee']);
const MAX_ONE_EXCLUSIVE_PATHS = new Set(['scene.breathAmplitude']);

function unitFor(path) {
  if (path === 'waves.amplitude' || path === 'waves.wavelength') return 'world units';
  if (path === 'waves.speed') return 'radians/second';
  if (path === 'nodes.count') return 'nodes';
  if (path === 'camera.fov') return 'degrees';
  if (path === 'camera.position' || path === 'camera.target' ||
      path === 'dust.tiltAmplitude' || path === 'floor.fineSpacing' || path === 'floor.coarseSpacing') {
    return 'world units';
  }
  if (path.endsWith('Seconds')) return 'seconds';
  if (path.endsWith('Ms')) return 'milliseconds';
  if (path === 'scene.floorFade' || path === 'floor.poolFade') return 'per world unit';
  if (path === 'subagents.intensityPerSecond') return 'intensity/second';
  if (path === 'camera.autoRotateSpeed') return 'orbit speed multiplier';
  if (path.includes('Speed') || path.endsWith('Speed')) return 'radians/second';
  if (path === 'pulses.speedMin' || path === 'pulses.speedRange') return 'world units/second';
  if (path === 'nodes.twinkleSpatial') return 'phase/world unit';
  return 'unitless';
}

export const VISUAL_SETTING_DEFINITIONS = Object.freeze(
  Object.entries(SHAPE).flatMap(([group, types]) =>
    Object.entries(types).flatMap(([type, names]) =>
      names.split(' ').map((name) => {
        const path = `${group}.${name}`;
        const label = `${group} ${name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`;
        const editor = type === 'enum' ? 'select' : type === 'boolean' ? 'checkbox'
          : type === 'rgb' || type === 'hex' ? 'color'
              : type === 'vector3' ? 'vector3' : 'number';
        const constraints = {
          ...(INTEGER_PATHS.has(path) ? { integer: true } : {}),
          ...(POSITIVE_PATHS.has(path) ? { exclusiveMinimum: 0 } : {}),
          ...(ZERO_TO_ONE_PATHS.has(path) ? { minimum: 0, maximum: 1 } : {}),
          ...(!SIGNED_PATHS.has(path) && type === 'number' && !ZERO_TO_ONE_PATHS.has(path) &&
              !POSITIVE_PATHS.has(path) ? { minimum: 0 } : {}),
          ...(path === 'activity.maxIntensity' ? { minimum: 1 } : {}),
          ...(group === 'hooks' && type === 'number' ? { minimum: 0, maximum: 4 } : {}),
          ...(path === 'nodes.count' ? { minimum: 2, maximum: 4000 } : {}),
          ...(path === 'waves.amplitude' ? { minimum: 0, maximum: 3 } : {}),
          ...(path === 'waves.wavelength' ? { minimum: 4, maximum: 40 } : {}),
          ...(path === 'waves.speed' ? { minimum: 0, maximum: 3 } : {}),
          ...(STRICT_UNIT_PATHS.has(path) ? { exclusiveMinimum: 0, exclusiveMaximum: 1 } : {}),
          ...(MAX_ONE_EXCLUSIVE_PATHS.has(path) ? { exclusiveMaximum: 1 } : {}),
        };
        return Object.freeze({
          path, type, label, unit: unitFor(path), editor, constraints: Object.freeze(constraints),
          ...(type === 'enum' ? { options: Object.freeze(['always', 'active', 'hidden']) } : {}),
        });
      })))
    .concat([
      Object.freeze({
        path: 'topology',
        type: 'enum',
        label: 'topology',
        unit: 'unitless',
        editor: 'select',
        constraints: Object.freeze({}),
        options: Object.freeze(['lattice', 'organic', 'waves', 'dna']),
      }),
    ])
);

const GROUP_LABELS = Object.freeze({
  waves: 'Waves',
  hooks: 'Hooks',
  camera: 'Camera',
  nodes: 'Nodes',
  pulses: 'Pulses',
  running: 'Running stream',
  activity: 'Activity effects',
  subagents: 'Subagents',
  waiting: 'Waiting effects',
  dust: 'Dust',
  floor: 'Floor',
  completion: 'Completion effects',
  impact: 'Impact effects',
  scene: 'Scene',
  effects: 'Effects',
});

const FRIENDLY_LABELS = Object.freeze({
  topology: 'Network topology',
  'hooks.startColor': 'hook.start color',
  'hooks.endColor': 'hook.end color',
  'hooks.otherColor': 'Other hook events color',
  'hooks.startImpact': 'hook.start scene impact',
  'hooks.endImpact': 'hook.end scene impact',
  'hooks.otherImpact': 'Other hook events scene impact',
  'camera.fov': 'Field of view',
  'camera.position': 'Camera position',
  'camera.target': 'Orbit center',
  'camera.damping': 'Orbit damping',
  'camera.minDistance': 'Minimum zoom distance',
  'camera.maxDistance': 'Maximum zoom distance',
  'camera.autoRotate': 'Automatic rotation',
  'camera.autoRotateSpeed': 'Automatic rotation speed',
  'nodes.count': 'Node count',
  'nodes.scale': 'Node projection scale',
  'nodes.size': 'Node size',
  'nodes.activeGrowth': 'Size increase during activity',
  'nodes.idleBrightness': 'Idle-node brightness',
  'nodes.activeBrightness': 'Active-node brightness',
  'nodes.decay': 'Excitation fade rate',
  'pulses.speedMin': 'Pulse speed minimum',
  'pulses.speedRange': 'Pulse speed maximum',
  'scene.edgeVisibility': 'Connecting-line visibility',
  'scene.bloomStrength': 'Glow strength',
  'effects.dust': 'Dust visibility',
  'effects.floor': 'Floor visibility',
});

const SUGGESTED_RANGES = Object.freeze({
  'camera.fov': [20, 100],
  'camera.minDistance': [5, 30],
  'camera.maxDistance': [30, 100],
  'camera.autoRotateSpeed': [0, 2],
  'nodes.scale': [50, 150],
  'nodes.size': [0.5, 2],
  'nodes.activeGrowth': [0, 4],
  'nodes.idleBrightness': [0, 1],
  'nodes.activeBrightness': [0, 3],
  'nodes.hotMix': [0, 3],
  'nodes.whiteThreshold': [0, 2],
  'nodes.whiteMix': [0, 2],
  'nodes.baseSizeMin': [0, 3],
  'nodes.baseSizeRange': [0, 3],
  'nodes.largeSizeMin': [0, 6],
  'nodes.largeSizeRange': [0, 4],
  'nodes.energyCap': [0, 5],
  'nodes.decay': [0, 8],
  'nodes.twinkleAmplitude': [0, 1],
  'nodes.twinkleSpeed': [0, 5],
  'nodes.coreFalloff': [0.1, 6],
  'pulses.scale': [0, 250],
  'pulses.head': [0, 8],
  'pulses.completionHead': [0, 10],
  'pulses.speedMin': [1, 10],
  'pulses.speedRange': [1, 18],
  'pulses.headBrightness': [0, 5],
  'pulses.trailFalloff': [0.1, 5],
  'pulses.coreFalloff': [0.1, 5],
  'pulses.nodeEnergy': [0, 2],
  'pulses.thinkingEdgeIntensity': [0, 2],
  'pulses.stepEdgeIntensity': [0, 2],
  'running.pulsesPerSecondPerSession': [0, 20],
  'running.maxSessions': [0, 128],
  'running.baseHops': [0, 12],
  'running.maxExtraHops': [0, 12],
  'running.spread': [0, 8],
  'running.nodeEnergy': [0, 2],
  'activity.maxIntensity': [1, 16],
  'activity.maxSpread': [0, 12],
  'activity.reasoningBaseHops': [0, 12],
  'activity.errorHops': [0, 12],
  'activity.reasoningEnergy': [0, 2],
  'activity.stepHeat': [0, 3],
  'activity.stepHeatCap': [0, 5],
  'subagents.growSeconds': [0.01, 2],
  'subagents.fadeSeconds': [0.1, 10],
  'subagents.tipSize': [0, 16],
  'subagents.fadingTipSize': [0, 16],
  'subagents.anchorSize': [0, 24],
  'subagents.initialIntensity': [0, 3],
  'subagents.intensityPerSecond': [0, 0.5],
  'subagents.maxIntensity': [0, 5],
  'subagents.runningAnchorIntensity': [0, 3],
  'subagents.waitingAnchorIntensity': [0, 3],
  'subagents.stuckAnchorIntensity': [0, 3],
  'subagents.quietAnchorIntensity': [0, 3],
  'subagents.failureFlashIntensity': [0, 6],
  'subagents.completionFlashBase': [0, 3],
  'subagents.completionFlashGrowth': [0, 12],
  'waiting.markerSize': [0, 2],
  'waiting.breathSpeed': [0, 3],
  'dust.scale': [0, 120],
  'dust.twinkleSpeed': [0, 5],
  'dust.twinklePhase': [0, 20],
  'dust.twinklePower': [0.1, 10],
  'dust.rotationSpeed': [-0.1, 0.1],
  'dust.tiltSpeed': [0, 0.5],
  'dust.tiltAmplitude': [0, 1],
  'floor.fineSpacing': [0.1, 10],
  'floor.fineIntensity': [0, 2],
  'floor.coarseSpacing': [0.1, 50],
  'floor.coarseIntensity': [0, 2],
  'floor.poolFade': [0, 0.5],
  'floor.poolBase': [0, 0.5],
  'floor.poolGrid': [0, 2],
  'completion.hops': [0, 20],
  'completion.neighbourHops': [0, 12],
  'completion.spread': [0, 16],
  'completion.neighbourSeeds': [0, 12],
  'completion.neighbourSpread': [0, 8],
  'completion.seedHeat': [0, 6],
  'completion.nodeEnergy': [0, 3],
  'completion.edgeIntensity': [0, 3],
  'impact.minMs': [1, 10000],
  'impact.maxMs': [1, 300000],
  'impact.minHops': [0, 20],
  'impact.maxHops': [0, 20],
  'impact.minSpread': [0, 16],
  'impact.maxSpread': [0, 16],
  'impact.neighbourSeeds': [0, 12],
  'impact.neighbourHops': [0, 12],
  'impact.neighbourSpread': [0, 8],
  'impact.seedHeat': [0, 6],
  'impact.nodeEnergy': [0, 3],
  'impact.edgeIntensity': [0, 3],
  'impact.head': [0, 8],
  'scene.categoryBrightness': [0, 3],
  'scene.edgeVariationMin': [0, 2],
  'scene.edgeVariationRange': [0, 2],
  'scene.breathSpeed': [0, 3],
  'scene.loadPulseScale': [1, 2000],
  'scene.loadSessionScale': [1, 256],
  'scene.loadSmoothing': [0, 10],
  'scene.coreSize': [0, 50],
  'scene.haloSize': [0, 100],
  'scene.bloomStrength': [0, 1.5],
  'scene.bloomLoad': [0, 2],
  'scene.edgeFade': [0, 8],
  'scene.dustBrightness': [0, 1],
  'scene.floorBrightness': [0, 1],
  'scene.floorFade': [0, 0.1],
  'scene.floorGlow': [0, 2],
});

function friendlySettingLabel(path) {
  if (FRIENDLY_LABELS[path]) return FRIENDLY_LABELS[path];
  const [group, name] = path.split('.');
  const field = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return `${GROUP_LABELS[group]} ${field}`;
}

const SETTING_DESCRIPTIONS = Object.freeze({
  topology: 'Selects the network style. Lattice keeps the current layout; Organic uses a random spherical distribution; Waves is a flat triangular mesh with travelling crests; DNA is a double helix with connecting rungs that twists around its own length instead of orbiting the camera. Activity still travels the connecting edges throughout each style.',
  'waves.amplitude': 'Vertical wave displacement in world units, only for Waves. Zero stops displacement. Reduced motion freezes the wave.',
  'waves.wavelength': 'Distance between travelling crests in world units, only for Waves.',
  'waves.speed': 'Wave phase speed in radians/second, only for Waves. Zero freezes the wave.',
  'hooks.startColor': 'Colors hook.start text in the activity feed and its scene pulses.',
  'hooks.endColor': 'Colors hook.end text in the activity feed and its scene pulses.',
  'hooks.otherColor': 'Colors other hook.* events in the activity feed and their scene pulses.',
  'hooks.startImpact': 'Strengthens hook.start pulse brightness and spread. 0 disables its scene effect; feed text and counts remain unchanged.',
  'hooks.endImpact': 'Strengthens hook.end pulse brightness and spread. 0 disables its scene effect; feed text and counts remain unchanged.',
  'hooks.otherImpact': 'Strengthens scene pulses for other hook.* events. 0 disables their scene effect; feed text and counts remain unchanged.',
  'camera.fov': 'Widens or narrows the camera view. Higher values show more of the scene and make objects appear smaller at the same camera position.',
  'camera.position': 'Places the camera in the scene. Change X, Y and Z to view the network from a different starting position.',
  'camera.target': 'Moves the point the camera looks at and orbits around. This changes the framing, not the network position.',
  'camera.damping': 'Controls how quickly camera motion settles after dragging. Higher values settle sooner; lower values retain more glide.',
  'camera.minDistance': 'Sets how close you can zoom toward the orbit center. Higher values keep the camera farther from the network.',
  'camera.maxDistance': 'Sets how far you can zoom away from the orbit center. Higher values allow a more distant view.',
  'camera.autoRotate': 'Orbits the camera automatically around the network, or twists the strands in DNA mode without orbiting the camera. Turn off to stop automatic motion and keep camera rotation under manual control.',
  'camera.autoRotateSpeed': 'Controls camera orbit speed, or strand twist speed in DNA mode, when automatic rotation is enabled. 0 stops rotation; use Direction to reverse it.',
  'nodes.count': 'Sets the number of points in the network, not the number of sessions. Committing a change rebuilds the network and its connections.',
  'nodes.scale': 'Scales how large network points appear on screen without moving them or changing the network shape.',
  'nodes.size': 'Multiplies the size of every network point. Higher values make points larger without changing their positions.',
  'nodes.activeGrowth': 'Makes energized nodes grow larger during activity. Higher values exaggerate the size change; 0 keeps their size steady.',
  'nodes.idleBrightness': 'Controls how visible quiet nodes remain between events. Higher values brighten their background twinkle.',
  'nodes.activeBrightness': 'Controls the extra brightness of energized or hot nodes. Higher values make activity stand out more strongly.',
  'nodes.hotMix': 'Controls how strongly hot nodes shift toward the hot color. Higher values reach that color with less heat.',
  'nodes.whiteThreshold': 'Sets the energy or heat level where nodes begin shifting toward the white color. Higher values delay this highlight.',
  'nodes.whiteMix': 'Controls how strongly nodes shift toward the white color above the whitening threshold. 0 removes this color shift.',
  'nodes.baseSizeMin': 'Sets the smallest randomly assigned size for ordinary nodes. Higher values enlarge the smaller network points.',
  'nodes.baseSizeRange': 'Adds random size variation above the ordinary-node minimum. Higher values create a wider mix of point sizes.',
  'nodes.largeChance': 'Sets the share of nodes assigned the large-node size range. Higher values create more prominent points.',
  'nodes.largeSizeMin': 'Sets the smallest size for nodes selected as large. Higher values make those points more prominent.',
  'nodes.largeSizeRange': 'Adds random size variation above the large-node minimum. Higher values allow larger standout points.',
  'nodes.energyCap': 'Limits the activity energy a node can accumulate. Higher values allow stronger activity-driven growth and brightness.',
  'nodes.decay': 'Controls how quickly node energy and heat fade after activity. Higher values fade faster; 0 stops this decay.',
  'nodes.twinkleBase': 'Sets the baseline of quiet-node twinkling. Higher values keep the network points more visible between twinkles.',
  'nodes.twinkleAmplitude': 'Sets how much quiet-node brightness varies during a twinkle. 0 makes this brightness steady.',
  'nodes.twinkleSpeed': 'Controls how quickly quiet nodes twinkle. Higher values make brightness changes more frequent.',
  'nodes.twinkleSpatial': 'Varies the twinkle timing across X, Y and Z positions. All zeros make nodes twinkle in sync.',
  'nodes.coreFalloff': 'Shapes the soft edge of each node point. Higher values concentrate its glow into a smaller, sharper center.',
  'nodes.baseColor': 'Sets the starting color of network nodes before heat and whitening highlights are applied.',
  'nodes.hotColor': 'Sets the color nodes move toward as they heat up during activity, before any whitening highlight.',
  'nodes.whiteColor': 'Sets the highlight color used when a node exceeds the whitening threshold. It need not be white.',
  'pulses.scale': 'Scales the on-screen size of traveling pulse points and their trails without changing travel speed.',
  'pulses.head': 'Sets the point size of ordinary reasoning and tool pulse heads and the starting size of their trails.',
  'pulses.completionHead': 'Sets the point size of completion-cascade pulse heads. Higher values make completions more prominent.',
  'pulses.trailSpacing': 'Spaces trail points behind ordinary pulse heads along each connection. Higher values stretch the trail farther back.',
  'pulses.completionTrailSpacing': 'Spaces trail points behind completion and duration-impact pulse heads. Higher values stretch these trails farther back.',
  'pulses.speedMin': 'Sets the slowest pulse travel speed. Individual pulses vary between the displayed minimum and maximum.',
  'pulses.speedRange': 'Sets the fastest pulse travel speed. Raising the displayed maximum allows faster pulses without changing the minimum.',
  'pulses.headBrightness': 'Brightens the leading point of every pulse relative to its trail. Higher values emphasize pulse heads.',
  'pulses.trailFalloff': 'Controls how quickly a pulse trail dims and shrinks behind its head. Higher values fade the tail more sharply.',
  'pulses.minTrailSize': 'Sets the smallest trail-point size relative to the pulse head. Higher values keep the tail points thicker.',
  'pulses.coreFalloff': 'Shapes the soft edge of each pulse point. Higher values concentrate its light into a sharper center.',
  'pulses.nodeEnergy': 'Adds energy when ordinary pulses reach a node. Higher values produce a stronger node response, up to the energy cap.',
  'pulses.thinkingEdgeIntensity': 'Controls how strongly reasoning and running-stream pulses illuminate the connections they travel along.',
  'pulses.stepEdgeIntensity': 'Controls how strongly tool-step and hook pulses illuminate the connections they travel along.',
  'running.pulsesPerSecondPerSession': 'Sets the background pulse rate for each observed running session. 0 stops this stream without hiding received activity events.',
  'running.maxSessions': 'Caps how many running sessions contribute to the background pulse stream, not how many sessions are tracked or listed.',
  'running.baseHops': 'Sets how many additional connections a running-stream pulse can cross after its first connection.',
  'running.maxExtraHops': 'Caps the extra travel distance added to running-stream pulses as the observed running-session count grows.',
  'running.spread': 'Sets how many connections each running-stream seed sends pulses along. Higher values make each seed fan out more widely.',
  'running.nodeEnergy': 'Adds energy to the starting node of each running-stream seed. Higher values make those nodes react more strongly.',
  'activity.maxIntensity': 'Caps the strength derived from grouped event counts, including hook pulse counts. Higher values allow busier arrivals to produce stronger scene effects.',
  'activity.maxSpread': 'Caps the number of starting connections used by grouped activity and hook pulses. Higher values allow wider bursts.',
  'activity.reasoningBaseHops': 'Adds travel distance to grouped reasoning-style pulses, on top of their count-based intensity.',
  'activity.errorHops': 'Sets the hop budget assigned to error pulses. Their current step-style motion stops after the first connection, so this does not extend their travel.',
  'activity.reasoningEnergy': 'Controls how much energy a grouped reasoning burst adds to its starting node, scaled by event intensity.',
  'activity.stepHeat': 'Controls the heat added to starting nodes by grouped step-style activity and hook pulses. Higher values strengthen node highlights.',
  'activity.stepHeatCap': 'Caps the starting-node heat from grouped step-style activity and hook pulses. Higher values allow hotter node highlights.',
  'subagents.growSeconds': 'Sets how long a new delegated-work branch takes to grow out from its anchor. Higher values slow growth; transitions must be enabled.',
  'subagents.fadeSeconds': 'Sets how long retired delegated-work branches remain while fading. Higher values leave them visible longer; transitions must be enabled.',
  'subagents.tipSize': 'Sets the on-screen point size at the end of each active delegated-work branch.',
  'subagents.fadingTipSize': 'Sets the on-screen point size at the end of retired delegated-work branches while they fade.',
  'subagents.anchorSize': 'Sets the on-screen point size marking a session with delegated work inside the network.',
  'subagents.initialIntensity': 'Sets the starting brightness of active delegated-work branches and their tips.',
  'subagents.intensityPerSecond': 'Adds branch brightness as delegated work ages, up to its intensity cap. Requires subagent transitions; this is not a measure of child activity.',
  'subagents.maxIntensity': 'Caps the brightness of active delegated-work branches and tips as they age.',
  'subagents.runningAnchorIntensity': 'Sets the brightness of delegated-work anchors whose parent session is running.',
  'subagents.waitingAnchorIntensity': 'Sets the brightness of delegated-work anchors whose parent session is waiting.',
  'subagents.stuckAnchorIntensity': 'Sets the brightness of delegated-work anchors whose parent session is marked stuck.',
  'subagents.quietAnchorIntensity': 'Sets the brightness of delegated-work anchors in other, quieter parent-session states.',
  'subagents.failureFlashFraction': 'Sets the fraction of the retirement fade that uses the failure brightness boost. 0 removes that boosted phase.',
  'subagents.failureFlashIntensity': 'Sets the brightness multiplier during the initial failure phase of a retiring branch.',
  'subagents.completionFlashFraction': 'Sets the fraction of the retirement fade that uses the completion brightness effect. 0 removes that phase.',
  'subagents.completionFlashBase': 'Sets the initial brightness multiplier during a completed branch retirement effect.',
  'subagents.completionFlashGrowth': 'Raises the brightness multiplier through the initial completion phase before the retired branch fades away.',
  'subagents.runningAnchorColor': 'Colors delegated-work anchors when their parent session is running.',
  'subagents.stuckAnchorColor': 'Colors delegated-work anchors when their parent session is marked stuck.',
  'subagents.quietAnchorColor': 'Colors delegated-work anchors in quieter parent-session states.',
  'subagents.clearedLineColor': 'Colors retiring branch lines when delegated work is cleared without a completion or failure outcome.',
  'subagents.clearedTipColor': 'Colors retiring branch tips when delegated work is cleared without a completion or failure outcome.',
  'waiting.markerOpacity': 'Sets the opacity of the rings marking waiting sessions. Requires waiting markers to be enabled.',
  'waiting.markerSize': 'Scales the rings marking waiting sessions. Higher values make each waiting cue larger.',
  'waiting.breathSpeed': 'Controls how fast the central waiting glow changes color and opacity while sessions are waiting.',
  'waiting.colorMixMin': 'Sets the minimum blend toward the waiting color in the central glow. Higher values keep it closer to the waiting color.',
  'waiting.colorMixRange': 'Sets how much the waiting-color blend varies over a breathing cycle. 0 keeps the color blend steady.',
  'waiting.opacityBase': 'Adds a steady opacity boost to the central glow while sessions are waiting and waiting glow is enabled.',
  'waiting.opacityBreath': 'Scales the extra central-glow opacity driven by the waiting-color blend. Higher values strengthen the waiting glow.',
  'dust.scale': 'Scales the on-screen size of background dust points without changing their number or positions.',
  'dust.twinkleBase': 'Sets the baseline brightness of background dust between twinkles. Requires dust visibility.',
  'dust.twinkleAmplitude': 'Sets the extra brightness variation in dust twinkles. 0 makes the dust brightness steady.',
  'dust.twinkleSpeed': 'Controls how quickly background dust twinkles. Higher values make brightness changes more frequent.',
  'dust.twinklePhase': 'Spreads twinkle timing between dust particles. 0 makes them twinkle in sync.',
  'dust.twinklePower': 'Shapes dust twinkles. Higher values keep particles near their baseline longer, with narrower bright peaks.',
  'dust.rotationSpeed': 'Rotates the background dust around the scene. Negative values reverse direction; 0 stops this rotation.',
  'dust.tiltSpeed': 'Controls how quickly the dust field rocks back and forth around its horizontal axis.',
  'dust.tiltAmplitude': 'Sets how far the dust field rocks back and forth. 0 removes this tilt motion.',
  'dust.color': 'Sets the color of the background dust points. Requires dust visibility.',
  'floor.fineSpacing': 'Sets the distance between fine floor-grid lines. Higher values spread lines farther apart; requires floor visibility.',
  'floor.fineIntensity': 'Sets the brightness contribution of the fine floor-grid lines. 0 removes that grid layer.',
  'floor.coarseSpacing': 'Sets the distance between coarse floor-grid lines. Higher values create larger grid cells; requires floor visibility.',
  'floor.coarseIntensity': 'Sets the brightness contribution of the coarse floor-grid lines. 0 removes that grid layer.',
  'floor.poolFade': 'Controls how quickly the activity-driven floor light pool fades away from the center. Higher values make the pool tighter.',
  'floor.poolBase': 'Sets the smooth, non-grid contribution to the floor light pool during activity.',
  'floor.poolGrid': 'Sets how strongly floor-grid lines pick up the activity-driven light pool.',
  'floor.color': 'Sets the base color of the fine and coarse floor-grid lines, separate from the activity light pool.',
  'floor.poolColor': 'Sets the color of the activity-driven light pool beneath the network.',
  'completion.hops': 'Sets how many additional connections the main completion pulse cascade can cross. Higher values let it travel farther.',
  'completion.neighbourHops': 'Sets how far completion pulses launched from neighboring seed nodes can continue through the network.',
  'completion.spread': 'Sets how many connections receive pulses from the main completion seed. Higher values widen the initial cascade.',
  'completion.neighbourSeeds': 'Sets how many neighbors also launch completion pulses. Higher values start the cascade from more places.',
  'completion.neighbourSpread': 'Sets how many connections each neighboring completion seed sends pulses along.',
  'completion.branchChance': 'Sets the chance that a completion pulse splits onto two connections instead of continuing along one.',
  'completion.seedHeat': 'Sets the heat at the starting node of a completion cascade. Higher values make that node highlight stronger.',
  'completion.nodeEnergy': 'Adds energy when completion pulses reach a node. Higher values strengthen the node response, up to the energy cap.',
  'completion.edgeIntensity': 'Sets how brightly completion pulses illuminate the connections they travel along.',
  'impact.minMs': 'Sets the shortest timed activity that creates a duration-impact burst. Shorter activities still appear in the feed.',
  'impact.maxMs': 'Sets the activity duration that reaches maximum impact strength. Longer activities do not make the burst larger.',
  'impact.minHops': 'Sets the travel budget for duration-impact pulses at the minimum duration. Higher values let the smallest impact travel farther.',
  'impact.maxHops': 'Sets the travel budget for duration-impact pulses at maximum duration. Higher values let the largest impact travel farther.',
  'impact.minSpread': 'Sets the number of starting connections for duration impacts at the minimum duration.',
  'impact.maxSpread': 'Sets the number of starting connections for duration impacts at maximum duration.',
  'impact.neighbourSeeds': 'Caps how many neighboring nodes launch extra pulses in a duration impact. Longer activities use more of this allowance.',
  'impact.neighbourHops': 'Caps the travel budget of neighboring duration-impact pulses. Longer activities use more of this allowance.',
  'impact.neighbourSpread': 'Sets how many connections each neighboring duration-impact seed sends pulses along.',
  'impact.branchChance': 'Sets the chance that a duration-impact pulse splits onto two connections instead of continuing along one.',
  'impact.seedHeat': 'Sets the maximum starting-node heat from a duration impact. Shorter qualifying activities apply a smaller share.',
  'impact.nodeEnergy': 'Adds energy when duration-impact pulses reach a node. Higher values strengthen the node response, up to the energy cap.',
  'impact.edgeIntensity': 'Sets how brightly duration-impact pulses illuminate the connections they travel along.',
  'impact.head': 'Sets the point size of duration-impact pulse heads. Higher values make timed activity bursts more prominent.',
  'scene.edgeVisibility': 'Shows connecting lines all the time, only when illuminated by activity, or not at all. Nodes and pulses remain visible.',
  'scene.categoryBrightness': 'Scales category-colored scene light, including pulses, illuminated connections and delegated-work branches. Feed colors do not change.',
  'scene.edgeVariationMin': 'Sets the minimum idle brightness multiplier for connections in Always visible mode.',
  'scene.edgeVariationRange': 'Adds random variation above the minimum idle connection brightness. Higher values give connections a wider brightness range.',
  'scene.breathSpeed': 'Controls how quickly the whole network expands and contracts when lattice breathing is enabled.',
  'scene.breathAmplitude': 'Sets how far the network expands and contracts around its normal size when lattice breathing is enabled.',
  'scene.loadPulseScale': 'Sets how many active pulses contribute a full share of visual load. Higher values make load-driven glows less sensitive to pulses.',
  'scene.loadSessionScale': 'Sets how many active sessions contribute a full share of visual load. Higher values make load-driven glows less sensitive to sessions.',
  'scene.loadSmoothing': 'Controls how quickly scene brightness follows changes in visual load. Higher values respond faster; 0 freezes the current smoothed load.',
  'scene.coreSize': 'Sets the size of the central glow sprite without changing the network geometry.',
  'scene.haloSize': 'Sets the size of the outer halo glow sprite around the network.',
  'scene.glowKnee': 'Sets where the intermediate opacity stop sits in the core and halo glow texture. Higher values move that stop toward the outer edge.',
  'scene.glowKneeOpacity': 'Sets the opacity at the intermediate glow-texture stop, shaping how the core and halo fade toward their edges.',
  'scene.bloomStrength': 'Sets the baseline post-processing glow around bright scene features. Higher values spread more of their light into a glow.',
  'scene.bloomLoad': 'Adds extra bloom strength as visual load rises. 0 keeps bloom at its baseline strength.',
  'scene.bloomRadius': 'Controls the spread of the post-processing bloom. Higher values create a broader, softer glow.',
  'scene.bloomThreshold': 'Sets how bright a feature must be to contribute to bloom. Higher values restrict glow to brighter features.',
  'scene.edgeFade': 'Controls how quickly activity illumination fades from connections. Higher values fade faster; 0 preserves this illumination.',
  'scene.coreOpacity': 'Sets the baseline opacity of the central glow before load and waiting effects are added.',
  'scene.coreLoad': 'Adds central-glow opacity as visual load rises. Higher values make busy periods brighten the center more.',
  'scene.haloOpacity': 'Sets the baseline opacity of the outer halo before load effects are added.',
  'scene.haloLoad': 'Adds outer-halo opacity as visual load rises. Higher values make busy periods brighten the halo more.',
  'scene.dustBrightness': 'Multiplies background dust brightness without changing particle size or twinkle timing.',
  'scene.floorBrightness': 'Multiplies the base floor-grid brightness, independently of the activity-driven floor light pool.',
  'scene.floorFade': 'Controls how quickly base floor-grid lines fade with distance from the center. Higher values keep the visible grid closer in.',
  'scene.floorGlow': 'Scales the floor light pool produced by visual load. 0 removes this activity-driven glow without hiding the grid.',
  'scene.edgeBaseColor': 'Sets the idle connecting-line color in Always visible mode. Activity illumination keeps its category colors.',
  'scene.background': 'Sets the solid background color behind the network, dust and floor.',
  'scene.coreColor': 'Sets the central glow color before the waiting-color blend is applied.',
  'scene.haloColor': 'Sets the color of the outer halo glow around the network.',
  'effects.dust': 'Shows or hides the background dust particles without changing their saved appearance settings.',
  'effects.floor': 'Shows or hides the floor grid and its activity-driven light pool.',
  'effects.latticeBreathing': 'Turns the gentle expansion and contraction of the whole network on or off.',
  'effects.waitingGlow': 'Turns the central waiting-color and opacity cue on or off while observed sessions are waiting.',
  'effects.waitingMarkers': 'Shows or hides the rings attached to waiting-session locations in the network.',
  'effects.subagentTransitions': 'Enables branch growth, age-based brightening and retirement fades for delegated work. Off keeps active branches visible without these transitions.',
});

function settingInputGuidance(definition) {
  const { path, type, constraints, unit } = definition;
  const details = [];
  if (type === 'number') {
    details.push('Enter a finite number.');
    if (constraints.integer) details.push('Use a whole number.');
    if (constraints.minimum !== undefined) details.push(`Minimum ${constraints.minimum}.`);
    if (constraints.maximum !== undefined) details.push(`Maximum ${constraints.maximum}.`);
    if (constraints.exclusiveMinimum !== undefined) {
      details.push(`Must be greater than ${constraints.exclusiveMinimum}.`);
    }
    if (constraints.exclusiveMaximum !== undefined) {
      details.push(`Must be less than ${constraints.exclusiveMaximum}.`);
    }
  } else if (type === 'vector3') {
    details.push('Enter finite X, Y and Z values.');
  } else if (type === 'rgb') {
    details.push('Displayed as sRGB; saved as a linear RGB array.');
  } else if (type === 'hex') {
    details.push('Displayed and saved as an sRGB colour.');
  } else if (type === 'enum') {
    details.push(`Choose ${definition.options.join(', ')}.`);
  } else {
    details.push('Toggle this effect on or off.');
  }
  if (unit !== 'unitless') details.push(`Unit: ${unit}.`);
  return details.join(' ');
}

function sectionForSetting(path) {
  if (path === 'topology') return 'network';
  const [group, name] = path.split('.');
  if (group === 'camera') return 'camera';
  if (group === 'nodes' || path === 'scene.edgeVisibility' || path === 'scene.edgeBaseColor' ||
      path === 'scene.edgeVariationMin' || path === 'scene.edgeVariationRange' || path === 'scene.edgeFade') {
    return 'network';
  }
  if (group === 'pulses' || group === 'running' || group === 'waves') return 'motion';
  if (['activity', 'hooks', 'subagents', 'waiting', 'completion', 'impact'].includes(group) ||
      group === 'effects' && !['dust', 'floor', 'latticeBreathing'].includes(name)) {
    return 'event-effects';
  }
  return 'atmosphere';
}

function suggestedRangeFor(definition) {
  const { path, constraints } = definition;
  if (SUGGESTED_RANGES[path]) return SUGGESTED_RANGES[path];
  const minimum = constraints.minimum ?? constraints.exclusiveMinimum;
  const maximum = constraints.maximum ?? constraints.exclusiveMaximum;
  if (minimum === undefined || maximum === undefined) return null;
  const span = maximum - minimum;
  return [
    constraints.exclusiveMinimum === undefined ? minimum : minimum + span / 100,
    constraints.exclusiveMaximum === undefined ? maximum : maximum - span / 100,
  ];
}

const QUICK_SETTINGS = new Set([
  'nodes.count',
  'nodes.size',
  'nodes.activeBrightness',
  'pulses.speedMin',
  'pulses.speedRange',
  'camera.autoRotate',
  'camera.autoRotateSpeed',
  'scene.bloomStrength',
  'scene.edgeVisibility',
  'effects.dust',
  'effects.floor',
]);

export const VISUAL_SETTING_PRESENTATION = Object.freeze(Object.fromEntries(
  VISUAL_SETTING_DEFINITIONS.map((definition) => {
    const { path } = definition;
    const suggestedRange = suggestedRangeFor(definition);
    const label = friendlySettingLabel(path);
    return [path, Object.freeze({
      label,
      description: SETTING_DESCRIPTIONS[path],
      inputGuidance: settingInputGuidance(definition),
      helpText: `${SETTING_DESCRIPTIONS[path]} ${settingInputGuidance(definition)}`,
      section: sectionForSetting(path),
      quick: QUICK_SETTINGS.has(path),
      suggestedRange: suggestedRange ? Object.freeze([...suggestedRange]) : null,
    })];
  })
));

const definitionsByGroup = new Map();
for (const definition of VISUAL_SETTING_DEFINITIONS) {
  const [group, name] = definition.path.split('.');
  if (!name) continue;
  if (!definitionsByGroup.has(group)) definitionsByGroup.set(group, new Map());
  definitionsByGroup.get(group).set(name, definition);
}
const rootSettingDefinitions = new Map(
  VISUAL_SETTING_DEFINITIONS.filter(({ path }) => !path.includes('.'))
    .map((definition) => [definition.path, definition]));
const topLevelSettingKeys = new Set([...definitionsByGroup.keys(), ...rootSettingDefinitions.keys()]);

function freezeTree(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeTree(child);
  }
  return Object.freeze(value);
}

export const VISUAL_PRESETS = freezeTree({
  balanced: {},
  subtle: {
    running: { pulsesPerSecondPerSession: 2, baseHops: 1 },
    nodes: { idleBrightness: 0.25, activeBrightness: 1.4 },
    pulses: { headBrightness: 1.2 },
    scene: {
      categoryBrightness: 0.7, breathAmplitude: 0.006, bloomStrength: 0.55,
      bloomLoad: 0.2, dustBrightness: 0.1, floorBrightness: 0.12, floorGlow: 0.3,
    },
  },
  intense: {
    running: { pulsesPerSecondPerSession: 10 },
    nodes: { activeBrightness: 2.4, activeGrowth: 2.5 },
    pulses: { headBrightness: 2.2 },
    activity: { maxIntensity: 10 },
    scene: {
      categoryBrightness: 1.2, bloomStrength: 1.1, bloomLoad: 0.42,
      coreLoad: 0.17, floorGlow: 0.7, dustBrightness: 0.24,
    },
  },
  aurora: {
    nodes: {
      baseColor: [0.08, 0.52, 0.46],
      hotColor: [0.18, 0.9, 0.67],
      whiteColor: [0.75, 0.98, 0.9],
    },
    dust: { color: [0.08, 0.42, 0.34] },
    floor: {
      color: [0.04, 0.2, 0.17],
      poolColor: [0.03, 0.48, 0.32],
    },
    scene: {
      background: 0x03100e,
      edgeBaseColor: [0.01, 0.07, 0.055],
      coreColor: 0x42ffc7,
      haloColor: 0x159b87,
      bloomStrength: 0.95,
      bloomLoad: 0.35,
      floorGlow: 0.65,
    },
  },
  ember: {
    nodes: {
      baseColor: [0.85, 0.13, 0.025],
      hotColor: [1, 0.48, 0.08],
      whiteColor: [1, 0.85, 0.62],
      activeGrowth: 2.3,
    },
    running: { pulsesPerSecondPerSession: 8 },
    dust: { color: [0.6, 0.12, 0.025] },
    floor: {
      color: [0.28, 0.07, 0.025],
      poolColor: [0.78, 0.18, 0.035],
    },
    effects: { floor: false },
    scene: {
      background: 0x110604,
      edgeBaseColor: [0.09, 0.025, 0.012],
      coreColor: 0xff7138,
      haloColor: 0xd83c1c,
      bloomStrength: 1.3,
      bloomLoad: 0.48,
      floorGlow: 0.75,
    },
  },
  monochrome: {
    nodes: {
      baseColor: [0.48, 0.55, 0.66],
      hotColor: [0.78, 0.84, 0.94],
      whiteColor: [0.95, 0.97, 1],
    },
    running: { pulsesPerSecondPerSession: 4 },
    effects: { dust: false, floor: false, latticeBreathing: false },
    scene: {
      background: 0x05070a,
      edgeVisibility: 'active',
      edgeBaseColor: [0.035, 0.045, 0.06],
      categoryBrightness: 0.55,
      coreColor: 0xcbd5e1,
      haloColor: 0x64748b,
      bloomStrength: 0.45,
      bloomLoad: 0.18,
      dustBrightness: 0,
      floorBrightness: 0,
      floorGlow: 0,
    },
  },
});

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(Reflect.ownKeys(value).map((key) => [key, cloneValue(value[key])]));
  }
  return value;
}

export function mergeVisualOverrides(...layers) {
  const merged = {};
  for (const layer of layers) {
    if (!isPlainRecord(layer)) continue;
    for (const group of Reflect.ownKeys(layer)) {
      const values = layer[group];
      if (!isPlainRecord(values)) {
        merged[group] = cloneValue(values);
        continue;
      }
      merged[group] = {
        ...(isPlainRecord(merged[group]) ? merged[group] : {}),
        ...cloneValue(values),
      };
    }
  }
  return merged;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function visualConfigurationSignature(configuration) {
  return JSON.stringify(stableValue({
    defaults: configuration.defaults,
    preset: configuration.preset,
    overrides: configuration.overrides,
  }));
}

export function createVisualSettingsModuleSource({ defaults, preset, overrides }) {
  return [
    "import { resolveVisualSettings } from './visual-config.mjs';",
    '',
    `export const VISUAL = ${JSON.stringify(defaults, null, 2)};`,
    `export const VISUAL_PRESET = ${JSON.stringify(preset)};`,
    `export const VISUAL_OVERRIDES = ${JSON.stringify(overrides, null, 2)};`,
    'const resolved = resolveVisualSettings(VISUAL, VISUAL_PRESET, VISUAL_OVERRIDES);',
    'export const EFFECTIVE_VISUAL = resolved.settings;',
    'export const VISUAL_ERRORS = resolved.errors;',
    '',
  ].join('\n');
}

function addUnknownKeyIssues(value, allowed, prefix, errors) {
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.has(key)) errors.push({ path: `${prefix}.${String(key)}`, message: 'Unknown setting.' });
  }
}

function applyOverrides(candidate, overrides, layerName) {
  const errors = [];
  if (!isPlainRecord(overrides)) {
    return [{ path: layerName, message: 'Overrides must be a plain object.' }];
  }
  addUnknownKeyIssues(overrides, topLevelSettingKeys, layerName, errors);
  for (const group of Reflect.ownKeys(overrides)) {
    const settings = overrides[group];
    if (rootSettingDefinitions.has(group)) {
      candidate[group] = cloneValue(settings);
      continue;
    }
    const groupDefinitions = definitionsByGroup.get(group);
    if (!groupDefinitions) continue;
    if (!isPlainRecord(settings)) {
      errors.push({ path: `${layerName}.${group}`, message: 'Must be a plain settings object.' });
      continue;
    }
    addUnknownKeyIssues(settings, groupDefinitions, `${layerName}.${group}`, errors);
    for (const name of Reflect.ownKeys(settings)) {
      if (groupDefinitions.has(name)) candidate[group][name] = cloneValue(settings[name]);
    }
  }
  return errors;
}

export function resolveVisualSettings(defaults, presetName = 'balanced', fileOverrides = {}, previewOverrides = {}) {
  const defaultErrors = validateVisualSettings(defaults);
  if (defaultErrors.length) return { settings: null, errors: defaultErrors };
  if (typeof presetName !== 'string' || !Object.hasOwn(VISUAL_PRESETS, presetName)) {
    return { settings: null, errors: [{ path: 'preset', message: `Unknown preset "${String(presetName)}".` }] };
  }

  const settings = cloneValue({ ...defaults, hooks: defaults.hooks ?? HOOK_DEFAULTS });
  settings.waves ??= cloneValue(WAVE_DEFAULTS);
  if (!Object.hasOwn(settings, 'topology')) settings.topology = 'lattice';
  for (const [layerName, overrides] of [
    ['fileOverrides', fileOverrides],
    [`preset:${presetName}`, VISUAL_PRESETS[presetName]],
    ['previewOverrides', previewOverrides],
  ]) {
    const shapeErrors = applyOverrides(settings, overrides, layerName);
    if (shapeErrors.length) return { settings: null, errors: shapeErrors };
    const validationErrors = validateVisualSettings(settings);
    if (validationErrors.length) return { settings: null, errors: validationErrors };
  }
  return { settings, errors: [] };
}

function validateTuple(value, definition, errors) {
  const path = definition.path;
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 3 || Reflect.ownKeys(value).filter((key) => key !== 'length')
        .some((key, index) => key !== String(index))) {
    errors.push({ path, message: 'Must be an array of exactly three finite numbers.' });
    return;
  }
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!Number.isFinite(item)) {
      errors.push({ path: `${path}[${index}]`, message: 'Must be finite.' });
    } else if (definition.type === 'rgb' && (item < 0 || item > 1)) {
      errors.push({ path: `${path}[${index}]`, message: 'Linear RGB channels must be between 0 and 1.' });
    }
  }
}

export function validateVisualSettings(settings) {
  const errors = [];
  if (!isPlainRecord(settings)) {
    return [{ path: 'VISUAL', message: 'Must be a plain configuration object.' }];
  }

  addUnknownKeyIssues(settings, topLevelSettingKeys, 'VISUAL', errors);
  for (const [group, definitions] of definitionsByGroup) {
    const values = settings[group];
    if (!Object.hasOwn(settings, group)) {
      if (group === 'hooks' || group === 'waves') continue;
      errors.push({ path: group, message: 'Required settings group is missing.' });
      continue;
    }
    if (!isPlainRecord(values)) {
      errors.push({ path: group, message: 'Must be a plain settings object.' });
      continue;
    }
    addUnknownKeyIssues(values, definitions, group, errors);
    for (const [name, definition] of definitions) {
      const path = definition.path;
      if (!Object.hasOwn(values, name)) {
        errors.push({ path, message: 'Required setting is missing.' });
        continue;
      }
      const value = values[name];
      if (definition.type === 'enum') {
        if (!definition.options.includes(value)) {
          errors.push({ path, message: `Must be one of: ${definition.options.join(', ')}.` });
        }
      } else if (definition.type === 'boolean') {
        if (typeof value !== 'boolean') errors.push({ path, message: 'Must be a boolean.' });
      } else if (definition.type === 'vector3' || definition.type === 'rgb') {
        validateTuple(value, definition, errors);
      } else if (definition.type === 'hex') {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
          errors.push({ path, message: 'Must be an integer sRGB hex color from 0x000000 to 0xffffff.' });
        }
      } else if (!Number.isFinite(value)) {
        errors.push({ path, message: 'Must be a finite number.' });
      } else {
        if (definition.constraints.integer && !Number.isSafeInteger(value)) {
          errors.push({ path, message: 'Must be a safe integer.' });
        }
        if (definition.constraints.minimum !== undefined && value < definition.constraints.minimum) {
          errors.push({ path, message: `Must be at least ${definition.constraints.minimum}.` });
        }
        if (definition.constraints.maximum !== undefined && value > definition.constraints.maximum) {
          errors.push({ path, message: `Must be at most ${definition.constraints.maximum}.` });
        }
        if (definition.constraints.exclusiveMinimum !== undefined &&
            value <= definition.constraints.exclusiveMinimum) {
          errors.push({ path, message: `Must be greater than ${definition.constraints.exclusiveMinimum}.` });
        }
        if (definition.constraints.exclusiveMaximum !== undefined &&
            value >= definition.constraints.exclusiveMaximum) {
          errors.push({ path, message: `Must be less than ${definition.constraints.exclusiveMaximum}.` });
        }
      }
    }
  }

  if (Object.hasOwn(settings, 'topology') &&
      !rootSettingDefinitions.get('topology').options.includes(settings.topology)) {
    errors.push({
      path: 'topology',
      message: `Must be one of: ${rootSettingDefinitions.get('topology').options.join(', ')}.`,
    });
  }

  const number = (path) => {
    const [group, name] = path.split('.');
    return settings[group]?.[name];
  };
  const related = (paths, message) => errors.push({ path: paths[0], message: `${message} (${paths.join(', ')}).` });
  if (Number.isFinite(number('camera.minDistance')) && Number.isFinite(number('camera.maxDistance')) &&
      number('camera.minDistance') > number('camera.maxDistance')) {
    related(['camera.minDistance', 'camera.maxDistance'], 'Minimum camera distance must not exceed maximum camera distance');
  }
  const position = settings.camera?.position, target = settings.camera?.target;
  if (Array.isArray(position) && Array.isArray(target) && position.length === 3 && target.length === 3 &&
      position.every(Number.isFinite) && target.every(Number.isFinite) &&
      position.every((coordinate, index) => coordinate === target[index])) {
    related(['camera.position', 'camera.target'], 'Camera position and target must not coincide');
  }
  if (Number.isFinite(number('waiting.colorMixMin')) && Number.isFinite(number('waiting.colorMixRange')) &&
      number('waiting.colorMixMin') + number('waiting.colorMixRange') > 1) {
    related(['waiting.colorMixMin', 'waiting.colorMixRange'], 'Waiting color blend must not exceed 1');
  }
  if (Number.isFinite(number('nodes.twinkleAmplitude')) && Number.isFinite(number('nodes.twinkleBase')) &&
      number('nodes.twinkleAmplitude') > number('nodes.twinkleBase')) {
    related(['nodes.twinkleAmplitude', 'nodes.twinkleBase'], 'Twinkle amplitude must not exceed its baseline');
  }
  for (const [low, high, label] of [
    ['impact.minMs', 'impact.maxMs', 'Impact duration'],
    ['impact.minHops', 'impact.maxHops', 'Impact hop budget'],
    ['impact.minSpread', 'impact.maxSpread', 'Impact spread'],
  ]) {
    if (Number.isFinite(number(low)) && Number.isFinite(number(high)) && number(low) > number(high)) {
      related([low, high], `${label} minimum must not exceed its maximum`);
    }
  }
  return errors;
}

export function showVisualConfigurationError(element, errors) {
  element.textContent = `Visual configuration could not be started:\n${errors
    .map(({ path, message }) => `${path}: ${message}`).join('\n')}\n\nFix visual-settings.mjs and refresh the page.`;
  element.hidden = false;
}

export async function startVisualApplication(
  document,
  loadConfiguration = loadVisualConfiguration,
  startScene = () => import('./main.js')
) {
  const { errors } = await loadConfiguration();
  if (errors.length) {
    showVisualConfigurationError(document.getElementById('visual-config-error'), errors);
    return false;
  }
  await startScene();
  return true;
}

export async function loadVisualConfiguration(loadModule = () => import('./visual-settings.mjs')) {
  let module;
  try {
    module = await loadModule();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      settings: null,
      errors: [{ path: 'visual-settings.mjs', message: `Could not load configuration module: ${detail}` }],
    };
  }
  if (Array.isArray(module?.VISUAL_ERRORS) && module.VISUAL_ERRORS.length) {
    return { settings: null, errors: module.VISUAL_ERRORS };
  }
  const settings = module?.EFFECTIVE_VISUAL ?? module?.VISUAL;
  const errors = validateVisualSettings(settings);
  return { settings: errors.length ? null : settings, errors };
}
