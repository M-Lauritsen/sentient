import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { createLibraryDialog, createLibraryApi } from '../library/copilot-library-ui.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = (generation = 'g1') => ({
  generation, revision: 'r1', scannedAt: '2026-10-19T12:00:00Z',
  complete: true, truncated: false, warnings: [],
  sources: [
    { id: 'default', label: 'Default Copilot', isDefault: true, state: 'ready', categories: ['agents', 'skills'], warnings: [] },
    { id: 'extra', label: 'Folder 1', isDefault: false, state: 'empty', categories: ['agents'], warnings: [] },
  ],
  files: ['a', 'b'].map((id) => ({
    id, sourceId: 'default', category: 'agents', relativePath: `${id}.md`, title: `Title ${id}`, warnings: [],
  })),
});
const detail = (id, generation = 'g1') => ({
  generation, file: snapshot().files.find((file) => file.id === id),
  markdown: `PRIVATE DOCUMENT ${id}`, links: {}, warnings: [],
});
function setup(t, overrides = {}) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:12345/' });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new dom.window.Event('close')); };
  }
  const calls = [], renders = [], modal = [];
  const api = {
    list: async () => snapshot(),
    detail: async (id) => detail(id),
    refresh: async () => snapshot('g2'),
    add: async () => ({ rootId: 'extra', snapshot: snapshot('g2') }),
    remove: async () => ({ snapshot: snapshot('g2') }),
    ...overrides,
  };
  for (const [key, action] of Object.entries(api)) {
    api[key] = (...args) => { calls.push([key, ...args]); return action(...args); };
  }
  let cancelled = 0;
  const ui = createLibraryDialog({
    document, api, onModalChange: (open) => modal.push(open),
    rendererFactory: ({ pane }) => ({
      clear() { cancelled++; pane.replaceChildren(); },
      cancel() { cancelled++; },
      async render(value, options) {
        renders.push([value, options]);
        pane.textContent = value.markdown;
        return { status: 'rendered' };
      },
    }),
  });
  const get = (id) => document.getElementById(`library-${id}`);
  const click = (id) => get(id).click();
  const file = (id) => document.querySelector(`[data-library-file="${id}"]`);
  return { dom, document, ui, calls, renders, modal, get, click, file, cancelled: () => cancelled };
}

test('open is lazy, labeled, read-only, no document autoselection; browse source/category/file', async (t) => {
  const s = setup(t);
  assert.equal(s.calls.length, 0);
  s.click('open'); await tick();
  assert.equal(s.get('dialog').open, true);
  assert.equal(s.document.activeElement, s.get('close'));
  assert.match(s.get('dialog').textContent, /not active Copilot configuration/);
  assert.match(s.get('status').textContent, /2 shown/);
  assert.equal(s.renders.length, 0);
  s.file('a').click(); await tick();
  assert.equal(s.renders.length, 1);
  assert.match(s.get('breadcrumb').textContent, /Default Copilot.*agents.*a.md/);
  assert.equal(s.document.activeElement, s.get('document-title'));
  assert.deepEqual(s.renders[0][1].fileIds, ['a', 'b']);
  s.get('category').value = 'skills';
  s.get('category').dispatchEvent(new s.dom.window.Event('change'));
  assert.match(s.get('files').textContent, /No matching Markdown files/);
  assert.equal(s.get('content').textContent, '');
  s.get('source').value = 'extra';
  s.get('source').dispatchEvent(new s.dom.window.Event('change'));
  assert.equal(s.get('remove').hidden, false);
  assert.match(s.get('files').textContent, /No matching/);
});

test('lifecycle invalidation closes and clears selected Library detail; old reads cannot repopulate', async (t) => {
  const pending = deferred();
  let resets = 0;
  const s = setup(t, { detail: () => pending.promise, reset() { resets++; } });
  s.click('open'); await tick();
  s.file('a').click(); await tick();
  s.ui.invalidate();
  assert.equal(resets, 1);
  assert.equal(s.get('dialog').open, false);
  assert.equal(s.get('content').textContent, '');
  assert.equal(s.get('files').children.length, 0);
  pending.resolve(detail('a'));
  await tick();
  assert.equal(s.get('content').textContent, '');
  s.click('open'); await tick();
  assert.equal(s.get('dialog').open, true);
  assert.equal(s.get('content').textContent, '');
});

test('Library reset fences old bootstrap/read promises and requests a new independent capability', async () => {
  const old = deferred();
  let bootstraps = 0;
  const headers = [];
  const api = createLibraryApi(async (url, options) => {
    if (url.endsWith('/bootstrap')) {
      if (++bootstraps === 1) return old.promise;
      return { ok: true, json: async () => ({ token: 'new-library-token' }) };
    }
    headers.push(options.headers);
    return { ok: true, json: async () => snapshot('new-instance') };
  });
  const stale = api.list();
  api.reset();
  const fresh = await api.list();
  assert.equal(fresh.generation, 'new-instance');
  old.resolve({ ok: true, json: async () => ({ token: 'old-library-token' }) });
  await assert.rejects(stale, { code: 'FORBIDDEN' });
  await api.list();
  assert.equal(bootstraps, 2);
  assert.deepEqual(headers.map((value) => value['X-Sentient-Library-Token']),
    ['new-library-token', 'new-library-token']);
});

test('latest selection wins; stale detail and renderer link callbacks cannot navigate', async (t) => {
  const a = deferred(), b = deferred();
  const s = setup(t, { detail: (id) => id === 'a' ? a.promise : b.promise });
  s.click('open'); await tick();
  s.file('a').click(); s.file('b').click();
  b.resolve(detail('b')); await tick();
  a.resolve(detail('a')); await tick();
  assert.deepEqual(s.renders.map(([value]) => value.file.id), ['b']);
  const navigate = s.renders[0][1].onNavigate;
  s.click('refresh'); await tick();
  navigate('a'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'detail').length, 2);
});

test('refresh marks stale, suppresses navigation, clears detail on success and focuses Refresh', async (t) => {
  const pending = deferred();
  const s = setup(t, { refresh: () => pending.promise });
  s.click('open'); await tick(); s.file('a').click(); await tick();
  s.click('refresh');
  assert.match(s.get('status').textContent, /stale/i);
  assert.equal(s.get('add').disabled, true);
  assert.equal(s.get('source').disabled, true);
  assert.equal(s.file('a').disabled, true);
  assert.equal(s.get('content').textContent, '');
  pending.resolve(snapshot('g2')); await tick();
  assert.equal(s.document.activeElement, s.get('refresh'));
  assert.equal(s.get('document-title').textContent, 'Select a document');
});

test('failed refresh retains visibly stale timestamped list and actionable bounded errors', async (t) => {
  const s = setup(t, { refresh: async () => { throw Object.assign(new Error('C:\\PRIVATE\\secret'), { code: 'TIMEOUT' }); } });
  s.click('open'); await tick(); s.click('refresh'); await tick();
  assert.match(s.get('status').textContent, /stale.*2026-10-19/i);
  assert.match(s.get('error').textContent, /Refresh/);
  assert.doesNotMatch(s.get('dialog').textContent, /PRIVATE|secret/);
  assert.equal(s.file('a').disabled, true);
  assert.equal(s.get('refresh').disabled, false);
  assert.equal(s.get('add').disabled, true);
  assert.equal(s.get('remove').disabled, true);
});

test('add requires explicit mode/category/confirmation; input retained on error and cleared on cancel/success/close', async (t) => {
  let fail = true;
  const s = setup(t, { add: async () => {
    if (fail) throw Object.assign(new Error('PRIVATE'), { code: 'SETTINGS_CONFLICT' });
    return { rootId: 'extra', snapshot: snapshot('g2') };
  } });
  s.click('open'); await tick(); s.click('add');
  assert.equal(s.document.activeElement, s.get('path'));
  s.get('path').value = 'C:\\synthetic';
  s.click('save'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'add').length, 0);
  s.get('mode').value = 'category';
  s.get('mode').dispatchEvent(new s.dom.window.Event('change'));
  s.get('add-category').value = 'agents';
  s.get('confirm-scope').checked = true;
  s.click('save'); await tick();
  assert.equal(s.get('path').value, 'C:\\synthetic');
  assert.equal(s.document.activeElement, s.get('path'));
  assert.match(s.get('form-error').textContent, /restart/i);
  fail = false;
  assert.equal(s.get('save').disabled, true);
  s.click('save'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'add').length, 1);
  s.click('refresh'); await tick();
  assert.equal(s.get('path').value, 'C:\\synthetic');
  s.click('save'); await tick();
  assert.equal(s.get('path').value, '');
  assert.equal(s.get('source').value, 'extra');
  s.click('add'); s.get('path').value = 'cancel-secret'; s.click('cancel-add');
  assert.equal(s.get('path').value, '');
  s.click('add'); s.get('path').value = 'close-secret'; s.ui.close();
  assert.equal(s.get('path').value, '');
  assert.doesNotMatch(s.get('dialog').textContent, /synthetic|cancel-secret|close-secret/);
});

test('remove is unregister-only confirmation; failure retains selection and success returns default', async (t) => {
  let fail = true;
  const s = setup(t, { remove: async () => {
    if (fail) throw Object.assign(new Error(), { code: 'BUSY' });
    return { snapshot: snapshot('g2') };
  } });
  s.click('open'); await tick();
  assert.equal(s.get('remove').hidden, true);
  s.get('source').value = 'extra';
  s.get('source').dispatchEvent(new s.dom.window.Event('change'));
  s.click('remove');
  assert.match(s.get('remove-confirmation').textContent, /files will not be deleted/i);
  s.click('cancel-remove');
  assert.equal(s.calls.filter(([key]) => key === 'remove').length, 0);
  s.click('remove'); s.click('confirm-remove'); await tick();
  assert.equal(s.get('source').value, 'extra');
  fail = false; s.click('confirm-remove'); await tick();
  assert.equal(s.get('source').value, 'default');
});

test('close cancels reads, clears sensitive DOM, returns focus; late results cannot repopulate on reopen', async (t) => {
  const pending = deferred();
  let n = 0;
  const s = setup(t, { list: () => ++n === 1 ? pending.promise : Promise.resolve(snapshot('g2')) });
  s.click('open'); s.ui.close();
  assert.equal(s.document.activeElement, s.get('open'));
  s.click('open'); await tick(); pending.resolve(snapshot()); await tick();
  s.file('a').click(); await tick();
  assert.equal(s.renders.length, 0, 'old-generation detail must be rejected');
  s.ui.close();
  assert.equal(s.get('content').textContent, '');
  assert.equal(s.get('files').textContent, '');
  assert.deepEqual(s.modal, [true, false, true, false]);
});

test('mutation survives close but cannot repopulate; reopen waits then reconciles; no conflicting mutations', async (t) => {
  const pending = deferred();
  const s = setup(t, { refresh: () => pending.promise });
  s.click('open'); await tick(); s.click('refresh'); s.click('add'); s.click('refresh'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'refresh').length, 1);
  s.ui.close(); s.click('open'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'list').length, 1);
  pending.resolve(snapshot('late')); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'list').length, 2);
  assert.equal(s.get('document-title').textContent, 'Select a document');
  assert.equal(s.get('add-form').hidden, true);
});

test('detail error states clear content, retain refresh and never echo raw messages', async (t) => {
  for (const code of ['CONTENT_CHANGED', 'NOT_FOUND', 'UNSAFE_SOURCE', 'LIMIT_EXCEEDED', 'SOURCE_UNAVAILABLE']) {
    const s = setup(t, { detail: async () => { throw Object.assign(new Error('PRIVATE PATH'), { code }); } });
    s.click('open'); await tick(); s.file('a').click(); await tick();
    assert.equal(s.get('content').textContent, '');
    assert.match(s.get('error').textContent, /Refresh/);
    assert.doesNotMatch(s.get('dialog').textContent, /PRIVATE PATH/);
  }
});

test('source missing/error/partial and snapshot limits report shown counts, never false completeness', async (t) => {
  for (const state of ['empty', 'missing', 'error', 'partial']) {
    const value = snapshot();
    value.sources[0].state = state; value.complete = false; value.truncated = true;
    value.warnings = [{ code: 'SETTINGS_UNAVAILABLE', message: 'PRIVATE PATH' }];
    const s = setup(t, { list: async () => value });
    s.click('open'); await tick();
    assert.match(s.get('source-state').textContent, new RegExp(state === 'missing' ? 'missing' : state, 'i'));
    assert.match(s.get('status').textContent, /partial/i);
    assert.match(s.get('warnings').textContent, /registrations unavailable/i);
    assert.doesNotMatch(s.get('dialog').textContent, /PRIVATE PATH/);
  }
});

test('native modal coordination, Escape/Tab focus contract and scene event isolation', async (t) => {
  const s = setup(t);
  const other = s.document.getElementById('visual-settings-dialog');
  other.open = true; s.click('open'); await tick();
  assert.equal(s.get('dialog').open, false);
  other.open = false; s.click('open'); await tick();
  let leaked = 0;
  s.document.addEventListener('wheel', () => leaked++);
  s.get('dialog').dispatchEvent(new s.dom.window.WheelEvent('wheel', { bubbles: true }));
  assert.equal(leaked, 0);
  s.get('close').focus();
  s.get('close').dispatchEvent(new s.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.ok(s.get('dialog').contains(s.document.activeElement));
  s.get('dialog').dispatchEvent(new s.dom.window.Event('cancel', { cancelable: true }));
  assert.equal(s.get('dialog').open, false);
  assert.equal(s.document.activeElement, s.get('open'));
});

test('API uses same-origin/no-store, private header token, JSON mutations and bounded error codes', async () => {
  const calls = [];
  const api = createLibraryApi(async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => url.endsWith('/bootstrap') ? { token: 'TOKEN' } : snapshot() };
  });
  await Promise.all([api.list(), api.list()]);
  assert.equal(calls.filter(([url]) => url.endsWith('/bootstrap')).length, 1);
  await api.add({ revision: 'r1', path: 'C:\\synthetic', mode: 'root' });
  for (const [url, options] of calls) {
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.doesNotMatch(url, /TOKEN|synthetic/);
    if (!url.endsWith('/bootstrap')) assert.equal(options.headers['X-Sentient-Library-Token'], 'TOKEN');
  }
  assert.equal(calls.at(-1)[1].headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(calls.at(-1)[1].body).path, 'C:\\synthetic');
  const broken = createLibraryApi(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'PRIVATE' } }) }));
  await assert.rejects(broken.list(), (error) => !error.message.includes('PRIVATE'));
});

test('real API adapter: late read across close/reopen is aborted and cannot overwrite a new snapshot', async (t) => {
  const late = deferred(), requests = [];
  let reads = 0;
  const api = createLibraryApi(async (url, options) => {
    requests.push([url, options]);
    if (url.endsWith('/bootstrap')) return { ok: true, json: async () => ({ token: 'token' }) };
    if (url === '/api/library' && ++reads === 1) {
      // Deliberately ignore abort, just as a response already queued by fetch can.
      return { ok: true, json: () => late.promise };
    }
    return { ok: true, json: async () => snapshot('g2') };
  });
  const s = setup(t, api);
  s.click('open'); await tick();
  s.ui.close();
  assert.equal(requests.find(([url]) => url === '/api/library')[1].signal.aborted, true);
  s.click('open'); await tick();
  const freshCount = s.get('status').textContent;
  late.resolve({ ...snapshot(), scannedAt: 'OLD PRIVATE TIMESTAMP' }); await tick();
  assert.equal(s.get('status').textContent, freshCount);
  assert.doesNotMatch(s.get('dialog').textContent, /OLD PRIVATE/);
  assert.equal(requests.filter(([url]) => url.endsWith('/bootstrap')).length, 1);
});

test('detail aborts on next selection and close, stale success/error cannot focus or paint', async (t) => {
  const a = deferred(), b = deferred(), signals = [];
  const s = setup(t, { detail: (id, signal) => { signals.push(signal); return id === 'a' ? a.promise : b.promise; } });
  s.click('open'); await tick(); s.file('a').click(); s.file('b').click();
  assert.equal(signals[0].aborted, true);
  s.ui.close();
  assert.equal(signals[1].aborted, true);
  a.reject(new Error('PRIVATE')); b.resolve(detail('b')); await tick();
  assert.equal(s.renders.length, 0);
  assert.equal(s.document.activeElement, s.get('open'));
  assert.equal(s.get('error').textContent, '');
});

test('close synchronously after refresh still submits captured revision once and reconciles', async (t) => {
  const pending = deferred();
  const s = setup(t, { refresh: (body) => { assert.deepEqual(body, { revision: 'r1' }); return pending.promise; } });
  s.click('open'); await tick();
  s.click('refresh'); s.ui.close(); s.click('open'); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'refresh').length, 1);
  pending.resolve(snapshot('g2')); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'list').length, 2);
});

test('bootstrap/network/malformed-response errors are bounded and retryable by reopening', async (t) => {
  let fail = true;
  const api = createLibraryApi(async (url) => {
    if (fail) throw new Error('C:\\private\\credential');
    return { ok: true, json: async () => url.endsWith('/bootstrap') ? { token: 'token' } : snapshot() };
  });
  const s = setup(t, api);
  s.click('open'); await tick();
  assert.match(s.get('error').textContent, /reopen/);
  assert.doesNotMatch(s.get('dialog').textContent, /credential|C:\\private/);
  fail = false; s.ui.close(); s.click('open'); await tick();
  assert.ok(s.file('a'));
});

test('add and remove serialize against refresh; a late removal cannot restore removed source detail', async (t) => {
  const pending = deferred();
  const s = setup(t, { remove: () => pending.promise });
  s.click('open'); await tick();
  s.get('source').value = 'extra';
  s.get('source').dispatchEvent(new s.dom.window.Event('change'));
  s.click('remove'); s.click('confirm-remove'); s.click('refresh'); s.click('add');
  await tick();
  assert.equal(s.calls.filter(([key]) => ['remove', 'refresh', 'add'].includes(key)).length, 1);
  s.ui.close(); s.click('open'); await tick();
  const next = snapshot('g2'); next.sources.pop();
  pending.resolve({ snapshot: next }); await tick();
  assert.equal(s.get('source').value, 'default');
  assert.equal(s.renders.length, 0);
});

test('root-mode add saves exactly one confirmed scope, closes safely and reconciles before reopening', async (t) => {
  const pending = deferred();
  const s = setup(t, { add: (body) => {
    assert.deepEqual(body, { revision: 'r1', path: 'C:\\synthetic-root', mode: 'root' });
    return pending.promise;
  } });
  s.click('open'); await tick(); s.click('add');
  s.get('path').value = 'C:\\synthetic-root'; s.get('mode').value = 'root';
  s.get('confirm-scope').checked = true;
  s.click('save'); s.click('save'); await tick();
  assert.match(s.get('status').textContent, /Saving/);
  assert.equal(s.get('refresh').disabled, true);
  assert.equal(s.get('save').disabled, true);
  assert.equal(s.calls.filter(([key]) => key === 'add').length, 1);
  s.ui.close(); s.click('open'); await tick();
  assert.equal(s.get('path').value, '');
  assert.equal(s.calls.filter(([key]) => key === 'list').length, 1);
  pending.resolve({ rootId: 'extra', snapshot: snapshot('g2') }); await tick();
  assert.equal(s.calls.filter(([key]) => key === 'list').length, 2);
  assert.equal(s.get('source').value, 'default', 'late mutation UI result must not select a source on the new open');
});

test('refresh during a delayed detail read aborts it and discards both late success and failure', async (t) => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const s = setup(t, { detail: () => pending.promise });
    s.click('open'); await tick(); s.file('a').click(); s.click('refresh'); await tick();
    if (fail) pending.reject(new Error('PRIVATE')); else pending.resolve(detail('a'));
    await tick();
    assert.equal(s.renders.length, 0);
    assert.equal(s.get('error').textContent, '');
    assert.equal(s.document.activeElement, s.get('refresh'));
  }
});

test('UI integration is local, scoped and leaves activity/settings/timeline channels independent', async () => {
  const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../library/copilot-library-ui.mjs', import.meta.url), 'utf8');
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(main, /createLibraryDialog\(\{\s*document,/);
  assert.match(main, /controlsEnabledBeforeLibrary = controls.enabled/);
  assert.match(main, /controls.enabled = controlsEnabledBeforeLibrary/);
  assert.match(main, /if \(!libraryModalOpen\) controls.update\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|EventSource|\/events|console\.|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(server, /\['\/library\/copilot-library-ui\.mjs', \['library\/copilot-library-ui\.mjs'/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /font: 1rem\/1.5/);
  assert.match(css, /forced-colors: active/);
});

test('actual main modal callback suspends/restores scene input without changing camera or preview values', async () => {
  const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
  const block = main.slice(main.lastIndexOf('createLibraryDialog({'), main.indexOf('\nconst lifecycleStatus ='));
  for (const initiallyEnabled of [true, false]) {
    const controls = { enabled: initiallyEnabled, autoRotate: true, target: [1, 2, 3] };
    let callback;
    vm.runInNewContext(block, {
      controls, document: {}, libraryModalOpen: false, controlsEnabledBeforeLibrary: true,
      createLibraryDialog: (options) => { callback = options.onModalChange; },
    });
    callback(true);
    assert.equal(controls.enabled, false);
    assert.equal(controls.autoRotate, true);
    assert.deepEqual(controls.target, [1, 2, 3]);
    callback(false);
    assert.equal(controls.enabled, initiallyEnabled);
    assert.deepEqual(controls.target, [1, 2, 3]);
  }
});
