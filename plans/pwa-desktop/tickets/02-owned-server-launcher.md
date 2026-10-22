---
id: "02"
title: "Add a Windows launcher with bounded owned-server lifecycle"
owner: Lead
status: done
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
- 01 verified in the current checkout and I1 scoped to the installed Brave app; use its validated shortcut/profile contract, never a guessed universal browser CLI feature. On 2026-10-21 the user explicitly replaced the merge prerequisite with in-place continuation against the verified, uncommitted 01 changes, then selected Brave-only/default after the shortcut's actual browser was established. Edge and Google Chrome launcher activation are deferred. No commits, pushes or merges are authorized.
- Runnable independently of unfinished 03: use synthetic authenticated window clients to demonstrate participation, expiry and shutdown. Before 03, an actual app page will time out for lack of registration; do not claim end-to-end product completion.

## Acceptance
- Given Windows and Node.js 22+ with this checkout/dependencies, when `node desktop/launch.mjs --browser brave` runs from any working directory (absolute script path when outside the checkout), then it creates an owned child at 127.0.0.1:43187, verifies matching IPC/HTTP readiness within 15s and only then dispatches the installed Brave app using I1.
- Given no browser argument, then select Brave; given Edge/Chrome selection, invalid arguments, unsupported platform/runtime, missing checkout/browser/profile/install, start/ready/dispatch failure, then emit the specified sanitized actionable error and nonzero exit, never an installer/build/elevation prompt.
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
- `desktop/activation.mjs` — validated Brave shortcut selection and shell-free dispatch.
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
1. Use the I1-proven setup to dispatch Brave only after owned readiness; record dispatch separately from window/lease evidence. Edge/Google Chrome are explicitly deferred by user direction.
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
- Candidate · 2026-10-21 · uncommitted worktree based on HEAD `7da9d45f73c20e1824737ae72c57b68e0f86def2`. Implementation/test/asset/README SHA-256: `b70b3e4b42424d18f17102788dbd26a72141ffcd5f7dddeda46e4985852eb620`. Digest covers sorted relative filenames, NUL separators and contents of `server.mjs`, `index.html`, `manifest.webmanifest`, `README.md`, all four `desktop/*.mjs`, both icons, all four `tests/pwa-*.test.mjs`, and the owned-child fixture (15 files). Evidence-only ticket edits are excluded. No commit/push/branch change.
- Final automated commands · agent-observed:
  - `node --test tests\pwa-lifecycle.test.mjs tests\pwa-launcher.test.mjs tests\server.test.mjs` · exit 0 · 44 passed, 0 failed, 0 skipped.
  - `npm test` · exit 0 · 401 passed, 0 failed, 0 skipped. Includes all seven activation tests and installability regressions.
  - `git diff --check` · exit 0 · no output.
- Windows synthetic lifecycle/ownership · automated real-process fixtures, not a manual browser matrix:
  - Two documents/last release: owned child exit 0 and listener unreachable; test elapsed 243ms with injected 60ms empty grace.
  - Lost release: both leases expired; child exit 0 and listener unreachable; 720ms with injected 500ms TTL plus 60ms grace.
  - No first lease: expected `NO_PARTICIPATING_WINDOW`, child exit 1 and listener unreachable; 285ms with injected 150ms initial grace.
  - Foreign HTTP listener: `PORT_IN_USE`, zero readiness/control requests, foreign listener still responded; 157ms.
  - Independent ordinary SENTIENT listener: `PORT_IN_USE`; ordinary page remained 200 and lifecycle bootstrap 404; 156ms.
  - Double-start race: exactly one dispatch/owner; loser `PORT_IN_USE`, winner remained ready and exited only after last release; 230ms.
  - IPC loss: real child exit 1 and listener unreachable; 144ms.
  - Above elapsed values include process/test overhead, not asserted production shutdown deadlines. Default 120s/90s/30s boundaries are checked with the controlled monotonic clock. Slow/aborted input, hostile metadata, capacity/rate bounds, replay, readiness retry/overflow/stall and held-child cleanup-stall paths are covered by focused fixtures.
  - Active SSE closes on stop; polling stops after partial bind failure; acquired Library cleanup is attempted exactly once even when it rejects. Library and lifecycle capabilities are distinct; desktop modules and lifecycle capabilities are absent from public assets/SSE.
- Separate live Brave smoke · agent-observed after the user confirmed the manual server was stopped: matching private IPC and canonical HTTP readiness preceded actual validated installed-app dispatch. Synthetic-only roots/settings, 6s injected initial grace, expected no-participation failure, owned child/listener gone after 7291ms including discovery/startup. Temporary roots removed; browser not terminated.
- Visible installed-app result · user-reported after that smoke: **“Yes, it opened as a standalone Brave app.”** This is not agent-observed visibility, profile-policy testing or browser lease evidence.
- Fresh reviewer · `code-review` agent · read-only review of launcher, activation, child, lifecycle, server integration, tests and canonical requirements: **No actionable findings.** Reviewer did not run tests or independently verify manual evidence. Two newly added tests were subsequently moved from accidental nesting to top-level registration; no production code changed, and both required commands were rerun with the final results above.
- Historical state before closure: implementation and automated checks were recorded, but the separate Windows runtime failure/interruption rehearsal was pending. The following closure evidence resolves that pending work; earlier automated coverage is not relabeled as manual.

### Windows runtime closure · 2026-10-21
- Candidate unchanged: the implementation digest above matched before and after this rehearsal. The recorded 44 focused / 401 full-suite passes and fresh code review remain applicable; no production/test/dependency files changed during closure.
- Operator-driven interruption · 07:18 local · the user pressed Ctrl+C in the visible terminal after actual installed Brave dispatch and confirmed the PASS output. The result file and terminal output independently showed graceful owned-child exit 0, listener closure in **20ms**, and readiness before interruption. The check did not terminate the browser.
- Operator-observed, scripted runtime rehearsal · 07:20–07:23 local · executed in the visible Windows terminal, outside `node:test`, with actual child processes, the canonical port and synthetic clients/filesystem roots. The user reported the PASS message; the agent waited for and inspected the completed result file and terminal output before recording success. This is a synthetic-client runtime rehearsal, not real browser lease participation or an agent-observed visual browser matrix.
  - Foreign listener: launcher returned `PORT_IN_USE`, sent **zero** HTTP requests to the listener, and the original listener still responded. Only the rehearsal's own listener was subsequently closed.
  - Independent ordinary SENTIENT: launcher returned `PORT_IN_USE`; the original server remained running, its page returned 200 and lifecycle bootstrap remained 404. Only the rehearsal's own manual server was subsequently stopped.
  - Missing browser/profile/install: each case used actual missing files/directories under a temporary synthetic root and returned the expected `BROWSER_UNAVAILABLE` / `APP_ACTIVATION_UNAVAILABLE`. No installed browser/profile/shortcut was removed or altered.
  - Failed activation: an actual process-spawn attempt against a deliberately missing synthetic executable returned `BROWSER_LAUNCH_FAILED`; the owned child exited and its listener closed.
  - Simultaneous launch: exactly one owner/dispatch-adapter call, one `PORT_IN_USE` loser; the winner still answered readiness after the loser exited, then stopped through its private owned-stop path. No browser spawn was inferred from the synthetic adapter.
  - Two participants with production constants: releasing the first left the second live; the second renewed after **15 seconds** and readiness still returned 200. After final release the server remained ready at 29 seconds, then child/listener shutdown completed in **30.016 seconds**.
  - Lost release with production constants: no release/renew was sent; readiness remained 200 at 91 and 119 seconds, then shutdown completed **120.020 seconds** after registration (90s TTL + 30s grace).
- The prior actual Brave dispatch/no-first-window smoke and user-confirmed standalone window remain separate evidence above. First-window timeout used an explicitly injected 6s grace; the production 120s initial boundary is covered by controlled-clock tests, not claimed as a new 120s manual browser measurement.
- Cleanup verified: every held rehearsal child had exited, temporary synthetic roots were removed, terminal returned to its shell prompt, and a separate OS listener query found **zero** listeners at port 43187.

### Completion checks
| Check | State | Evidence / boundary |
| --- | --- | --- |
| TEST | Met | Recorded focused/full-suite passes; unchanged implementation digest. |
| LIFECYCLE | Met | Controlled-clock/resource/failure tests plus actual Windows interruption, ownership and production-duration synthetic-client rehearsal above. Real page wiring remains 03. |
| SECURITY | Met | Same-origin/capability/input tests, separate capabilities, ordinary mode preservation and observed foreign-listener survival. This is scoped evidence, not repository-wide security clearance. |
| REVIEW | Met | Recorded independent fresh review; closure changed evidence/status only. |
| BUILD / LINT / TYPECHECK | Not applicable | No applicable general scripts or added build/packaging dependencies. |

Ticket 02 is complete for the user-approved Brave-only scope. This does not complete ticket 03, grant merge/release acceptance or authorize any commit, push or branch change.
