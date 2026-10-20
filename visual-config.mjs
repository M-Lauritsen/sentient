const SHAPE = {
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
          ...(path === 'nodes.count' ? { minimum: 2, maximum: 4000 } : {}),
          ...(STRICT_UNIT_PATHS.has(path) ? { exclusiveMinimum: 0, exclusiveMaximum: 1 } : {}),
          ...(MAX_ONE_EXCLUSIVE_PATHS.has(path) ? { exclusiveMaximum: 1 } : {}),
        };
        return Object.freeze({
          path, type, label, unit: unitFor(path), editor, constraints: Object.freeze(constraints),
          ...(type === 'enum' ? { options: Object.freeze(['always', 'active', 'hidden']) } : {}),
        });
      })))
);

const GROUP_LABELS = Object.freeze({
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

function settingHelpText(definition, label) {
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
  return `${label}. ${details.join(' ')} Suggested slider ranges are guidance, not validation limits. Configuration path: ${path}.`;
}

function sectionForSetting(path) {
  const [group, name] = path.split('.');
  if (group === 'camera') return 'camera';
  if (group === 'nodes' || path === 'scene.edgeVisibility' || path === 'scene.edgeBaseColor' ||
      path === 'scene.edgeVariationMin' || path === 'scene.edgeVariationRange' || path === 'scene.edgeFade') {
    return 'network';
  }
  if (group === 'pulses' || group === 'running') return 'motion';
  if (['activity', 'subagents', 'waiting', 'completion', 'impact'].includes(group) ||
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
      helpText: settingHelpText(definition, label),
      section: sectionForSetting(path),
      quick: QUICK_SETTINGS.has(path),
      suggestedRange: suggestedRange ? Object.freeze([...suggestedRange]) : null,
    })];
  })
));

const definitionsByGroup = new Map();
for (const definition of VISUAL_SETTING_DEFINITIONS) {
  const [group, name] = definition.path.split('.');
  if (!definitionsByGroup.has(group)) definitionsByGroup.set(group, new Map());
  definitionsByGroup.get(group).set(name, definition);
}

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
  addUnknownKeyIssues(overrides, definitionsByGroup, layerName, errors);
  for (const group of Reflect.ownKeys(overrides)) {
    const settings = overrides[group];
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

  const settings = cloneValue(defaults);
  for (const [layerName, overrides] of [
    [`preset:${presetName}`, VISUAL_PRESETS[presetName]],
    ['fileOverrides', fileOverrides],
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

  addUnknownKeyIssues(settings, definitionsByGroup, 'VISUAL', errors);
  for (const [group, definitions] of definitionsByGroup) {
    const values = settings[group];
    if (!Object.hasOwn(settings, group)) {
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
