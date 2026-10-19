# Copilot Library — authoritative requirements

**Implementation authorization amendment (2026-10-19):** The user subsequently authorized all five implementation tickets and explicitly approved a native Windows safety helper with added build/distribution requirements after the Node-only blocker. Earlier plan-only wording below is historical, not a current implementation prohibition. Work stays in-place with no branch/commit/push; dependencies are verified in-place predecessors, not falsely “merged”. See `spec.md` and `native/README.md` for the authorized mechanism and actual supported-platform/build boundary. All safety and acceptance requirements remain in force.

This document specifies future work, not existing behavior. Gate A and the four behavioral decisions in `spec.md` were approved at checkpoint ①. The user approved all five tickets and the proposed technical defaults at checkpoint ② on 2026-10-19 as the planning baseline, without authorizing implementation. “Proposed” below identifies reversible technical defaults, not unresolved approval or proven feasibility; changes must update contracts, tests and user documentation together. The Library is an overview of files, not a claim that Copilot has loaded, installed, enabled or applied them.

## 1. Scope and current-checkout evidence

- The user requested specs only for viewing agents, instructions and skills from the default `.copilot` and additional folders, with rendered Markdown/front matter and application-matched UI.
- Baseline supplied for this planning pass: main HEAD `10074c8`, initially clean; Library runtime is absent. Existing ticket completion claims concern other historical work, not this checkout.
- Inspected `.github/copilot-instructions.md`, `README.md`, `package.json`, `server.mjs`, `index.html`, `style.css` and all five prior tickets. Node >=22, ESM, Three.js 0.160.0 is the sole manifest dependency. Scripts: `npm test` = `node --test tests/*.test.mjs`; `npm run check:publication`; `npm start` = `node server.mjs`.
- `server.mjs` has explicit static/vendor allowlists and enforces IPv4 loopback. `index.html` contains the HUD, statistics, timeline and visual-settings dialogs. `style.css` supplies mono typography, blue/orange tokens, dark surfaces, fine borders and focus rings.
- Root `AGENTS.md` and `docs/project-profile.md` are absent. No profile, AGENTS file, `specs` index or implementation file is to be created in this pass. The GSD workflow/template was read from the user's skill references.
- No real `.copilot` contents or private journals need inspection. Use synthetic folders for all future acceptance. Earlier test/review/publication output remains historical only.

## 2. Sources, classification and lifecycle

### 2.1 Default and additional registrations
- Resolve the current server user's home server-side; implicit source is `<home>/.copilot`, mode `root`, label “Default Copilot”. Do not derive it from an arbitrary browser path or the activity source's journal directory. Always show it, including missing/unreadable states; it cannot be unregistered.
- Add folder is explicit path entry, not an arbitrary filesystem explorer. The user chooses **Copilot root** or **Category folder**, with category `agents`, `skills` or `instructions` mandatory for the latter. Preview the read-only scope and confirm before submitting.
- Root mode inspects only its immediate `agents`, `skills`, `instructions` directories. Category mode treats the chosen folder itself as that category; it need not have a conventional name. Do not guess category from content/front matter, scan the entire root, or scan any `session-state`, `.git`, `node_modules` or directory reparse/link target. Reject registration whose path includes a `session-state` segment.
- Proposed classification: include case-insensitive `.md` regular files, including `.agent.md` and `.instructions.md`; exclude other extensions/binaries, including executables. Agents/instructions recurse within their category. Skills recurse: each `SKILL.md` is an entry; other Markdown under its directory is support documentation owned by the nearest ancestor skill. Nested `SKILL.md` starts a new skill. Markdown with no ancestor skill is visible as “Unassociated skill document”, not silently lost. `SKILL.md` at a category root is valid. Non-Markdown skill assets remain excluded.
- Labels: source label, category, category-relative path, entry/support/unassociated kind, readable title and optional plain-text description. Detail title prefers a valid nonempty metadata `name`, then `title`, then first Markdown H1, then basename; name/title <=200 characters for display, description <=500 with an explicit shortened indicator. Preserve case and the full bounded original metadata in detail; never infer “active” or “installed”.
- Deterministically sort categories agents/skills/instructions and paths case-insensitively with an exact-string tie break. Classification and default scope must be explained in help.

### 2.2 Duplicates, refresh and removal
- Canonicalize and compare roots using platform-aware identity, case and separator handling, not raw string prefixes. Reject canonical duplicates (including default aliases) and ancestor/descendant overlap among default/additional registrations, even across modes/categories; return `DUPLICATE_ROOT` or `OVERLAPPING_ROOT` with safe labels. Distinct files with identical bytes/names are not duplicates. A default source's child category cannot be added separately.
- Missing default is a warning, never an add-folder failure for unrelated safe roots. Adding requires an existing readable safe directory. Saved roots that later disappear remain registered with errors; never redirect or silently delete them.
- First Library open obtains an initial bounded snapshot; later opens reuse the process snapshot and show its timestamp. No watchers, timers, background file discovery or automatic content refresh. Restart revalidates registrations and builds a new snapshot on first open. File safety checks at detail-read time are mandatory, not watching.
- Manual Refresh scans all registered sources, publishes a new generation atomically, and invalidates all old file IDs. Clear old detail after success and announce “Select a file again”; retain selected source/category if still present. A partial scan publishes clearly partial results; a request-level failure retains the prior snapshot marked stale with its original timestamp.
- Add/remove success includes a new snapshot; add saves only after validation and bounded initial scan (empty/partial are allowed and clearly indicated). Remove is additional-source-only, requires confirmation, invalidates all old file IDs and clears removed detail; it unregisters only and never deletes files. Already absent root ID is `NOT_FOUND`.
- Mutation failure leaves prior registrations, revision and snapshot in force. Successful registration persists across server restart; no Markdown, metadata or snapshot cache is written to disk/browser storage.

## 3. Settings and filesystem security

### 3.1 Persistence and confidentiality
- Proposed Windows store: `%LOCALAPPDATA%/SENTIENT/library/settings.json`; if LOCALAPPDATA is unavailable/untrusted, disable additional-root persistence with `SETTINGS_UNAVAILABLE`, not a repository/home fallback. Other platforms require an explicit equally protected per-user app-data policy before claiming support.
- Schema v1: `{version:1,revision:<opaque revision>,additionalRoots:[{path:<canonical absolute local path>,mode:"root"|"category",category?:<enum>}]}`. Category exists only in category mode. Default source is implicit, not stored. Runtime root/file IDs, labels, file content, metadata, tokens and timestamps are not persisted.
- Absolute registrations are sensitive. The dedicated directory, settings file, temporary files and concurrency-control artifacts must have verified access restricted to the current user (and required trusted OS principals only). Never broaden permissions, follow links, or expose settings as a static asset. Do not echo saved paths to API responses, errors, logs, telemetry, exports or activity. Warn that local backups/admin access are outside this boundary.
- Bounded settings validation rejects unknown schema versions, invalid records, duplicate keys/schema fields, oversized files and unsafe locations without silently resetting or overwriting. Missing settings means an empty additional list. Corrupt/unsafe settings leave default viewing available if safe, clearly disable registration mutations, preserve original bytes and show recovery guidance. External repair followed by server restart is the proposed recovery; no destructive Reset button.
- Unwritable settings still permit safe reads of valid loaded registrations, but mutations fail without “saved” confirmation. All persistence is atomic, revision-protected and recoverable: failed writes preserve the last valid state and do not leak temporary path/content.
- Acceptance is multi-process, not merely a process-local mutex: two server instances registering/removing against the same revision must yield one complete success and one `SETTINGS_CONFLICT`, never lost updates, corrupt JSON or mixed memory/disk success. An instance observing an external revision change must require restart/reload guidance before retry, not overwrite. Crash/timeout cleanup must not break another process's lock. Mechanism is left to Lead; failure to demonstrate this blocks SOURCE.

### 3.2 Local paths, containment and race safety
- Registration accepts bounded absolute local drive paths on Windows, e.g. `C:\Synthetic\Library`; reject relative/drive-relative paths, UNC/network paths, device/extended namespaces, URLs, alternate data streams, reserved device names, embedded NUL/control characters, ambiguous trailing dots/spaces, environment/tilde expansion and lexical `.`/`..` segments. Do not reveal existence of rejected/out-of-scope paths. Other input fields never accept filesystem paths.
- Check the full ancestor chain and category descendants: disallow symlinks, junctions and unsupported reparse points, escapes and non-regular files. Boundary checks use canonical path components plus file identity/volume where available; `C:\safe2` is not inside `C:\safe`. Refuse multi-linked files unless safety can be demonstrated; default is reject link count >1.
- Revalidate on registration, scan and every detail read. Snapshot ID mapping is not read authorization. Protect against replacements of roots, ancestors, files and settings between check/open/read/write; validate identity and containment of the actually opened handles, not only pre-open realpath strings. Bound read size independently of stat size and recheck for change.
- A source/file changed since snapshot returns `CONTENT_CHANGED` rather than a mixed/stale document; refresh is required. An unsafe replacement returns `UNSAFE_SOURCE` without reading/exposing the replacement bytes.
- If the platform/runtime cannot prove link/handle/ACL/race safety, fail closed for the affected source or settings mutation and surface `SAFETY_UNSUPPORTED`. Do not ship a path-based best-effort check as a verified Windows guarantee. Ticket 01 owns feasibility evidence; this is a potential blocker, not a prescribed unverified implementation.

### 3.3 Proposed reversible resource budgets
All bounds apply before allocation/traversal as appropriate, include rejected/ignored visited entries, and are test-injectable to small values. Changing them requires updating user-visible limit help and acceptance.

| Resource | Proposed maximum / behavior |
|---|---|
| Additional sources | 16 plus implicit default; registration beyond this fails `LIMIT_EXCEEDED` |
| Registration input / settings | Path 1,024 UTF-16 code units; request 8 KiB; settings 64 KiB |
| Scan | Depth 12 below category root; 10,000 visited entries/source; 2,000 included documents total; 5 seconds/source, 15 seconds/request |
| Work | One scan/mutation per process; at most 2 active detail operations; at most 8 outstanding filesystem operations including timed-out/cleanup work |
| Document / response | 256 KiB UTF-8 document; 512 KiB detail JSON; 2 MiB snapshot JSON; reject whole oversized document, never parse a cut-off prefix |
| Front matter / renderer | 16 KiB metadata; 32 nesting levels; 1,000 scalar/container nodes; no YAML alias/anchor expansion; 20,000 rendered nodes/document |
| Parsing time | 250 ms/document for parse/render work in cancellable/bounded execution; pathological input cannot freeze the main UI |

When a scan budget is reached return `complete:false`, `truncated:true`, stable reason codes and affected source/category; do not claim all files were found. Per-source permission/timeout failures yield `state:"error"|"partial"` and warnings while other sources remain usable. Counts are “shown”, not inferred totals. Reject invalid UTF-8/NUL/binary data with `UNSUPPORTED_CONTENT`; raw errors/absolute paths never enter diagnostics. HTTP timeout is not cancellation proof: outstanding I/O still consumes capacity until settled; repeated timeouts cannot accumulate unbounded work. Queue overflow is `BUSY` with bounded retry guidance.

## 4. HTTP contract (proposed)

### 4.1 Authorization and isolation
- Keep `127.0.0.1` binding, exact expected Host including port, and no CORS. Host aliases, spoofed origins, null origins and DNS-rebinding hosts fail before filesystem work. Use the current served origin, not a caller-supplied header, to establish trust.
- `GET /api/library/bootstrap` returns `{token}` with an unpredictable per-process token only to requests with `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: same-origin` and `Sec-Fetch-Dest: empty`; if Origin is present it must exactly match. Missing/contradictory browser evidence fails closed, including navigations and opaque/file origins.
- All other library routes, including GET reads, require the same browser evidence plus `X-Sentient-Library-Token`. Mutations additionally require exact Origin, `Content-Type: application/json` without unsupported encodings, and a bounded JSON object; reject unknown body fields and duplicate keys. Same-origin scripts can intentionally view the library; this does not defend against an already compromised same-origin app.
- Reads do not accept query path parameters, arbitrary filesystem IDs, relative path resolution or route-to-static fallback. Invalid route/ID is JSON denial; percent-encoded separators, traversal, doubled encodings and malformed IDs never resolve a path.
- Every library response, including bootstrap/errors, is JSON with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; no token in URL/referrer/storage/logs, no CORS headers. Never cache responses in a service worker. Do not weaken existing CSP or asset allowlists.

### 4.2 Shapes and routes
Opaque `rootId`, `fileId`, `generation`, `revision` and token are bounded non-path values. IDs are unpredictable and process-scoped; file IDs additionally belong to a snapshot generation. Displayed paths are category-relative only. Root labels are “Default Copilot” / “Folder N” (N unique within the process); do not expose full saved paths or infer them from labels.

- `GET /api/library/bootstrap` → 200 `{token}`; bootstrap performs no discovery.
- `GET /api/library` → 200 Snapshot; build once on first use, then reuse until explicit mutation/refresh.
- `GET /api/library/files/:fileId` → 200 Detail; no raw/download endpoint.
- `POST /api/library/roots` body `{revision,path,mode,category?}` → 201 `{rootId,snapshot}` after durable success.
- `DELETE /api/library/roots/:rootId` body `{revision}` → 200 `{snapshot}` after durable success; default removal is 403 `DEFAULT_ROOT`.
- `POST /api/library/refresh` body `{revision}` → 200 Snapshot, or 409 `SETTINGS_CONFLICT` if external settings revision differs.

Snapshot: `{generation,revision,scannedAt,complete,truncated,warnings,sources,files}`.
Source: `{id,label,mode,category?,isDefault,state,categories,warnings}`; state is `ready|empty|missing|error|partial`, categories lists only applicable enum values.
File summary: `{id,sourceId,category,relativePath,kind,skillEntryId?,title,description?,warnings}`; kind is `entry|support|unassociated`. Metadata-derived summaries must use the same safe bounded parsing rules as detail, never scan excluded content. Snapshot partiality must also reflect summary/response-size bounds.
Detail: `{generation,file:{id,sourceId,category,relativePath,kind},markdown,warnings,links}`. Markdown is the bounded original UTF-8 source including front matter; renderer owns metadata parsing under §5. `links` maps at most 200 discovered relative Markdown link destinations to current-snapshot `{fileId,fragment?}`; targets must pass the same registered-file/safety policy, otherwise remain unmapped/inert. Never use a path-bearing link as a new API read parameter.
Warning: `{code,sourceId?,fileId?,category?,message}`; safe preset messages, no raw OS exceptions. Response fields do not include arbitrary filesystem paths. Summary/detail disagreeing due to file changes returns `CONTENT_CHANGED`.

Errors: `{error:{code,message,retryable},generation?,revision?}` with bounded preset text. No stack traces, rejected input echoes or inferred sensitive file existence. If no trusted current snapshot/revision exists, omit those optional fields.

| HTTP | Stable codes / behavior |
|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_PATH`, `INVALID_MODE`, `INVALID_ID` |
| 403 | `FORBIDDEN`, `DEFAULT_ROOT`, `UNSAFE_SOURCE`, `SAFETY_UNSUPPORTED` |
| 404 | `NOT_FOUND` (includes unknown or expired file ID; UI offers refresh, not path retry) |
| 409 | `DUPLICATE_ROOT`, `OVERLAPPING_ROOT`, `SETTINGS_CONFLICT`, `CONTENT_CHANGED` |
| 413 | `LIMIT_EXCEEDED` (request, document or payload bound) |
| 415 | `UNSUPPORTED_CONTENT` (including request media type/encoding) |
| 405 | `METHOD_NOT_ALLOWED` with allowed methods, no static fallback |
| 503 | `BUSY`, `SETTINGS_UNAVAILABLE`, `SOURCE_UNAVAILABLE` |
| 504 / 500 | `TIMEOUT` / `INTERNAL_ERROR`, no raw diagnostic text |

A missing/unreadable source in a list is a source state, not a whole-list 404. Unauthorized responses are indistinguishable before lookup. Request-level refresh errors do not publish a half-updated generation. Safe per-source partial results are explicitly allowed.

## 5. Markdown and front matter

- Render headings, paragraphs, emphasis, ordered/unordered lists, block quotes, fenced/inline code, thematic breaks, tables and local fragment/library links. Preserve readable mixed case and code whitespace. Do not execute snippets, commands, “instructions”, tools or skill code.
- Front matter is recognized only at the document start (optional UTF-8 BOM), opening line exactly `---`, closing line `---` or `...`; support LF/CRLF. Parse a restricted YAML mapping of inert strings/booleans/null/numbers, nested mappings and lists. Preserve unknown fields and their order in a readable **Metadata** section above the rendered Markdown body.
- Ticket 01 owns the bounded inert metadata helper and its parser choice because summaries already need it; pin any required dependency there and test hostile/malformed metadata without a renderer. Ticket 03 reuses that shipped policy/helper for presentation and selects Markdown/sanitizer dependencies. No ticket may require a parser from an unfinished successor.
- Disable custom tags, object construction, aliases, anchors, merge keys, executable values and implicit date/object conversion. Keys such as `tools`, `model` or `applyTo` are plain data, not configuration. Reject duplicate keys, nonmapping top levels and unsupported/excessive constructs as malformed.
- For malformed or unclosed front matter show “Front matter could not be parsed” and safe escaped raw metadata text (bounded with explicit truncation), never silently discard it or infer metadata. With a valid closing delimiter render the remaining body normally; with no closing delimiter show the whole bounded source as escaped text and explain why no body was separated. Oversized metadata leaves the document readable as escaped source with a limit warning. Empty mapping is a valid empty Metadata state; no delimiter means no Metadata section.
- Raw HTML stays escaped/inert. No images (including local/remote), media, iframe, SVG, forms, scripts, event attributes, CSS injection, embeds or automatic previews; show descriptive inert alt text where useful. Disable autoloads and extensions that request network resources. Use a pinned locally served parser and sanitizer/DOM-safe construction; select and record versions/licenses/security rationale in ticket 03.
- Only heading fragments and mapped links to already-discovered Markdown inside registered sources are interactive. Relative link resolution occurs against the current category document server-side, cannot leave the category/registration or enter excluded trees, and must not follow links/reparse points. Absolute paths, `file:`, UNC, protocol-relative, HTTP(S), mailto, data, javascript and unknown schemes stay text; never navigate outside the Library. Fragment IDs are namespaced within the pane and cannot target unrelated UI.
- Rendered DOM, metadata, titles, link text and warnings all cross the same untrusted-text boundary. Parser output cannot create Library controls, spoof errors, alter application styles or escape the pane. A parser/sanitizer error gives a warning and escaped text fallback, never raw HTML.
- Enforce §3.3 limits during parsing and node generation; abort stale tasks on selection/refresh/close and ignore late results. Code is plain text; no network highlighter or dynamically loaded plugins.

## 6. UI journeys and application integration

### 6.1 Visual reference and layout
- Add **Library** near the existing `#visual-settings-open` HUD action in `index.html`; label the dialog “Copilot Library”. Use native dialog semantics and a large overlay above the scene rather than replacing the visualization.
- Match `style.css` tokens `--blue`, `--orange`, `--text`, `--bg`, mono font stack, `.visual-settings-dialog` surface/backdrop/border and existing `:focus-visible` ring language. Proposed desktop size `min(1200px,94vw)` and max-height `90dvh`; allow internally scrollable regions. Keep decorative scanlines/glow out of reading text.
- Navigation pane: source, category and documents; detail pane: breadcrumb, readable title, Metadata then rendered body. Use category-relative paths to distinguish duplicate titles. Filter by selected source/category; search, content editing and configurable layouts are deferred.
- Explicitly override `.hud` uppercase/letter-spacing for titles, paths, metadata, body, form inputs and messages; mixed-case content is not transformed. Body default >=16px with line-height >=1.5; chrome may match existing HUD only while meeting accessibility/zoom requirements.
- At <=700px use stacked navigation/detail with a labeled Back to files action; opening a document brings its heading into view. At 320 CSS px and 400% zoom no two-dimensional page/dialog scrolling; code/tables may scroll within labeled contained regions. Header, Close, Refresh and Add folder remain reachable without content obscuring them.

### 6.2 Journeys and states
1. **Open:** keyboard/click opens modal; focus lands on dialog title or Close; announce loading, then default source/categories and counts of shown files. Do not open a file automatically. Help states “Read-only files; not active Copilot configuration”.
2. **Browse:** select source/category, then a document. Announce selection/loading; show metadata above body, relative breadcrumb and read-only label. Empty source/category says “No matching Markdown files” with Refresh/Add folder, not an error. Missing default explains its expected role without disclosing the home path.
3. **Register:** Add folder reveals labeled path field, mode control and category selector when required; show scope/exclusions and persistence disclosure. Only this deliberate input/confirmation may display the user's typed absolute path; clear it on success/cancel/close, never restore saved paths. Submission disables duplicate actions and announces saving. On validation/conflict/permission/limit error keep the user's input and field focus, show actionable bounded text; never claim persistence succeeded. On success select the new source and show its empty/partial/error state if applicable.
4. **Remove:** additional source action explains “Unregister only; files will not be deleted”; confirm/cancel with keyboard. After success select default and clear old detail; failure keeps source/detail, marked stale if necessary. Default has no remove control.
5. **Refresh:** explicit action announces scanning; keep old results visibly stale while pending and suppress old detail navigation. On success replace generation/IDs, clear detail and return focus to Refresh (or the surviving source control). On failure retain old data with timestamp/error and retry. Never show stale content as current.
6. **Change/error:** missing/denied/unsafe file, `CONTENT_CHANGED` or expired ID clears current detail and offers Refresh; malformed metadata only warns inside otherwise readable detail. Truncation/timeouts show partial-result reasons and shown counts, not “all”. Settings errors distinguish viewing available from registrations unavailable.
7. **Async/close:** latest selection/generation wins; response to a removed source, previous selection or closed dialog cannot repopulate it. Serialize mutations; disallow Add/Remove/Refresh while another is pending, with accessible busy explanation. Close/Escape works during work; committed server-side success may finish, but late UI results are ignored; next open reconciles with server snapshot. No orphan modal or pending focus callback.
8. **Restart:** additional safe registrations return without re-entering paths; changed/missing ones are labeled, not silently removed. Corrupt/conflicting settings explain recovery/restart rather than performing a destructive reset.

### 6.3 Accessibility and scene isolation
- Meet WCAG 2.2 AA: text contrast >=4.5:1 (large text >=3:1), control/focus boundaries >=3:1 against adjacent colors; measure actual composited colors rather than assuming token compliance.
- All actions keyboard-operable; Tab/Shift+Tab contained in modal, Escape/Close returns focus to Library trigger; no keyboard trap. Use buttons/lists or fully specified ARIA patterns, no incomplete tree widget. Show visible selected state not color alone, programmatic names/roles/expanded/selected/busy state and associated inline errors.
- AA target sizes >=24x24 CSS px or compliant spacing; ensure focus never fully obscured. Heading hierarchy and metadata key/value semantics remain usable by screen readers. Status announcements use polite live regions; actionable errors are announced without repeated full-document reading.
- Manually test keyboard-only, screen-reader names/status, 200% text zoom, 400% zoom/320px reflow, reduced motion and high-contrast/forced colors. Do not add flashing/animated read surfaces.
- Prevent canvas orbit/zoom/hotkeys from handling dialog input, scroll or keys. Keep one modal at a time; coordinate with statistics/timeline/visual-settings dialogs. Closing preserves scene camera, visual-setting preview, feed, timeline and statistics. Activity/SSE continues independently; a library failure cannot stop it.

## 7. Privacy, exceptions and rollback

- Repository rules remain read-only for Copilot/activity sources. The only scoped write exception is SENTIENT-owned registration/settings and protected atomic/concurrency artifacts; the only mutations are library registration/unregistration/manual refresh. No command execution, content modification, watching, Copilot config writes or source deletion.
- Explicit intentional viewing is a separate privacy boundary: a selected document and its metadata may themselves contain sensitive text or paths. Show them only in the Library, not in activity/SSE, logs, metrics, screenshots, publication artifacts, browser storage or exports. Discovery labels expose only bounded titles/descriptions and category-relative paths within this intentional Library boundary; do not promise document contents are anonymized.
- Do not import activity-source internals, scan session-state, expose prompts/journal/tool contents, or change the existing bounded activity projections. Test with distinct synthetic secret markers in excluded folders, library content/settings and activity fixtures; assert no cross-channel leakage.
- No external resources, telemetry, CDN or arbitrary static file serving. New modules/vendor assets require individual `STATIC_FILES`/vendor mappings, appropriate licenses and unchanged/tighter CSP.
- Rollback: disable/remove Library trigger, routes and new assets/modules, stop library work, ignore versioned settings; preserve sources, activity and visual settings. Do not auto-delete settings. Document explicit local settings removal by the user only, with privacy warning. Rollback test verifies original scene/HTTP/SSE behavior without source changes.

## 8. Delivery, verification and independent review

- Five template-based tickets, each owned by Lead, current status `todo`. Sequence 01 → 02 → 03 → 04 → 05; begin only on required merged predecessors. Each is runnable in a new worktree/session after its prerequisites, with its own synthetic fixtures and no reliance on a user's server/files.
- Expected new test names in tickets are future deliverables, not present or executed in this planning pass. Use built-in `node:test`/`node:assert/strict`. Existing test files named in verification commands must be confirmed by Lead before execution.
- Each Lead evidence entry records current commit, command, exit, counts/output, platform, skipped/unsupported cases and fresh Reviewer verdict. Unsupported security behavior blocks release, not an unexplained skip.
- Test-first security/functional checks are distinct from manual visual/accessibility acceptance. No browser automation dependency is currently specified in package.json; Node UI-contract tests cannot prove layout, contrast or screen-reader behavior.
- Ticket 02 supplies a future isolated preview harness, `tests/helpers/library-preview.mjs`, using programmatic server injection for a disposable activity journal directory, synthetic default Library/category roots and a dedicated temporary settings location. It must explicitly supply every path rather than falling back to the operator's home/app-data; refuse startup if isolation cannot be established. Bind only `127.0.0.1` with port `0`, print the actual URL and synthetic registration paths, and never probe/reuse an existing server. `node tests/helpers/library-preview.mjs` is the exact future manual launch command for tickets 04/05; open only its printed URL. Provide an explicit terminal restart action that closes/recreates the server against the same fixture to prove persistence, without a browser-accessible restart endpoint. Ctrl+C closes the server and cleans only that harness's exact temporary fixture after checks. No changes to HOME/USERPROFILE or production path/port defaults are needed. These harness files do not exist yet; `npm start` remains the normal app command, not synthetic acceptance.
- Plan-only checks: inspect links, ticket status/dependencies, ≤40-line spec, coverage/consistency and retained history. Do not run full runtime tests or treat historical results as current acceptance. Independent document review returned no Blocking findings; its isolation-procedure note and correction are recorded in `review.md`.
- Checkpoint ② is approved for the ticket set and proposed technical defaults as a planning baseline only. No implementation, tracker write, commit, push, deploy or change outside this plan folder is authorized now.

## 9. Acceptance and definition of done

These are feature-specific DoD rows, not a claim that an absent repository-wide DoD document exists.

| Row / owner ticket | Required proof | Exact future verification from repository root |
|---|---|---|
| SOURCE / 01 | Default + both registration modes; nested skill/support/orphan classification; safe metadata summaries; exclusions; duplicates/overlaps; bounds/partiality; handle/race/link safety; protected persistence/restart/corruption/unwritable/multi-process conflict; sources unchanged | `node --test tests/library-source.test.mjs` |
| API / 02 | Real loopback HTTP shapes/statuses; unauthorized bootstrap/read/mutation denied before I/O; stale IDs/revisions; body/response/concurrency limits; library failures isolated; SSE unchanged | `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` |
| RENDER / 03 | Readable metadata/unknown fields; malformed/hostile YAML; safe common Markdown; local links only; no remote/executable DOM; bounded cancellation; pinned local assets/CSP/licenses | `node --test tests/library-markdown.test.mjs tests/server.test.mjs` |
| UI / 04 | All §6 journeys/states, stale async races, matching visual design, registration persistence semantics, keyboard/focus/zoom/contrast/manual acceptance, scene isolation | `node --test tests/copilot-library-ui.test.mjs tests/ui-contract.test.mjs` then `node tests/helpers/library-preview.mjs` for synthetic browser checks |
| RELEASE / 05 | Accurate README scoped exception/recovery/limits; integrated privacy, regressions, rollback; fresh review and all manual checks; publication disposition | `npm test`; `npm run check:publication`; `node tests/helpers/library-preview.mjs` for synthetic integrated checks |

For manual acceptance, follow the isolated harness procedure in §8, not the ordinary `npm start` URL. The feature must offer safe test injection for source/settings paths via programmatic fixtures without broadening public API paths. Publication failure remains a recorded blocker until explicitly resolved by the responsible reviewer/user without suppressing checks. No row is satisfied at planning time.
