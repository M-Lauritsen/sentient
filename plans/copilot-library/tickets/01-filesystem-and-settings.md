---
id: 01
title: "Discover bounded library files and persist registered roots"
owner: Lead
status: done
depends_on: []
parallel: yes
branch: feature/copilot-library-01
dod: [SOURCE]
skill: "-"
prod: no
issue: ""
---
Major: yes (filesystem traversal and durable settings create local-file disclosure and integrity risks).

## Goal
Implement the isolated bounded source/settings boundary in requirements §§2–3, supplying a safe interface for later HTTP integration.

## Acceptance
- Given synthetic home/root/category folders, discover only the requirements §2 Markdown subset, including nested skill entries, nearest-entry support docs and unassociated docs; exclude session-state and unrelated files. Default resolution is independent of journal configuration.
- Given alias/duplicate/ancestor/descendant registrations or hostile Windows paths, reject with the specified codes; retain missing saved registrations as visible errors. Scan/read enforce containment, link/reparse/hard-link policy and actual opened-object race safety.
- Given scan/entry/depth/time/payload limits, publish deterministic partiality and shown counts; no unbounded I/O accumulation after timeout. Return safe labels, summaries, opaque generation-scoped IDs and valid local-link mappings for §4 shapes.
- Own the bounded inert metadata parser/helper required for safe title/description extraction under §5, including malformed/hostile YAML and fallback tests. Pin/document any needed dependency here; do not wait for ticket 03's renderer.
- Given add/remove/refresh, preserve prior state on mutation failure; successful snapshots invalidate old file IDs. Reads of changed files fail `CONTENT_CHANGED`, not stale/mixed content.
- Given v1 settings, prove restricted confidentiality, bounded validation, restart persistence, corruption/unknown-version recovery, failed/unwritable write preservation, crash safety and multi-process same-revision conflict without lost updates. No source/content/metadata writes.
- Prove Windows handle/reparse/ACL safety with real synthetic filesystem tests plus injected adversarial races; if Node/platform support is insufficient, report blocked with evidence, never downgrade to best-effort path checks.

## Files (expected)
- `copilot/library-source.mjs` (or isolated equivalent)
- Dedicated settings helper if needed; no HTTP/browser integration
- Shared inert metadata helper; `package.json` / `package-lock.json` only if needed for its pinned parser
- `tests/library-source.test.mjs`

## Verify (exact command, run from repo root)
```powershell
node --test tests/library-source.test.mjs
```
Future test file: not present/executed at the current baseline. Use injected synthetic roots/settings and child processes for concurrency, not real user settings/journals.

## DoD
- [ ] SOURCE: all requirements §9 SOURCE proof passes at the implementation commit; record Windows feasibility, concurrency/race evidence and unchanged source-byte hashes.

## Run independently
No predecessor. Start from main baseline after checkpoint ② approval; own fixtures and source/settings interface contract only. Do not require API/UI code or future tickets. Freeze §4 projection shapes for ticket 02.

## Out of scope
- HTTP routes, browser UI, Markdown rendering, or changes to activity source/SSE.

## Evidence (filled by Lead)
**Current attempt · 2026-10-19 · implementation commit: none (uncommitted work on the existing `main` checkout).**

- **Windows safety feasibility: BLOCKED, synthetic checks only.** Node v22.22.3 on Windows reports `fs.constants.O_NOFOLLOW` and `fs.promises.openat` unavailable; `FileHandle` exposes `stat()` but no final-path/containment query. A controlled synthetic junction replacement between path preflight and open returned `synthetic-outside` through the checked root path. `fstat` distinguishes that replacement, but Node's handle API does not establish the opened object's final path or prove containment against a raced ancestor. This is not a proof that every implementation is impossible; it is evidence that path-based Node checks cannot meet the required opened-handle guarantee.
- **Windows settings ACL feasibility: BLOCKED with Node chmod alone.** On a disposable synthetic directory, `icacls` granted `BUILTIN\Users` read access; after `fs.chmod(path, 0o700)` and `fs.chmod(file, 0o600)`, `icacls` still reported the Users ACE and inherited broader ACEs. A verified Windows ACL mechanism is required; POSIX mode bits are not proof of the required confidentiality.
- All probe fixtures were synthetic temporary directories and were removed. No real `.copilot`, journal or settings data was read; no source files were modified. Safe ticket-01 subset only: bounded YAML front-matter parsing and ordered inert metadata summaries (`copilot/library-metadata.mjs`, `tests/library-metadata.test.mjs`), using pinned `yaml@2.8.1` (ISC).
- `node --test tests/library-metadata.test.mjs` — exit **0**; 8 passed, 0 failed.
- `npm test` — exit **1**; 170 passed, 1 failed. The failure is `tests/visual-settings.test.mjs` expecting `VISUAL_PRESET === "balanced"` while the concurrent unowned edit in `visual-settings.mjs` sets `"intense"`. That file and its test were not changed by this work.
- `npm run check:publication` — exit **1**; one finding, `local-records: plans`. The check was not suppressed and the ignored planning artifacts were retained.
- `git diff --check` — exit **0**. Working tree also contains unrelated user edits (`index.html`, `server.mjs`, `tests/server.test.mjs`, `visual-settings.mjs`, `favicon.svg`); they were preserved.
- Fresh Reviewer verdict: **OK-WITH-NOTES**, no Blocking findings. The Should finding (oversized plain Markdown incorrectly reported as having front matter) was fixed and covered by regression assertions; targeted follow-up Reviewer verdict: **OK**, no findings.

**Disposition:** SOURCE remains blocked. The parser subset does not provide a usable safe Library source and does not satisfy SOURCE DoD. Do not continue API/render/UI/release tickets or claim ticket 01 complete until a reviewed Windows opened-handle containment and ACL strategy is available and tested; no predecessor was merged.

### Native authorization follow-on · 2026-10-19 (uncommitted, in-place)
- User explicitly approved native helper design/implementation/build distribution after the above blocker. Existing parser/evidence and unrelated user edits retained. Installed Framework64 `v4.0.30319/csc.exe` works; no installs or machine/security-policy changes. Private temporary-location executable launch returned `spawn UNKNOWN`; controlled checkout `native/bin` build/launch succeeds. Supported implementation is x64 Windows, fixed NTFS volume root, no SUBST/network/reparse traversal. `native/README.md` records design, OS APIs and build/distribution reality. Generated executables are ignored, not published.
- Implemented native handle-relative open/enumeration/read, full pinned ancestor chain, opened volume/identity/parent containment before bytes, hardlink refusal, snapshot SHA256+metadata signatures. Settings use handle-created/verified current-user+SYSTEM protected ACLs, stable exclusive OS lock, complete-byte hash precondition, flushed private temporary and handle-relative atomic rename. Worker is private bounded stdio/no shell/no port; deadlines kill/settle work before releasing capacity.
- Implemented isolated `library-source.mjs`: default/root/category scope, skills nearest-entry ownership/orphans, opaque per-generation IDs, summaries through the existing parser in a cancellable 250ms worker, safe bounded detail/local-link mapping, budgets/partiality, registration/restart/unregister/refresh, protected persistence/conflict/recovery. Not yet HTTP/UI integrated.
- Red evidence: `node --test tests/library-native.test.mjs` exit **1**, missing native module; `node --test tests/library-source.test.mjs` exit **1**, missing source module, before implementation. Subsequent failed compiler/runtime/test probes were fixed rather than treated as green. Actual file-symlink creation is unavailable (`EPERM`); no privilege changes; actual junctions cover root/ancestor/leaf reparse positions.
- Fresh native Reviewer found Blocking timestamp-restoration bypass; fixed with SHA256 and real same-size/restored-time regression. Fresh combined SOURCE Reviewer found Blocking excluded registration ancestors and remaining-deadline propagation; fixes now reject lexical/canonical `.git`/`node_modules`/`session-state` source ancestry (including saved records), pass remaining source/request time into native/parser operations, discard late summaries, and await cancellation/exit before replacement. Follow-up review pending; no completion claim.
- `node --test tests/library-native.test.mjs tests/library-source.test.mjs tests/library-metadata.test.mjs` — exit **0**, **37 passed / 0 failed / 0 skipped**. Tail: `# tests 37; # pass 37; # fail 0; # skipped 0; # duration_ms 11806.0391`. Real synthetic Windows checks cover junction/hardlink refusal, full-chain/file rename/write denial during held pre-read validation, ancestor replacement, restored timestamps, private ACL creation and broad file/directory ACL refusal, two-process one-success/one-conflict, pre-rename failure cleanup, settings ancestor/file held race denial/crash lock release, restart, source bytes unchanged, changed local-link target unmapped, writable/read-only settings behavior, missing roots, exclusions and limits. Deterministic injected-clock tests separately cover remaining native deadlines and discarding late metadata; they are not substitutes for native filesystem safety proof.
- SOURCE remains **unchecked pending final follow-up Reviewer and verification disposition**. No predecessor merged; no API/renderer/UI advanced while blockers are open.

### Final verification / review-limit handoff · 2026-10-19
- Final follow-up Reviewer returned **Blocking** solely because `Date.now()` can move backwards and extend deadline budgets. Fixed after demonstrating red: `node --test tests/library-source.test.mjs` exit **1** showed native time grants `[1006,101006,201006]` instead of `[2]`. Deadline accounting now uses injected/default `performance.now()` monotonic time; `Date.now()` remains only the display `scannedAt` clock. Regression now passes. **This final fix has NOT received an accepting Reviewer verdict.** The bounded review/fix loop is exhausted for this session; SOURCE remains blocked on independent review acceptance, not on an unavailable Windows toolchain. Do not advance dependent tickets yet.
- Dependency audit found `yaml@2.8.1` affected by `GHSA-48c2-rrv3-qjmp` (stack overflow on deeply nested collections). Updated only this existing dependency to exact **2.8.3**, the smallest patched release verified against the maintainer's official release notes: https://github.com/eemeli/yaml/releases/tag/v2.8.3 (“Catch stack overflow during node composition”). No parser rewrite or other dependency change. Manifest changed first, then `npm install` exit **0**; lock updated. `npm audit` exit **0**, tail `found 0 vulnerabilities`. The dependency patch also awaits final review with the clock fix.
- `npm run build:library-helper` — exit **0**, tail `Windows Library helper built from maintained source (local build only).`
- `node --test tests/library-native.test.mjs tests/library-source.test.mjs tests/library-metadata.test.mjs` — exit **0**, tail `# tests 38; # pass 38; # fail 0; # skipped 0; # duration_ms 2428.6466` on final patched dependency.
- Exact ticket command `node --test tests/library-source.test.mjs` — exit **0**, tail `# tests 15; # pass 15; # fail 0; # skipped 0; # duration_ms 2337.8421`.
- Final `npm test` — exit **0**, tail `# tests 201; # pass 201; # fail 0; # skipped 0; # duration_ms 2474.5182`. An earlier full run still reproduced the unowned intense/balanced visual preset failure (200 pass/1 fail), confirmed separately; the concurrent visual-settings edit disappeared before the final full run. Lead did not modify that file or its test, and does not claim to have fixed it.
- `npm run check:publication` — exit **1**, tail `local-records: plans; Publication check: 1 finding(s).` Ignored plans retained; no suppression or sharing claim.
- `git diff --check` — exit **0**; scoped secret-pattern/conflict-marker check over eight newly authored native/source/test/doc files — exit **0**, no matching files (not a full-history certification). HEAD remains `10074c8` on the existing checkout, no commits/branches/push/deploy. Concurrent index/server/server-test/favicon changes preserved; no Library integration added to those files. `LibraryHelper.exe processes remaining: 0`; fixture-specific helpers were closed and their executables/fixtures removed.
- DoD disposition: **SOURCE Blocked** (final review acceptance outstanding, tests pass); **API / RENDER / UI Not met** (not implemented); **RELEASE Blocked** (dependencies/manual checks incomplete and publication finding). No manual browser/layout/accessibility verification or real user source/journal/settings inspection. **PR-READY: no**.
- Next action: fresh bounded review of monotonic-clock/dependency fixes and SOURCE acceptance; then continue ticket 02 → 03 → 04 → 05 in-place under existing approval, without a new Gate A. See `../handoff.md`. Native implementation/build is executable, not merely a proposed design.

### Accepted SOURCE disposition · 2026-10-19
- The final fresh Reviewer returned **OK-WITH-NOTES; SOURCE accepted**. The earlier clock/dependency delta was checked; null/nonmapping YAML and malformed closed front matter now safely preserve the body, and exact post-classification snapshot sizing publishes bounded partial results.
- Final exact ticket command `node --test tests/library-source.test.mjs` — exit **0**, **16 passed / 0 failed / 0 skipped**.
- Final combined SOURCE suite, run serially to avoid concurrent Windows compiler/helper startup interference: `node --test --test-concurrency=1 tests/library-native.test.mjs tests/library-source.test.mjs tests/library-metadata.test.mjs` — exit **0**, **40 passed / 0 failed / 0 skipped**. The normal parallel combined invocation failed twice intermittently with native/source helper startup/settings errors; this is recorded as an unresolved test-runner stability note, not green evidence.
- `npm run build:library-helper` (alone) — exit **0**; `npm audit` — exit **0**, zero vulnerabilities; `git diff --check` — exit **0**. No helper processes remained. Synthetic source-byte hashes and Windows junction/ACL/race/multiprocess checks passed; actual symlink creation remains unavailable (`EPERM`).
- Reviewer Should notes remain: avoid quadratic serialized-snapshot trimming beyond the request deadline, add a post-trim referential-integrity assertion for `skillEntryId`, and investigate parallel helper-test startup flakiness / unique helper test build location. These are not SOURCE-blocking under the accepted review, but should be tracked during integrated regression work. No browser/manual UI evidence is implicated.
- Delivered in-place on existing `main` at HEAD `10074c8`; not merged, committed, pushed, or published. Subsequent tickets are approved to continue in-place; “dependencies” are delivered predecessors for this session, not merged branches.

## Historical evidence — not current acceptance
Preserved from the earlier ticket; runtime/tests are absent at main `10074c8`, so this does not set current status:
> Synthetic tests prove category discovery, nested skills/orphans, bounds, canonical-root policy, ID invalidation, hostile filesystem rejection, restart persistence, atomic-write failure behavior, deadlines across stalled filesystem operations/cleanup, and fail-closed Windows ACL setup; no Copilot source is modified. Evidence: `node --test tests/library-source.test.mjs` (exit 0; 19 tests passed, including real Windows ACL application and verification).
