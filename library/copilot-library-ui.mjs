import { createLibraryMarkdownRenderer } from '../copilot/library-markdown.mjs';

// Never display server/OS exception text or retain token/path in browser storage.
const MESSAGES = {
  SETTINGS_CONFLICT: 'Registration settings changed. Refresh or reopen to reconcile; restart the app if the conflict remains. No save is confirmed.',
  SETTINGS_UNAVAILABLE: 'Viewing available; registrations unavailable. Check local settings permissions or restart; do not reset settings.',
  DUPLICATE_ROOT: 'That folder is already registered. Choose another folder.',
  OVERLAPPING_ROOT: 'That scope overlaps a registered folder. Choose a separate scope.',
  INVALID_PATH: 'Enter a supported absolute local folder path.',
  INVALID_MODE: 'Choose root mode or a category and confirm the scope.',
  UNSAFE_SOURCE: 'This source cannot be read safely. Choose a safe local folder or Refresh.',
  SAFETY_UNSUPPORTED: 'Safe reading is unavailable on this platform. Check the native helper and restart.',
  DEFAULT_ROOT: 'The default source cannot be unregistered.',
  CONTENT_CHANGED: 'The document changed. Refresh before selecting it again.',
  NOT_FOUND: 'The document is missing or its selection expired. Refresh to reconcile.',
  LIMIT_EXCEEDED: 'A safety limit was reached. Reduce the selected scope or choose a smaller document, then Refresh.',
  SOURCE_UNAVAILABLE: 'The source is unreadable. Check its availability and Refresh.',
  BUSY: 'Another operation is running. Wait, then retry.',
  TIMEOUT: 'The operation timed out. Refresh to reconcile before retrying.',
  FORBIDDEN: 'Library access expired or was denied. Close and reopen; restart if necessary.',
};
const messageFor = (error) => MESSAGES[error?.code] ??
  'Library operation failed. Refresh or close and reopen to retry. If a save was in progress, its outcome is unconfirmed.';

export function createLibraryApi(fetchImpl = globalThis.fetch.bind(globalThis)) {
  let tokenPromise;
  let generation = 0;
  const request = async (route, { method = 'GET', body, signal, bootstrap = false } = {}) => {
    const current = generation;
    const token = bootstrap ? null : await (tokenPromise ??= request('/api/library/bootstrap', { bootstrap: true })
      .then((value) => {
        if (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.token)) throw new Error('Invalid bootstrap');
        return value.token;
      }).catch((error) => { if (current === generation) tokenPromise = null; throw error; }));
    if (current !== generation) throw Object.assign(new Error('Library instance changed'), { code: 'FORBIDDEN' });
    const response = await fetchImpl(route, {
      mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      method, signal,
      headers: {
        ...(token ? { 'X-Sentient-Library-Token': token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (current !== generation) throw Object.assign(new Error('Library instance changed'), { code: 'FORBIDDEN' });
    if (!response.ok) {
      if (response.status === 403 && current === generation) tokenPromise = null;
      const code = Object.hasOwn(MESSAGES, value?.error?.code) ? value.error.code : 'INTERNAL_ERROR';
      throw Object.assign(new Error(messageFor({ code })), { code });
    }
    return value;
  };
  return {
    reset() { generation++; tokenPromise = null; },
    list: (signal) => request('/api/library', { signal }),
    detail: (id, signal) => request(`/api/library/files/${encodeURIComponent(id)}`, { signal }),
    refresh: (body) => request('/api/library/refresh', { method: 'POST', body }),
    add: (body) => request('/api/library/roots', { method: 'POST', body }),
    remove: (id, body) => request(`/api/library/roots/${encodeURIComponent(id)}`, { method: 'DELETE', body }),
  };
}

export function createLibraryDialog({
  document, api = createLibraryApi(), rendererFactory = createLibraryMarkdownRenderer,
  onModalChange = () => {},
}) {
  const get = (id) => document.getElementById(`library-${id}`);
  const dialog = get('dialog'), opener = get('open');
  const renderer = rendererFactory({ pane: get('content') });
  let epoch = 0, selection = 0, snapshot = null, stale = false, loading = false;
  let mutation = null, readController = null, detailController = null;
  let active = false;
  const current = (id) => active && dialog.open && epoch === id;
  const status = (text) => { get('status').textContent = text; };
  function error(error, form = false) {
    const target = get(form ? 'form-error' : 'error');
    target.textContent = messageFor(error);
    target.hidden = false;
    if (form) get('path').setAttribute('aria-invalid', 'true');
  }
  function clearErrors() {
    for (const id of ['error', 'form-error']) { get(id).hidden = true; get(id).textContent = ''; }
    get('path').removeAttribute('aria-invalid');
  }
  function clearDetail() {
    selection++;
    detailController?.abort();
    renderer.clear();
    get('document-title').textContent = 'Select a document';
    get('breadcrumb').textContent = '';
    get('detail-warnings').textContent = '';
    get('detail-warnings').hidden = true;
    get('detail').setAttribute('aria-busy', 'false');
    get('browser').classList.remove('library-document-open');
    for (const button of get('files').querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  }
  function clearForm() {
    get('add-form').reset();
    get('path').value = '';
    get('add-form').hidden = true;
    get('add-category').hidden = true;
    get('add-category-label').hidden = true;
    get('add-category').required = false;
    get('form-error').hidden = true;
    get('form-error').textContent = '';
    get('path').removeAttribute('aria-invalid');
    get('add').setAttribute('aria-expanded', 'false');
  }
  const selectedSource = () => snapshot?.sources.find((source) => source.id === get('source').value);
  function lockControls() {
    const busy = loading || !!mutation;
    // Keep the live status outside the busy subtree so loading is announced now,
    // not postponed until the operation has already completed.
    get('browser').setAttribute('aria-busy', String(busy));
    get('add-form').setAttribute('aria-busy', String(busy));
    for (const id of ['refresh', 'add', 'remove']) get(id).disabled = busy || (id !== 'refresh' && (!snapshot || stale));
    for (const id of ['source', 'category']) get(id).disabled = busy || stale || !snapshot;
    for (const button of get('files').querySelectorAll('button')) button.disabled = busy || stale;
    for (const id of ['path', 'mode', 'add-category', 'confirm-scope', 'save', 'confirm-remove', 'cancel-add', 'cancel-remove']) get(id).disabled = busy;
    get('save').disabled ||= stale;
    get('confirm-remove').disabled ||= stale;
  }
  function announceSnapshot() {
    const count = snapshot.files.filter((file) =>
      file.sourceId === get('source').value && file.category === get('category').value).length;
    status(`${stale ? 'Stale results' : 'Ready'} · ${count} shown files in this category · ${
      !snapshot.complete || snapshot.truncated ? 'Partial results; safety or source limits apply' : 'Snapshot'
    } · scanned ${snapshot.scannedAt}.`);
  }
  function warnings(values, target) {
    const codes = [...new Set((values ?? []).map((value) => value.code))];
    target.textContent = codes.map((code) => MESSAGES[code] ??
      'Some items are unavailable, excluded, unsafe or limited; shown results may be partial. Check the source and Refresh.').join(' ');
    target.hidden = codes.length === 0;
  }
  function renderFiles() {
    clearDetail();
    const source = selectedSource();
    const states = {
      ready: 'Source ready.',
      empty: 'Source empty. No matching Markdown files.',
      missing: 'Source missing. Default Copilot normally contains your local Copilot categories; no home path is displayed. Check availability and Refresh or Add folder.',
      error: 'Source error: unreadable or unsafe. Check availability and Refresh.',
      partial: 'Source partial: some files are unavailable or safety limits were reached. Refresh after checking the source.',
    };
    get('source-state').textContent = states[source?.state] ?? 'Source unavailable. Refresh.';
    get('remove').hidden = !source || source.isDefault;
    const files = snapshot.files.filter((file) => file.sourceId === source?.id && file.category === get('category').value);
    get('files').replaceChildren();
    for (const file of files) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.dataset.libraryFile = file.id;
      button.textContent = `${file.title || file.relativePath} — ${file.relativePath}`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectFile(file.id));
      item.append(button); get('files').append(item);
    }
    if (!files.length) {
      const item = document.createElement('li');
      item.textContent = 'No matching Markdown files. Refresh or Add folder.';
      get('files').append(item);
    }
    warnings([...(snapshot.warnings ?? []), ...(source?.warnings ?? [])], get('warnings'));
    announceSnapshot(); lockControls();
  }
  function options(select, values, valueFor, labelFor) {
    select.replaceChildren(...values.map((value) => {
      const option = document.createElement('option');
      option.value = valueFor(value); option.textContent = labelFor(value); return option;
    }));
  }
  function renderCategories() {
    options(get('category'), selectedSource()?.categories ?? [], (value) => value, (value) => value);
    renderFiles();
  }
  function accept(value, preferredSource) {
    // Server responses are trusted only as a complete API envelope, never HTML.
    if (!value || typeof value.generation !== 'string' || typeof value.revision !== 'string' ||
        !Array.isArray(value.sources) || !Array.isArray(value.files)) throw new Error('Invalid snapshot');
    snapshot = value; stale = false;
    options(get('source'), snapshot.sources, (source) => source.id, (source) => source.label);
    get('source').value = snapshot.sources.some((source) => source.id === preferredSource) ? preferredSource :
      (snapshot.sources.find((source) => source.isDefault)?.id ?? snapshot.sources[0]?.id ?? '');
    renderCategories();
  }
  async function selectFile(id, fragment) {
    if (!active || loading || mutation || stale || !snapshot) return;
    const file = snapshot.files.find((value) => value.id === id);
    if (!file) return;
    clearDetail(); clearErrors();
    const view = epoch, task = selection, generation = snapshot.generation;
    const valid = () => current(view) && task === selection && generation === snapshot?.generation && !stale;
    detailController = new AbortController();
    const signal = detailController.signal;
    get('detail').setAttribute('aria-busy', 'true');
    status('Loading selected document…');
    for (const button of get('files').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.libraryFile === id));
    }
    try {
      const value = await api.detail(id, signal);
      if (!valid()) return;
      if (value.generation !== generation || value.file?.id !== id || value.file?.sourceId !== file.sourceId ||
          value.file?.category !== file.category || value.file?.relativePath !== file.relativePath) {
        throw Object.assign(new Error(), { code: 'CONTENT_CHANGED' });
      }
      const result = await renderer.render(value, {
        generation, fileIds: snapshot.files.map((entry) => entry.id), signal,
        onNavigate: (target) => { if (valid()) selectFile(target?.fileId, target?.fragment); },
      });
      if (!valid()) return;
      if (result.status === 'failed' || result.status === 'discarded') throw new Error('Render failed');
      get('breadcrumb').textContent = `${snapshot.sources.find((source) => source.id === file.sourceId)?.label} / ${file.category} / ${file.relativePath}`;
      get('document-title').textContent = file.title || file.relativePath;
      warnings([...(file.warnings ?? []), ...(value.warnings ?? [])], get('detail-warnings'));
      // Tables/code are exceptions to reflow, each keyboard-scrollable and named.
      for (const element of get('content').querySelectorAll('pre, table')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'library-scroll-region'; wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', element.tagName === 'TABLE' ? 'Document table' : 'Document code');
        element.replaceWith(wrapper); wrapper.append(element);
      }
      get('browser').classList.add('library-document-open');
      get('detail').setAttribute('aria-busy', 'false');
      get('document-title').focus();
      get('document-title').scrollIntoView?.({ block: 'nearest' });
      // The renderer owns namespaced fragments. Never query outside its pane.
      if (fragment) {
        const heading = [...get('content').querySelectorAll('[id]')].find((node) => node.id.endsWith(`heading-${fragment}`));
        heading?.focus(); heading?.scrollIntoView?.({ block: 'nearest' });
      }
      status(`Selected ${file.relativePath}. Read-only document${result.status === 'fallback' ? '; safe text fallback' : ''}.`);
    } catch (failure) {
      if (!valid()) return;
      clearDetail(); error(failure);
      status('Document unavailable. Refresh before selecting again.');
    }
  }
  async function runMutation(kind, operation) {
    if (!active || mutation || loading || !snapshot || (kind !== 'refresh' && stale)) return;
    const view = epoch, previousSource = get('source').value;
    clearErrors();
    if (kind === 'refresh') { stale = true; clearDetail(); }
    status(kind === 'refresh' ? 'Scanning… old results are stale; navigation unavailable.' : 'Saving registration… conflicting actions unavailable.');
    // Defer invocation until the guard is installed, including synchronous failures.
    const pending = Promise.resolve().then(operation);
    mutation = pending; lockControls();
    try {
      const value = await pending;
      if (!current(view)) return;
      accept(kind === 'refresh' ? value : value.snapshot,
        kind === 'add' ? value.rootId : kind === 'remove' ? undefined : previousSource);
      if (kind === 'add') clearForm();
      get('remove-confirmation').hidden = true;
      status(`${kind === 'refresh' ? 'Refreshed snapshot' : 'Saved registration locally'}. ${get('status').textContent}`);
    } catch (failure) {
      if (!current(view)) return;
      if (kind === 'refresh') { announceSnapshot(); }
      else if (failure.code === 'SETTINGS_CONFLICT') {
        stale = true; clearDetail(); announceSnapshot();
      } else status('Registration failed; no save is confirmed. Check the error and retry.');
      error(failure, kind === 'add');
      if (kind === 'add') get('path').disabled = false;
      if (kind === 'add') get('path').focus();
    } finally {
      if (mutation === pending) mutation = null;
      if (current(view)) {
        lockControls();
        if (kind === 'refresh') get('refresh').focus();
        else if (get('add-form').hidden && get('remove-confirmation').hidden) get('source').focus();
      }
    }
  }
  async function open() {
    if (dialog.open || [...document.querySelectorAll('dialog[open]')].some((other) => other !== dialog)) return;
    active = true; const view = ++epoch;
    snapshot = null; stale = false; loading = true;
    clearErrors(); clearForm(); clearDetail();
    get('remove-confirmation').hidden = true;
    get('source').replaceChildren(); get('category').replaceChildren(); get('files').replaceChildren();
    get('warnings').textContent = ''; get('warnings').hidden = true;
    get('source-state').textContent = '';
    get('remove').hidden = true;
    dialog.showModal(); onModalChange(true);
    opener.setAttribute('aria-expanded', 'true'); get('close').focus();
    status(mutation ? 'Waiting for the previous save, then reconciling…' : 'Loading Library…');
    lockControls();
    try {
      if (mutation) await mutation.catch(() => {});
      if (!current(view)) return;
      readController = new AbortController();
      const value = await api.list(readController.signal);
      if (current(view)) accept(value);
    } catch (failure) {
      if (current(view)) { error(failure); status('Library unavailable. Refresh or reopen to retry.'); }
    } finally {
      if (current(view)) { loading = false; lockControls(); }
    }
  }
  function cleanup() {
    if (!active || dialog.open) return; // Ignore a queued close event after reopen.
    active = false; epoch++; loading = false;
    readController?.abort(); clearDetail(); clearForm(); clearErrors();
    snapshot = null;
    for (const id of ['files', 'source', 'category', 'source-state', 'warnings', 'status']) get(id).replaceChildren();
    get('remove-confirmation').hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    onModalChange(false); opener.focus({ preventScroll: true });
  }
  function close() { if (dialog.open) dialog.close(); cleanup(); }
  opener.addEventListener('click', open);
  get('close').addEventListener('click', close);
  dialog.addEventListener('close', cleanup);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  get('refresh').addEventListener('click', () => {
    if (!snapshot) { if (!loading && !mutation) { close(); open(); } return; }
    const body = { revision: snapshot.revision };
    runMutation('refresh', () => api.refresh(body));
  });
  get('source').addEventListener('change', () => {
    if (loading || mutation || stale) return;
    get('remove-confirmation').hidden = true; clearErrors(); renderCategories();
  });
  get('category').addEventListener('change', () => { if (!loading && !mutation && !stale) { clearErrors(); renderFiles(); } });
  get('add').setAttribute('aria-expanded', 'false');
  get('add').setAttribute('aria-controls', 'library-add-form');
  get('add').addEventListener('click', () => {
    if (loading || mutation || stale || !snapshot) return;
    clearErrors(); clearForm(); get('remove-confirmation').hidden = true;
    get('add-form').hidden = false; get('add').setAttribute('aria-expanded', 'true'); get('path').focus();
  });
  get('cancel-add').addEventListener('click', () => { clearForm(); get('add').focus(); });
  get('mode').addEventListener('change', () => {
    const category = get('mode').value === 'category';
    get('add-category').hidden = !category;
    get('add-category-label').hidden = !category; get('add-category').required = category;
  });
  get('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (mutation || loading || stale || !snapshot) return;
    const path = get('path').value.trim(), mode = get('mode').value, category = get('add-category').value;
    if (!path || !['root', 'category'].includes(mode) || (mode === 'category' && !category) || !get('confirm-scope').checked) {
      error({ code: 'INVALID_MODE' }, true); get('path').focus(); return;
    }
    const body = { revision: snapshot.revision, path, mode, ...(mode === 'category' ? { category } : {}) };
    runMutation('add', () => api.add(body));
  });
  get('remove').addEventListener('click', () => {
    if (loading || mutation || stale || !selectedSource() || selectedSource().isDefault) return;
    clearForm(); clearErrors(); get('remove-confirmation').hidden = false; get('cancel-remove').focus();
  });
  get('cancel-remove').addEventListener('click', () => { get('remove-confirmation').hidden = true; get('remove').focus(); });
  get('confirm-remove').addEventListener('click', () => {
    const source = selectedSource();
    if (!source || source.isDefault) return;
    const body = { revision: snapshot.revision };
    runMutation('remove', () => api.remove(source.id, body));
  });
  get('back').addEventListener('click', () => {
    get('browser').classList.remove('library-document-open');
    (get('files').querySelector('[aria-pressed="true"]') ?? get('category')).focus();
  });
  // Native showModal makes the background inert. Keep synthetic/programmatic
  // clicks from opening another app modal and avoid closing a settings preview.
  document.addEventListener('click', (event) => {
    if (active && !dialog.contains(event.target) && event.target !== opener) event.stopImmediatePropagation();
  }, true);
  for (const name of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keyup']) {
    dialog.addEventListener(name, (event) => event.stopPropagation());
  }
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, select, a[href], [tabindex]')]
      .filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]') &&
        ![node, ...ancestors(node, dialog)].some((element) => document.defaultView.getComputedStyle(element).display === 'none'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  });
  return {
    open, close,
    invalidate() {
      api.reset?.();
      close();
    },
  };
}

function ancestors(node, boundary) {
  const result = [];
  for (let parent = node.parentElement; parent && parent !== boundary; parent = parent.parentElement) result.push(parent);
  return result;
}
