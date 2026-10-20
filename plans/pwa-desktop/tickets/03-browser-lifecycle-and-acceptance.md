---
id: "03"
title: "Connect browser window leases and verify PWA lifecycle end to end"
owner: Lead
status: todo
depends_on: ["01", "02"]
parallel: no
branch: feature/pwa-desktop-03
dod: [TEST, LIFECYCLE, BROWSER, SECURITY, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Let real PWA windows participate in owned-server lifecycle while honestly showing gaps/recovery and documenting the two distinct shortcuts.

## Acceptance
- Given an owned backend, when an app document loads, then it bootstraps the same-origin session, registers its unique memory-only window ID and renews every 15s as scheduling permits, with at most one in-flight request and bounded retry/backoff.
- Given ordinary manually started server mode with lifecycle 404, then the page continues existing functionality without pretending it owns or may stop that server.
- Given several windows/tabs, then their leases aggregate independently; closing one cannot stop a server held by another. Hidden/minimized state alone does not release a lease; no last-window count is inferred from browser-process exit or storage.
- Given final close/crash/bfcache transition or failed keepalive release, then expiry/grace implements D10 best-effort policy; successful release is only a hint, never a guarantee.
- Given known lease loss/instance change or a return from suspension, then immediately mark coverage unknown and stop stale live indicators/pulses/counting before revalidating the boot and fresh SSE snapshot; do not backfill missed deltas or totals.
- Given an owned server stops/restarts while a page is suspended, then old tokens/IDs cannot control the new instance; refresh session/register and establish a new epoch baseline, clear stale session/tree/Library detail, and recover without representing stale work as live.
- Given a loaded page loses the backend, then show actionable “run the launcher” guidance and unknown coverage. Given an unloaded installed shortcut and stopped backend, then document browser-owned unavailable-page behavior rather than promising a custom offline screen.
- Given current stable Windows Edge AND Chrome, then complete the real matrix below; automated simulations alone cannot satisfy BROWSER.
- Given launcher/setup documentation, then clearly distinguish “SENTIENT launcher (starts server)” from browser-created “SENTIENT OS”, dependencies, browser/profile requirements, accepted suspension/shutdown risks, failure recovery and rollback/uninstall.
- Given a first-time user, then document opt-in launcher-shortcut creation with safe absolute paths and first installation via manual `npm start`; stop the manually started server before using the launcher, never adopt it.

## Files (expected)
- `pwa-lifecycle-client.mjs` — proposed browser-only lease/session adapter with injected clock/fetch for testing.
- `bootstrap.mjs` and/or `visual-config.mjs` — minimal initialization, after checking current startup flow.
- `activity-client.mjs`, `main.js` — narrowly scoped recovery invalidation/snapshot baseline integration; preserve unrelated visual/workspace behavior.
- `copilot-library-ui.mjs` — stale detail invalidation only if needed for known instance replacement.
- `server.mjs` — explicit static entry for the new browser module; no wildcard route.
- `index.html`, `style.css` — only accessible lifecycle/recovery guidance as needed, no broad redesign.
- `tests/pwa-browser-client.test.mjs`, `tests/pwa-end-to-end.test.mjs` — new synthetic node:test suites.
- `tests/activity-client.test.mjs`, `tests/ui-contract.test.mjs`, `tests/copilot-library-ui.test.mjs` — focused regressions.
- `README.md` — final setup/shortcut/lifecycle/limitations/recovery/rollback guidance.
- `plans/pwa-desktop/decisions.md` — measured browser evidence/limitations if needed.

## Tests and synthetic fixtures
- Fake fetch/timers/visibility/pagehide/pageshow/focus/EventSource and synthetic snapshots with distinct epochs; no real user profiles, journals, prompts or Library roots.
- Cover bootstrap/register/renew/release, missing/disabled lifecycle, 403/409 token rotation and lease expiry, 429 capacity/backoff, abort/timeouts, bfcache return, no overlapping requests, and full timer/listener teardown.
- End-to-end Node test uses actual ephemeral owned server plus synthetic browser adapters/clock and a fake browser dispatcher, proving registration/aggregation/expiry/restart and ready-before-dispatch without depending on real Chromium in CI.
- Prove coverage becomes unknown before stale queued events can be accepted; no stale running animation/counting, no replay/backfill or totals inflation on suspension/reconnect, new-epoch snapshot required.
- Preserve ordinary transport reconnect behavior where compatible: last-known content is visibly unknown, not fresh; known lifecycle-invalid state must suppress running pulses immediately.
- Assert Library detail from a replaced instance is cleared and cannot silently remain current; existing source restrictions and safe rendering remain intact.
- Assert lifecycle tokens/window IDs never appear in storage/URLs/activity/Library/log payloads; no service worker/offline cache introduced; preferences remain allowed.

## Verify (exact command, run from repo root)
```powershell
node --test tests/pwa-browser-client.test.mjs tests/pwa-end-to-end.test.mjs tests/activity-client.test.mjs tests/ui-contract.test.mjs tests/copilot-library-ui.test.mjs
node --test tests/pwa-installability.test.mjs tests/pwa-lifecycle.test.mjs tests/pwa-launcher.test.mjs
npm test
```
These are node:test pattern commands, not a claim tests already exist or pass. Record current full-suite failures independently of the historical profile.

## Manual real-browser acceptance (required for BOTH stable Edge and Chrome)
Record OS/browser versions, explicit profile/setup, selected activation method, observed window behavior, measured delays and outcome per row. Use synthetic activity and Library fixtures; no real private payloads in screenshots/logs.

| Case | Required observation |
| --- | --- |
| Actual install | Browser UI installs the manifest-backed PWA; correct name/icons and standalone launch; no promise of an always-present promotion icon. |
| Supported cold launch | Backend stopped, launcher shortcut from a different working directory/path with spaces starts only its child, readiness precedes browser open, correct installed app/profile registers a lease. |
| Browser shortcut | Backend running: browser-created shortcut works; backend stopped: cannot bootstrap Node, browser error is documented. |
| Last close | Final window close with release and simulated dropped release; approximately 30s grace or <=120s from last heartbeat under normal scheduling, with recorded tolerance; no guaranteed closure notification. |
| Multiple windows/tabs | Two independent documents register; close one, keep another active, backend remains; close final participant, backend eventually stops. Document 8-lease capacity behavior. |
| Hidden/minimized | No intentional release on hiding; active-scheduler heartbeats preserve the lease as possible, no promise against browser throttling. |
| Suspension | Freeze/discard or sleep beyond TTL; backend may stop while a window remains open or timers may run late. Resume shows unknown before fresh data and tells user to run launcher if needed. |
| Restart/reconnect | Restart via launcher after stop, return old window, verify fresh boot/token and snapshot baseline; no stale running activity, pulses, Library detail or counted gap events. |
| Startup/activation failure | Missing browser/profile/install, dispatch failure and no first lease produce actionable errors and owned cleanup; dispatch exit alone is not success. |
| Duplicate/foreign listener | Double launch plus independently started SENTIENT and harmless foreign listener; no adoption, no foreign termination/control request, no alternate port or browser-open-on-foreign-origin. |
| Privacy/cache | DevTools/network/storage checks: loopback only, no lifecycle secret in URLs/activity/logs/storage, no service worker/activity/Library offline cache. |
| Rollback | Stop only owned backend; ordinary npm start/Ctrl+C still works; browser uninstall/shortcut removal separate; no lifecycle state migration. |

Browser policy preventing a required case must be reported as blocked/unsupported, not recorded as passed. Capture manual evidence separately from node:test output.

## DoD rows
| Row | This ticket's completion requirement |
| --- | --- |
| TEST | Both scoped commands and npm test recorded at implementation HEAD, including current failure classification. |
| LIFECYCLE | Synthetic E2E and browser loss/suspension/aggregation/recovery safeguards pass without stale-live presentation. |
| BROWSER | Complete actual Edge + Chrome matrix with timings and limitations; no synthetic substitute. |
| SECURITY | Memory-only capabilities, exact same-origin use, unchanged privacy/Library safety, no sensitive cache or external network. |
| REVIEW | Fresh verdict covers browser state invalidation and end-to-end evidence. |
| BUILD / LINT / TYPECHECK | N/A: no applicable general scripts; no new build/packaging dependency. |

## Out of scope
- Guaranteed OS-wide last-window detection, managed/native windows, Electron, offline data, installer/runtime bundling, telemetry/CDN, auto-login startup or broad UI redesign.
- Branch/worktree changes during planning, unrelated dirty files, ignore/publication-rule changes, commits or pushes.

## Evidence (filled by Lead)
- Automated command · exit code · last lines · implementation HEAD: pending
- Manual Edge matrix · versions · timings · observed outcomes: pending
- Manual Chrome matrix · versions · timings · observed outcomes: pending
- Reviewer verdict: pending
