// Pure helpers for previewing a hovered appearance setting in the live scene.
// Nothing here touches staged, saved or observed state.

export const DEMO_FOCUSES = Object.freeze(['hooks', 'impact', 'completion', 'waiting', 'running', 'pulses']);

const FOCUS_BY_PATH = new Map([
  ['effects.waitingGlow', 'waiting'],
  ['effects.waitingMarkers', 'waiting'],
  ['pulses.thinkingEdgeIntensity', 'running'],
  ['scene.categoryBrightness', 'pulses'],
]);
const FOCUS_BY_GROUP = new Map([
  ['hooks', 'hooks'],
  ['impact', 'impact'],
  ['completion', 'completion'],
  ['waiting', 'waiting'],
  ['running', 'running'],
  ['pulses', 'pulses'],
  ['activity', 'pulses'],
]);

// Rebuilds the network, re-rolls random per-node/per-edge values, creates a
// texture on every apply, or moves the camera abruptly: not swept.
const UNSWEPT_PATHS = new Set([
  'nodes.count',
  'nodes.largeChance', 'nodes.largeSizeMin', 'nodes.largeSizeRange',
  'nodes.baseSizeMin', 'nodes.baseSizeRange',
  'scene.edgeVariationMin', 'scene.edgeVariationRange',
  'scene.glowKnee', 'scene.glowKneeOpacity',
  'camera.damping', 'camera.minDistance', 'camera.maxDistance',
]);

export const SWEEP_PERIOD_MS = 2400;
export const TOGGLE_PERIOD_MS = 1000;
const SWEEP_SWING = 0.7;

export function demoFocusForPath(path) {
  if (typeof path !== 'string') return null;
  return FOCUS_BY_PATH.get(path) ?? FOCUS_BY_GROUP.get(path.split('.')[0]) ?? null;
}

export function sweepablePath(definition, presentation) {
  if (!definition || UNSWEPT_PATHS.has(definition.path)) return false;
  if (definition.type === 'boolean') return true;
  return definition.type === 'number' && definition.editor === 'number' &&
    Array.isArray(presentation?.suggestedRange);
}

function constrain(value, { minimum, maximum, exclusiveMinimum, exclusiveMaximum, integer } = {}) {
  let result = integer ? Math.round(value) : value;
  const step = integer ? 1 : 1e-6;
  if (minimum !== undefined) result = Math.max(minimum, result);
  if (exclusiveMinimum !== undefined && result <= exclusiveMinimum) result = exclusiveMinimum + step;
  if (maximum !== undefined) result = Math.min(maximum, result);
  if (exclusiveMaximum !== undefined && result >= exclusiveMaximum) result = exclusiveMaximum - step;
  return result;
}

// A smooth swing across ~70% of the suggested range that starts exactly at the
// current value; booleans flip once per TOGGLE_PERIOD_MS (well under 3 flashes/s).
export function previewSweepValue(definition, presentation, base, elapsedMs) {
  if (definition.type === 'boolean') {
    return Math.floor(elapsedMs / TOGGLE_PERIOD_MS) % 2 === 0 ? base : !base;
  }
  const low = Math.min(presentation.suggestedRange[0], base);
  const high = Math.max(presentation.suggestedRange[1], base);
  const half = (high - low) * SWEEP_SWING / 2;
  if (!(half > 0)) return base;
  const middle = Math.min(high - half, Math.max(low + half, base));
  const phase = Math.asin(Math.max(-1, Math.min(1, (base - middle) / half)));
  const value = middle + half * Math.sin((2 * Math.PI * elapsedMs) / SWEEP_PERIOD_MS + phase);
  return constrain(value, definition.constraints);
}

// Writes the swept value into `settings` (a caller-owned copy of the applied settings).
export function applyPreviewSweep(settings, definition, presentation, elapsedMs) {
  const [group, name] = definition.path.split('.');
  const base = settings[group][name];
  if (definition.path === 'camera.autoRotateSpeed') {
    const direction = base < 0 ? -1 : 1;
    settings.camera.autoRotate = true;
    settings.camera.autoRotateSpeed =
      direction * previewSweepValue(definition, presentation, Math.abs(base), elapsedMs);
    return settings;
  }
  settings[group][name] = previewSweepValue(definition, presentation, base, elapsedMs);
  return settings;
}
