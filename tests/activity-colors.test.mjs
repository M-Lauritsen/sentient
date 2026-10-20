import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  CATEGORIES, CATEGORY_GLYPH, CATEGORY_HEX, CATEGORY_INDEX, CATEGORY_RGB, activityCategory,
} from '../activity-colors.mjs';
import { createImpulseFeed } from '../activity-client.mjs';
import { createPageActivityTotals } from '../session-stats-ui.mjs';
import { createWorkspaceStore } from '../workspace-model.mjs';
import { createWorkspaceUI } from '../workspace-ui.mjs';

const root = new URL('../', import.meta.url);

test('activity category rules follow the documented first-match mapping', () => {
  const rows = [
    [{ kind: 'completion', eventType: 'session.task_complete' }, 'completion'],
    [{ kind: 'activity', eventType: 'session.error' }, 'error'],
    [{ kind: 'activity', eventType: 'abort' }, 'error'],
    [{ kind: 'activity', eventType: 'subagent.failed' }, 'error'],
    [{ kind: 'activity', eventType: 'permission.requested' }, 'waiting'],
    [{ kind: 'activity', eventType: 'user_input.completed' }, 'waiting'],
    [{ kind: 'activity', eventType: 'elicitation.requested' }, 'waiting'],
    [{ kind: 'activity', eventType: 'subagent.started' }, 'subagent'],
    ...['bash', 'powershell', 'shell', 'read_bash', 'write_bash', 'stop_bash', 'functions.powershell']
      .map((toolName) => [{ kind: 'activity', eventType: 'tool.execution_start', toolName }, 'shell']),
    ...['edit', 'create', 'write', 'apply_patch', 'str_replace_editor']
      .map((toolName) => [{ kind: 'activity', eventType: 'tool.execution_start', toolName }, 'edit']),
    ...['view', 'read', 'read_file', 'get_file_contents', 'grep', 'glob', 'search',
      'search_code', 'search_wiki', 'microsoft_docs_search', 'microsoft_code_sample_search',
      'query-docs', 'resolve-library-id', 'rg', 'ls']
      .map((toolName) => [{ kind: 'activity', eventType: 'tool.execution_start', toolName }, 'read']),
    ...['functions.view', 'functions.rg', 'github-mcp-server/search_code',
      'github-mcp-server/get_file_contents', 'context7/query-docs']
      .map((toolName) => [{ kind: 'activity', eventType: 'tool.execution_start', toolName }, 'read']),
    [{ kind: 'activity', eventType: 'tool.execution_start', toolName: 'functions.apply_patch' }, 'edit'],
    [{ kind: 'activity', eventType: 'tool.execution_complete', toolName: 'view' }, 'read'],
    [{ kind: 'step' }, 'tool'],
    [{ kind: 'activity', eventType: 'assistant.message_delta' }, 'reasoning'],
    [{ kind: 'activity', eventType: 'assistant.reasoning_delta' }, 'reasoning'],
    [{ kind: 'activity', eventType: 'assistant.turn_start' }, 'reasoning'],
    [{ kind: 'thinking' }, 'reasoning'],
    [{ kind: 'activity', eventType: 'session.shutdown' }, 'lifecycle'],
    [{ kind: 'activity', eventType: 'assistant.turn_end' }, 'lifecycle'],
    [{ kind: 'activity', eventType: 'user.message' }, 'lifecycle'],
    [{ kind: 'activity', eventType: 'future.new_event' }, 'unknown'],
    [{ kind: 'activity' }, 'unknown'],
    [{ kind: 'step', eventType: 'subagent.failed' }, 'error'],
    [{ kind: 'thinking', eventType: 'subagent.failed' }, 'error'],
  ];
  for (const [activity, expected] of rows) {
    assert.equal(activityCategory(activity), expected, JSON.stringify(activity));
  }
});

test('missing and malformed metadata is safe and tool completion has no inferred success', () => {
  for (const value of [undefined, null, 7, 'activity', [], { kind: null }, { eventType: 42 }]) {
    assert.doesNotThrow(() => activityCategory(value));
  }
  assert.equal(activityCategory(), 'unknown');
  assert.equal(activityCategory(null), 'unknown');
  assert.equal(activityCategory({ kind: 'activity', eventType: 'tool.execution_complete' }), 'tool');
  assert.equal(activityCategory({ kind: 'activity', eventType: 'tool.execution_start', toolName: 'VIEW' }), 'tool');
  assert.equal(activityCategory({ kind: 'activity', eventType: 'tool.execution_start', toolName: 'bad name' }), 'tool');
});

test('category exports are ordered, frozen where supported, and RGB data is precomputed', () => {
  assert.deepEqual(CATEGORIES, [
    'completion', 'error', 'waiting', 'subagent', 'shell', 'edit',
    'read', 'tool', 'reasoning', 'lifecycle', 'unknown',
  ]);
  assert.ok(Object.isFrozen(CATEGORIES));
  assert.ok(Object.isFrozen(CATEGORY_HEX));
  assert.ok(Object.isFrozen(CATEGORY_INDEX));
  assert.equal(CATEGORY_RGB.length, CATEGORIES.length * 3);
  for (const [index, category] of CATEGORIES.entries()) {
    assert.equal(CATEGORY_INDEX[category], index);
    assert.match(CATEGORY_HEX[category], /^#[0-9a-f]{6}$/);
    assert.equal(typeof CATEGORY_GLYPH[category], 'string');
    assert.ok(CATEGORY_GLYPH[category].length > 0);
    const hex = CATEGORY_HEX[category].slice(1);
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(CATEGORY_RGB[index * 3 + channel] - parseInt(hex.slice(channel * 2, channel * 2 + 2), 16) / 255) < 1e-6);
    }
  }
});

test('CSS palette matches the module and feed text colors meet 4.5:1 except unknown fallback', async () => {
  const css = await readFile(new URL('style.css', root), 'utf8');
  const variables = Object.fromEntries([...css.matchAll(/--c-([a-z]+):\s*(#[0-9a-f]{6})\s*;/gi)]
    .map((match) => [match[1], match[2].toLowerCase()]));
  for (const category of CATEGORIES) {
    assert.equal(variables[category], CATEGORY_HEX[category], `${category} CSS parity`);
  }
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const background = luminance('#020409');
  for (const category of CATEGORIES.filter((name) => name !== 'unknown')) {
    assert.ok((luminance(CATEGORY_HEX[category]) + 0.05) / (background + 0.05) >= 4.5, category);
  }
  assert.match(css, /\.impulse-cat-unknown\s*\{[^}]*color:\s*var\(--text\)/s);
});

test('Workspace legend renders every category with a glyph and swatch', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="workspace-open">Workspace</button>
    <main id="workspace">
      <section data-workspace-dock="left"></section>
      <section data-workspace-dock="right"></section>
      <section data-workspace-dock="bottom-left"></section>
      <section data-workspace-dock="bottom"></section>
      <div data-workspace-assets hidden></div>
    </main>
  </body></html>`, { url: 'http://127.0.0.1/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  const { document } = dom.window;
  const ui = createWorkspaceUI({
    document,
    root: document.getElementById('workspace'),
    opener: document.getElementById('workspace-open'),
    store: createWorkspaceStore({ storage: dom.window.localStorage }),
    feed: createImpulseFeed(),
    pageActivityTotals: createPageActivityTotals(),
  });
  ui.update({ connection: 'connected', sourceStatus: 'available', coverage: 'complete', sessions: [] });
  document.querySelector('.workspace-settings-open').click();
  const type = document.querySelector('.workspace-catalog select');
  type.value = 'legend';
  type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  document.querySelector('.workspace-catalog button').click();
  const rows = [...document.querySelectorAll(
    '[data-module-type="legend"] .activity-legend-list .legend-row',
  )];
  assert.equal(rows.length, CATEGORIES.length);
  for (const category of CATEGORIES) {
    const row = rows.find((item) => item.dataset.category === category);
    assert.ok(row, `${category} legend row exists`);
    assert.ok(row.classList.contains(`impulse-cat-${category}`));
    assert.equal(row.querySelector('.legend-swatch').textContent, CATEGORY_GLYPH[category]);
    assert.notEqual(row.querySelector('.legend-swatch').style.backgroundColor, '');
    assert.equal(row.querySelector('.legend-name').textContent, category);
  }
});
