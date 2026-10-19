---
id: 05
title: "Document the scoped library exception and verify rollout"
owner: Lead
status: blocked
depends_on: [04]
parallel: no
branch: feature/copilot-library-05
dod: [RELEASE]
skill: "-"
prod: no
issue: ""
---
Major: no (documentation and integrated verification only; the feature itself is classified Major).

## Goal
After ticket 04 is merged, document the scoped exception and certify requirements §§7–9 with fresh integrated regression, security and manual evidence.

## Acceptance
- Update existing README for read-only Library versus activity privacy, both registration modes/exclusions, metadata and local-link behavior, limits/partiality, settings location/confidentiality/recovery and intentional viewing. Do not assume a missing `specs/README.md` exists or introduce a new documentation hierarchy.
- Explain manual refresh, unregister-only removal, restart persistence/conflicts, fail-closed unsupported safety and no active/configuration claims. Document rollback without source changes or automatic settings deletion.
- Add/run synthetic integrated regression proof of library/settings markers absent from activity/SSE/logs, safe rollback, no remote resources, and unchanged source hashes. Preserve scene/feed/palette/timeline/statistics/visual settings.
- Run complete tests and publication check at the actual implementation commit; investigate any findings (including `plans` local-records) without suppressing checks. A nonzero exit is an unresolved release blocker, not a “pass with warning”.
- With ticket 02's isolated preview harness, repeat all requirements §6 state/visual/accessibility checks and restart/add/remove/refresh/conflict recovery; record exact outcomes, not historical results. The harness must preserve its disposable fixture across its controlled server restart to prove persistence. No release-complete claim while any security/manual/review/publication item remains unresolved.

## Files (expected)
- `README.md`
- `tests/library-regressions.test.mjs` (future integrated synthetic acceptance file)
- Evidence updates in this ticket; existing tests only where integrated coverage requires

## Verify (exact commands, run from repo root)
```powershell
npm test
npm run check:publication
node tests/helpers/library-preview.mjs
```
For the last command, use requirements §8's harness procedure, open only its printed ephemeral loopback URL, perform the manual browser checks above and stop with Ctrl+C. It owns cleanup of its exact temporary fixture after all restart checks. `npm start` remains the ordinary application launch command, not the isolated acceptance command.
Commands are future verification, not executed for this documentation pass. The preview harness is a future ticket 02 deliverable. Use only synthetic roots/settings/journals; never inspect an existing user's server or journals.

## DoD
- [ ] RELEASE: requirements §9 RELEASE proof passes at the implementation commit; fresh Reviewer accepts all rows; publication exits zero or remains explicitly blocked for responsible resolution; no source or activity invariant changed.

## Run independently
Start only after 04 and all transitive predecessors are merged. The shipped feature supplies all runtime seams; this ticket owns its integrated fixtures/docs and verification, not missing behavior delegated back to an unfinished ticket.

## Out of scope
- New feature behavior or any change to Copilot files, activity journals, or tracker.

## Evidence (filled by Lead)

### Current execution · 2026-10-19 · final approved ticket

**Disposition: BLOCKED, not done; RELEASE remains unchecked.** Documentation and
synthetic integration are implemented. No next ticket was started.
Explicit current user authorization supersedes the historical merged-dependency/
branch instructions above: tickets01–04 are accepted/done **in-place**, not
merged/committed. No new Gate A, branch, commit, push, deployment, migration or
shared-environment action. HEAD remained
`10074c8f89323b16bc4a552d930501bc2520db3a`; evidence is for the dirty in-place
implementation, not a fabricated implementation commit.

Platform: Windows x64, Node v22.22.3. `docs/project-profile.md` is absent;
commands were discovered from README/package.json and the native/renderer build
scripts. Repository instructions were read. All fixtures explicitly use synthetic
temporary roots/settings/journals and ephemeral IPv4 loopback servers. No real
home Copilot documents, journals, settings or existing server were read/contacted.

#### Changes and proof scope

- Existing README now distinguishes the activity projection from intentional
  Library viewing; documents both modes/classification/exclusions, metadata/
  local links/inert content, limits/partiality, refresh/staleness, unregister-only,
  protected settings/confidentiality/restart/conflicts/recovery, fail-closed safety
  and coordinated rollback without auto-deletion. Ordinary activity-only startup
  is separate from opt-in Windows helper/worker builds. Distribution must include
  the ignored executable and generated worker, with local dependencies/licenses;
  no claim that source alone is a supported Library distribution.
- Added `tests/library-regressions.test.mjs`: separate synthetic body, metadata,
  registration-path, excluded-tree and private-activity markers; actual HTTP
  detail through the shipped parser bundle and safe DOM renderer; intercepted
  DOM resource/fetch requests remain empty; only mapped local navigation works.
  Captured child stdout/stderr and browser console have no marker leakage.
  Complete initial/live/dormant SSE frames have no markers while bounded live
  activity/statistics still arrive. Refresh/read after the private journal marker
  exists proves the converse boundary. Root/category exclusions, refresh ID
  invalidation, saved registration/server restart and unregister-only are checked.
  SHA-256 trees verify source bytes/entries unchanged; journal bytes remain
  unchanged by application reads. Original scene/activity/palette/timeline/
  statistics/visual-settings assets remain served.
- Rollback proof is explicitly a **dormant/unavailable Library seam**, not actual
  code removal or a nonexistent runtime disable flag. Original HTTP/SSE works
  without constructing the Library; a fail-closed Library error does not stop
  static activity assets, reset/delete settings, or change source/journal bytes.
  No claim of manually executing a coordinated code rollback.
- Required native failure was reproduced RED:
  `node --test tests/library-native.test.mjs` exit1, 1 test/0 pass/1 fail,
  `HELPER_BUILD_FAILED`. Compiler diagnostics showed CS0016: shared production
  output executable in use. Changed only that test's build destination to its
  own disposable fixture. It no longer overwrites/contends with the application's
  executable; isolated native test then exit0, 15 pass/0 fail. No unowned process
  was stopped. No runtime safety policy/retries were weakened.
- Initial new-test fixture assertions incorrectly expected the renderer callback
  to return an ID/full map instead of its `{fileId,fragment}` projection; corrected
  those assertions to the actual contract before the first green integration run.
  Later Reviewer SSE-framing finding was fixed for all relevant frame checks.
- Concurrent README visual documentation and all activity/visual settings/UI/tests,
  earlier Library implementation and ignored plan records were preserved. No
  unrelated legend/default/live-node-rebuild test expectations were edited.

#### Exact verification and outcomes

Final code results (all counts include nested Node tests; zero cancelled/skipped
in these runs):

| Command | Exit | Tail / result |
|---|---:|---|
| `node --test tests/library-regressions.test.mjs` | 0 | tests1, pass1, fail0 |
| `node --test tests/library-native.test.mjs tests/library-regressions.test.mjs tests/library-metadata.test.mjs` | 0 | tests26, pass26, fail0 |
| `node --test tests/library-source.test.mjs` | 0 | tests16, pass16, fail0 |
| `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` | 0 | tests33, pass33, fail0 |
| `node --test tests/library-markdown.test.mjs tests/server.test.mjs` | 0 | tests32, pass32, fail0; renderer/server unchanged afterwards |
| `node --test tests/copilot-library-ui.test.mjs tests/ui-contract.test.mjs` | 0 | tests45, pass45, fail0; UI unchanged afterwards |
| `npm test` | **1** | tests267, pass264, fail3, cancelled0, skipped0, todo0 |
| `npm run check:publication` | **1** | local-records: plans; personal-path: ticket04; 2 findings |
| `npm audit` | 0 | found 0 vulnerabilities |
| `npm run build:library-renderer` | 0 | Built self-contained local Library Markdown worker (marked15.0.12/yaml2.8.3) |
| `node scripts/build-library-renderer.mjs --check` | 0 | Local Library worker is up to date |
| `npm run build:library-helper` | **1** | HELPER_BUILD_FAILED; CS0016 output executable in use |
| `node --check tests/library-regressions.test.mjs` | 0 | no syntax output |
| `node --check tests/library-native.test.mjs` | 0 | no syntax output |
| `git diff --check` | 0 | no whitespace output |

Final full-suite tail:

```text
1..239
# tests 267
# suites 0
# pass 264
# fail 3
# cancelled 0
# skipped 0
# todo 0
```

The remaining current full-suite failures are:
`HUD legend is collapsed and lists every category with a glyph and swatch`
(`tests/activity-colors.test.mjs:102`, “activity legend details exists”);
`visual settings characterize the latest tuned defaults, not structural capacities or palette`
(`tests/visual-settings.test.mjs:156`, deep equality);
`visual settings validate all known paths and reject malformed values without mutating input`
(`tests/visual-settings.test.mjs:248`, expected95/actual120).
These are concurrent/pre-existing areas; owner edits were not altered to force
green. The four previously recorded live-node-rebuild failures were not present
in the final current run; no claim that ticket05 fixed them.

**Earlier non-green results are retained, not replaced by reruns:** first exact
`npm test` exit1,267tests252pass15fail (11 SOURCE subtests plus parent, legend,
two visual defaults); next full run exit1,267tests249pass18fail (14 native
subtests plus parent, legend, two visual defaults). An exact SOURCE run also
exit1,16tests4pass12fail; exact API run exit1,33tests24pass9fail. A concurrent
native/regression/metadata run exit1,26tests25pass1fail included the new
integration child assertion failure; subsequent isolated and concurrent runs
passed. Synthetic diagnostic loops observed intermittent
`SAFETY_UNSUPPORTED` at fresh helper `settingsRead`/`identify`, sometimes followed
by empty/partial snapshots, `SETTINGS_UNAVAILABLE` and cascading assertions.
Raw synthetic transport diagnostic runs also passed. **No root cause is
established; native/Library startup stability remains an unresolved feature-linked
release/review blocker.** A green last run is not a stability certification.
No assertions, time budgets, safety checks or suite selection were suppressed.

Production helper build remains independently blocked by an executable held
open by an existing process of unestablished ownership. The new isolated test
helper builds prove source compilation, not a successful rebuild/package of
`native/bin/LibraryHelper.exe`. Existing helper was neither terminated nor
claimed current solely from the preview result.

Publication inspection: `scripts/check-publication.mjs` intentionally reports
directories named `plans` regardless of ignore rules; `git check-ignore plans`
returns `plans`, and `git ls-files plans` has no output. The second match is
ticket04 line76's slash-delimited prose referring to journals, home and settings,
not an established absolute personal path. It is a heuristic finding, not
certification that the planning records are publishable. Preserved ticket04,
ignored records, checker and ignore rules unchanged. Exact checker tail remains:

```text
local-records: plans
personal-path: plans\copilot-library\tickets\04-library-dialog-ui.md
Publication check: 2 finding(s). Dependencies and Git metadata excluded; manual review still required.
```

#### Preview, manual provenance and cleanup

Executed the exact child command `node tests/helpers/library-preview.mjs`
visibly via a bounded Python stdin controller (no persistent runner file).
Only its printed ephemeral URLs were used:
`http://127.0.0.1:50443` → terminal `restart` →
`http://127.0.0.1:50448`. The same exact disposable fixture
`sentient-library-preview-hBfd5v` and settings bytes survived restart.
Automated HTTP assertions passed: initial4files/default, Add folder/category
registration, restart2sources/5files, persisted settings bytes, Refresh/detail
for each file, unregister to default only while extra file remained.
Terminal EOF used the harness's normal cleanup path; child **exit0** and exact
fixture verified absent. No private home/settings, fixed application port,
other helper/server or browser profile was used.

This was an **automated HTTP smoke**, not browser/manual measurements. The user
directly confirmed ticket04's complete manual UI/accessibility matrix passed on
2026-10-19; that acceptance remains valid and was not repeated or reattributed.
Ticket05's explicit fresh full §6 browser matrix and conflict-recovery preview
were **not** executed. HTTP smoke/source conflict tests do not substitute for
that manual row; it remains a RELEASE blocker. No new contrast, zoom,
screen-reader or keyboard measurements are claimed.

#### Fresh independent review and final gates

Two fresh full scoped Reviewer contexts read the README and entire new
integration/native test scope against requirements and implementation/build
documentation. Loop1: **BLOCKING** for intermittent integration proof; Should
single-chunk dormant SSE assertion. Fixed framing and strengthened converse
privacy, reverified isolated/concurrent/full runs. Loop2: **BLOCKING** solely for
unresolved release evidence (full-suite/build/publication/stability; fresh manual
matrix/conflict recovery). No scoped regression/native code defect identified.
Loop2 Should: optional Windows builds mixed into ordinary Run block; separated
into explicit opt-in steps, preserving activity-only startup. Final README diff
and whitespace/publication rechecked; no third independent review is claimed.
Review was read-only; execution evidence was supplied by Lead, not claimed as
Reviewer-run tests.

**RELEASE: BLOCKED / PR-READY: NO.** Required next human decisions/actions:
resolve concurrent legend/visual expectations with their owner; establish and
resolve intermittent native startup cause without weakening safety; arrange
production helper rebuild only when its legitimate owner releases it; responsibly
resolve publication findings without suppression/deletion of records; complete
the ticket05-specific isolated manual/conflict recovery evidence and fresh
acceptance as needed. Do not mark this ticket/RELEASE done or claim a shipped
distribution. No further ticket implementation is authorized by this record.

## Historical execution evidence · 2026-10-18 — not current acceptance

The following earlier record is preserved verbatim. It concerns another historical worktree, includes paths/files not present on current main `10074c8`, and does not establish current implementation, test results, approval or status. Its concluding disposition and old status references are historical only; current status/evidence are above. The old missing spec/index references are superseded by `../requirements.md` for this plan.

- Gate A: PASS is recorded in the approved spec; tickets 01–04 are marked
  `done` in the existing worktree. Per coordinator instruction, stayed on
  `feature/feat08-09` without branching, committing, pushing or deployment.
- `docs/project-profile.md` is absent; commands come from `package.json` and
  README. README, `specs/README.md`, this ticket, the library UI and its tests
  were updated. The user-provided `specs/08-copilot-library.md`, unrelated
  prior worktree changes and token-usage/token-traversal work were left
  untouched.
- Documentation now covers the library-only content/settings exception,
  exact persisted/disclosed data, registration/removal/refresh and recovery,
  source read-only behavior, inert/untrusted content, limits, local-only
  dependencies and unchanged activity invariants. Rollout is explicitly pending.
- `npm test` — exit **0**:
  ```text
  1..189
  # tests 189
  # suites 0
  # pass 189
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  ```
- `npm run check:publication` — exit **1**:
  ```text
  local-records: plans
  Publication check: 1 finding(s). Dependencies and Git metadata excluded; manual review still required.
  ```
  Investigated `scripts/check-publication.mjs`: any directory named `plans`
  is deliberately reported as `local-records`, independently of Git ignore
  rules. `plans/` was already ignored in HEAD; `git ls-files plans` returns
  no tracked files. The directory contains 28 Markdown planning/ticket records.
  The scan reports no other category; that is not proof the records are safe
  to publish. Kept all records and checks unchanged. Publication remains a
  blocker under the coordinator's requirement that automated checks pass;
  review publication contents separately without suppressing the check.
- `git diff --check` — exit **0**, no output.
- A temporary `createSentientServer` instance on an ephemeral loopback port
  used only synthetic roots. Browser checks confirmed both reported static
  module URLs return 200, Agents/Skills listing and Markdown detail load, the
  selected category's pressed state and breadcrumb stay synchronized, and an
  additional synthetic source can be registered and browsed. Refresh found a
  new synthetic file, removal unregistered the source without changing its
  files, and a fresh `LibrarySource` instance loaded persisted registration.
  Category-button focus was retained after selection. This did not use
  `npm start`; responsive layout, broader keyboard/focus, and manual
  error/limit checks remain outstanding. The temporary server was isolated
  from the user's existing server.
- Windows startup now applies and verifies user-only ACLs for the dedicated
  settings directory and file; an ACL failure blocks additional-root
  mutations. Security DoD is still not certified: the independent review found
  ACL operations are path-based and settings updates lack cross-process
  compare-and-swap, leaving path-swap and lost-update concerns unresolved.
  Passing synthetic tests does not establish race safety.
- Independent Reviewer checked current documentation against targeted source
  behavior and found no accuracy findings; the second pass accepted the supplied
  spec-index/ticket baselines. Its review remains incomplete because it reported
  inability to execute the requested tracked README diff command. This is a
  review-evidence limitation, not a confirmed documentation defect; do not
  represent it as full review approval.

**Disposition:** blocked, not done. Documentation is implemented and the full
test suite passes, but publication exits 1; security evidence and
coordinator-owned manual acceptance remain rollout gates. Do not announce or
enable the Library entry as rollout-complete.
