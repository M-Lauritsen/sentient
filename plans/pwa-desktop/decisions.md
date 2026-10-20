# PWA desktop decisions and implementation contracts

Checkpoint ①: APPROVED; Gate A: PASS. Checkpoint ②: pending approval of tickets.
This record preserves confirmed choices, not a new questionnaire. Only planning files are being written.
Major: yes (Windows launcher/server ownership and browser install/client lifecycle).

## Confirmed decision map
- D1 · deliverable · specifications before implementation | implement now · specifications only · depends_on: [] · decided (approved).
- D2 · entry point · companion launcher starts backend | browser shortcut only · companion launcher plus true PWA · depends_on: [D1] · decided.
- D3 · backend lifecycle · stop after windows close | keep running · automatic best-effort delayed stop · depends_on: [D2] · decided.
- D4 · closure reliability · true browser PWA with suspension risk | managed native window · true browser-managed Edge/Chrome PWA, accepted best-effort shutdown · depends_on: [D3] · decided.
- D5 · distribution · existing checkout/Node.js 22+ | self-contained installer · checkout/Node.js 22+ first · depends_on: [D2] · decided.
- D6 · privacy/scope · loopback, no cached activity/Library | network/offline expansion · preserve restrictions; no offline data caching · depends_on: [D4] · decided.
- D7 · shortcut semantics · launcher cold start | browser-installed shortcut cold start · launcher is supported backend bootstrap; browser shortcut cannot start Node · depends_on: [D2,D4] · decided.

## Grounding and evidence boundaries
- Current code: `server.mjs` exports `createSentientServer`, binds IPv4 loopback, serves an explicit `STATIC_FILES` map, has Host/origin/fetch guards, no-store responses, bounded HTTP/SSE and `stop()` cleanup of streams/source/Library helper.
- `package.json`: Node >=22, ES modules, `npm start` = `node server.mjs`, `npm test` = `node --test tests/*.test.mjs`; no general build/lint/typecheck commands. Library builds stay opt-in and are not launcher startup hooks.
- Existing client uses SSE epoch/sequence validation and a 15-second reconnect presentation grace. New PWA return-from-suspension handling must invalidate live coverage before validating recovery; do not silently relabel last-known data as live.
- `docs/project-profile.md` is historical evidence only, not current test results; `docs/definition-of-done.md` is absent, so ticket rows are explicitly defined here rather than invented as an existing repository policy.
- Root AGENTS.md was reported absent; no nearer plans AGENTS.md found. Existing dirty staged/unstaged source, tests and deleted plans are outside this planning operation.
- Do not change ignore/publication rules or resurrect plans; whether these new planning files are tracked does not authorize publication or commits.
- Official platform reference, retrieved 2026-10-20: [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). Chromium manifest requirements include name/short_name, 192/512 icons, start_url and display; loopback is eligible; a service worker is not an installation prerequisite.
- Browser installation/promotion UI is browser-controlled. A manifest test does not prove installation, activation, profile selection, last-window behavior or shortcut operation.
- No implementation commands or tests were run for these planning artifacts. All implementation and manual evidence remains pending.

## D8 · Launcher ownership and entry contract · decided design
- Proposed entry: `node desktop/launch.mjs --browser edge|chrome`; no argument selects Edge; invalid arguments exit 2 with usage. Windows only; verify Node >=22 and required checkout/dependencies, but never install/build automatically.
- The launch shortcut must target this checkout with absolute, correctly quoted paths; invoking it from another working directory must work. It must not require elevation, execution-policy changes, a packaged runtime or a browser extension.
- Browser/profile activation configuration, if needed, is local and explicit with a minimal schema established by I1. It contains no activity or lifecycle secrets; no arbitrary shell command field. No silent switch to another browser/profile.
- Use an owned Node child and private IPC to establish protocol version and random per-boot instance identity; lifecycle mode is enabled only via this launcher-owned creation path, not default CLI startup.
- Occupied `127.0.0.1:43187` always means `PORT_IN_USE`, including another launcher or an independently started SENTIENT server. Do not adopt/reuse a listener, select a new port, infer ownership from HTML/PID alone, or stop any existing process.
- Concurrent launcher starts resolve at the exclusive bind: exactly one can own the listener; losers report the conflict and clean up only their own child. No persistent PID lock is needed for this fail-closed design.
- Start activity/Library readiness as existing APIs allow; ordinary activity must not depend on optional Library builds. Catch partial-start errors and close any source/helper resources acquired by the owned child.
- After child READY IPC, probe the HTTP readiness endpoint at the fixed origin and require matching instance identity and protocol, before any browser open attempt. Overall readiness timeout 15s; individual probes at most 1s and one in flight, with bounded retry count.
- Browser-command spawn/dispatch has a 10s timeout. A successful OS dispatch is not proof of a visible installed PWA or of app-window closure; first lease is the participation acknowledgement, with the separate 120s initial grace.
- Proposed launcher failures: `UNSUPPORTED_PLATFORM`, `NODE_VERSION`, `CHECKOUT_UNAVAILABLE`, `BROWSER_UNAVAILABLE`, `APP_ACTIVATION_UNAVAILABLE`, `PORT_IN_USE`, `START_FAILED`, `READY_TIMEOUT`, `BROWSER_LAUNCH_FAILED`, `NO_PARTICIPATING_WINDOW`, `OWNERSHIP_LOST`, `CLEANUP_FAILED`. Sanitized stderr, nonzero exit, actionable next step, no private payloads/tokens.
- Launcher remains a supervisor, separate from the browser process; never use browser-process exit as a window-close signal. Owned child stops itself on lease policy or private IPC stop. Parent/IPC loss triggers owned-child cleanup, not foreign-server cleanup.
- Explicit browser dispatch failure, first-window timeout, startup failure, interruption or supervisor loss requests graceful owned-child shutdown; after 5s only the still-held owned child handle may be forcibly terminated. Child also has bounded resource-close/exit handling if IPC is gone. Never kill by process name, port scan, stale PID or browser process; no process-tree sweep.
- Graceful stop closes SSE, timers, activity polling and any Library helper using existing cleanup. Report a cleanup failure rather than claiming success; a detached browser may remain open and must display an unknown/disconnected state.

## D9 · Owned-mode HTTP/IPC contract · decided design
- Lifecycle routes are absent (404) in ordinary `npm start` mode; default startup, manual Ctrl+C and privacy behavior stay unchanged.
- Private IPC carries protocol 1, boot instance identity, ready/failure/stop/stopped messages. An ownership capability, if used, travels only over private IPC, never a URL, argv, persisted config or browser activity.
- `GET /api/app-lifecycle/ready` returns `{protocol:1, instanceId, state:"ready"}` only after initialization; 503 while stopping/not ready. Native readiness probes supply canonical Host/origin/fetch headers; the body contains no credential, process ID, filesystem path or activity.
- `GET /api/app-lifecycle/session` returns `{protocol:1, instanceId, token, heartbeatMs:15000, leaseTtlMs:90000}`. This is a new random >=256-bit browser lifecycle capability per boot, unrelated to the Library token; in-memory only, never storage/logs/URLs/SSE.
- Bootstrap and lease routes require exact `Host: 127.0.0.1:43187`, exact Origin when present, `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: same-origin`, `Sec-Fetch-Dest: empty`, and custom `X-Sentient-Lifecycle: 1`. POST requires exact Origin and `application/json`. No CORS allow-origin; reject cross-site, missing fetch metadata, navigation/forms and preflight access. Native tests/probes explicitly set these headers.
- `POST /api/app-lifecycle/leases` accepts only `{op:"register"|"renew"|"release", instanceId, windowId}` and `X-Sentient-Lifecycle-Token`; windowId is a random 128-bit base64url identifier per live document, never a journal/session ID. Strict schema; reject extra fields and invalid lengths. No shutdown operation.
- Success is `{instanceId, windowId, state:"active"|"released", leaseTtlMs:90000}`. Register is idempotent; renew requires an existing unexpired lease; release is idempotent but only for the matching boot and authorized request.
- JSON errors use `{error:{code}}`: 400 `INVALID_REQUEST`, 403 `FORBIDDEN`, 404 `LIFECYCLE_DISABLED`, 405 `METHOD_NOT_ALLOWED` with Allow, 409 `INSTANCE_CHANGED`/`LEASE_EXPIRED`, 413 `LIMIT_EXCEEDED`, 415 `UNSUPPORTED_CONTENT`, 429 `BUSY`, 503 `STOPPING`. Invalid/old credentials receive 403 before boot mismatch details; do not expose secrets through errors.
- Limits: 8 live leases, 2KiB request bodies, 2s request timeout, 8KiB responses maximum; one heartbeat request in flight per window; bounded expirations/rate state. Use bounded token comparison. Reject oversized/chunked-overflow, malformed UTF-8/JSON, slow or aborted requests without updating leases.
- Global lifecycle request budget: 32 in flight, 256 requests per 10s rolling server window, excess 429; expiry checks remain independent. Rejected/unauthorized requests never extend grace or pin shutdown.
- All lifecycle responses are `Cache-Control: no-store`; no service worker or Cache API; preserve existing CSP, traversal/symlink protections, activity/Library no-store and all loopback checks.
- This protects against hostile web origins, not malicious local software or same-origin compromise. Same-origin XSS is a lifecycle capability risk; do not weaken CSP or render Library content unsafely.

## D10 · Lease aggregation and timers · decided design
- Reversible initial constants: heartbeat 15s, lease TTL 90s, empty grace 30s, initial first-window grace 120s after readiness. Keep them centralized/test-injectable; no new broad configuration surface.
- Participating means any live same-origin page/document that registers, including installed PWA windows and ordinary app tabs. Do not attempt unreliable browser-level enumeration or infer closure from SSE client count alone.
- Browser gets the boot session then registers its own memory-only windowId. Reload creates a new ID; abandoned IDs expire. One document cannot release another via a shared localStorage ID; do not persist IDs or credentials.
- Heartbeats continue for hidden/minimized windows as scheduling permits. Visibility loss alone never releases a lease. On `pagehide`, a best-effort authenticated same-origin keepalive release may be attempted, but correctness must not depend on delivery; no unauthenticated sendBeacon shortcut.
- `pagehide` with bfcache persistence must not signal guaranteed closure. `pageshow`/return to visibility/focus after a gap invalidates live coverage, obtains a current boot session and re-registers as needed before treating data as fresh.
- State machine: ready -> awaiting-first-window -> active (>=1 valid lease) -> empty-grace (0 valid leases) -> stopping -> stopped. No first registration by 120s means owned stop with `NO_PARTICIPATING_WINDOW`, even if browser spawn succeeded.
- After at least one registration, expired/released leases are removed; the last removal starts 30s empty grace. An accepted registration/renewal before stopping cancels empty grace; other live leases keep the server up.
- Under normal active scheduling, lost close signals cause shutdown no later than 120s after the last accepted heartbeat (90s TTL + 30s grace), plus scheduler tolerance. Successful last-window release yields approximately 30s. Initial 120s grace is separate.
- Server timers use monotonic elapsed time, recheck state at deadlines, and serialize stop vs registration/renewal. Once stopping commits, reject new leases; do not revive an exiting instance.
- Suspension can prevent heartbeats while a window is still open, so that window may lose its server. OS/browser suspension can also delay timer execution/shutdown. No guaranteed exact deadline or OS-wide “last window” claim.
- Bounded stale leases disappear on expiry/restart. Capacity 429 is visible/retryable with bounded backoff, not an invitation to increase resource limits silently. No unbounded retry queues or history.

## D11 · Browser install, stale state and user recovery · decided design
- Manifest id, start_url and scope are `/`, without query secrets; fixed canonical origin `http://127.0.0.1:43187`. Name `SENTIENT OS`, short_name `SENTIENT`, display `standalone`, prefer_related_applications false/omitted; local genuine 192/512 PNGs. Use explicit static MIME entries and a manifest link; no wildcard file serving.
- No service worker, offline shell or runtime caching is needed in this first version. Activity/Library data stays memory-only/no-store; existing visual/workspace preference persistence is not a new activity cache.
- Distinct names/documentation: “SENTIENT launcher (starts server)” and browser-created “SENTIENT OS” app shortcut. Browser-installed shortcut cannot invoke Node or reopen a stopped backend. With no server/cache, its cold failure may be the browser's own unavailable-page UI; do not promise an in-page recovery screen there.
- First-time setup uses ordinary `npm start`, opens the canonical origin in the explicitly selected browser/profile, installs through browser UI, and records any I1-required activation settings. The user stops that manually started server with Ctrl+C before using the launcher; the launcher must not take it over. Shortcut setup is opt-in and documented, not an installer or automatic login hook.
- On loaded-page connection loss, known lease expiry, or return from suspension, mark coverage unknown immediately, stop counting events and presenting running animation/status as fresh. Existing ordinary short transport grace can retain visibly last-known content; it must not assert live coverage, and PWA lifecycle-invalid state must not preserve running pulses.
- Loading lasts until a validated current snapshot. Quiet/empty means no observed activity, not verified idle. Show actionable backend-unavailable text on a loaded page: run the launcher; browser-installed shortcut cannot start the server.
- Refresh boot/session capability on recovery; do not reuse old credentials after 403/409 or instance change. Force a fresh SSE snapshot/epoch baseline before accepting deltas; discard buffered stale deltas and do not backfill gap events or fabricate timeline totals.
- Clear stale session/tree/Library detail on known instance replacement; retain permitted layout/preferences. Library may refetch only through the existing safe API; an old detail selection is not live/fresh evidence. Do not reset lifetime page totals merely because a transport reconnects; preserve existing no-gap-counting semantics.
- No user uninstall interception; closing/uninstalling is handled by lease expiry. Installation promotion and menu placement vary by browser/version/policy; no guarantee of an always-visible install icon.

## I1 · Browser activation mechanics · investigation prerequisite, not a reopened user choice
- Status: pending; owner Lead, ticket 01. Blocks launch integration in 02, not manifest work.
- Budget: at most one working day; use current stable Windows Edge AND Chrome, a disposable local profile for each, and a checkout path with spaces. Record OS/browser versions and browser policy restrictions.
- Establish installation using actual browser UI, then determine a repeatable explicit browser/profile/app activation method for the launcher. Test browser initially closed and already running; verify the intended installed app (not just an arbitrary `--app` URL window or another profile).
- Read official browser documentation for any assumed command/shortcut contract. If app IDs/shortcuts are profile-specific, document discovery, validation, supported configuration and failure behavior; never guess IDs or parse/run arbitrary shortcut command text.
- Demonstrate safe argument arrays/shortcut quoting, fixed secret-free origin, absence of shell interpolation, and missing-browser/profile/install handling. A browser process may dispatch and exit; this is not closure evidence.
- Deliver measured evidence and selected bounded strategy/config in this decision record. Tests must cover the selection/validation contract using synthetic inputs; real activation evidence is separate.
- Exit acceptance: both browsers have a reproducible supported activation/setup path with explicit profile requirements and no native window ownership. No dependency may assume a universal CLI feature.
- If unsupported at the budget limit, mark 02 blocked with evidence and a concrete limitation/options report. Do not silently downgrade to Electron, invent a universal switch, or require an installer; only a genuinely blocking scope change returns to the user.

## DoD and implementation sequencing
| Row | Required evidence |
| --- | --- |
| BUILD / LINT / TYPECHECK | N/A for this JS/asset/launcher change: no applicable general scripts. Existing optional Library build scripts are not general validation substitutes. |
| TEST | Ticket-scoped `node --test ...` and `npm test`, exact exit/output at implementation HEAD; synthetic fixtures only. Record pre-existing failures separately; never waive new failures based on profile history. |
| LIFECYCLE | Deterministic timer/ownership/adversarial HTTP tests in 02; browser registration/recovery and end-to-end tests in 03. |
| BROWSER | Actual Windows stable Edge AND Chrome manual install/activation in 01 and full matrix in 03; record versions, setup, observed timing and outcomes separately from automated output. |
| SECURITY | No foreign listener/process termination; no credentials in URLs/activity/storage/logs; same-origin/capability/body/time/resource limits; no offline activity/Library cache. |
| REVIEW | Fresh reviewer verdict pending; no fabricated review/test evidence. |

1. 01 is independently ready after checkpoint ②: manifest/asset tests plus bounded activation investigation; no launcher implementation.
2. 02 starts only after 01 merges and I1 passes: owned-server launcher/lifecycle, executable/testable with synthetic windows; browser lease integration intentionally comes in 03.
3. 03 starts after 01 and 02 merge: actual browser participation, stale-state recovery, shortcut guidance and full manual matrix. Each ticket verifies against its merged prerequisites, not unfinished work.
4. Suggested per-ticket branches are metadata only. Preserve the user-owned dirty branch/worktree; no branch creation/switch, commits, pushes or implementation during planning.
5. Rollback after implementation: stop only the launcher's child, remove additive PWA/lifecycle integration, keep manual server behavior; browser uninstall/shortcut removal is explicit user action. No persisted lifecycle state or migration to undo.
