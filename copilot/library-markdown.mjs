import { clipUtf8, utf8ByteLength } from './library-text.mjs';
import { headingSlug, renderLimits } from './library-render-limits.mjs';

const TAGS = new Set([
  'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 's',
  'code', 'pre', 'br', 'hr', 'blockquote', 'ol', 'ul', 'li', 'table',
  'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd', 'a',
]);
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
// Semantic wrappers add DOM levels: YAML mapping -> dl/dd, Markdown list ->
// ul/li. Accommodate policy depth 32 and lexer depth 64 without unbounded DOM
// recursion; this does not relax either parser's source-nesting policy.
const MAX_DOM_DEPTH = 160;
let paneSequence = 0;

function resolveRelativeDestination(value, currentPath) {
  // Resolve against the current category-relative file and reject escapes
  // before consulting the server's already-discovered target map.
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false;
  if (typeof currentPath !== 'string' || currentPath.length === 0 || currentPath.length > 2_048) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/^[\\/]/u.test(decoded) ||
      /[\u0000-\u001f\u007f-\u009f\\:]/u.test(decoded) ||
      /&(?:#|[a-z][a-z\d]*;)/iu.test(decoded) ||
      decoded.startsWith('#') || decoded.includes('?')) return false;
  const relative = decoded.split('#', 1)[0];
  if (!relative) return false;
  const segments = currentPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\:\u0000-\u001f]/u.test(segment))) {
    return false;
  }
  segments.pop();
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return false;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? segments.join('/') : false;
}

function fragmentSlug(value) {
  try { return headingSlug(decodeURIComponent(value)); } catch { return null; }
}

/**
 * Standalone ticket-03 boundary; no dialog/API/activity/storage integration.
 * render(detail, { generation, fileIds, onNavigate?, signal?, limits? })
 * requires the caller's current snapshot generation and discovered file IDs.
 * Call cancel/clear on refresh, selection change and close. One live worker,
 * staged atomic DOM commit, and every old link/result guarded by task identity.
 */
export function createLibraryMarkdownRenderer({
  pane,
  workerFactory = () => new Worker(new URL('./library-markdown-worker.mjs', import.meta.url), { type: 'module' }),
}) {
  if (!pane?.ownerDocument) throw new TypeError('A Library content pane is required');
  const document = pane.ownerDocument;
  const paneId = ++paneSequence;
  let sequence = 0;
  let active = null;
  let disposed = false;

  const cancel = () => {
    if (!active) return;
    active.cancelled = true;
    active.stop();
    active = null;
  };
  const clear = () => { cancel(); pane.replaceChildren(); };
  const dispose = () => { clear(); disposed = true; };

  async function render(detail, options = {}) {
    cancel();
    if (disposed || !IDENTIFIER.test(options.generation ?? '') ||
        detail?.generation !== options.generation || options.signal?.aborted) {
      return { status: 'discarded' };
    }
    const limits = renderLimits(options.limits);
    const source = typeof detail.markdown === 'string' ? detail.markdown : '';
    const prefix = `library-pane-${paneId}-render-${++sequence}-`;
    const deadline = performance.now() + limits.maxTimeMs;
    const job = { cancelled: false, worker: null, stop: () => {} };
    active = job;
    const current = () => active === job && !job.cancelled && !disposed && !options.signal?.aborted;
    const check = () => {
      if (!current()) throw new Error('CANCELLED');
      if (performance.now() >= deadline) throw new Error('TIME_LIMIT');
    };
    const terminate = () => {
      if (job.worker) {
        job.worker.terminate();
        job.worker = null;
      }
    };
    const abort = () => { if (active === job) cancel(); };
    options.signal?.addEventListener('abort', abort, { once: true });

    const fallback = (reason) => {
      if (!current()) return { status: 'discarded' };
      const clipped = clipUtf8(source, limits.maxRawBytes);
      const message = reason === 'FRONT_MATTER_UNCLOSED'
        ? 'Front matter could not be parsed: no closing delimiter; no body was separated.'
        : reason === 'FRONT_MATTER_TOO_LARGE'
          ? 'Front matter could not be parsed: metadata size limit exceeded. Original source follows.'
          : 'Document could not be rendered safely (parser, DOM or time/resource limit). Original source follows.';
      const explanation = message + (clipped.truncated ? ' Source truncated at the raw-text limit.' : '');
      try {
        const warning = document.createElement('p');
        warning.setAttribute('role', 'status');
        warning.textContent = explanation;
        const pre = document.createElement('pre');
        pre.textContent = clipped.text;
        pane.replaceChildren(warning, pre);
      } catch {
        // Last-resort text-only sink even if element creation/replacement failed.
        // If even this DOM primitive fails, report failure rather than success.
        try { pane.textContent = `${explanation}\n${clipped.text}`; }
        catch { return { status: 'failed' }; }
      }
      return { status: 'fallback' };
    };

    try {
      if (typeof detail.markdown !== 'string' ||
          utf8ByteLength(source, limits.maxDocumentBytes) > limits.maxDocumentBytes) {
        return fallback('DOCUMENT_TOO_LARGE');
      }
      check();
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error = false) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          terminate();
          if (error) reject(new Error(value));
          else resolve(value);
        };
        const timer = setTimeout(() => finish('TIME_LIMIT', true), Math.max(0, deadline - performance.now()));
        job.stop = () => finish('CANCELLED', true);
        try {
          job.worker = workerFactory();
          job.worker.addEventListener('error', () => finish('PARSER_FAILURE', true));
          job.worker.addEventListener('message', ({ data }) => finish(data));
          job.worker.postMessage({ markdown: source, limits });
        } catch { finish('PARSER_FAILURE', true); }
      });
      check();
      if (result?.type === 'fallback') return fallback(result.reason);
      if (result?.type !== 'result' || !Array.isArray(result.nodes)) throw new Error('INVALID_PLAN');

      // Validate the worker's data a second time. Parser tokens, attributes and
      // HTML never enter a DOM parser, innerHTML, URLs, CSS or event attributes.
      let count = 0, textBytes = 0;
      const headings = new Map();
      const duplicateSlugs = new Map();
      const usedSlugs = new Set();
      const pendingLinks = [];
      const fragment = document.createDocumentFragment();
      const fileIds = new Set();
      if (Array.isArray(options.fileIds) && options.fileIds.length <= 2_000) {
        for (const id of options.fileIds) if (typeof id === 'string' && IDENTIFIER.test(id)) fileIds.add(id);
      }
      const mappings = new Map();
      const currentFile = detail.file;
      if (detail.links && typeof detail.links === 'object' &&
          currentFile && typeof currentFile.sourceId === 'string' &&
          typeof currentFile.category === 'string') {
        const entries = Object.entries(detail.links);
        if (entries.length <= 200) {
          for (const [destination, target] of entries) {
            const resolvedPath = resolveRelativeDestination(destination, currentFile.relativePath);
            if (!resolvedPath || !target || !fileIds.has(target.fileId) ||
                target.sourceId !== currentFile.sourceId || target.category !== currentFile.category ||
                typeof target.relativePath !== 'string' ||
                target.relativePath.toLowerCase() !== resolvedPath.toLowerCase() ||
                (target.fragment !== undefined &&
                 (typeof target.fragment !== 'string' || target.fragment.length > 200))) continue;
            mappings.set(destination, {
              fileId: target.fileId,
              ...(target.fragment !== undefined ? { fragment: target.fragment } : {}),
            });
          }
        }
      }
      const append = async (values, parent, depth = 0, inMetadata = false) => {
        if (!Array.isArray(values) || values.length > limits.maxRenderedNodes || depth > MAX_DOM_DEPTH) throw new Error('INVALID_PLAN');
        for (const value of values) {
          check();
          if (++count > limits.maxRenderedNodes) throw new Error('NODE_LIMIT');
          if (count % 128 === 0) {
            // Keep abort/selection/close responsive while building a detached tree.
            await new Promise((resolve) => setTimeout(resolve, 0));
            check();
          }
          if (typeof value === 'string') {
            textBytes += utf8ByteLength(value, limits.maxDocumentBytes + 1_024);
            if (textBytes > limits.maxDocumentBytes + 1_024) throw new Error('TEXT_LIMIT');
            parent.append(document.createTextNode(value));
            continue;
          }
          if (!value || !TAGS.has(value.tag) ||
              Object.keys(value).some((key) => !['tag', 'children', 'destination', 'metadata', 'start'].includes(key)) ||
              (value.metadata !== undefined && (value.tag !== 'section' || value.metadata !== true)) ||
              (value.start !== undefined && (value.tag !== 'ol' ||
                !Number.isSafeInteger(value.start) || value.start < 0 || value.start > 999_999_999)) ||
              (value.destination !== undefined && (value.tag !== 'a' || typeof value.destination !== 'string'))) {
            throw new Error('INVALID_PLAN');
          }
          // Links start as inert spans; upgrade only after all headings exist.
          const element = document.createElement(value.tag === 'a' ? 'span' : value.tag);
          if (value.start !== undefined) element.start = value.start;
          await append(value.children, element, depth + 1, inMetadata || value.metadata === true);
          if (/^h[1-6]$/u.test(value.tag) && !inMetadata) {
            const slug = headingSlug(element.textContent);
            let number = duplicateSlugs.get(slug) ?? 0;
            let unique = number ? `${slug}-${number}` : slug;
            while (usedSlugs.has(unique)) {
              number++;
              unique = `${slug}-${number}`;
            }
            duplicateSlugs.set(slug, number + 1);
            usedSlugs.add(unique);
            element.id = prefix + 'heading-' + unique;
            element.tabIndex = -1;
            if (!headings.has(unique)) headings.set(unique, element);
          }
          if (value.metadata) {
            const heading = element.firstElementChild;
            if (heading?.tagName !== 'H2') throw new Error('INVALID_PLAN');
            heading.id = prefix + 'metadata-label';
            element.setAttribute('aria-labelledby', heading.id);
          }
          if (value.tag === 'a') pendingLinks.push({ element, destination: value.destination });
          parent.append(element);
        }
      };
      await append(result.nodes, fragment);
      for (const { element, destination } of pendingLinks) {
        check();
        const heading = typeof destination === 'string' && destination.startsWith('#')
          ? headings.get(fragmentSlug(destination.slice(1))) : null;
        const target = mappings.get(destination);
        if (!heading && (!target || typeof options.onNavigate !== 'function')) continue;
        const link = document.createElement('a');
        if (++count > limits.maxRenderedNodes) throw new Error('NODE_LIMIT');
        link.href = `#${heading?.id ?? prefix + 'document'}`;
        link.append(...element.childNodes);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          if (!current()) return;
          if (heading) {
            heading.focus({ preventScroll: true });
            heading.scrollIntoView?.({ block: 'nearest' });
          } else {
            options.onNavigate({ ...target });
          }
        });
        link.addEventListener('auxclick', (event) => event.preventDefault());
        link.addEventListener('dragstart', (event) => event.preventDefault());
        element.replaceWith(link);
      }
      check();
      pane.replaceChildren(fragment);
      return { status: 'rendered' };
    } catch {
      return current() ? fallback('RENDER_FAILURE') : { status: 'discarded' };
    } finally {
      terminate();
      options.signal?.removeEventListener('abort', abort);
      // Retain task identity after completion to invalidate its DOM handlers on
      // the next cancel/render. No worker, timer or pending callback is retained.
      job.stop = () => {};
    }
  }

  return Object.freeze({ render, cancel, clear, dispose });
}
