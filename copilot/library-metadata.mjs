import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument as parseYamlDocument,
} from 'yaml';
import { clipUtf8, utf8ByteLength } from './library-text.mjs';

const DEFAULT_LIMITS = Object.freeze({
  maxDocumentBytes: 256 * 1024,
  maxFrontMatterBytes: 16 * 1024,
  maxRawBytes: 16 * 1024,
  maxDepth: 32,
  maxNodes: 1_000,
});

const STANDARD_TAGS = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

function boundedLimit(options, name) {
  const requested = options[name];
  if (!Number.isSafeInteger(requested) || requested < 0) return DEFAULT_LIMITS[name];
  return Math.min(requested, DEFAULT_LIMITS[name]);
}

function failure(warning, raw, limits, hasFrontMatter = true, body = null) {
  const clipped = clipUtf8(raw, limits.maxRawBytes);
  return {
    hasFrontMatter,
    valid: false,
    metadata: null,
    entries: [],
    body,
    warning,
    rawText: clipped.text,
    rawTruncated: clipped.truncated,
  };
}

function hasOpeningDelimiter(source) {
  const firstLineEnd = source.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd);
  return (firstLine.startsWith('\uFEFF') ? firstLine.slice(1) : firstLine)
    .replace(/\r$/u, '') === '---';
}

function locateBlock(source) {
  const firstLineEnd = source.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd);
  const normalizedFirstLine = (firstLine.startsWith('\uFEFF') ? firstLine.slice(1) : firstLine)
    .replace(/\r$/u, '');
  if (normalizedFirstLine !== '---') return null;
  if (firstLineEnd === -1) {
    return { openingEnd: source.length, closingStart: -1, bodyStart: -1 };
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(lineStart, end).replace(/\r$/u, '');
    if (line === '---' || line === '...') {
      return {
        openingEnd: firstLineEnd + 1,
        closingStart: lineStart,
        bodyStart: lineEnd === -1 ? source.length : lineEnd + 1,
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  return { openingEnd: firstLineEnd + 1, closingStart: -1, bodyStart: -1 };
}

function convertNode(node, state, depth) {
  if (++state.nodes > state.maxNodes || depth > state.maxDepth) {
    throw new Error('FRONT_MATTER_TOO_COMPLEX');
  }
  if (!node || isAlias(node) || node.anchor || (node.tag && !STANDARD_TAGS.has(node.tag))) {
    throw new Error('FRONT_MATTER_MALFORMED');
  }

  if (isScalar(node)) {
    const value = node.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new Error('FRONT_MATTER_MALFORMED');
  }

  if (isSeq(node)) {
    const items = [];
    for (const item of node.items) items.push(convertNode(item, state, depth + 1));
    return { type: 'sequence', items };
  }

  if (isMap(node)) {
    const entries = [];
    const seen = new Set();
    for (const pair of node.items) {
      const keyNode = pair?.key;
      if (!isScalar(keyNode) || typeof keyNode.value !== 'string' || keyNode.anchor ||
          (keyNode.tag && !STANDARD_TAGS.has(keyNode.tag))) {
        throw new Error('FRONT_MATTER_MALFORMED');
      }
      if (++state.nodes > state.maxNodes || seen.has(keyNode.value) || keyNode.value === '<<') {
        throw new Error(state.nodes > state.maxNodes
          ? 'FRONT_MATTER_TOO_COMPLEX'
          : 'FRONT_MATTER_MALFORMED');
      }
      seen.add(keyNode.value);
      entries.push({
        key: keyNode.value,
        value: convertNode(pair.value, state, depth + 1),
      });
    }
    return { type: 'mapping', entries };
  }

  throw new Error('FRONT_MATTER_MALFORMED');
}

function findEntry(entries, key) {
  return entries.find((entry) => entry.key === key)?.value;
}

function primitive(value) {
  return value && typeof value === 'object' ? null : value;
}

function displayText(value, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const trimmed = value.trim();
  return {
    value: [...trimmed].slice(0, maxLength).join(''),
    truncated: [...trimmed].length > maxLength,
  };
}

/**
 * Parse only a bounded, inert YAML mapping at the beginning of a Markdown file.
 * Mapping values use ordered entry arrays so unknown keys and source ordering
 * survive without constructing objects from YAML keys.
 */
export function parseFrontMatter(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const limits = Object.fromEntries(
    Object.keys(DEFAULT_LIMITS).map((key) => [key, boundedLimit(options, key)]),
  );
  const documentBytes = utf8ByteLength(source, limits.maxDocumentBytes);
  if (documentBytes > limits.maxDocumentBytes) {
    return failure('DOCUMENT_TOO_LARGE', source, limits, hasOpeningDelimiter(source));
  }

  const block = locateBlock(source);
  if (!block) {
    return {
      hasFrontMatter: false,
      valid: true,
      metadata: null,
      entries: [],
      body: source,
      warning: null,
      rawText: null,
      rawTruncated: false,
    };
  }
  if (block.closingStart === -1) {
    return failure('FRONT_MATTER_UNCLOSED', source, limits);
  }

  const raw = source.slice(block.openingEnd, block.closingStart);
  const frontMatterBytes = utf8ByteLength(source.slice(0, block.bodyStart), limits.maxFrontMatterBytes);
  if (frontMatterBytes > limits.maxFrontMatterBytes) {
    return failure('FRONT_MATTER_TOO_LARGE', raw, limits);
  }

  let document;
  try {
    document = parseYamlDocument(raw, {
      version: '1.2',
      schema: 'core',
      uniqueKeys: true,
      strict: true,
      prettyErrors: false,
      logLevel: 'silent',
    });
  } catch {
    return failure('FRONT_MATTER_MALFORMED', raw, limits, true, source.slice(block.bodyStart));
  }
  if (document.errors.length > 0 || document.warnings.length > 0) {
    return failure('FRONT_MATTER_MALFORMED', raw, limits, true, source.slice(block.bodyStart));
  }

  let converted;
  try {
    if (document.contents === null) {
      converted = { type: 'mapping', entries: [] };
    } else {
      const state = { maxNodes: limits.maxNodes, maxDepth: limits.maxDepth, nodes: 0 };
      converted = convertNode(document.contents, state, 0);
    }
  } catch (error) {
    const warning = error instanceof Error &&
      (error.message === 'FRONT_MATTER_TOO_COMPLEX' || error.message === 'FRONT_MATTER_MALFORMED')
      ? error.message
      : 'FRONT_MATTER_MALFORMED';
    return failure(warning, raw, limits, true, source.slice(block.bodyStart));
  }
  if (!converted || converted.type !== 'mapping') {
    return failure('FRONT_MATTER_MALFORMED', raw, limits, true, source.slice(block.bodyStart));
  }

  return {
    hasFrontMatter: true,
    valid: true,
    metadata: converted,
    entries: converted.entries,
    body: source.slice(block.bodyStart),
    warning: null,
    rawText: null,
    rawTruncated: false,
  };
}

/** Return the display title and description used by bounded file summaries. */
export function frontMatterSummary(parsed) {
  if (!parsed?.valid || !parsed.hasFrontMatter) {
    return { title: null, description: null, titleTruncated: false, descriptionTruncated: false };
  }
  const name = findEntry(parsed.entries, 'name');
  const title = findEntry(parsed.entries, 'title');
  const description = findEntry(parsed.entries, 'description');
  const selectedTitle = displayText(primitive(name), 200) ?? displayText(primitive(title), 200);
  const selectedDescription = displayText(primitive(description), 500);
  return {
    title: selectedTitle?.value ?? null,
    description: selectedDescription?.value ?? null,
    titleTruncated: selectedTitle?.truncated ?? false,
    descriptionTruncated: selectedDescription?.truncated ?? false,
  };
}
