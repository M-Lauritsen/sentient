---
id: 04
title: "Integrate the accessible Copilot library dialog"
owner: Lead
status: done
depends_on: [03]
parallel: no
branch: feature/copilot-library-04
dod: [UI]
skill: "-"
prod: no
issue: ""
---
Major: yes (new Library dialog and asynchronous states affect local content disclosure and existing scene controls).

## Goal
After ticket 03 is merged, integrate the HUD-matched responsive Library dialog and all requirements §6 journeys using the shipped API/renderer.

## Acceptance
- Given default/additional sources, browse source → category → relative file, rendered title, readable Metadata and Markdown; do not autoselect a document or imply active/installed configuration.
- Given Add folder, explicitly choose root/category mode, validate scope and confirm; show saving/error/conflict states and clear typed paths after success/cancel/close. Removal confirms unregister-only, never default/source deletion. Refresh handles generation/selection invalidation exactly as §6.
- Given loading/empty/missing/unreadable/unsafe/partial/limit/malformed-metadata/settings errors, show actionable labeled states without full paths or false completeness/persistence claims.
- Given rapid selections, refresh/remove/close during reads and delayed responses, latest generation wins; block conflicting mutations, ignore stale results, preserve correct focus and reconcile the next open.
- Match the actual style.css/index.html references in §6, not an unrelated file-manager design: large native overlay, mono/color/border/focus language, mixed-case body >=16px, responsive stack <=700px, internally scrollable detail.
- Demonstrate WCAG 2.2 AA measurements and manual keyboard/focus, screen-reader labels/status, 200% text/400% zoom/320px reflow, forced colors/reduced motion; Node contract tests alone cannot satisfy visual/accessibility DoD.
- Modal input cannot orbit/zoom the scene; coordinate other dialogs, return focus on Close/Escape, and preserve visual-settings preview, camera, activity/feed/timeline/statistics and independent SSE operation.

## Files (expected)
- `index.html`
- `main.js`
- `bootstrap.mjs` only if required for the existing startup integration seam
- `style.css`
- Dedicated library UI module
- `tests/copilot-library-ui.test.mjs`

## Verify (exact command, run from repo root)
```powershell
node --test tests/copilot-library-ui.test.mjs tests/ui-contract.test.mjs
```
New UI test file is a future deliverable, not currently present/executed. Manual verification:
```powershell
node tests/helpers/library-preview.mjs
```
Use the isolated preview harness delivered by ticket 02, as specified in requirements §8; it injects disposable journals, default Library root and settings, binds an ephemeral IPv4 loopback port and prints its URL and synthetic registration paths. Follow requirements §§6 and 9, record viewport/zoom/contrast/keyboard outcomes and stop with Ctrl+C. Do not use `npm start` or connect to the user's real journals/server for these checks. The harness command is future verification, not currently available or executed.

## DoD
- [x] UI: requirements §9 UI proof passes at the implementation commit, including manual visual/accessibility evidence and state/race tests; sources and existing scene/activity behavior unchanged.

## Run independently
Start only after 03 and transitive predecessors are merged. Own UI fixtures and controllable request promises; use the preview harness already delivered by 02, not unfinished future work. No release-doc work is required. Keep rollout acceptance pending until 05 completes.

## Out of scope
- Source/settings, API authorization, or Markdown sanitizer implementation.

## Evidence (filled by Lead)
2026-10-19 · Windows_NT · existing user-owned checkout at `10074c8`, **uncommitted in-place implementation**. Existing checkpoint authorization expressly accepts predecessors 01–03 in-place and forbids a new branch/commit/push/deploy; no merged/commit claim. **Implementation present; UI DoD NOT met / acceptance BLOCKED on human manual matrix. Ticket 05 not started.**

Scope: native Library dialog/trigger in `index.html`; dedicated `copilot-library-ui.mjs`; HUD-matched opaque reading surface/responsive stack in `style.css`; modal callback and controls-update guards in `main.js`; one explicit static module allowlist entry in `server.mjs` (no route/auth/CSP/source/sanitizer changes). `tests/copilot-library-ui.test.mjs` uses jsdom and controlled promises; `tests/ui-contract.test.mjs` minimally tolerates pre-existing HTML formatting and supplies the existing edgeLines VM stub. Concurrent visual settings/favicon and all predecessor edits preserved.

Behavior: lazy snapshot/no document autoselection; source/category/file selection and safe renderer; relative breadcrumbs; read-only/not-active disclosure; both explicit confirmed registration modes, scoped exclusions/persistence disclosure and typed-path clearing; unregister-only inline confirmation; shown counts/source states/partial and settings warnings; safe preset errors with no raw exception echo; stale refresh display and navigation/mutation suppression; generation/selection guards, abortable reads, serialized mutations across close/reopen, server reconciliation before the next list; native Escape/Close and focus return; one modal at a time without closing another panel/preview; pane-local scroll regions, selected text indicator and names/live status outside busy subtree. No library content/token/path goes to storage, activity/SSE, exports or logs.

Test first: exact UI command initially **exit 1**, new test import `ERR_MODULE_NOT_FOUND` before the UI module existed. That run also exposed existing formatted-HTML contract assertions and a missing `edgeLines` VM stub. Next implementation run reproduced a UI mutation-test scheduling assertion; corrected the test to await the deliberately deferred operation, and separately added a synchronous-close/captured-revision regression. Reviewer-requested stale-mutation suppression is covered by disabled Save/Add/Remove and reconciliation-before-retry assertions.

Current scoped verification (all from repo root, output tails):
- `node --test tests/copilot-library-ui.test.mjs tests/ui-contract.test.mjs` → **exit 0**, `tests 45 / pass 45 / fail 0 / cancelled 0 / skipped 0`. Covers UI/API adapter concurrency, shared lazy bootstrap, fetch options/token containment, late lists/details, aborted signals, latest selection/link callbacks, root/category Add, Add/Remove/Refresh serialization and close/reopen, immediate close before mutation invocation, failures and stale settings conflicts, clearing/focus/modal isolation, actual main controls callback and source-level channel isolation.
- `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` → **exit 0**, `tests 33 / pass 33 / fail 0 / cancelled 0 / skipped 0`.
- `node --test tests/library-markdown.test.mjs tests/server.test.mjs` → **exit 0**, `tests 32 / pass 32 / fail 0 / cancelled 0 / skipped 0`.
- `node --test --test-concurrency=1 tests/server.test.mjs tests/library-api.test.mjs tests/library-markdown.test.mjs tests/library-source.test.mjs tests/library-metadata.test.mjs` → **exit 0**, `tests 63 / pass 63 / fail 0 / cancelled 0 / skipped 0`.
- `npm run build:library-renderer -- --check` → **exit 0**, `Local Library worker is up to date.`
- `node --check copilot-library-ui.mjs`, `node --check main.js`, `node --check tests/copilot-library-ui.test.mjs`, `git diff --check` → **exit 0**, no diagnostics.

Broader regression caveat, **not green**: `node --test --test-concurrency=1 tests/*.test.mjs` → **exit 1**, `251 tests / 243 pass / 8 fail / 0 cancelled / 0 skipped` at that worktree snapshot. Failures: existing activity legend HTML contract, native helper `HELPER_BUILD_FAILED`, visual defaults/expected count mismatch, and four concurrent visual-settings live-node-rebuild tests expecting functionality not yet present in main. Isolated later visual-settings run (file changed concurrently) → **exit 1**, `34 tests / 28 pass / 6 fail`, the same two defaults and four node-rebuild expectations; isolated native test → **exit 1**, `HELPER_BUILD_FAILED`. No unrelated visual/default/native implementation changed or concealed. Earlier camera-seam VM failure caused by placing Library initialization in its extracted snippet was fixed by moving initialization to the normal final UI startup seam; the later visual-settings run no longer reports that failure.

### Browser evidence and required manual matrix

Actual browser checks used **only** `node tests/helpers/library-preview.mjs`, spawned with piped stdin by a temporary bounded CDP runner, fresh disposable Edge profile, printed ephemeral preview URLs; no existing service, `npm start`, private journals/home/settings, or installed Copilot configuration used. Final isolated URL `http://127.0.0.1:63155` was harness-owned; server stopped, fixture and browser profile removed. Temporary runner removed. No screenshots/content artifacts retained.

Browser: Edge **155.0.0.0**, Windows headless, local generated worker actually rendered synthetic Agent and Metadata. Final runner `node .tmp-library-browser.mjs` → **exit 0**, tail `Temporary browser profile and synthetic preview cleaned.` This was **automation**, not a human manual acceptance session.

Final cleanup probe: **0** synthetic preview fixtures, **0** temporary Edge profiles, temporary runner absent. A later process-count probe found **1** LibraryHelper process with an existing Node parent not identified as a test or this preview; ownership is unestablished. It was **not terminated or contacted**. Do not interpret this session's cleanup as a claim that every unrelated helper on the machine has stopped.

| Required row | Actual automated observation | Manual acceptance |
|---|---|---|
| Keyboard / focus / native modal | `:modal` true; open focus Close; no autoselection; document selection focus `library-document-title`; Shift+Tab remained inside; Escape closed, cleared content, restored `library-open`; reopen reconciled | **BLOCKED**: full human keyboard-only forward/reverse traversal, long documents/forms, focus visibility/obscuring and all modal coordination not manually exercised |
| Screen-reader labels / status | Browser AX tree exposed dialog “Copilot Library”, Close Copilot Library, Refresh, Add folder, labeled Source/Category comboboxes, selected document name and status role; polite atomic status exists outside busy subtree | **BLOCKED**: no human NVDA/JAWS/Narrator speech/status announcement check; AX is not screen-reader proof |
| Desktop typography / scroll | 1280×900 viewport; dialog width 1200, height 672.20; body 16px/24px; internal pane metrics and Metadata present; no horizontal overflow | **BLOCKED**: human visual HUD match, long content/code/table scrolling and reachable actions |
| 200% text | At 320 CSS px with root font 200%, actual body 32px/48px, dialog width 300.80, max height 648 of 720; no dialog/page horizontal overflow | **BLOCKED**: CSS root scaling is not a human browser text-only zoom session |
| 400% zoom / 320px reflow | Emulated 320×720 CSS viewport, dialog width 300.80, no dialog/page horizontal overflow, stack active | **BLOCKED**: actual browser 400% zoom and human reading/focus/reflow inspection not performed |
| Contrast ≥WCAG 2.2 AA | Actual computed colors on opaque #030812 surface: body 16.04:1; chrome 11.19:1; button text 15.11:1; blue boundary 5.70:1 inner/6.05:1 outer; focus ring 6.05:1. Opaque surface removes scene-compositing uncertainty for these samples | **Partial measurements only**: sampled ratios pass AA thresholds; all states, trigger over scene, warnings/errors, focus and target-size visual audit still **BLOCKED** |
| Reduced motion / forced colors | Browser media emulation matched both; forced surface black/control text white and system outline; no animated reading surface added | **BLOCKED**: human OS high-contrast and reduced-motion visual checks not performed |

### Independent review

Fresh Reviewer loop 1 read the **complete** scoped UI module/tests, Library HTML/CSS/main guards/static mapping and relevant contract adjustments, plus requirements/handoff. Verdict **BLOCKING** solely for outstanding required manual acceptance; **Should** stale Add/Remove/Save allowed against old snapshot. Fixed the Should by disabling/guarding mutations until Refresh/reopen reconciliation; added regression assertions and reverified exact UI command.

Fresh **full scoped Reviewer loop 2**: **BLOCKING on human manual matrix only**; **no additional scoped code blocker, Should or Nit**. Reviewer independently inspected the complete UI module/test file, Library HTML/CSS, main startup/callback and both update guards, static mapping, contract changes, requirements and evidence. Confirmed stale mutation concern fixed and covered. Two review loops exhausted; no attempt to waive the manual blocker, no UI DoD PASS or release verdict claimed.

Next human action: run `node tests/helpers/library-preview.mjs`, use **only its printed synthetic URL/paths**, complete the matrix above with actual keyboard/screen reader/zoom/contrast/OS visual observations, stop with Ctrl+C and verify cleanup. Address the separately documented concurrent regression failures without overwriting their owner's edits. Only after UI acceptance may ticket04 be marked done; **do not begin ticket05 in this task**.

### Manual acceptance update · 2026-10-19

The user confirmed they personally completed every required manual row (keyboard/focus/modal coordination, screen-reader labels/status, actual text/zoom/reflow, contrast/focus states, and OS forced-colors/reduced-motion) and selected **“No, all checks passed.”** Their overall description was “looks like it works.” The user did not provide the screen-reader name, individual measurements, or per-row notes; the automated browser measurements above remain separately labeled as automation and are not represented as additional human measurements.

The preview was stopped after the user's manual checks. The exact harness fixture directory remained after terminal interruption, was inspected, removed by its resolved path, and verified absent. No unrelated helper process was stopped. UI ticket is accepted/done in-place based on direct user confirmation, passing contract tests, automated browser evidence, and independent scoped reviews with no remaining code findings. Ticket 05 may proceed; full integrated/release checks remain outstanding.

## Historical evidence — not current acceptance
Preserved from the earlier ticket; not proof at main `10074c8`:
> UI contract tests prove navigation, CRUD registration semantics, refresh/stale handling, loading/empty/error/limit states, keyboard/focus behavior, and isolation from activity/statistics controls. Evidence: `node --test tests/copilot-library-ui.test.mjs tests/ui-contract.test.mjs` (exit 0; 32 tests passed); related `node --test tests/library-markdown.test.mjs tests/library-api.test.mjs` (exit 0; 12 tests passed).
