export const RENDER_LIMITS = Object.freeze({
  maxDocumentBytes: 256 * 1024,
  maxFrontMatterBytes: 16 * 1024,
  maxRawBytes: 16 * 1024,
  maxMetadataDepth: 32,
  maxMetadataNodes: 1_000,
  maxRenderedNodes: 20_000,
  maxTimeMs: 250,
});

// Tests/integrators may tighten budgets, never silently raise the contract.
export function renderLimits(options = {}) {
  return Object.fromEntries(Object.entries(RENDER_LIMITS).map(([key, maximum]) => [
    key,
    Number.isSafeInteger(options[key]) && options[key] >= 0
      ? Math.min(options[key], maximum) : maximum,
  ]));
}

export function headingSlug(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/gu, '-') || 'heading';
}
