import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createSentientServer } from '../../server.mjs';
import { libraryHelperExecutable } from '../../copilot/library-native.mjs';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'sentient-library-preview-'));
const activityRoot = path.join(fixture, 'activity');
const defaultRoot = path.join(fixture, 'default-copilot');
const extraRoot = path.join(fixture, 'additional-copilot');
const settingsPath = path.join(fixture, 'private', 'library');
let app;
let cleaning = false;
let restarting = false;

const isolated = (value) => path.resolve(value).startsWith(`${path.resolve(fixture)}${path.sep}`);

async function startPreview() {
  app = createSentientServer({
    activityRoot,
    libraryRoot: defaultRoot,
    librarySettingsPath: settingsPath,
    host: '127.0.0.1',
    port: 0,
    pollIntervalMs: 0,
  });
  const { port } = await app.start();
  process.stdout.write(`Synthetic preview: http://127.0.0.1:${port}\n`);
  process.stdout.write(`Synthetic default Library root: ${defaultRoot}\n`);
  process.stdout.write(`Synthetic add-folder path: ${extraRoot}\n`);
  process.stdout.write('Enter "restart" to restart the server against the same fixture, or Ctrl+C to clean up.\n');
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  try { await app?.stop(); } finally { await rm(fixture, { recursive: true, force: true }); }
}

try {
  if (![activityRoot, defaultRoot, extraRoot, settingsPath].every(isolated)) {
    throw new Error('Synthetic preview paths must stay inside the disposable fixture');
  }
  await access(libraryHelperExecutable);
  await mkdir(path.join(activityRoot, 'synthetic-session'), { recursive: true });
  await writeFile(path.join(activityRoot, 'synthetic-session', 'events.jsonl'), '');
  for (const folder of [
    path.join(defaultRoot, 'agents'),
    path.join(defaultRoot, 'skills', 'sample-skill'),
    path.join(defaultRoot, 'instructions'),
    extraRoot,
  ]) await mkdir(folder, { recursive: true });
  await writeFile(path.join(defaultRoot, 'agents', 'sample.agent.md'),
    '---\nname: Synthetic Agent\ndescription: Disposable preview content\n---\n# Synthetic Agent\n\nThis local fixture is read-only.\n');
  await writeFile(path.join(defaultRoot, 'skills', 'sample-skill', 'SKILL.md'),
    '---\ntitle: Synthetic Skill\n---\n# Synthetic Skill\n\nNo tool or code runs in this preview.\n');
  await writeFile(path.join(defaultRoot, 'skills', 'sample-skill', 'reference.md'), '# Synthetic support document\n');
  await writeFile(path.join(defaultRoot, 'instructions', 'sample.instructions.md'), '# Synthetic Instructions\n');
  await writeFile(path.join(extraRoot, 'additional.md'), '# Additional Synthetic Folder\n');
  await startPreview();
} catch (error) {
  await cleanup();
  process.stderr.write(`Library preview could not start: ${error?.code === 'ENOENT' ? 'build the Windows helper first with npm run build:library-helper' : 'isolated startup failed'}\n`);
  process.exitCode = 1;
}

if (!cleaning) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let commandQueue = Promise.resolve();
  input.on('line', async (line) => {
    if (line.trim().toLowerCase() !== 'restart' || restarting) return;
    restarting = true;
    commandQueue = commandQueue.then(async () => {
      try {
        await app.stop();
        await startPreview();
      } catch {
        process.stderr.write('Synthetic preview restart failed.\n');
      } finally {
        restarting = false;
      }
    });
  });
  input.on('close', () => { commandQueue.finally(() => { if (!cleaning) cleanup(); }); });
  const stop = () => {
    input.close();
    commandQueue.finally(() => cleanup()).finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
