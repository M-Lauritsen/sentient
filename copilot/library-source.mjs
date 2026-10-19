import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { LibraryNative } from './library-native.mjs';

const CATEGORIES = ['agents', 'skills', 'instructions'];
const EXCLUDED = new Set(['session-state', '.git', 'node_modules']);
const ID = /^[A-Za-z0-9_-]{24,64}$/u;
const DEFAULTS = Object.freeze({
  maxSources: 16, maxDepth: 12, maxVisited: 10_000, maxFiles: 2_000,
  sourceMs: 5_000, requestMs: 15_000, maxSnapshotBytes: 2 * 1024 * 1024,
});
const token = () => randomBytes(24).toString('base64url');
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const warning = (code, fields = {}) => ({ code, ...fields, message: {
  SETTINGS_UNAVAILABLE: 'Registrations unavailable. Repair protected settings externally and restart; default viewing may still work.',
  SETTINGS_CONFLICT: 'Settings changed in another instance. Restart before retrying.',
  LIMIT_EXCEEDED: 'A Library limit was reached. Only shown files are included.',
  TIMEOUT: 'Library work reached its time limit. Results may be partial.',
  NOT_FOUND: 'This source is missing.',
  UNSAFE_SOURCE: 'This source could not be opened safely.',
  SAFETY_UNSUPPORTED: 'Verified Windows Library safety is unavailable. Build the native helper on a supported system.',
  SOURCE_UNAVAILABLE: 'This source could not be read.',
  CONTENT_CHANGED: 'This source changed. Refresh before reading.',
  UNSUPPORTED_CONTENT: 'This document is not supported UTF-8 Markdown.',
}[code] ?? 'Some document information could not be shown safely.' });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const decode = (encoded) => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
    if (text.includes('\0')) fail('UNSUPPORTED_CONTENT');
    return text;
  } catch { fail('UNSUPPORTED_CONTENT'); }
};

export function validateLibraryPath(input) {
  if (typeof input !== 'string' || input.length > 1024 || !/^[A-Za-z]:\\/u.test(input) || /[\p{Cc}/]/u.test(input)) fail('INVALID_PATH');
  const parts = input.slice(3).split('\\');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /[<>:"|?*]/u.test(part) ||
      part.toLowerCase() === 'session-state' ||
      /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) fail('INVALID_PATH');
  return input[0].toUpperCase() + input.slice(1);
}

class Parser {
  #worker;
  #pending;
  #id = 0;
  #dead = false;
  #termination;
  constructor() {
    this.#worker = new Worker(new URL('./library-metadata-worker.mjs', import.meta.url));
    this.#worker.on('message', ({ id, value, error }) => {
      const pending = this.#pending;
      if (!pending || id !== pending.id) return this.#stop('UNSUPPORTED_CONTENT');
      clearTimeout(pending.timer);
      this.#pending = undefined;
      if (error) pending.reject(Object.assign(new Error(error), { code: error }));
      else pending.resolve(value);
    });
    this.#worker.on('error', () => this.#stop('UNSUPPORTED_CONTENT'));
    this.#worker.on('exit', () => this.#stop('UNSUPPORTED_CONTENT'));
  }
  #stop(code) {
    this.#dead = true;
    const pending = this.#pending;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending = undefined;
    }
    this.#termination ??= this.#worker.terminate();
    if (pending) this.#termination.then(() => pending.reject(Object.assign(new Error(code), { code })));
    return this.#termination;
  }
  run(op, text, basename, { timeoutMs = 250 } = {}) {
    if (this.#dead) return Promise.reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
    if (this.#pending) return Promise.reject(Object.assign(new Error('BUSY'), { code: 'BUSY' }));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#stop('TIMEOUT'), Math.max(1, Math.min(250, timeoutMs)));
      this.#pending = { id, resolve, reject, timer };
      this.#worker.postMessage({ id, op, text, basename });
    });
  }
  async close() { await this.#stop('SOURCE_UNAVAILABLE'); }
}

export function createLibrarySource({
  defaultRoot = path.join(os.homedir(), '.copilot'),
  settingsPath, executable, limits = {}, now = Date.now, monotonicNow = () => performance.now(),
  nativeFactory = (options) => new LibraryNative(options), parserFactory = () => new Parser(),
} = {}) {
  const budget = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key,
    Number.isSafeInteger(limits[key]) && limits[key] > 0 ? Math.min(value, limits[key]) : value]));
  let native = nativeFactory({ executable, timeoutMs: Math.min(budget.sourceMs, budget.requestMs) });
  let parser = parserFactory(), restartNative = false, restartParser = false, operationDeadline;
  let initialized = false, busy = false, closed = false, settingsOK = true;
  let diskSignature, revision = token(), snapshot, files = new Map();
  let roots = [{ id: token(), label: 'Default Copilot', path: defaultRoot, mode: 'root', isDefault: true }];
  let nextLabel = 1;
  const settingsWarning = () => warning('SETTINGS_UNAVAILABLE');
  const remaining = (deadline = operationDeadline) => {
    const value = deadline - monotonicNow();
    if (value <= 0) fail('TIMEOUT');
    return value;
  };
  async function call(request, deadline = operationDeadline) {
    const timeoutMs = remaining(deadline);
    if (restartNative) {
      native = nativeFactory({ executable, timeoutMs: Math.min(budget.sourceMs, budget.requestMs) });
      restartNative = false;
    }
    try {
      const result = await native.request(request, { timeoutMs });
      remaining(deadline);
      return result;
    } catch (error) {
      if (error.code === 'TIMEOUT' || error.code === 'SAFETY_UNSUPPORTED') {
        await native.close();
        restartNative = true; // Fresh process only on the next operation, NEVER an implicit retry.
      }
      throw error;
    }
  }
  async function parse(op, text, basename, deadline = operationDeadline) {
    const timeoutMs = Math.min(250, remaining(deadline));
    if (restartParser) { parser = parserFactory(); restartParser = false; }
    try {
      const result = await parser.run(op, text, basename, { timeoutMs });
      remaining(deadline);
      return result;
    } catch (error) {
      if (error.code === 'TIMEOUT') { await parser.close(); restartParser = true; }
      throw error;
    }
  }
  function sourcePath(absolute) {
    validateLibraryPath(absolute);
    if (absolute.slice(3).split('\\').some((part) => EXCLUDED.has(part.toLowerCase()))) fail('UNSAFE_SOURCE');
  }

  function validateRecords(value) {
    if (!exact(value, ['version', 'revision', 'additionalRoots']) || value.version !== 1 || !ID.test(value.revision) ||
        !Array.isArray(value.additionalRoots) || value.additionalRoots.length > budget.maxSources) fail('SETTINGS_UNAVAILABLE');
    for (const record of value.additionalRoots) {
      if (!exact(record, ['path', 'mode', 'category'])) fail('SETTINGS_UNAVAILABLE');
      sourcePath(record.path);
      validateMode(record);
    }
    return value;
  }
  function validateMode(record) {
    if (record.mode !== 'root' && record.mode !== 'category' || record.mode === 'root' && 'category' in record ||
        record.mode === 'category' && !CATEGORIES.includes(record.category)) fail('INVALID_MODE');
  }
  async function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      if (settingsPath === undefined) {
        const known = await call({ op: 'settingsLocation' });
        const env = process.env.LOCALAPPDATA;
        if (!env || validateLibraryPath(env).toLowerCase() !== validateLibraryPath(known.path).toLowerCase()) fail('SETTINGS_UNAVAILABLE');
        settingsPath = path.win32.join(known.path, 'SENTIENT', 'library');
      }
      validateLibraryPath(settingsPath);
      const stored = await call({ op: 'settingsRead', path: settingsPath });
      diskSignature = stored.signature;
      if (stored.signature !== 'missing') {
        const value = validateRecords(await parse('settings', decode(stored.data)));
        revision = value.revision;
        roots.push(...value.additionalRoots.map((record) => ({ ...record, id: token(), label: `Folder ${nextLabel++}`, isDefault: false })));
      }
    } catch {
      settingsOK = false;
    }
  }
  async function exclusive(action) {
    if (closed) fail('SOURCE_UNAVAILABLE');
    if (busy) fail('BUSY');
    busy = true;
    operationDeadline = monotonicNow() + budget.requestMs;
    try { await initialize(); return await action(); } finally { busy = false; }
  }
  function assertRevision(expected) {
    if (!settingsOK) fail('SETTINGS_UNAVAILABLE');
    if (expected !== revision) fail('SETTINGS_CONFLICT');
  }
  async function assertDisk() {
    const result = await call({ op: 'settingsRead', path: settingsPath });
    if (result.signature !== diskSignature) fail('SETTINGS_CONFLICT');
  }
  const prefix = (a, b) => a.length <= b.length && a.every((id, index) => id === b[index]);
  function overlap(a, b) {
    if (a.chain && b.chain) {
      if (a.chain.at(-1) === b.chain.at(-1)) return 'DUPLICATE_ROOT';
      if (prefix(a.chain, b.chain) || prefix(b.chain, a.chain)) return 'OVERLAPPING_ROOT';
    }
    const pa = path.win32.normalize(a.path).toLowerCase(), pb = path.win32.normalize(b.path).toLowerCase();
    if (pa === pb) return 'DUPLICATE_ROOT';
    if (pa.startsWith(pb + '\\') || pb.startsWith(pa + '\\')) return 'OVERLAPPING_ROOT';
    return null;
  }
  async function identify(root, deadline) {
    sourcePath(root.path);
    const value = await call({ op: 'identify', path: root.path, expectedChain: root.chain }, deadline);
    sourcePath(value.path);
    return { ...root, path: value.path, chain: value.chain, canonical: value.canonical };
  }
  async function scan(inputRoots, nextRevision) {
    const generation = token(), nextFiles = new Map(), summaries = [], sources = [], warnings = [];
    let snapshotSize = 0, truncated = false, sizeLimited = false;
    const nextRoots = [];
    if (!settingsOK) warnings.push(settingsWarning());
    for (const original of inputRoots) {
      const source = { id: original.id, label: original.label, mode: original.mode,
        ...(original.category ? { category: original.category } : {}), isDefault: original.isDefault,
        state: 'empty', categories: original.mode === 'root' ? [...CATEGORIES] : [original.category], warnings: [] };
      sources.push(source);
      let root = original, visited = 0, included = 0, partial = false;
      const sourceStart = monotonicNow();
      const deadline = Math.min(operationDeadline, sourceStart + budget.sourceMs);
      const warn = (code, category) => {
        const item = warning(code, { sourceId: source.id, ...(category ? { category } : {}) });
        if (!source.warnings.some((value) => value.code === item.code && value.category === item.category)) source.warnings.push(item);
        partial = true;
        if (code === 'LIMIT_EXCEEDED' || code === 'TIMEOUT') truncated = true;
      };
      const check = () => {
        remaining(deadline);
        if (visited >= budget.maxVisited || summaries.length >= budget.maxFiles || sizeLimited) fail('LIMIT_EXCEEDED');
      };
      try {
        check();
        root = await identify(original, deadline);
        for (const previous of nextRoots) {
          const problem = overlap(root, previous);
          if (problem) fail('UNSAFE_SOURCE');
        }
        const categoryRoots = root.mode === 'root'
          ? CATEGORIES.map((category) => ({ category, directory: path.win32.join(root.path, category) }))
          : [{ category: root.category, directory: root.path }];
        for (const { category, directory } of categoryRoots) {
          const pending = [{ directory, relative: '', depth: 0 }];
          const categoryFiles = [];
          while (pending.length) {
            const folder = pending.pop();
            try {
              check();
              const result = await call({ op: 'inspect', path: folder.directory, rootChain: root.chain, limit: Math.max(1, budget.maxVisited - visited) }, deadline);
              if (result.truncated) warn('LIMIT_EXCEEDED', category);
              const entries = result.entries.sort((a, b) => compare(a.name, b.name));
              for (const entry of entries) {
                check();
                visited++;
                if (EXCLUDED.has(entry.name.toLowerCase())) continue;
                if (entry.reparse) { warn('UNSAFE_SOURCE', category); continue; }
                const absolute = path.win32.join(folder.directory, entry.name);
                const relative = folder.relative ? `${folder.relative}/${entry.name}` : entry.name;
                try {
                  validateLibraryPath(absolute);
                  if (entry.directory) {
                    if (folder.depth >= budget.maxDepth) { warn('LIMIT_EXCEEDED', category); continue; }
                    pending.push({ directory: absolute, relative, depth: folder.depth + 1 });
                  } else if (/\.md$/iu.test(entry.name)) {
                    const opened = await call({ op: 'read', path: absolute, rootChain: root.chain }, deadline);
                    check();
                    const markdown = decode(opened.data);
                    const summary = await parse('summary', markdown, entry.name, deadline);
                    const id = token();
                    const file = { id, sourceId: source.id, category, relativePath: relative, kind: 'entry',
                      title: summary.title, ...(summary.description ? { description: summary.description } : {}),
                      warnings: summary.warnings.map((code) => warning(code, { fileId: id })) };
                    const bytes = Buffer.byteLength(JSON.stringify(file));
                    if (snapshotSize + bytes > budget.maxSnapshotBytes) {
                      sizeLimited = true;
                      warn('LIMIT_EXCEEDED', category);
                      break;
                    }
                    snapshotSize += bytes;
                    summaries.push(file); categoryFiles.push(file); included++;
                    nextFiles.set(id, { absolute, chain: opened.chain, signature: opened.signature, file, rootChain: root.chain });
                  }
                } catch (error) { warn(error.code || 'SOURCE_UNAVAILABLE', category); }
              }
              if (sizeLimited) break;
            } catch (error) {
              if (error.code !== 'NOT_FOUND' || folder.relative !== '' || root.mode !== 'root') warn(error.code || 'SOURCE_UNAVAILABLE', category);
              if (error.code === 'TIMEOUT' || error.code === 'LIMIT_EXCEEDED') break;
            }
          }
          classifySkills(categoryFiles);
        }
        source.state = partial ? 'partial' : included ? 'ready' : 'empty';
      } catch (error) {
        source.state = error.code === 'NOT_FOUND' ? 'missing' : 'error';
        warn(error.code || 'SOURCE_UNAVAILABLE');
      }
      nextRoots.push(root);
    }
    remaining();
    summaries.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || compare(a.relativePath, b.relativePath) || compare(a.sourceId, b.sourceId));
    const relinkSkills = () => {
      for (const source of sources) {
        const skillFiles = summaries.filter((file) => file.sourceId === source.id && file.category === 'skills');
        for (const file of skillFiles) {
          file.kind = 'entry';
          delete file.skillEntryId;
        }
        classifySkills(skillFiles);
      }
    };
    const buildValue = () => {
      warnings.length = 0;
      if (!settingsOK) warnings.push(settingsWarning());
      for (const source of sources) warnings.push(...source.warnings);
      return {
        generation, revision: nextRevision, scannedAt: new Date(now()).toISOString(),
        complete: warnings.length === 0, truncated, warnings, sources, files: summaries,
      };
    };
    let value = buildValue();
    while (Buffer.byteLength(JSON.stringify(value)) > budget.maxSnapshotBytes && summaries.length) {
      const removed = summaries.pop();
      nextFiles.delete(removed.id);
      const source = sources.find((item) => item.id === removed.sourceId);
      source.state = 'partial';
      if (!source.warnings.some((item) => item.code === 'LIMIT_EXCEEDED' && item.category === removed.category)) {
        source.warnings.push(warning('LIMIT_EXCEEDED', { sourceId: source.id, category: removed.category }));
      }
      truncated = true;
      relinkSkills();
      value = buildValue();
    }
    if (Buffer.byteLength(JSON.stringify(value)) > budget.maxSnapshotBytes) fail('LIMIT_EXCEEDED');
    return { value, roots: nextRoots, files: nextFiles };
  }
  function publish(result) {
    snapshot = result.value; roots = result.roots; files = result.files;
    return structuredClone(snapshot);
  }
  async function persist(nextRoots, nextRevision) {
    const additionalRoots = nextRoots.filter((root) => !root.isDefault).map(({ path: absolute, mode, category }) => ({
      path: absolute, mode, ...(mode === 'category' ? { category } : {}),
    }));
    const bytes = Buffer.from(JSON.stringify({ version: 1, revision: nextRevision, additionalRoots }));
    try {
      const saved = await call({ op: 'settingsWrite', path: settingsPath, expected: diskSignature, data: bytes.toString('base64') });
      diskSignature = saved.signature;
      revision = nextRevision;
    } catch (error) {
      // A worker death after durable rename has an ambiguous outcome. Never retry/overwrite in-process.
      if (error.code !== 'SETTINGS_CONFLICT') settingsOK = false;
      throw error;
    }
  }
  return {
    list: () => exclusive(async () => snapshot ? structuredClone(snapshot) : publish(await scan(roots, revision))),
    refresh: (expected) => exclusive(async () => {
      assertRevision(expected); await assertDisk();
      const result = await scan(roots, revision);
      await assertDisk();
      return publish(result);
    }),
    register: (record) => exclusive(async () => {
      assertRevision(record.revision); await assertDisk();
      if (!exact(record, ['revision', 'path', 'mode', 'category'])) fail('INVALID_REQUEST');
      validateMode(record); validateLibraryPath(record.path);
      if (roots.length - 1 >= budget.maxSources) fail('LIMIT_EXCEEDED');
      const candidate = await identify({ path: record.path, mode: record.mode,
        ...(record.mode === 'category' ? { category: record.category } : {}), id: token(), label: `Folder ${nextLabel}`, isDefault: false });
      for (const root of roots) {
        let checked = root;
        try { checked = await identify(root); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        const problem = overlap(candidate, checked);
        if (problem) fail(problem);
      }
      const nextRevision = token();
      const result = await scan([...roots, candidate], nextRevision);
      const addedSource = result.value.sources.find((source) => source.id === candidate.id);
      if (addedSource.state === 'error' || addedSource.state === 'missing') fail('SOURCE_UNAVAILABLE');
      await persist(result.roots, nextRevision);
      nextLabel++;
      return { rootId: candidate.id, snapshot: publish(result) };
    }),
    unregister: (rootId, expected) => exclusive(async () => {
      assertRevision(expected); await assertDisk();
      const root = roots.find((item) => item.id === rootId);
      if (!root) fail('NOT_FOUND');
      if (root.isDefault) fail('DEFAULT_ROOT');
      const nextRevision = token();
      const result = await scan(roots.filter((item) => item.id !== rootId), nextRevision);
      await persist(result.roots, nextRevision);
      return { snapshot: publish(result) };
    }),
    detail: (fileId) => exclusive(async () => {
      const record = files.get(fileId);
      if (!record || !snapshot) fail('NOT_FOUND');
      const opened = await call({ op: 'read', path: record.absolute, expectedChain: record.chain, expected: record.signature });
      const markdown = decode(opened.data);
      // Only known same-category Markdown destinations become opaque ID links. No path read here.
      const links = Object.create(null);
      let count = 0;
      for (const candidate of await parse('links', markdown)) {
        if (candidate.image || count >= 200) continue;
        const destination = candidate.destination;
        if (/^(?:[\\/]|[A-Za-z][\w+.-]*:)/u.test(destination) || destination.includes('\\')) continue;
        let decoded;
        try { decoded = decodeURIComponent(destination); } catch { continue; }
        if (decoded.startsWith('/') || decoded.startsWith('\\')) continue;
        const [relative, fragment] = decoded.split('#');
        if (!relative || relative.includes(':') || relative.includes('\\')) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(record.file.relativePath), relative));
        if (target.startsWith('../') || target.startsWith('/') || target.split('/').some((part) => EXCLUDED.has(part.toLowerCase()))) continue;
        const found = [...files.values()].find((item) => item.file.sourceId === record.file.sourceId &&
          item.file.category === record.file.category && item.file.relativePath.toLowerCase() === target.toLowerCase());
        if (found) {
          count++; // Rejected targets consume the work budget too.
          try {
            await call({ op: 'verify', path: found.absolute, expectedChain: found.chain, expected: found.signature });
            links[destination] = {
              fileId: found.file.id,
              sourceId: found.file.sourceId,
              category: found.file.category,
              relativePath: found.file.relativePath,
              ...(fragment ? { fragment: fragment.slice(0, 200) } : {}),
            };
          } catch (error) {
            if (error.code === 'TIMEOUT') throw error;
          }
        }
      }
      const { id, sourceId, category, relativePath, kind } = record.file;
      const detail = { generation: snapshot.generation, file: { id, sourceId, category, relativePath, kind }, markdown, warnings: [], links };
      if (Buffer.byteLength(JSON.stringify(detail)) > 512 * 1024) fail('LIMIT_EXCEEDED');
      return detail;
    }),
    close: async () => { closed = true; await Promise.all([native.close(), parser.close()]); },
  };
}

function compare(a, b) {
  const lowerA = a.toLowerCase(), lowerB = b.toLowerCase();
  return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : a < b ? -1 : a > b ? 1 : 0;
}
function classifySkills(files) {
  if (files[0]?.category !== 'skills') return;
  const entries = new Map(files.filter((file) => path.posix.basename(file.relativePath).toLowerCase() === 'skill.md')
    .map((file) => [path.posix.dirname(file.relativePath).toLowerCase(), file]));
  for (const file of files) {
    if (path.posix.basename(file.relativePath).toLowerCase() === 'skill.md') continue;
    let folder = path.posix.dirname(file.relativePath).toLowerCase();
    while (true) {
      const entry = entries.get(folder);
      if (entry) { file.kind = 'support'; file.skillEntryId = entry.id; break; }
      if (folder === '.') { file.kind = 'unassociated'; break; }
      folder = path.posix.dirname(folder);
    }
  }
}
