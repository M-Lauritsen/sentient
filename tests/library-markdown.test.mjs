import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { createLibraryMarkdownRenderer } from '../copilot/library-markdown.mjs';
import { parseFrontMatter, frontMatterSummary } from '../copilot/library-metadata.mjs';

function threadFactory({ stall = false, started = () => {}, terminated = () => {} } = {}) {
  const worker = new Worker(new URL('./helpers/library-render-worker.mjs', import.meta.url), { workerData: { stall } });
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => { const exit = worker.terminate(); terminated(exit); return exit; },
    addEventListener(type, callback) {
      worker.on(type, type === 'message' ? (data) => {
        if (data.type === 'synthetic-parser-started') started();
        else callback({ data });
      } : callback);
    },
  };
}

function fixture(t, options = {}) {
  const requests = [];
  class NoResources extends ResourceLoader {
    fetch(url) { requests.push(url); return null; }
  }
  const dom = new JSDOM('<!doctype html><button id="outside">Outside</button><main></main>', {
    url: 'http://library.invalid/',
    runScripts: 'dangerously',
    resources: new NoResources(),
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      window.fetch = (url) => { requests.push(String(url)); throw new Error('network denied'); };
    },
  });
  const pane = dom.window.document.querySelector('main');
  const renderer = createLibraryMarkdownRenderer({ pane, workerFactory: threadFactory, ...options });
  t.after(() => { renderer.dispose(); dom.window.close(); });
  const render = (markdown, extra = {}) => renderer.render({
    generation: 'generation-1',
    markdown,
    file: { sourceId: 'source-1', category: 'agents', relativePath: 'current.md' },
    links: {},
    ...extra.detail,
  }, { generation: 'generation-1', fileIds: ['known-file'], ...extra });
  return { dom, pane, renderer, render, requests };
}

function inert(pane) {
  assert.equal(pane.querySelectorAll(
    'script,style,link,base,img,picture,svg,math,iframe,object,embed,video,audio,source,form,input,button,textarea,select',
  ).length, 0);
  for (const element of pane.querySelectorAll('*')) {
    for (const attr of element.attributes) {
      assert.ok(['id', 'href', 'tabindex', 'aria-labelledby', 'role', 'start'].includes(attr.name), attr.name);
      assert.ok(!/^(?:src|style|on)/i.test(attr.name));
    }
  }
}

test('common Markdown creates semantic DOM, preserves mixed case and code whitespace', async (t) => {
  const { pane, render } = fixture(t);
  const source = '# Mixed Case\n\nA **Strong** and *Soft* `Code`.\n\n> Quoted\n\n1. First\n2. Second\n\n- One\n- Two\n\n---\n\n```js\n  x < y;\n    Next\n```\n\n| Key | Value |\n| --- | --- |\n| A | B |';
  assert.equal((await render(source)).status, 'rendered');
  for (const tag of ['h1', 'p', 'strong', 'em', 'code', 'blockquote', 'ol', 'ul', 'li', 'hr', 'pre', 'table', 'thead', 'tbody', 'th', 'td']) {
    assert.ok(pane.querySelector(tag), tag);
  }
  assert.equal(pane.querySelector('h1').textContent, 'Mixed Case');
  assert.equal(pane.querySelector('pre code').textContent, '  x < y;\n    Next');
  inert(pane);
  await render('3. Third\n4. Fourth');
  assert.equal(pane.querySelector('ol').start, 3);
});

test('metadata uses the source policy, ordered semantic inert nested values above body', async (t) => {
  const { pane, render, requests } = fixture(t);
  const source = '\uFEFF---\r\nname: My Agent\r\nunknown:\r\n  flag: true\r\n  none: null\r\n  count: 4.5\r\n  values: [One, false]\r\n__proto__: inert\r\ntools: "<img src=https://evil.invalid onerror=alert(1)>"\r\n---\r\n# Body';
  const summary = frontMatterSummary(parseFrontMatter(source));
  assert.equal(summary.title, 'My Agent');
  assert.equal((await render(source)).status, 'rendered');
  assert.equal(pane.firstElementChild.tagName, 'SECTION');
  const section = pane.firstElementChild;
  assert.equal(section.querySelector('h2').textContent, 'Metadata');
  assert.equal(section.getAttribute('aria-labelledby'), section.querySelector('h2').id);
  assert.deepEqual([...section.querySelector('dl').children].filter((node) => node.tagName === 'DT').map((node) => node.textContent),
    ['name', 'unknown', '__proto__', 'tools']);
  for (const value of ['My Agent', 'true', 'null', '4.5', 'One', 'false', '<img src=']) {
    assert.ok(section.textContent.includes(value), value);
  }
  assert.equal(pane.querySelector('h1').textContent, 'Body');
  inert(pane);
  assert.deepEqual(requests, []);
});

test('empty metadata is accessible; no delimiter means no metadata section', async (t) => {
  const { pane, render } = fixture(t);
  await render('---\n---\nBody');
  assert.match(pane.querySelector('section').textContent, /Metadata.*No metadata fields/s);
  await render('# Plain');
  assert.equal(pane.querySelector('section'), null);
});

test('metadata at policy depth 32 renders semantically; depth 33 retains raw prefix and body', async (t) => {
  const { pane, render } = fixture(t);
  const sourceAtDepth = (depth) =>
    `---\nvalue: ${'{value: '.repeat(depth - 1)}true${'}'.repeat(depth - 1)}\n---\n# Body`;
  const accepted = sourceAtDepth(32);
  assert.equal(parseFrontMatter(accepted).valid, true);
  assert.equal((await render(accepted)).status, 'rendered');
  assert.equal(pane.querySelector('section h2').textContent, 'Metadata');
  assert.equal(pane.querySelectorAll('dl').length, 32);
  assert.equal(pane.querySelector('pre'), null);
  assert.equal(pane.querySelector('h1').textContent, 'Body');
  const rejected = sourceAtDepth(33);
  assert.equal(parseFrontMatter(rejected).valid, false);
  assert.equal((await render(rejected)).status, 'rendered');
  assert.equal(pane.querySelector('section'), null);
  assert.equal(pane.querySelector('pre').textContent, rejected.slice(0, -6));
  assert.equal(pane.querySelector('h1').textContent, 'Body');
  inert(pane);
});

test('every restricted YAML failure remains inert and preserves original prefix with a separated body', async (t) => {
  const { pane, render, requests } = fixture(t);
  const cases = [
    'name: [broken', 'null', '- sequence', 'a: 1\na: 2',
    'a: !custom run', 'a: !!js/function "alert(1)"',
    'a: &x value', 'a: *x', '<<: {a: b}',
    `a: ${'['.repeat(40)}0${']'.repeat(40)}`,
    'a: "<script>window.executed=true</script>"\na: duplicate',
  ];
  for (const raw of cases) {
    const source = `---\n${raw}\n---\n# Body`;
    assert.equal(parseFrontMatter(source).valid, false);
    assert.equal((await render(source)).status, 'rendered', raw);
    assert.match(pane.textContent, /Front matter could not be parsed/);
    assert.equal(pane.querySelector('pre').textContent, source.slice(0, -6), raw);
    assert.equal(pane.querySelector('h1').textContent, 'Body');
    inert(pane);
  }
  assert.deepEqual(requests, []);
});

test('unclosed, front-matter size/depth/node and document limits have bounded visible fallbacks', async (t) => {
  const { pane, render } = fixture(t);
  const unclosed = '---\na: value\n# Not a body';
  await render(unclosed);
  assert.equal(pane.querySelector('pre').textContent, unclosed);
  assert.match(pane.textContent, /no body was separated/i);
  for (const [limits, source] of [
    [{ maxFrontMatterBytes: 8 }, '---\na: original\n---\n# Whole'],
    [{ maxMetadataDepth: 1 }, '---\na: {b: {c: 1}}\n---\n# Body'],
    [{ maxMetadataNodes: 2 }, '---\na: [one, two]\n---\n# Body'],
    [{ maxDocumentBytes: 8 }, '# Original oversized document'],
  ]) {
    await render(source, { limits });
    assert.ok(pane.querySelector('pre').textContent.startsWith(source.split('\n#')[0]));
    assert.match(pane.textContent, /limit|could not be parsed/i);
    inert(pane);
  }
  await render(`---\na: ${'é'.repeat(140_000)}`, { limits: { maxRawBytes: 11 } });
  assert.ok(Buffer.byteLength(pane.querySelector('pre').textContent) <= 11);
  assert.match(pane.textContent, /truncated/i);
  await render('---\na: [broken\n---\n# Body', { limits: { maxRawBytes: 7 } });
  assert.ok(Buffer.byteLength(pane.querySelector('pre').textContent) <= 7);
  assert.match(pane.textContent, /truncated/i);
  assert.equal(pane.querySelector('h1').textContent, 'Body');
});

test('hostile Markdown and metadata never create executable or resource DOM', async (t) => {
  const { dom, pane, render, requests } = fixture(t);
  const source = [
    '<script>window.executed=true;fetch("https://evil.invalid")</script>',
    '<img src="https://evil.invalid/a" onerror="window.executed=true">',
    '<svg onload=alert(1)><a href="javascript:alert(1)">X</a></svg>',
    '<style>body{display:none}</style><link rel=stylesheet href=https://evil.invalid>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form action=https://evil.invalid><input autofocus onfocus=alert(1)></form>',
    '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
    '![Remote Alt](https://evil.invalid/pixel) ![Local Alt](./secret.png)',
    '[script](javascript:alert%281%29) [data](data:text/html,bad) [http](https://evil.invalid)',
    '[file](file:///C:/secret) [unc](\\\\server\\share) [proto](//evil.invalid)',
    '[mail](mailto:a@b) [unknown](custom:run) [absolute](/outside.md)',
  ].join('\n\n');
  assert.equal((await render(source)).status, 'rendered');
  inert(pane);
  assert.equal(pane.querySelector('a'), null);
  assert.match(pane.textContent, /<script>/);
  assert.match(pane.textContent, /Remote Alt/);
  assert.equal(dom.window.executed, undefined);
  assert.deepEqual(requests, []);
});

test('only pane headings and current-snapshot server mappings are interactive', async (t) => {
  const { dom, pane, render } = fixture(t);
  const navigations = [];
  await render('# Mixed Case\n\n# Mixed Case\n\n[Here](#mixed-case) [Other UI](#outside) [Known](other.md#Part) [Unknown](missing.md) [External](https://evil.invalid)', {
    onNavigate: (target) => navigations.push(target),
    detail: { links: {
      'other.md#Part': {
        fileId: 'known-file', fragment: 'Part', relativePath: 'other.md', sourceId: 'source-1', category: 'agents',
      },
      'missing.md': {
        fileId: 'not-in-snapshot', relativePath: 'missing.md', sourceId: 'source-1', category: 'agents',
      },
      'https://evil.invalid': {
        fileId: 'known-file', relativePath: 'evil.md', sourceId: 'source-1', category: 'agents',
      },
    } },
  });
  const links = [...pane.querySelectorAll('a')];
  assert.deepEqual(links.map((node) => node.textContent), ['Here', 'Known']);
  const headings = [...pane.querySelectorAll('h1')];
  assert.notEqual(headings[0].id, headings[1].id);
  assert.equal(links[0].hash, `#${headings[0].id}`);
  assert.notEqual(headings[0].id, 'mixed-case');
  links[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(dom.window.document.activeElement, headings[0]);
  links[1].click();
  assert.deepEqual(navigations, [{ fileId: 'known-file', fragment: 'Part' }]);
  assert.equal(dom.window.location.hash, '');
});

test('same heading in two panes gets different IDs; stale old links cannot navigate', async (t) => {
  const a = fixture(t), b = fixture(t);
  const calls = [];
  const options = {
    onNavigate: (value) => calls.push(value),
    detail: { links: {
      'a.md': { fileId: 'known-file', relativePath: 'a.md', sourceId: 'source-1', category: 'agents' },
    } },
  };
  await a.render('# One\n\n[go](a.md)', options);
  await b.render('# One');
  assert.notEqual(a.pane.querySelector('h1').id, b.pane.querySelector('h1').id);
  const old = a.pane.querySelector('a');
  a.renderer.cancel();
  old.click();
  assert.deepEqual(calls, []);
});

test('unsafe destinations stay inert even if accidentally present in a supplied ID map', async (t) => {
  const { pane, render } = fixture(t);
  const destinations = [
    'https://evil.invalid', 'file:///C:/secret.md', '//evil.invalid/a.md',
    '\\\\evil.invalid\\a.md', '/absolute.md', 'data:text/plain,a', 'mailto:a@b',
    'javascript:run', 'custom:run', '%2f%2fevil.invalid/a.md', 'java%73cript%3arun',
    'javascript&#58;run', '&#47;&#47;evil.invalid/a.md', 'a%00.md',
    '../../outside.md', '%2e%2e/%2e%2e/outside.md',
  ];
  const links = Object.fromEntries(destinations.map((href) => [href, {
    fileId: 'known-file',
    relativePath: 'outside.md',
    sourceId: 'source-2',
    category: 'skills',
  }]));
  const markdown = destinations.map((href, i) => `[Unsafe ${i}](${href})`).join('\n\n');
  await render(markdown, {
    onNavigate: () => assert.fail('unsafe link navigated'),
    detail: {
      file: { sourceId: 'source-1', category: 'agents', relativePath: 'nested/current.md' },
      links,
    },
  });
  assert.equal(pane.querySelector('a'), null);
  inert(pane);
});

test('parent traversal from the category root stays inert even for an in-snapshot mapped ID', async (t) => {
  const { pane, render } = fixture(t);
  await render('[Escape](../outside.md)', {
    onNavigate: () => assert.fail('category escape navigated'),
    detail: {
      links: {
        '../outside.md': {
          fileId: 'known-file',
          relativePath: 'outside.md',
          sourceId: 'source-1',
          category: 'agents',
        },
      },
    },
  });
  assert.equal(pane.querySelector('a'), null);
  inert(pane);
});

test('safe parent-relative links stay inside the current source and category', async (t) => {
  const calls = [];
  const { pane, render } = fixture(t);
  const links = {
    '../shared%20agent.md': {
      fileId: 'known-file', relativePath: 'Shared Agent.md', sourceId: 'source-1', category: 'agents',
    },
    '../SHARED%20AGENT.md': {
      fileId: 'known-file', relativePath: 'Shared Agent.md', sourceId: 'source-1', category: 'agents',
    },
    '../other.md': {
      fileId: 'known-file', relativePath: 'other.md', sourceId: 'source-2', category: 'agents',
    },
  };
  await render('[Same category](../shared%20agent.md) [Different case](../SHARED%20AGENT.md) [Different source](../other.md)', {
    onNavigate: (target) => calls.push(target),
    detail: {
      file: { sourceId: 'source-1', category: 'agents', relativePath: 'nested/current.md' },
      links,
    },
  });
  const anchor = pane.querySelector('a');
  assert.equal(anchor?.textContent, 'Same category');
  anchor.click();
  assert.deepEqual(calls, [{ fileId: 'known-file' }]);
  assert.deepEqual([...pane.querySelectorAll('a')].map((link) => link.textContent),
    ['Same category', 'Different case']);
  assert.equal(pane.textContent.includes('Different source'), true);
});

test('metadata and naturally suffixed headings cannot collide with generated heading IDs', async (t) => {
  const { pane, render } = fixture(t);
  await render('---\na: 1\n---\n# Metadata\n\n# A\n\n# A\n\n# A-1\n\n# A');
  const ids = [...pane.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(pane.querySelector('section').getAttribute('aria-labelledby'), pane.querySelector('section h2').id);
});

test('renderer node limit and worker/parser/DOM failures use escaped bounded source fallback', async (t) => {
  const { pane, render } = fixture(t);
  const source = '# Original\n\n<script>bad()</script>';
  assert.equal((await render(source, { limits: { maxRenderedNodes: 2 } })).status, 'fallback');
  assert.equal(pane.querySelector('pre').textContent, source);
  inert(pane);
  const fake = fixture(t, { workerFactory: () => {
    const handlers = {};
    return {
      terminate() {},
      addEventListener(type, callback) { handlers[type] = callback; },
      postMessage() { queueMicrotask(() => handlers.message({ data: { type: 'result', nodes: [{ tag: 'script', children: ['bad()'] }] } })); },
    };
  } });
  assert.equal((await fake.render(source)).status, 'fallback');
  assert.equal(fake.pane.querySelector('pre').textContent, source);
  inert(fake.pane);
  const original = pane.ownerDocument.createElement.bind(pane.ownerDocument);
  let thrown = false;
  pane.ownerDocument.createElement = (tag) => {
    if (!thrown) { thrown = true; throw new Error('synthetic DOM failure'); }
    return original(tag);
  };
  assert.equal((await render(source)).status, 'fallback');
  assert.equal(pane.querySelector('pre').textContent, source);
});

test('failed worker startup is escaped and oversized source never starts a worker', async (t) => {
  let started = 0;
  const { pane, render } = fixture(t, { workerFactory: () => { started++; throw new Error('parser unavailable'); } });
  assert.equal((await render('<script>bad()</script>')).status, 'fallback');
  assert.equal(started, 1);
  assert.equal((await render('é'.repeat(140_000))).status, 'fallback');
  assert.equal(started, 1);
  assert.match(pane.textContent, /truncated/i);
  inert(pane);
});

test('cancellation, stale generations and replacement selection never commit late output', async (t) => {
  const { pane, render, renderer } = fixture(t);
  const controller = new AbortController();
  const pending = render('# Old', { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).status, 'discarded');
  assert.equal(pane.textContent, '');
  assert.equal((await render('# Stale', { generation: 'generation-2' })).status, 'discarded');
  const old = render('# Previous');
  const current = render('# Current');
  assert.equal((await old).status, 'discarded');
  assert.equal((await current).status, 'rendered');
  assert.equal(pane.querySelector('h1').textContent, 'Current');
  renderer.clear();
  assert.equal(pane.textContent, '');
});

test('a stuck parser is terminated at the budget and cannot accumulate workers', async (t) => {
  let running = 0, terminated = 0;
  const { render, pane } = fixture(t, { workerFactory: () => {
    running++;
    assert.equal(running, 1);
    return { postMessage() {}, addEventListener() {}, terminate() { running--; terminated++; } };
  } });
  for (let i = 0; i < 3; i++) {
    assert.equal((await render('<img src=x>', { limits: { maxTimeMs: 10 } })).status, 'fallback');
    assert.equal(running, 0);
    assert.match(pane.textContent, /limit|timed out/i);
  }
  assert.equal(terminated, 3);
});

test('deadline really terminates a non-cooperative parser thread, not only a mock flag', async (t) => {
  const exits = [];
  let started = 0;
  const { pane, render } = fixture(t, { workerFactory: () => threadFactory({
    stall: true, started: () => started++, terminated: (exit) => exits.push(exit),
  }) });
  const before = performance.now();
  assert.equal((await render('# Synthetic parser stall', { limits: { maxTimeMs: 150 } })).status, 'fallback');
  assert.equal(started, 1);
  assert.equal(exits.length, 1);
  await Promise.all(exits);
  assert.ok(performance.now() - before < 1_000);
  assert.match(pane.textContent, /time\/resource limit/);
});

test('large construction yields so selection/close can cancel without partial DOM', async (t) => {
  const { pane, render, renderer } = fixture(t);
  const original = pane.ownerDocument.createElement.bind(pane.ownerDocument);
  let created = 0;
  pane.ownerDocument.createElement = (tag) => {
    created++;
    if (created === 50) setTimeout(() => renderer.clear(), 0);
    return original(tag);
  };
  const task = render('- Item\n'.repeat(500));
  assert.equal((await task).status, 'discarded');
  assert.ok(created >= 50 && created < 500, `cancelled during DOM construction at ${created} elements`);
  assert.equal(pane.childNodes.length, 0);
});

test('shipped browser worker is self-contained with no Node Buffer or runtime imports', async () => {
  const bundle = await readFile(new URL('../copilot/generated/library-markdown-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /\bBuffer\.|from ["'](?:node:|https?:|yaml|marked)|\bimport\(/);
  assert.match(bundle, /ISC|yaml/);
  assert.match(execFileSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-library-renderer.mjs', import.meta.url)),
    '--check',
  ], { encoding: 'utf8' }), /up to date/);
});
