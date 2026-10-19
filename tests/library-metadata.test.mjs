import test from 'node:test';
import assert from 'node:assert/strict';
import { frontMatterSummary, parseFrontMatter } from '../copilot/library-metadata.mjs';
import { clipUtf8, utf8ByteLength } from '../copilot/library-text.mjs';

test('browser-safe UTF-8 byte accounting preserves Node summary/fallback boundary semantics', () => {
  for (const source of ['ASCII', 'é漢😀', '\ud800lone\udc00', '\uFEFF\r\n😀']) {
    assert.equal(utf8ByteLength(source), Buffer.byteLength(source));
    for (let maximum = 0; maximum < 20; maximum++) {
      const clipped = clipUtf8(source, maximum);
      assert.ok(Buffer.byteLength(clipped.text) <= maximum);
      assert.equal(clipped.truncated, clipped.text.length < source.length);
      assert.ok(source.startsWith(clipped.text));
    }
  }
});

test('no front matter leaves the document body untouched', () => {
  const source = '\uFEFF# Mixed Case\n\nBody';
  const result = parseFrontMatter(source);

  assert.equal(result.hasFrontMatter, false);
  assert.equal(result.valid, true);
  assert.equal(result.body, source);
  assert.equal(result.metadata, null);
});

test('valid BOM and CRLF front matter preserves ordered unknown nested values', () => {
  const source = '\uFEFF---\r\nname: My Agent\r\ncustom:\r\n  enabled: true\r\n  list:\r\n    - first\r\n    - 42\r\napplyTo: "**/*.js"\r\n---\r\n# Body';
  const result = parseFrontMatter(source);

  assert.equal(result.valid, true);
  assert.deepEqual(result.entries.map(({ key }) => key), ['name', 'custom', 'applyTo']);
  assert.deepEqual(result.metadata, {
    type: 'mapping',
    entries: [
      { key: 'name', value: 'My Agent' },
      {
        key: 'custom',
        value: {
          type: 'mapping',
          entries: [
            { key: 'enabled', value: true },
            { key: 'list', value: { type: 'sequence', items: ['first', 42] } },
          ],
        },
      },
      { key: 'applyTo', value: '**/*.js' },
    ],
  });
  assert.equal(result.body, '# Body');
  assert.deepEqual(frontMatterSummary(result), {
    title: 'My Agent',
    description: null,
    titleTruncated: false,
    descriptionTruncated: false,
  });
});

test('summary uses title fallback and visibly reports display-length truncation', () => {
  const parsed = parseFrontMatter(`---\ntitle: ${'t'.repeat(205)}\ndescription: ${'d'.repeat(505)}\n---\nBody`);
  assert.deepEqual(frontMatterSummary(parsed), {
    title: 't'.repeat(200),
    description: 'd'.repeat(500),
    titleTruncated: true,
    descriptionTruncated: true,
  });
});

test('empty mapping is valid and an unclosed delimiter preserves whole source as raw text', () => {
  const empty = parseFrontMatter('---\n---\nBody');
  assert.equal(empty.valid, true);
  assert.equal(empty.hasFrontMatter, true);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.body, 'Body');

  const unclosed = parseFrontMatter('---\nname: Example\n# not a body');
  assert.equal(unclosed.valid, false);
  assert.equal(unclosed.body, null);
  assert.equal(unclosed.warning, 'FRONT_MATTER_UNCLOSED');
  assert.equal(unclosed.rawText, '---\nname: Example\n# not a body');
});

test('malformed, duplicate, nonmapping, custom-tagged, anchored and merged metadata fails inertly', () => {
  const documents = [
    '---\nname: [unterminated\n---\nBody',
    '---\nnull\n---\n# Null fallback body',
    '---\nname: first\nname: second\n---\nBody',
    '---\n- not a mapping\n---\nBody',
    '---\nname: !!js/function "process.exit()"\n---\nBody',
    '---\nname: &agent Copilot\nalias: *agent\n---\nBody',
    '---\nbase: {name: Example}\n<<: {tools: run}\n---\nBody',
  ];

  for (const source of documents) {
    const result = parseFrontMatter(source);
    assert.equal(result.valid, false, source);
    assert.equal(result.body, source.slice(source.lastIndexOf('---') + 4), source);
    assert.equal(typeof result.rawText, 'string', source);
  }
});

test('front matter byte, nesting, and node limits are enforced without partial parsing', () => {
  const tooLarge = parseFrontMatter('---\nname: a very long value\n---\nBody', {
    maxFrontMatterBytes: 8,
  });
  assert.equal(tooLarge.valid, false);
  assert.equal(tooLarge.warning, 'FRONT_MATTER_TOO_LARGE');
  assert.equal(tooLarge.body, null);

  const tooDeep = parseFrontMatter('---\na:\n  b:\n    c: value\n---\nBody', {
    maxDepth: 2,
  });
  assert.equal(tooDeep.valid, false);
  assert.equal(tooDeep.warning, 'FRONT_MATTER_TOO_COMPLEX');

  const tooManyNodes = parseFrontMatter('---\na: [one, two]\n---\nBody', {
    maxNodes: 2,
  });
  assert.equal(tooManyNodes.valid, false);
  assert.equal(tooManyNodes.warning, 'FRONT_MATTER_TOO_COMPLEX');
});

test('deeply nested YAML is rejected without escaping the bounded parser', () => {
  const nested = `[${'['.repeat(3_000)}value${']'.repeat(3_000)}]`;
  const result = parseFrontMatter(`---\nvalue: ${nested}\n---\nBody`);
  assert.equal(result.valid, false);
  assert.ok(['FRONT_MATTER_TOO_COMPLEX', 'FRONT_MATTER_MALFORMED'].includes(result.warning));
  assert.equal(result.body, 'Body');
});

test('raw fallback is UTF-8 bounded and explicitly reports truncation', () => {
  const source = `---\nvalue: ${'é'.repeat(30)}\n---\nBody`;
  const result = parseFrontMatter(source, {
    maxFrontMatterBytes: 8,
    maxRawBytes: 9,
  });

  assert.equal(result.valid, false);
  assert.equal(result.rawTruncated, true);
  assert.ok(Buffer.byteLength(result.rawText, 'utf8') <= 9);
});

test('oversized documents are rejected before YAML parsing', () => {
  const result = parseFrontMatter('---\na: value\n---\nBody', {
    maxDocumentBytes: 4,
  });

  assert.equal(result.valid, false);
  assert.equal(result.warning, 'DOCUMENT_TOO_LARGE');
  assert.equal(result.hasFrontMatter, true);
  assert.equal(result.body, null);

  const plainMarkdown = parseFrontMatter('# A document that exceeds its limit', {
    maxDocumentBytes: 4,
  });
  assert.equal(plainMarkdown.valid, false);
  assert.equal(plainMarkdown.warning, 'DOCUMENT_TOO_LARGE');
  assert.equal(plainMarkdown.hasFrontMatter, false);
});
