---
id: "02"
title: "Add a Windows launcher with bounded owned-server lifecycle"
owner: Lead
status: todo
depends_on: ["01"]
parallel: no
branch: feature/pwa-desktop-02
dod: [TEST, LIFECYCLE, SECURITY, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Start an exclusively owned local server from a Windows checkout launcher and stop only that server through a bounded, testable lease policy.

## Prerequisites
- 01 merged and I1 passed for Edge AND Chrome; use its proven activation/setup contract, never a guessed universal browser CLI feature.
- Runnable independently of unfinished 03: use synthetic authenticated window clients to demonstrate participation, expiry and shutdown. Before 03, an actual app page will time out for lack of registration; do not claim end-to-end product completion.

## Acceptance
- Given Windows and Node.js 22+ with this checkout/dependencies, when `node desktop/launch.mjs --browser edge` or `--browser chrome` runs from any working directory, then it creates an owned child at 127.0.0.1:43187, verifies matching IPC/HTTP readiness within 15s and only then dispatches the selected installed app using I1.
- Given no browser argument, then select Edge; given invalid arguments, unsupported platform/runtime, missing checkout/browser/profile/install, start/ready/dispatch failure, then emit the specified sanitized actionable error and nonzero exit, never an installer/build/elevation prompt.
- Given any existing listener or simultaneous launch, when bind fails, then report `PORT_IN_USE`; do not adopt it, change port, open the app against it or stop it. A duplicate loser cleans only its own child.
- Given owned mode, then implement D9 JSON/IPC contracts, exact same-origin protections, independent memory-only boot capability, limits and no-store; no unauthenticated shutdown endpoint.
- Given normal `npm start`, then owned-mode lifecycle routes remain 404 and existing manual startup/Ctrl+C behavior stays unchanged.
- Given synthetic participating windows, then 15s heartbeats renew 90s leases; one valid lease keeps the server running; last release/expiry starts 30s empty grace; an accepted timely registration cancels it; no first registration within 120s stops the owned server.
- Given expired credentials, invalid traffic or capacity/rate excess, then reject with specified bounded errors without extending grace; serialize the stop/renew race and reject attempts after stopping commits.
- Given launch failure, interruption, IPC/supervisor loss or resource-close stall, then close SSE/polling/Library resources and enforce 5s owned-child-only cleanup; never kill browsers, processes by name, a stale PID, process trees or a foreign listener.
- Given a reported browser spawn success without a first lease, then do not infer visible app success; timeout with `NO_PARTICIPATING_WINDOW` and clean up the owned child.

## Files (expected)
- `desktop/launch.mjs` — proposed checkout entry/supervisor.
- `desktop/server-child.mjs`, `desktop/lifecycle.mjs` — proposed private owned-mode child/controller; consolidate if simpler without weakening boundaries.
- `desktop/launch.cmd` — proposed Node entry wrapper if required for the I1-proven shortcut path; no shell interpolation of arbitrary configuration.
- Minimal local activation configuration/schema only if I1 requires and justifies it; no new dependencies by default.
- `server.mjs` — opt-in owned lifecycle adapter/routes/readiness and startup-failure cleanup, default CLI unchanged.
- `tests/pwa-lifecycle.test.mjs`, `tests/pwa-launcher.test.mjs` — new deterministic node:test suites.
- `tests/server.test.mjs` — default mode/privacy regression coverage.
- `README.md` — independent command/ownership/error guidance; full browser-use instructions in 03.

## Tests and synthetic fixtures
- Inject monotonic clock/timers and spawn/browser adapters; test just-before/at/after TTL, initial grace, empty grace, renew/release/stop races and wall-clock jumps without minute-long sleeps.
- Temporary synthetic activity/Library roots and independent window IDs only; stub Library source cleanup and confirm exactly-once closure. No user's journals, installed profiles or real app settings.
- HTTP tests cover correct bootstrap/token, missing/wrong Host/Origin/fetch/custom header, cross-site navigation/forms/preflight, malformed/oversized/slow/aborted JSON, wrong media type/method, replayed boot credentials, unknown extra fields, max leases, request/rate caps and secret-free errors.
- Spawn fixtures model readiness mismatches, wrong identity/protocol, process exit, EADDRINUSE, spawn/dispatch timeout, first-window timeout, stop failure and IPC loss. Capture outputs to assert no capability leaks in argv/URLs/logs/activity/storage.
- Exercise duplicate-launch races and an independent SENTIENT/foreign HTTP listener; prove it survives and receives no termination/control request. Tests may use ephemeral ports through test injection, but production CLI stays fixed.
- Confirm readiness always precedes browser dispatch, one probe/request in flight, bounded retry timers and no accumulated listeners/processes after cleanup.
- Verify ordinary server mode has no lifecycle controls and preserves privacy/CSP/IPv4 constraints.

## Verify (exact command, run from repo root)
```powershell
node --test tests/pwa-lifecycle.test.mjs tests/pwa-launcher.test.mjs tests/server.test.mjs
npm test
```
New named suites are deliverables. Use existing node:test patterns; do not infer passes from historical test counts.

## Manual Windows lifecycle checks (separate evidence)
1. Use the I1-proven setup to dispatch Edge and Chrome only after owned readiness; record dispatch separately from window/lease evidence.
2. With synthetic participants, confirm multiple live leases, last release and lost-release expiry, initial timeout, and cleanup timings; real page participation is verified in 03.
3. Occupy the port with an independent SENTIENT server and then a harmless foreign test listener; attempt launch and verify both remain running and receive no shutdown request.
4. Double-start the launcher, simulate missing browser and failed activation, interrupt the supervisor, and verify only owned child cleanup. No process-name kill commands.

## DoD rows
| Row | This ticket's completion requirement |
| --- | --- |
| TEST | Scoped and full suite exit/output recorded; deterministic synthetic fixtures leave no listeners/children. |
| LIFECYCLE | Proven readiness/ownership/failure/lease/resource bounds and Windows synthetic-participant checks; browser E2E explicitly not yet claimed. |
| SECURITY | Default start unchanged, foreign process survival, same-origin capability controls, bounded input/resources, no sensitive leaks. |
| REVIEW | Fresh review of ownership races, endpoint guards, child cleanup and I1 integration. |
| BUILD / LINT / TYPECHECK | N/A: no applicable general scripts, no added build/packaging dependency. |

## Out of scope
- Real browser lease wiring/UI recovery (03), native window management, offline caching, installers, auto-login startup, foreign-server reuse, arbitrary port selection.
- No manipulation of the existing user-owned branch or unrelated staged/unstaged work.

## Evidence (filled by Lead)
- Automated command · exit code · last lines · implementation HEAD: pending
- Windows synthetic lifecycle/ownership cases · timings · observed results: pending
- Reviewer verdict: pending
