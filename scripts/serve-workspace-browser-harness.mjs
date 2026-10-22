import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['tests/workspace-browser-harness.html', 'text/html; charset=utf-8']],
  ['/appearance', ['tests/appearance-browser-harness.html', 'text/html; charset=utf-8']],
  ['/appearance-browser-harness.mjs', ['tests/appearance-browser-harness.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace-browser-harness.mjs', ['tests/workspace-browser-harness.mjs', 'text/javascript; charset=utf-8']],
  ['/activity/activity-client.mjs', ['activity/activity-client.mjs', 'text/javascript; charset=utf-8']],
  ['/activity/activity-colors.mjs', ['activity/activity-colors.mjs', 'text/javascript; charset=utf-8']],
  ['/appearance/visual-config.mjs', ['appearance/visual-config.mjs', 'text/javascript; charset=utf-8']],
  ['/visual-settings.mjs', ['visual-settings.mjs', 'text/javascript; charset=utf-8']],
  ['/appearance/visual-settings-ui.mjs', ['appearance/visual-settings-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/appearance/visual-settings-preview.mjs', ['appearance/visual-settings-preview.mjs', 'text/javascript; charset=utf-8']],
  ['/appearance/visual-settings-worker.mjs', ['appearance/visual-settings-worker.mjs', 'text/javascript; charset=utf-8']],
  ['/three.module.js', ['node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8']],
  ['/ui/session-stats-ui.mjs', ['ui/session-stats-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace/workspace-model.mjs', ['workspace/workspace-model.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace/workspace-ui.mjs', ['workspace/workspace-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/ui/navigation-ui.mjs', ['ui/navigation-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(asset[0], root));
    response.writeHead(200, {
      'Content-Type': asset[1],
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'sha256-v+eCoFIc4h3ug0mh21Zy6e0Vd/I2tIIB3qAa575EJkM='; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(500).end('Harness asset unavailable.');
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(`Synthetic workspace harness: http://127.0.0.1:${address.port}/`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
