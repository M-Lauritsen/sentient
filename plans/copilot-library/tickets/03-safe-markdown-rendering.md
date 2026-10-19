---
id: 03
title: "Add locally served safe Markdown rendering"
owner: Lead
status: done
depends_on: [02]
parallel: no
branch: feature/copilot-library-03
dod: [RENDER]
skill: "-"
prod: no
issue: ""
---
Major: yes (untrusted local Markdown needs a fail-closed rendering boundary and pinned local dependencies).

## Goal
After ticket 02 is merged, provide a standalone safe local renderer for requirements §5 and metadata-derived summaries consistent with its parser.

## Acceptance
- Given valid restricted YAML front matter, show a readable semantic Metadata section above rendered body, preserve unknown fields/order, and keep all values inert. Metadata summary extraction and detail rendering must agree.
- Given malformed/unclosed/oversized front matter, duplicate keys, nonmapping YAML, tags, anchors/aliases/merges or excessive nesting, show §5 warning/raw-text fallback without losing source content or constructing executable objects.
- Given common Markdown and hostile HTML/URLs, support the specified formatting, mixed case and code whitespace while preventing executable DOM, embedded resources, style/control injection or pane escape. Only namespaced fragments/current-snapshot mapped IDs navigate locally.
- Given parser/renderer limits, cancellation or stale generation, bound work and DOM creation, keep the UI responsive and ignore stale output. Prove no network request or plugin/code execution from source/metadata.
- Reuse 01's shipped inert metadata helper/parser. Select pinned Markdown/sanitizer dependencies or documented equivalently safe DOM construction; record versions, licenses and security rationale. Serve required assets only via explicit allowlists, with existing CSP unchanged/tighter and no CDN. Reuse one safe metadata policy across source summaries/detail.

## Files (expected)
- `package.json`, `package-lock.json`
- `server.mjs`
- Dedicated library Markdown browser module and `tests/library-markdown.test.mjs`
- Shared inert metadata helper/source integration and synthetic fixtures as required for consistent summaries

## Verify (exact command, run from repo root)
```powershell
node --test tests/library-markdown.test.mjs tests/server.test.mjs
```
Future renderer test file, not currently present/executed. Also rerun summary regression tests from merged 01 when changing its metadata helper:
```powershell
node --test tests/library-source.test.mjs
```

## DoD
- [x] RENDER: requirements §9 RENDER proof passes at the implementation commit; include executable hostile-content tests, bounded fallback/cancellation and local-asset/CSP evidence, not string-only assertions.

## Run independently
Start only after 02 (and its merged 01) is available. Test standalone renderer with synthetic Detail objects and a minimal pane fixture; no ticket 04 dialog is required. Own the metadata-helper consistency change if needed, not a dependency on unfinished rendering work in 01.

## Out of scope
- Root registration/settings/API contract changes or library navigation/dialog.

## Evidence (filled by Lead)
Implementation: current user-owned checkout, in-place authorization in `spec.md`; no branch/commit/push/deploy and no claim that tickets 01/02 are merged. Windows_NT x64, Node 22.22.3, npm 10.9.8. Status remains `in_progress`: implementation/verification complete, **final acceptance blocked on review evidence**, not accepted/done.

### Boundary and dependencies
- `copilot/library-markdown.mjs` exposes `createLibraryMarkdownRenderer({pane,workerFactory?})`; `render(detail,{generation,fileIds,onNavigate?,signal?,limits?})`, `cancel`, `clear`, `dispose`. Caller must supply the current snapshot generation/discovered IDs and cancel/clear on selection, refresh and close. No ticket-04 wiring was added.
- One terminable worker/job; YAML and Markdown lexing never run on the UI thread. Detached DOM construction yields every 128 nodes, checks identity/deadline throughout, and commits atomically. Old link handlers/results cannot navigate/commit after cancellation or replacement.
- Contract ceilings: 256 KiB document, 16 KiB front matter, metadata depth 32/nodes 1,000, rendered work/nodes at most 20,000, 250 ms including worker startup/transfer/DOM construction. Limits can only be tightened. Emergency escaped fallback is at most four DOM nodes and 16 KiB raw source, explicitly marked if truncated; it remains available after a normal node/time budget fails.
- Source metadata policy reused unchanged: ordered inert entry arrays, same parser and summary extraction; only Buffer byte-counting/clipping replaced with shared browser-safe UTF-8 helpers. Lone-surrogate/Unicode byte-boundary regression added. The browser bundle resolves YAML's browser export; parsing has not moved into a second renderer-specific metadata policy.
- **marked 15.0.12 · MIT · runtime, exact pin:** GFM/common Markdown lexer only, no HTML renderer/highlighter/extensions/plugins. HTML tokens become text; images become inert alt text.
- **yaml 2.8.3 · ISC · existing exact runtime pin:** ticket-01 restricted AST policy, bundled into the worker, no alias expansion/object construction.
- **esbuild 0.25.12 · MIT · exact dev pin:** deterministic local browser-only bundle; no CDN, dynamic imports, source maps or source-document input. No runtime bundler.
- **jsdom 26.1.0 · MIT · exact dev pin:** executable DOM tests with scripts enabled, intercepted resource requests and synthetic content; never shipped/served to the browser. Transitives locked in package-lock.json.
- No sanitizer dependency: equivalent safe DOM construction with a closed tag/data-plan allowlist, separate main-thread revalidation, text nodes/textContent only, and no HTML/CSS/attribute parsing sinks. Only generated attributes and namespaced heading fragments/current-snapshot ID callbacks can be interactive. Unsafe/unknown schemes, absolute/UNC/encoded-resource destinations remain inert even with an accidentally overbroad supplied link map.
- `npm run build:library-renderer` creates ignored `copilot/generated/library-markdown-worker.mjs`. Build this asset after `npm ci` (dev dependencies required for building) and distribute it with the application, just as the native helper needs its build artifact. Missing/failed worker loads fail to bounded escaped text. `--check` rebuilds in memory and rejects stale output; acceptance tests execute/check the shipped bundle, not just the worker source.
- Explicit static entries: renderer, limits, UTF-8 helper, bundled worker and `/MARKED-LICENSE.txt` / `/YAML-LICENSE.txt`. No node_modules wildcard or raw metadata/source module exposure. App CSP unchanged; worker-response CSP tightened to default-src/connect-src 'none', script-src 'self', no eval/inline/blob permission.

### Executed evidence
- Test-first RED: `node --test tests/library-markdown.test.mjs` → exit **1**, missing renderer module, 0 pass / 1 fail. Additional ordered-list-start, overbroad entity-encoded URL map and bundle-freshness assertions were observed red (3 failures) before fixes.
- `npm run build:library-renderer` → exit **0**, tail: `Built self-contained local Library Markdown worker (marked 15.0.12 / yaml 2.8.3).`
- Exact `node --test tests/library-markdown.test.mjs tests/server.test.mjs` → exit **0**, latest tail: `tests 30; pass 30; fail 0; cancelled 0; skipped 0; todo 0`. Covers real bundled parser threads + executable hostile DOM/resource assertions, metadata/source preservation, namespace/ID collisions, mapped-link restrictions, injected document/metadata/node/time budgets, actual non-cooperative thread termination, DOM-phase yielding/cancellation, stale generations, parser/plan/DOM failures and explicit assets/licenses/CSP. A test-placement mistake initially cancelled one new HTTP subtest; corrected and exact command rerun successfully.
- Exact `node --test tests/library-source.test.mjs` → exit **0**, tail: `tests 16; pass 16; fail 0; cancelled 0; skipped 0`.
- `node --test tests/library-metadata.test.mjs` → exit **0**, latest tail: `tests 10; pass 10; fail 0; cancelled 0; skipped 0`.
- `npm audit` → exit **0**, `found 0 vulnerabilities`. `git diff --check` → exit **0**; scoped renderer/worker/build `node --check` → exit **0**.
- Only ephemeral synthetic fixtures/server ports were used; no real `.copilot`, journals or settings data/server. No changes to favicon, index/main, visual-settings edits or activity/SSE contracts. No current full-suite/manual-browser/screen-reader/Prod verdict claimed.
- Fresh scoped Reviewer loop 1: **OK-WITH-NOTES**, no Blocking findings. One Should at `library-markdown.mjs` DOM-depth check: allowed YAML depth 32 expands beyond 64 DOM levels through semantic dl/dd wrappers. Added executable depth-32 success/depth-33 rejection test, observed RED (`fallback` instead of `rendered`, exit 1), then raised only the finite DOM wrapper ceiling to 160; YAML depth 32 and Markdown parser depth 64 remain unchanged. Exact 30-test command, source 16 and metadata 10 all rerun exit 0 after the fix.
- Fresh complete-scope Reviewer found a Blocking link traversal issue: a forged/overbroad detail map could make `../` or encoded traversal navigate outside the current category. Test first reproduced the unsafe anchor. Fixed by resolving the decoded relative destination against the selected file's category-relative path, rejecting category-root escapes, and requiring the mapped target's source/category/path to match. Ticket 01 source detail mappings now provide only the target's safe relative path/source/category plus its opaque ID/fragment; renderer navigation still emits only opaque ID/fragment. Regression tests cover encoded/root escapes, cross-source/category mappings, valid in-category parent-relative links, encoded spaces and case-insensitive Windows path matching; source assertions cover the mapping shape.
- Follow-up Reviewer read the complete updated scoped bundle and returned **OK-WITH-NOTES — ACCEPT**, no Blocking findings. The Should about spaces and Nit about case-only mapped paths were resolved by accepting spaces after URI decoding and matching target paths case-insensitively, consistent with the source's Windows lookup policy. The complete bundle was supplied and read; acceptance is not based on a partial working-tree diff.
- Final exact `node --test tests/library-markdown.test.mjs tests/server.test.mjs` — exit **0**, 32 passed, 0 failed, 0 cancelled/skipped. `node --test tests/library-source.test.mjs tests/library-metadata.test.mjs` — exit **0**, 26 passed. `npm run build:library-renderer -- --check`, `npm audit`, syntax checks and `git diff --check` — exit **0**; audit found 0 vulnerabilities.
- Ticket 03 is accepted/done in-place, not merged or committed. No ticket-04 integration was part of this renderer scope.

## Historical evidence — not current acceptance
Preserved from the earlier ticket; its “front matter as inert text” requirement is superseded by the approved readable Metadata section:
> Synthetic hostile-content tests prove only approved local formatting/links render; dependencies are pinned and served locally under an explicit allowlist with CSP intact. Evidence: `node --test tests/library-markdown.test.mjs tests/server.test.mjs` (exit 0; 19 tests passed); `npm audit` (exit 0; 0 vulnerabilities).
