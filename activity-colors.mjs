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

const SHELL_TOOLS = Object.freeze([
  'bash', 'powershell', 'shell', 'read_bash', 'write_bash', 'stop_bash',
]);
const EDIT_TOOLS = Object.freeze([
  'edit', 'create', 'write', 'apply_patch', 'str_replace_editor',
]);
const READ_TOOLS = Object.freeze([
  'view', 'read', 'grep', 'glob', 'search', 'rg', 'ls',
]);

function startsWith(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix);
}

export function activityCategory(value = {}) {
  const activity = value && typeof value === 'object' ? value : {};
  const { kind, eventType, toolName } = activity;

  if (kind === 'completion') return 'completion';
  if (eventType === 'session.error' || eventType === 'abort' || eventType === 'subagent.failed') {
    return 'error';
  }
  if (startsWith(eventType, 'permission.') ||
      startsWith(eventType, 'user_input.') ||
      startsWith(eventType, 'elicitation.')) return 'waiting';
  if (startsWith(eventType, 'subagent.')) return 'subagent';
  if (startsWith(eventType, 'tool.')) {
    if (SHELL_TOOLS.includes(toolName)) return 'shell';
    if (EDIT_TOOLS.includes(toolName)) return 'edit';
    if (READ_TOOLS.includes(toolName)) return 'read';
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
