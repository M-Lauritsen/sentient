import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Build only repository/dependency code. No source documents, plugins, CDN,
// sourcemaps or runtime module resolution are included in the browser asset.
const result = await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['copilot/library-markdown-worker.mjs'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  legalComments: 'inline',
  write: false,
  banner: {
    js: '// Local bundled parser: marked 15.0.12 (MIT), yaml 2.8.3 (ISC).\n// Licenses: /MARKED-LICENSE.txt and /YAML-LICENSE.txt. Build: npm run build:library-renderer',
  },
});
const output = new URL('../copilot/generated/library-markdown-worker.mjs', import.meta.url);
if (process.argv.includes('--check')) {
  const existing = await readFile(output);
  if (!existing.equals(result.outputFiles[0].contents)) {
    throw new Error('Library worker is stale: run npm run build:library-renderer');
  }
  console.log('Local Library worker is up to date.');
} else {
  await mkdir(new URL('../copilot/generated/', import.meta.url), { recursive: true });
  await writeFile(output, result.outputFiles[0].contents);
  console.log('Built self-contained local Library Markdown worker (marked 15.0.12 / yaml 2.8.3).');
}
