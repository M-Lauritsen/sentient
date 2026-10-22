---
id: "03"
title: "Connect browser window leases and verify PWA lifecycle end to end"
owner: Lead
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

## Approved prerequisite and scope amendments
- User requested continuation on the same branch on 2026-10-21. Ticket 02 is done; continue against the current checkout without waiting for a merge. HEAD at start: `c6602b0`. No commit/push/branch changes are authorized.
- The previously approved Brave-only/default launcher scope applies here. Edge/Google Chrome launcher activation and their real-browser matrix are deferred, not silently treated as passing. Browser-independent client behavior is covered synthetically; the real-browser matrix below targets Brave.

## Acceptance
- Given an owned backend, when an app document loads, then it bootstraps the same-origin session, registers its unique memory-only window ID and renews every 15s as scheduling permits, with at most one in-flight request and bounded retry/backoff.
- Given ordinary manually started server mode with lifecycle 404, then the page continues existing functionality without pretending it owns or may stop that server.
- Given several windows/tabs, then their leases aggregate independently; closing one cannot stop a server held by another. Hidden/minimized state alone does not release a lease; no last-window count is inferred from browser-process exit or storage.
- Given final close/crash/bfcache transition or failed keepalive release, then expiry/grace implements D10 best-effort policy; successful release is only a hint, never a guarantee.
- Given known lease loss/instance change or a return from suspension, then immediately mark coverage unknown and stop stale live indicators/pulses/counting before revalidating the boot and fresh SSE snapshot; do not backfill missed deltas or totals.
- Given an owned server stops/restarts while a page is suspended, then old tokens/IDs cannot control the new instance; refresh session/register and establish a new epoch baseline, clear stale session/tree/Library detail, and recover without representing stale work as live.
- Given a loaded page loses the backend, then show actionable “run the launcher” guidance and unknown coverage. Given an unloaded installed shortcut and stopped backend, then document browser-owned unavailable-page behavior rather than promising a custom offline screen.
- Given the installed stable Windows Brave, then complete the real matrix below; automated simulations alone cannot satisfy BROWSER. Edge/Google Chrome remain deferred under the approved scope amendment.
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

## Manual real-browser acceptance (required for Brave)
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
| BROWSER | Complete actual Brave matrix with timings and limitations; no synthetic substitute. Edge/Google Chrome deferred. |
| SECURITY | Memory-only capabilities, exact same-origin use, unchanged privacy/Library safety, no sensitive cache or external network. |
| REVIEW | Fresh verdict covers browser state invalidation and end-to-end evidence. |
| BUILD / LINT / TYPECHECK | N/A: no applicable general scripts; no new build/packaging dependency. |

## Out of scope
- Guaranteed OS-wide last-window detection, managed/native windows, Electron, offline data, installer/runtime bundling, telemetry/CDN, auto-login startup or broad UI redesign.
- Branch/worktree changes during planning, unrelated dirty files, ignore/publication-rule changes, commits or pushes.

## Evidence (filled by Lead)
- Candidate · 2026-10-21 · uncommitted changes on `feature/windows-desktop-electron-03`, based on HEAD `c6602b0c5a79663415e320f35eb06ddda2eb0543`. Prior ticket implementation was committed by the user before this continuation; this session performed no commits or pushes. Implementation/documentation/test SHA-256: `18bb3251e8d7e37b539bec8b1f8e3260dd701f092493e49286e4cf5dd18f6f84`.
- Digest covers sorted Windows-relative filenames, NUL separators and file contents for `README.md`, `activity-client.mjs`, `copilot-library-ui.mjs`, `desktop\launch.mjs`, `index.html`, `main.js`, `pwa-lifecycle-client.mjs`, `server.mjs`, `style.css`, `tests\activity-client.test.mjs`, `tests\copilot-library-ui.test.mjs`, `tests\ui-contract.test.mjs`, `tests\pwa-browser-client.test.mjs`, `tests\pwa-end-to-end.test.mjs`, `tests\fixtures\pwa-browser.mjs`. Evidence-only plan edits are excluded.
- Automated · agent-observed final commands:
  - `node --test tests\pwa-browser-client.test.mjs tests\pwa-end-to-end.test.mjs tests\activity-client.test.mjs tests\ui-contract.test.mjs tests\copilot-library-ui.test.mjs` · exit 0 · **107 passed, 0 failed, 0 skipped**.
  - `node --test tests\pwa-installability.test.mjs tests\pwa-lifecycle.test.mjs tests\pwa-launcher.test.mjs` · exit 0 · **34 passed, 0 failed, 0 skipped**.
  - `npm test` · exit 0 · **417 passed, 0 failed, 0 skipped**.
  - `git diff --check` · exit 0 · no output.
- New behavior coverage: strict bounded bootstrap/lease response handling, 404 manual coexistence, hidden renewal, 403/409 fresh boot, 429 bounded backoff, late scheduling/focus/visibility invalidation, bfcache release/return, timeout/abort, no overlapping close/renew/recover requests, failed-release expiry fallback and disposal. Real ephemeral HTTP E2E covers ready-before-fake-dispatch, independent documents, last release, lost release, boot replacement and manual mode. SSE regression invokes stale old callbacks and unbaselined deltas and proves they cannot count/animate; a fresh snapshot is required. UI regression clears observed pulse slots/counters but preserves Appearance demo motion. Library regression clears detail and fences old bootstrap/read promises.
- Initial development failures were corrected before the final commands: a test was accidentally inserted inside a fixture class; one synthetic snapshot lacked required projection fields; the native HTTP fixture duplicated the custom header with different case and initially used an inadequate I/O wait. These were test-fixture defects, not waived failures or production-guard changes.
- Fresh review · `code-review` agent · read-only review of the changed browser adapter, SSE/UI/Library integration, lifecycle serving, tests and task requirements: **No significant issues found.** Reviewer did not independently execute tests or the manual Brave matrix; this is scoped code-review evidence, not completion/release acceptance.

### Real Brave observations · synthetic-only backend roots
Environment inherited from I1: Windows 10.0.26200.0, installed Brave proxy 155.1.97.59, validated installed-app shortcut/profile. No browser install/profile/settings were modified. The operator first confirmed all SENTIENT windows/tabs and manual servers were closed. Each runtime used the production `runLauncher`, installed Brave dispatcher and `serveOwnedChild`, with only server activity/Library/settings roots redirected to an empty temporary directory; production lease/grace constants were unchanged. The launcher/child started from a temporary path containing spaces; no synthetic lease was registered by the observer.

| Case | Observation and provenance | State |
| --- | --- | --- |
| Installed app / owned readiness | Matching private IPC and HTTP readiness preceded real installed Brave dispatch. User confirmed standalone app worked. Existing manifest/icon/install evidence is inherited from 01/I1, not a new installation run. | Met within installed-app scope |
| Actual browser registration/renewal | Runtime remained ready at **130124ms** after readiness, beyond the 120s first-window deadline. User reported keeping the actual app open, minimizing for at least 45s, then restoring successfully. The observer only probed readiness; this was not a synthetic-client lease. | Met |
| Multiple documents | User opened a second ordinary Brave app tab, closed the standalone window, and reported the tab stayed connected after at least 45s. Agent verified ready=200 at 07:46:09 local. | Met; user-observed window actions |
| Last close | User reported roughly 30s shutdown after closing the final tab. Production child reported `EMPTY`, exit 0 at 07:46:56; OS query found zero listeners. Total runtime was 334591ms, not a measured close-to-stop interval. | Met with approximate operator timing |
| Suspension / dropped release | User paused JavaScript using Brave DevTools Sources/F8, kept the window open until server stop, then resumed. Child reported `EMPTY`, exit 0 at 07:51:27, total runtime 150739ms. User reported unknown/backend-unavailable guidance after resume. Pause/last-heartbeat time was not instrumented; do not interpret total runtime as TTL duration. | Met for scheduling loss and visible unavailable recovery |
| Restart/reconnect | New owned server started at 07:52:20. User confirmed the already-loaded unavailable window reconnected without refresh within about 15s and its notice cleared. Runtime remained ready beyond 130137ms. | Met for empty-source recovery |
| Privacy/cache | User inspected DevTools and reported loopback-only app requests, no service worker/Cache Storage for activity/Library, and no lifecycle token/window ID in local/session storage. No values/screenshots were collected. | Met; user-reported inspection |
| Repeated final close | The first user shutdown report preceded observed closure: the OS still found a listener after 45s. User was asked to close all app windows/tabs again without reopening the shortcut. The child subsequently reported `EMPTY`, exit 0 at 07:58:28, total runtime 368275ms; OS query found zero listeners. No exact last-close duration is claimed for this round. | Met for eventual owned cleanup; preserves the discrepancy |
| Browser-created shortcut with stopped backend | The initial report preceded confirmed server closure and was not accepted as isolated proof. After the OS confirmed zero listeners, the user repeated the check and confirmed the browser unavailable page with no backend start. A subsequent OS query again found zero listeners on 43187. | Met; user-observed page and agent-observed stopped backend |
| Failure/duplicate/foreign listeners | Ticket 02 Windows rehearsal and focused regression suite retained. Only the launcher's no-first-window guidance string changed; ownership and guards did not. Missing installation tests did not alter the real profile. | Met by applicable inherited evidence |
| Nonempty stale running/Library detail / gap totals | With the temporary shortcut fixture below, the user confirmed running synthetic activity and selected Library text before stop. After the agent stopped only the test-owned backend, the user confirmed unavailable guidance, cleared running session/tree/pulses and Library detail, and a stopped page-wide total. After restart, the original window recovered without refresh, kept detail closed, and retained its noted page-wide total without replaying the 21 preexisting synthetic gap events. No screenshots or private data were collected. | Met; user-observed browser behavior |
| Optional launcher shortcut / rollback | User explicitly authorized one temporary `.lnk` in the session test folder. Absolute Node/harness/checkout paths were quoted; Node and the harness path contained spaces, and the shortcut working directory was an unrelated directory with spaces. Matching owned IPC/HTTP readiness preceded actual installed Brave dispatch; the user confirmed the app and synthetic content. This used production `runLauncher` and browser dispatch with an injected synthetic-root child, not an unmodified CLI run against real journals. Ordinary mode/rollback retains applicable real HTTP and 02 evidence. The temporary shortcut was removed; no Desktop/Start-menu/profile modification occurred. | Met within synthetic-root shortcut scope |

- Edge/Google Chrome matrix: deferred by the approved Brave-only scope amendment.

### Additional temporary-shortcut evidence
- Nonempty cold dispatch: `2026-10-21T06:33:26.395Z`; harness recorded `workingDirectoryIsCheckout:false`, `readyBeforeDispatch:true` and 14 newly appended synthetic activity events. Optional native helper and generated renderer were already present; no builds/installations ran.
- Agent-requested owned stop: `06:34:52.216Z`; child reported `STOP`, exit 0; harness finished at `06:34:52.232Z`. OS query confirmed zero listeners. This is explicit test-owned interruption evidence, not a last-close timing measurement.
- Restart dispatch: `06:37:18.881Z`, again after matching readiness. The new source contained 21 synthetic events before startup; these were baseline-only, not replayed live. The user confirmed original-window recovery, unchanged page-wide total and cleared old Library detail.
- After the user confirmed closing all test windows/tabs, OS queries found zero listeners and no remaining Node process matching this harness. The restart result file did not capture a final child stop/exit; do not claim a final exit code or exact last-close timing for this round. Earlier independent `EMPTY`/exit-0 close evidence remains applicable.
- Cleanup: agent removed the specifically identified leftover synthetic temporary root and the authorized test shortcut after confirming shutdown. Session scripts/results remain as scoped reproducibility evidence. No user shortcut or real activity/Library source was changed.

### Completion state
| Row | State | Boundary |
| --- | --- | --- |
| TEST | Met | Both required groups and full suite passed on the fingerprinted candidate. |
| LIFECYCLE | Met for implemented behavior | Real browser registration/renewal, aggregation, scheduling loss and empty-source restart were observed as above; deterministic tests cover exact edge cases and stale-data safeguards. |
| BROWSER | Met within approved Brave scope | Isolated stopped-backend shortcut, temporary launcher shortcut and nonempty synthetic recovery checks supplement the earlier observed matrix. Provenance and timing/CLI limitations remain explicit above. |
| SECURITY | Met for scoped implementation checks | Tests plus user-reported DevTools inspection; not a repository-wide security clearance. |
| REVIEW | Met | Independent fresh correctness review, not authoritative completion acceptance. |
| BUILD / LINT / TYPECHECK | Not applicable | No applicable general scripts or added build/packaging dependencies. |

Implementation and the approved Brave checks are submitted for independent completion judgment; the package below is the sole current lifecycle/next-owner record. No release, merge, commit or push is authorized.

## Delivery package
```yaml
PackageId: "03"
Title: "Connect browser leases and verify Brave PWA recovery"
Scope:
  In: ["Ticket 03 Acceptance and approved Brave-only matrix", "Browser lease, SSE/UI/Library recovery and related documentation"]
  Out: ["Edge/Google Chrome launcher matrix", "Prod/main release", "Installation/profile modification", "Commits/pushes", "Offline/native window guarantees"]
RiskLevel: Medium
Requirements:
  - { Id: R1, Statement: "Implement the ten confirmed Acceptance bullets above with the approved scope amendments.", Source: "This ticket; user same-branch continuation and Brave-only decisions", Status: Confirmed }
AcceptanceCriteria:
  - { Id: AC1, Statement: "Owned document bootstrap, unique memory-only ID, renewal and bounded serialization/retry.", RequirementIds: [R1], Status: Met }
  - { Id: AC2, Statement: "Manual lifecycle-404 mode preserves ordinary behavior without ownership.", RequirementIds: [R1], Status: Met }
  - { Id: AC3, Statement: "Independent leases aggregate; hiding alone does not release.", RequirementIds: [R1], Status: Met }
  - { Id: AC4, Statement: "Final close and dropped release use best-effort expiry/grace, not guaranteed closure.", RequirementIds: [R1], Status: Met }
  - { Id: AC5, Statement: "Known lease loss and suspension invalidate stale live state before fresh recovery; no gap backfill.", RequirementIds: [R1], Status: Met }
  - { Id: AC6, Statement: "New boot fences old credentials/SSE/Library state and requires a fresh snapshot.", RequirementIds: [R1], Status: Met }
  - { Id: AC7, Statement: "Loaded-page guidance and browser-owned unavailable shortcut behavior are honest.", RequirementIds: [R1], Status: Met }
  - { Id: AC8, Statement: "Approved Brave matrix has actual browser evidence, separate from simulations.", RequirementIds: [R1], Status: Met }
  - { Id: AC9, Statement: "Document distinct shortcuts, dependencies, limitations, recovery and rollback.", RequirementIds: [R1], Status: Met }
  - { Id: AC10, Statement: "Document opt-in safe absolute launcher shortcut and manual first installation without server adoption.", RequirementIds: [R1], Status: Met }
Assumptions: []
Decisions:
  - { Id: D1, Question: "Supported launcher browser?", Outcome: "Brave only; Edge/Google Chrome deferred.", Owner: User, Status: Accepted }
  - { Id: D2, Question: "Prerequisite merge and branch?", Outcome: "Continue on current branch against completed predecessors without waiting for merge.", Owner: User, Status: Accepted }
  - { Id: D3, Question: "Shutdown reliability?", Outcome: "Browser-managed best-effort leases with accepted suspension risk, not guaranteed last-window enumeration.", Owner: User, Status: Accepted }
  - { Id: D4, Question: "Temporary shortcut acceptance setup?", Outcome: "One explicitly authorized session-folder shortcut; synthetic roots only; remove after checking.", Owner: User, Status: Accepted }
Dependencies:
  - { Id: DEP1, Description: "Ticket 01 install/activation evidence", Owner: Lead, Status: Satisfied }
  - { Id: DEP2, Description: "Ticket 02 owned launcher and Windows lifecycle evidence", Owner: Lead, Status: Satisfied }
Evidence:
  - { Id: E1, Claim: "Candidate identity and automated behavior checks cover AC1-AC7 and privacy safeguards.", Label: Verified, Source: "Evidence section: SHA-256 and exact commands", Result: "107 focused, 34 predecessor and 417 full-suite tests passed; diff check clean.", Owner: Lead }
  - { Id: E2, Claim: "Actual Brave acceptance supports AC3-AC8 within the recorded boundaries.", Label: Verified, Source: "Real Brave observations and additional temporary-shortcut evidence above", Result: "Attributed operator page reports and agent runtime observations; no synthetic-only browser claim.", Owner: Lead }
  - { Id: E3, Claim: "Current code received independent correctness review.", Label: Verified, Source: "Fresh code-review verdict recorded above", Result: "No significant issues found; reviewer did not independently run browser checks.", Owner: "code-review agent" }
  - { Id: E4, Claim: "AC9-AC10 setup/recovery/rollback documentation matches scoped behavior.", Label: Verified, Source: "README.md Windows launcher and browser-install sections; tickets 01/02", Result: "Distinct shortcuts, absolute quoting, no automatic setup/adoption, recovery and rollback documented.", Owner: Lead }
  - Id: E5
    Claim: "Independent completion judgment for PackageId 03."
    Label: Verified
    Source: "Delivery Quality Governance returned assessment, 2026-10-21"
    Result: "Pass: R1/AC1-AC10 and applicable DoD satisfied for Brave-only feature-branch local scope. Candidate fingerprint and diff hygiene verified. Recorded test/review evidence, attributed browser observations and authorized runtime artifacts accepted within disclosed synthetic-root, timing and missing final restart-exit limitations. No Prod/main or parent-plan acceptance."
    Owner: "Delivery Quality Governance"
Risks:
  - { Id: RISK1, Description: "Browser suspension can expire a lease while its window remains open; shutdown timers are not OS guarantees.", Severity: Medium, Mitigation: "User-approved best-effort policy, visible unknown/recovery and explicit documentation.", Owner: User, Status: Accepted }
  - { Id: RISK2, Description: "Brave installation/profile policy may vary; launcher relies on validated standard Chromium-generated shortcuts.", Severity: Medium, Mitigation: "Fail closed on unsupported/ambiguous setup; no fallback browser/profile or arbitrary command execution.", Owner: Lead, Status: Mitigated }
  - { Id: RISK3, Description: "Manual evidence is operator-reported; the shortcut run injected synthetic roots and the final restart exit code was not captured.", Severity: Low, Mitigation: "Preserve exact provenance; earlier exit-0 close evidence retained; OS confirmed listener/process closure; no unmodified CLI/private-source claim.", Owner: Lead, Status: Mitigated }
DefinitionOfDone:
  - { Id: TEST, Criterion: "Both scoped commands and full suite pass on the identified candidate.", Verify: "Exact commands in Verify and Evidence", Owner: Lead, EvidenceIds: [E1], Status: Met }
  - { Id: LIFECYCLE, Criterion: "Lease/recovery safeguards prevent stale-live behavior.", Verify: "Synthetic E2E plus attributed real Brave recovery", Owner: Lead, EvidenceIds: [E1, E2], Status: Met }
  - { Id: BROWSER, Criterion: "Approved Brave real-browser matrix has attributed evidence and limitations.", Verify: "Real Brave observations and additional temporary-shortcut evidence", Owner: Lead, EvidenceIds: [E2], Status: Met }
  - { Id: SECURITY, Criterion: "Memory-only same-origin capabilities and existing privacy/Library safety remain.", Verify: "Focused/full tests and user DevTools report", Owner: Lead, EvidenceIds: [E1, E2, E3], Status: Met }
  - { Id: REVIEW, Criterion: "Independent fresh review covers browser invalidation and E2E changes.", Verify: "Recorded code-review verdict", Owner: "code-review agent", EvidenceIds: [E3], Status: Met }
  - { Id: BUILD-LINT-TYPECHECK, Criterion: "Applicable general build/lint/typecheck.", Verify: "No applicable scripts or new build dependency.", Owner: Lead, EvidenceIds: [], Status: NotApplicable }
Status: Accepted
NextOwner: None
```
