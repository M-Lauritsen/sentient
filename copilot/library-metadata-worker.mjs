import { parentPort } from 'node:worker_threads';
import { parseDocument } from 'yaml';
import { parseFrontMatter, frontMatterSummary } from './library-metadata.mjs';

parentPort.on('message', ({ id, op, text, basename }) => {
  try {
    if (op === 'links') {
      const candidates = [];
      for (const match of text.matchAll(/!?\[[^\]\r\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
        candidates.push({ destination: match[1], image: match[0].startsWith('!') });
        if (candidates.length >= 200) break;
      }
      parentPort.postMessage({ id, value: candidates });
      return;
    }
    if (op === 'settings') {
      // JSON grammar plus YAML AST duplicate-key checking, without YAML object construction.
      const value = JSON.parse(text);
      const document = parseDocument(text, { schema: 'json', uniqueKeys: true, prettyErrors: false, logLevel: 'silent' });
      if (document.errors.length || document.warnings.length) throw new Error();
      parentPort.postMessage({ id, value });
      return;
    }
    const parsed = parseFrontMatter(text);
    const summary = frontMatterSummary(parsed);
    const heading = parsed.body?.match(/^#\s+(.+)$/mu)?.[1]?.trim();
    parentPort.postMessage({ id, value: {
      title: summary.title ?? (heading || basename).slice(0, 200),
      ...(summary.description ? { description: summary.description } : {}),
      warnings: [
        ...(parsed.warning ? [parsed.warning] : []),
        ...(summary.descriptionTruncated || summary.titleTruncated ? ['SUMMARY_SHORTENED'] : []),
      ],
    } });
  } catch { parentPort.postMessage({ id, error: 'UNSUPPORTED_CONTENT' }); }
});
