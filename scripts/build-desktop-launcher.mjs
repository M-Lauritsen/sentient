import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopLauncherExecutable = fileURLToPath(new URL('../native/bin/SentientLauncher.exe', import.meta.url));
const source = fileURLToPath(new URL('../native/DesktopLauncher.cs', import.meta.url));

export async function buildDesktopLauncher(output = desktopLauncherExecutable) {
  if (process.platform !== 'win32') throw Object.assign(new Error('WINDOWS_REQUIRED'), { code: 'WINDOWS_REQUIRED' });
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  await mkdir(path.dirname(output), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, [
      '/nologo', '/optimize+', '/target:winexe', '/platform:x64',
      '/reference:System.Windows.Forms.dll', `/out:${output}`, source,
    ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    const collect = (bytes) => { diagnostics = (diagnostics + bytes.toString()).slice(-8192); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => reject(Object.assign(new Error('COMPILER_UNAVAILABLE'), { code: 'COMPILER_UNAVAILABLE' })));
    child.on('exit', (code) => code === 0 ? resolve() : reject(Object.assign(
      new Error('LAUNCHER_BUILD_FAILED'), { code: 'LAUNCHER_BUILD_FAILED', diagnostics },
    )));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildDesktopLauncher();
    console.log('Console-free Windows launcher built in native\\bin\\SentientLauncher.exe.');
  } catch (error) {
    console.error(error.code || 'LAUNCHER_BUILD_FAILED');
    if (error.diagnostics) console.error(error.diagnostics);
    process.exitCode = 1;
  }
}
