# Persistent visual settings and presets
status: specified
Major: yes (server persistence/API, browser startup and settings UI; new write trust boundary).
## Gate A
Gate A: PASS for specification only; implementation and runnable tickets require separate approval.
Issue: none; Lane: planned; Branch: existing user-owned checkout; no commit, push or deployment authorised.
Outcome: save the current appearance across restarts and manage named custom presets without editing source.
Acceptance: save/restore settings; create, update, rename and delete custom presets; immutable built-ins.
Blast radius: local settings storage and browser/server integration; no activity/event contract changes.
Security review: required for implementation (new local write endpoints); no secrets or session content in presets.
Policy exception: future writes are permitted only to the dedicated visual-settings store; journals, Library content and source files remain read-only.
Rollback: disable settings endpoints/loading and return to file-authored configuration; preserve the JSON store for recovery.
DoD: TEST (storage/API/UI), UI (real browser), SECURITY, DOCS, REVIEW; BUILD/LINT only where existing scripts cover touched assets.
## Proposed design (not implementation authority)
- Store one versioned JSON document at `%LOCALAPPDATA%\SentientOS\visual-settings.json` on Windows; use the platform user-config directory elsewhere, never cwd or a browser-supplied path.
- Shape: `{ schemaVersion: 1, revision, savedSettings: null | settings, presets: [{ id, name, settings }] }`; settings are complete validated snapshots, including startup-only values.
- Reuse visual-config.mjs definitions/validation; preserve linear RGB arrays, sRGB integer colours and enum constraints; reject unknown keys, unsafe object keys, nonfinite values and incompatible versions.
- Built-ins remain balanced/subtle/intense in source; custom IDs are server-generated opaque handles, never names or paths. Trim names, require 1-64 characters, reject controls and case-insensitive duplicates.
- Bound the store to 32 custom presets, requests to 256 KiB and the stored document to 1 MiB; reject over-limit input explicitly without partial mutations.
- At startup resolve the authored file, then savedSettings if present, before allocating scene topology; do not save on preview, preset selection or application startup.
- Missing store means normal file defaults; corrupt, unsupported or unreadable stores show an actionable error, allow explicit file-default startup, and block writes rather than silently overwriting data.
- Selecting a preset previews its full snapshot; Save settings explicitly stores the desired snapshot for next startup. Updating a preset does not implicitly change savedSettings.
- Save as preset creates a snapshot; Update preset replaces it explicitly; Rename changes only its name; Delete requires confirmation and never deletes built-ins or the saved appearance.
- Node-count edits remain staged until page refresh; saves/presets include the desired count, and UI distinguishes saved configuration from the network currently running.
- Reset preview returns to the last loaded saved/file state; Use file defaults explicitly previews the authored file; Save settings is still required to persist that choice.
- Preserve existing JS download/export without server-side source rewriting; add validated JSON preset import/export, never execute imported JavaScript.
## Proposed API and write safety
- `GET /api/visual-settings/bootstrap` supplies a same-origin, process-scoped token; `GET /api/visual-settings` returns the document and an opaque revision/ETag.
- `PUT /api/visual-settings/current`, `POST /api/visual-settings/presets`, `PUT/PATCH/DELETE /api/visual-settings/presets/:id` save current, create, update/rename or delete; all mutations require `If-Match`.
- Enforce IPv4 loopback, exact Host/Origin, same-origin fetch metadata, token headers and JSON media type; no permissive CORS, arbitrary file access or executable payloads.
- Responses use bounded structured errors: invalid 400, forbidden 403, missing 404, stale revision 412, too large 413, unsupported media 415 and persistence failure 500; never leak disk paths.
- Serialize transactions and protect compare-and-write across server processes; stale tabs/processes must reload or explicitly reapply edits, never automatically overwrite newer settings.
- Write an exclusive temporary file in the same directory, flush/close then safely replace; reject symlink/reparse redirection, preserve the last good document on failure and clean up only owned temporary files.
- Show loading, dirty preview, saving, saved, refresh-required, conflict and failure states; preserve edits on failure; acknowledge success only after persistence; label controls and announce status accessibly.

## Completion and next checkpoint
- Use temporary synthetic stores, controlled failures and real loopback requests to cover restart restore, CRUD, import/export, limits, validation, origin/token rejection, concurrent saves and failed-write preservation.
- Run `node --test tests/visual-settings.test.mjs` plus new storage/API selectors; then `npm test` and `npm run check:publication` (README/package.json sources; docs/project-profile.md is absent).
- Verify real-browser save/restart, preset CRUD, dirty/reload conflicts, picker conversions and count refresh; require independent Reviewer and targeted security review before delivery.
- Next: confirm proposed storage/API/limits and produce runnable tickets for approval; this spec does not authorise code changes. Onboarding/profile work, general filesystem writes, autosave, cloud sync and executable config imports are out of scope.
