// Private stdio only. No shell, listener, content logging, global installation or runtime compilation.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const libraryHelperExecutable = fileURLToPath(new URL('../native/bin/LibraryHelper.exe', import.meta.url));
const source = fileURLToPath(new URL('../native/LibraryHelper.cs', import.meta.url));
const failure = (code) => Object.assign(new Error(code), { code });

export async function buildLibraryHelper(output = libraryHelperExecutable) {
  if (process.platform !== 'win32') throw failure('SAFETY_UNSUPPORTED');
  // Existing Windows .NET Framework compiler; no download, SDK or PowerShell policy changes.
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  await mkdir(path.dirname(output), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/reference:System.Web.Extensions.dll', `/out:${output}`, source], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    const collect = (bytes) => { diagnostics = (diagnostics + bytes.toString()).slice(-8192); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => reject(failure('SAFETY_UNSUPPORTED')));
    child.on('exit', (code) => code === 0 ? resolve() : reject(Object.assign(failure('HELPER_BUILD_FAILED'), { diagnostics })));
  });
}

export class LibraryNative {
  #child;
  #pending;
  #buffer = Buffer.alloc(0);
  #id = 0;
  #closed = false;
  #exited;
  constructor({ executable = libraryHelperExecutable, timeoutMs = 5000, allowTestBarriers = false } = {}) {
    this.timeoutMs = timeoutMs;
    try {
      this.#child = spawn(executable, allowTestBarriers ? ['--test-barriers'] : [], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      this.#closed = true;
      this.#exited = Promise.resolve();
      return;
    }
    this.#exited = new Promise((resolve) => this.#child.once('close', resolve));
    this.#child.stdout.on('data', (chunk) => this.#receive(chunk));
    this.#child.on('error', () => this.#fail('SAFETY_UNSUPPORTED'));
    this.#child.on('exit', () => this.#fail('SAFETY_UNSUPPORTED'));
    this.#child.stdin.on('error', () => this.#fail('SAFETY_UNSUPPORTED'));
  }
  #fail(code) {
    this.#closed = true;
    if (this.#pending) {
      const pending = this.#pending;
      clearTimeout(pending.timer);
      this.#pending = undefined;
      // Do not release capacity or permit replacement while timed-out native work still exists.
      this.#exited.then(() => pending.reject(failure(code)));
    }
    this.#child?.kill();
  }
  #receive(chunk) {
    if (this.#closed) return;
    if (this.#buffer.length + chunk.length > 1048576) return this.#fail('SAFETY_UNSUPPORTED');
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const end = this.#buffer.indexOf(10);
    if (end < 0) return;
    const frame = this.#buffer.subarray(0, end).toString('utf8');
    this.#buffer = this.#buffer.subarray(end + 1);
    const pending = this.#pending;
    let value;
    try { value = JSON.parse(frame); } catch { return this.#fail('SAFETY_UNSUPPORTED'); }
    if (!pending || value.id !== pending.id || this.#buffer.length) return this.#fail('SAFETY_UNSUPPORTED');
    this.#pending = undefined;
    clearTimeout(pending.timer);
    if (value.error) pending.reject(failure(value.error));
    else pending.resolve(value.result);
  }
  request(request, { timeoutMs = this.timeoutMs } = {}) {
    if (this.#closed) return Promise.reject(failure('SAFETY_UNSUPPORTED'));
    if (this.#pending) return Promise.reject(failure('BUSY'));
    const id = ++this.#id;
    const frame = JSON.stringify({ ...request, id }) + '\n';
    if (Buffer.byteLength(frame) > 131072) return Promise.reject(failure('LIMIT_EXCEEDED'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail('TIMEOUT'), Math.max(1, Math.min(timeoutMs, this.timeoutMs)));
      this.#pending = { id, timer, resolve, reject };
      this.#child.stdin.write(frame);
    });
  }
  async close() {
    this.#fail('SAFETY_UNSUPPORTED');
    await this.#exited;
  }
}
