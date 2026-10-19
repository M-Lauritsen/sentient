// Synthetic browser-worker bridge: execute the shipped, self-contained browser
// bundle in a real terminable thread, not an in-process parser mock.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = {
  postMessage: (message) => parentPort.postMessage(message),
};
if (workerData?.stall) {
  // Deliberately broken synthetic parser, never a source-controlled operation.
  parentPort.on('message', () => {
    parentPort.postMessage({ type: 'synthetic-parser-started' });
    for (;;) { /* Termination, not a cooperative flag, must stop this thread. */ }
  });
} else {
  await import('../../copilot/generated/library-markdown-worker.mjs');
  parentPort.on('message', (data) => self.onmessage({ data }));
}
