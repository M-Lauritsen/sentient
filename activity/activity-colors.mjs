export const CATEGORIES = Object.freeze([
  'completion', 'error', 'waiting', 'subagent', 'shell', 'edit',
  'read', 'tool', 'reasoning', 'lifecycle', 'unknown',
]);

export const CATEGORY_HEX = Object.freeze({
  completion: '#ff8a2a',
  error: '#ff5a6e',
  waiting: '#ff4fd8',
  subagent: '#a98bff',
  shell: '#ffc94a',
  edit: '#3ddc97',
  read: '#4fd6ff',
  tool: '#ff9f4a',
  reasoning: '#3d8bff',
  lifecycle: '#7f9cc9',
  unknown: '#5a6f99',
});

export const CATEGORY_GLYPH = Object.freeze({
  completion: '✓',
  error: '!',
  waiting: '…',
  subagent: '⑂',
  shell: '$',
  edit: '✎',
  read: '◇',
  tool: '›',
  reasoning: '~',
  lifecycle: '·',
  unknown: '?',
});

export const CATEGORY_RGB = Float32Array.from(CATEGORIES.flatMap((category) => {
  const hex = CATEGORY_HEX[category].slice(1);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}));

export const CATEGORY_INDEX = Object.freeze(Object.fromEntries(
  CATEGORIES.map((category, index) => [category, index]),
));

export const HOOK_TYPES = Object.freeze(['start', 'end', 'other']);
export const HOOK_DEFAULTS = Object.freeze({
  startColor: 0x5eead4,
  endColor: 0xc4b5fd,
  otherColor: 0x94a3b8,
  startImpact: 1,
  endImpact: 1,
  otherImpact: 0.5,
});

export function hookType(eventType) {
  if (typeof eventType !== 'string' || !eventType.startsWith('hook.')) return null;
  return eventType === 'hook.start' ? 'start' : eventType === 'hook.end' ? 'end' : 'other';
}

export function hookPalette(settings = HOOK_DEFAULTS) {
  return HOOK_TYPES.flatMap((type) => {
    const color = settings[`${type}Color`];
    return [16, 8, 0].map((shift) => ((color >> shift) & 0xff) / 255);
  });
}

export function createScenePalette(settings) {
  const hooks = settings.hooks ?? HOOK_DEFAULTS;
  return Float32Array.from([...CATEGORY_RGB, ...hookPalette(hooks)], (channel, index) => {
    const hook = HOOK_TYPES[Math.floor(index / 3) - CATEGORIES.length];
    const strength = hook ? hooks[`${hook}Impact`] : 1;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return settings.scene.categoryBrightness * linear * strength;
  });
}

export function applyHookColors(document, settings = HOOK_DEFAULTS) {
  for (const type of HOOK_TYPES) {
    document.documentElement.style.setProperty(`--hook-${type}`,
      `#${settings[`${type}Color`].toString(16).padStart(6, '0')}`);
  }
}

const SHELL_TOOLS = Object.freeze([
  'bash', 'powershell', 'shell', 'read_bash', 'write_bash', 'stop_bash',
]);
const EDIT_TOOLS = Object.freeze([
  'edit', 'create', 'write', 'apply_patch', 'str_replace_editor',
]);
const READ_TOOLS = Object.freeze([
  'view', 'read', 'read_file', 'get_file_contents', 'grep', 'glob', 'search',
  'search_code', 'search_wiki', 'microsoft_docs_search', 'microsoft_code_sample_search',
  'query-docs', 'resolve-library-id', 'rg', 'ls',
]);

function startsWith(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix);
}

function toolOperation(toolName) {
  if (typeof toolName !== 'string') return '';
  return toolName.slice(Math.max(
    toolName.lastIndexOf('.'),
    toolName.lastIndexOf('/'),
    toolName.lastIndexOf(':'),
  ) + 1);
}

export function activityCategory(value = {}) {
  const activity = value && typeof value === 'object' ? value : {};
  const { kind, eventType, toolName } = activity;
  const operation = toolOperation(toolName);

  if (kind === 'completion') return 'completion';
  if (eventType === 'session.error' || eventType === 'abort' || eventType === 'subagent.failed') {
    return 'error';
  }
  if (startsWith(eventType, 'permission.') ||
      startsWith(eventType, 'user_input.') ||
      startsWith(eventType, 'elicitation.')) return 'waiting';
  if (startsWith(eventType, 'subagent.')) return 'subagent';
  if (startsWith(eventType, 'tool.')) {
    if (SHELL_TOOLS.includes(operation)) return 'shell';
    if (EDIT_TOOLS.includes(operation)) return 'edit';
    if (READ_TOOLS.includes(operation)) return 'read';
    return 'tool';
  }
  if (kind === 'step') return 'tool';
  if (startsWith(eventType, 'assistant.reasoning') ||
      startsWith(eventType, 'assistant.message') ||
      eventType === 'assistant.turn_start' || kind === 'thinking') return 'reasoning';
  if (startsWith(eventType, 'session.') ||
      eventType === 'assistant.turn_end' ||
      startsWith(eventType, 'user.')) return 'lifecycle';
  return 'unknown';
}
