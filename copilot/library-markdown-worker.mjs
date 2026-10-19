// Source of the self-contained local browser worker. Never import this on the
// UI thread: even the YAML/Markdown lexers run behind a terminable deadline.
import { Lexer } from 'marked';
import { parseFrontMatter } from './library-metadata.mjs';
import { renderLimits } from './library-render-limits.mjs';
import { clipUtf8 } from './library-text.mjs';

self.onmessage = ({ data }) => {
  try {
    const limits = renderLimits(data.limits);
    const deadline = performance.now() + limits.maxTimeMs;
    let count = 0;
    const guard = (depth = 0) => {
      if (++count > limits.maxRenderedNodes || depth > 64 || performance.now() >= deadline) {
        throw new Error('RENDER_LIMIT');
      }
    };
    const text = (value) => { guard(); return String(value); };
    const node = (tag, children, extra = {}) => { guard(); return { tag, children, ...extra }; };
    const warning = (message) => node('p', [text(message)]);
    const raw = (value) => node('pre', [text(value)]);
    // Entity decoding is text-only; decoded characters never reach an HTML sink.
    const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (match, name) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
      if (named) return named;
      const point = name[1]?.toLowerCase() === 'x'
        ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '\ufffd';
    });
    const convert = (tokens, depth = 0) => {
      const result = [];
      for (const token of tokens) {
        guard(depth);
        const inline = () => convert(token.tokens ?? [], depth + 1);
        switch (token.type) {
          case 'space': break;
          case 'heading': result.push(node(`h${token.depth}`, inline())); break;
          case 'paragraph': result.push(node('p', inline())); break;
          case 'text':
            result.push(...(token.tokens ? inline() : [text(decode(token.text))]));
            break;
          case 'escape': result.push(text(decode(token.text))); break;
          case 'html': result.push(text(token.raw)); break;
          case 'strong': result.push(node('strong', inline())); break;
          case 'em': result.push(node('em', inline())); break;
          case 'del': result.push(node('s', inline())); break;
          case 'codespan': result.push(node('code', [text(token.text)])); break;
          case 'code': result.push(node('pre', [node('code', [text(token.text)])])); break;
          case 'br': result.push(node('br', [])); break;
          case 'hr': result.push(node('hr', [])); break;
          case 'blockquote': result.push(node('blockquote', inline())); break;
          case 'list':
            result.push(node(token.ordered ? 'ol' : 'ul', token.items.map((item) => {
              guard(depth);
              return node('li', [
                ...(item.task ? [text(item.checked ? '[x] ' : '[ ] ')] : []),
                ...convert(item.tokens, depth + 1),
              ]);
            }), token.ordered ? { start: token.start } : {}));
            break;
          case 'table': {
            const row = (cells, tag) => {
              guard(depth);
              return node('tr', cells.map((cell) => node(tag, convert(cell.tokens, depth + 1))));
            };
            result.push(node('table', [
              node('thead', [row(token.header, 'th')]),
              node('tbody', token.rows.map((cells) => row(cells, 'td'))),
            ]));
            break;
          }
          case 'link':
            result.push(node('a', inline(), { destination: token.href }));
            break;
          case 'image':
            result.push(text(`[Image: ${decode(token.text)}]`));
            break;
          case 'def': break;
          default: throw new Error('UNSUPPORTED_TOKEN');
        }
      }
      return result;
    };
    const metadataValue = (value, depth = 0) => {
      guard(depth);
      if (value === null || typeof value !== 'object') return [text(value === null ? 'null' : value)];
      if (value.type === 'sequence') {
        return [node('ul', value.items.map((item) => node('li', metadataValue(item, depth + 1))))];
      }
      if (value.type === 'mapping') {
        return [node('dl', value.entries.flatMap((entry) => [
          node('dt', [text(entry.key)]), node('dd', metadataValue(entry.value, depth + 1)),
        ]))];
      }
      throw new Error('INVALID_METADATA');
    };
    const parsed = parseFrontMatter(data.markdown, {
      maxDocumentBytes: limits.maxDocumentBytes,
      maxFrontMatterBytes: limits.maxFrontMatterBytes,
      maxDepth: limits.maxMetadataDepth,
      maxNodes: limits.maxMetadataNodes,
      // Raw fallback below uses the original source, including delimiters.
      maxRawBytes: limits.maxRawBytes,
    });
    guard();
    if (!parsed.valid && parsed.body === null) {
      self.postMessage({ type: 'fallback', reason: parsed.warning });
      return;
    }
    const nodes = [];
    if (parsed.hasFrontMatter && parsed.valid) {
      nodes.push(node('section', [
        node('h2', [text('Metadata')]),
        ...(parsed.entries.length ? metadataValue(parsed.metadata) : [node('p', [text('No metadata fields.')])]),
      ], { metadata: true }));
    } else if (!parsed.valid) {
      const prefix = clipUtf8(data.markdown.slice(0, data.markdown.length - parsed.body.length), limits.maxRawBytes);
      nodes.push(warning('Front matter could not be parsed. Original front matter follows as inert text.' +
        (prefix.truncated ? ' Front matter truncated at the raw-text limit.' : '')));
      // Retain the exact original bounded prefix, not reconstructed YAML.
      nodes.push(raw(prefix.text));
    }
    const tokens = Lexer.lex(parsed.body, { gfm: true, breaks: false, pedantic: false });
    guard();
    nodes.push(...convert(tokens));
    self.postMessage({ type: 'result', nodes });
  } catch {
    self.postMessage({ type: 'fallback', reason: 'RENDER_FAILURE' });
  }
};
