import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = [
  ['personal-path', /(?:[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+)/i],
  ['session-identifier', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['possible-credential', /(?:\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/=]{20,})/],
];
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml', '.toml', '.xml', '.svg', '.ts']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);

// Heuristics complement manual review and GitHub secret scanning; not a proof
// that arbitrary private content or every possible credential is absent.
export async function scanPublication(root) {
  const findings = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      const report = (category) => findings.push({ file: relative, category });
      if (entry.isSymbolicLink()) {
        report('symlink-review-required');
        continue;
      }
      if (entry.isDirectory()) {
        if (['plans', '.copilot'].includes(entry.name)) report('local-records');
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/^(?:events(?:\..+)?\.jsonl|\.env(?:\..+)?|.+\.(?:log|pem|key|pfx|p12|bak|backup))$/i.test(entry.name)
          && !/^\.env\.(?:example|sample|template)$/.test(entry.name)) report('local-data');
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !entry.name.startsWith('.')) continue;
      const text = await readFile(absolute, 'utf8');
      for (const [category, expression] of RULES) {
        if (expression.test(text)) report(category);
      }
    }
  }
  await visit(path.resolve(root));
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await scanPublication(fileURLToPath(new URL('..', import.meta.url)));
  for (const { file, category } of findings) console.error(`${category}: ${file}`);
  console.log(`Publication check: ${findings.length} finding(s). Dependencies and Git metadata excluded; manual review still required.`);
  process.exitCode = findings.length ? 1 : 0;
}
