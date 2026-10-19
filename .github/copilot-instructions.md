# SENTIENT OS repository instructions

## Run and test

- Requires Node.js 22 or newer.
- Install dependencies with `npm install`; run the local app with `npm start` and open `http://127.0.0.1:43187/`.
- Run the full suite with `npm test`.
- Run one test file with `node --test tests/activity-source.test.mjs`; select a test by name with `node --test --test-name-pattern="session HUD status" tests/activity-source.test.mjs`.
- Run the release-sharing checks with `npm run check:publication`.

## Architecture and data flow

- `copilot/activity-source.mjs` polls local Copilot `events.jsonl` files and derives bounded session status, coverage, and statistics. Its initial baseline is not replayed as live activity.
- `server.mjs` serves the app’s explicit static/vendor asset allowlists and streams validated snapshots and activity over `/events`. It is intentionally restricted to IPv4 loopback.
- `index.html` and `style.css` define the browser UI. `main.js` builds the Three.js scene; `activity-client.mjs` validates and projects incoming event data and owns browser-side activity state; `session-stats-ui.mjs` renders statistics.
- `activity-colors.mjs` is the shared activity category and palette mapping. `visual-settings.mjs` contains appearance tuning; `main.js`’s `CFG` contains structural geometry and fixed buffer capacities. Keep activity categories separate from pulse motion kinds.
- Adding a browser-loaded module requires adding its URL-to-file mapping to `STATIC_FILES` in `server.mjs`. Three.js and its addons are served locally through the import map; do not introduce a CDN dependency.
- Preserve coverage as distinct from zero activity: partial or missing observation is unknown, not verified idle. Consult `README.md` for the documented status, timeline, visual-tuning, and privacy behavior.

## Project-specific constraints

- Keep the application local-only and read-only. Do not expose raw session IDs, journal paths, prompts, reasoning content, tool arguments, or tool results in browser-facing data; preserve the server’s bounded projections and loopback restriction.
- Tests use Node’s built-in `node:test` and `node:assert/strict`, synthetic temporary journal directories, and controlled clocks. Use synthetic fixtures rather than real user journals or screenshots.
- Keep visual-only edits in `visual-settings.mjs`; palette/category changes belong in `activity-colors.mjs`. Do not move geometry or buffer capacity settings into visual tuning.
