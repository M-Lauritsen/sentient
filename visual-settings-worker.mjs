import { resolveVisualSettings } from './visual-config.mjs';

try {
  const module = await import('./visual-settings.mjs');
  const resolved = resolveVisualSettings(
    module.VISUAL, module.VISUAL_PRESET, module.VISUAL_OVERRIDES);
  const errors = Array.isArray(module.VISUAL_ERRORS) && module.VISUAL_ERRORS.length
    ? module.VISUAL_ERRORS : resolved.errors;
  self.postMessage({
    defaults: module.VISUAL,
    preset: module.VISUAL_PRESET,
    overrides: module.VISUAL_OVERRIDES,
    settings: errors.length ? null : resolved.settings,
    errors,
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  self.postMessage({
    defaults: null,
    preset: null,
    overrides: null,
    settings: null,
    errors: [{ path: 'visual-settings.mjs', message: `Could not load configuration module: ${detail}` }],
  });
}
