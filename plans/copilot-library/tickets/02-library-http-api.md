---
id: 02
title: "Expose the isolated library API with same-origin authorization"
owner: Lead
status: done
depends_on: [01]
parallel: no
branch: feature/copilot-library-02
dod: [API]
skill: "-"
prod: no
issue: ""
---
Major: yes (new file-disclosure and mutation endpoints require strict loopback request authorization and bounded handling).

## Goal
After ticket 01 is merged, expose requirements §4 using its isolated source/settings interface without changing activity behavior.

## Acceptance
- Given exact same-origin browser evidence, bootstrap returns a no-store process token; list/detail require it too. Cross-origin, missing/contradictory Fetch Metadata, forged Host/Origin, navigation and null-origin requests are denied before source I/O.
- Given root/category registration, remove and refresh requests, implement all §4 shapes, revisions, status/error codes and unknown-field/duplicate-key rejection. Only registration accepts a path; detail is opaque-ID-only and cannot fall through to static serving.
- Given unsupported media/encoding, oversize body/response, malformed/encoded traversal ID, stale generation, default removal, settings conflict/failure or busy/timeouts, return bounded safe JSON and preserve prior state as specified.
- Given library failure, existing server/static/SSE behavior stays available; library IDs/titles/paths/content/settings/tokens never enter activity projections or logs. Preserve no-CORS, no-store, nosniff and existing CSP.
- Real loopback tests use temporary synthetic sources/settings and ephemeral ports, never a running user server; assert exact schemas and rejection before filesystem access, not only response codes.
- Provide programmatic injection for activity journals, default Library root and settings location without changing production defaults or adding browser-controlled path overrides. Own the future `tests/helpers/library-preview.mjs` harness specified in requirements §8 so subsequent UI/release tickets can launch isolated acceptance previews.

## Files (expected)
- `server.mjs`
- `tests/server.test.mjs`
- `tests/library-api.test.mjs`
- `tests/helpers/library-preview.mjs` (future isolated manual-preview harness)

## Verify (exact command, run from repo root)
```powershell
node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs
```
`tests/library-api.test.mjs` is a future file; this command has not been run for this plan. Source tests come from merged 01; server tests are existing regression targets to confirm at execution.

## DoD
- [x] API: requirements §9 API proof passes at the implementation commit, with real local HTTP authorization/error tests and unchanged SSE privacy.

## Run independently
Start only after 01 is merged. Use its shipped interface and this ticket's own HTTP fixtures; no renderer, browser dialog, future tests or unmerged branch is required.

## Out of scope
- Markdown parsing/rendering, browser dialog, and activity write endpoints.

## Evidence (filled by Lead)
**Current in-place attempt · 2026-10-19 · HEAD `10074c8` on user-owned `main`; no commit/branch.**

- Implemented lazy Library source injection (`libraryRoot`, `librarySettingsPath`, `librarySourceFactory`) so ordinary activity startup and bootstrap do not start the native helper or scan files. Added same-origin Fetch Metadata/Host/Origin/token gates; exact-Origin mutation checks before source construction; JSON duplicate-key/unknown-field/body-size/media validation; bounded safe response/error mapping; loopback-only protected routes with no static fallback; source close on stop. Activity/SSE projections and static allowlists were left unchanged.
- Added synthetic ephemeral-loopback tests for authorization before source construction, non-discovering bootstrap, root/category registration, list/detail/refresh/unregister, generation invalidation, duplicate/default errors, malformed/duplicate/unknown/oversized bodies, media encodings, forged Host/Origin, and oversized responses.
- Exact ticket command `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` — exit **0**, **30 passed / 0 failed / 0 skipped** on Windows.
- Preview harness smoke: piped terminal `restart` to `node tests/helpers/library-preview.mjs` — exit **0**; two ephemeral IPv4 loopback URLs were printed, paths remained under one disposable synthetic fixture, then stdin-close cleanup completed. No browser/manual UI check was performed.
- `node --check` on `server.mjs`, `tests/library-api.test.mjs`, and `tests/helpers/library-preview.mjs` — exit **0**; `git diff --check` — exit **0**.
- Fresh Reviewer initially returned **BLOCKED** because the complete scoped diff was not available, then identified missing mutation-body deadlines and a durable-registration/413 response mismatch. All findings were addressed; the final reviewer read the complete scoped diff bundle and accepted the API with no Blocking findings. See final acceptance below.
- One diagnostic typo briefly sent an unauthenticated `GET /api/library/bootstrap` to `127.0.0.1:43187` rather than the captured ephemeral test port; the only response received was generic 404, and no token/content was returned. It is unknown whether a user-owned service answered; no further request was made. All acceptance tests and preview smoke used explicit ephemeral ports and synthetic roots/settings/journals. No real home Copilot/journal/settings data was read.
- Delivery is in-place only, not merged, committed, pushed or published.

**Final API acceptance · 2026-10-19:** Follow-up fixes bound slow mutation body reads to 15 seconds (with bounded JSON timeout responses and connection closure), validate media/body/schema/revision before constructing the source, and test missing-Origin refresh/register/delete rejection before source construction. Registration and unregistration responses receive a bounded 256-byte envelope allowance over the 2 MiB source snapshot cap; a regression test verifies a serialized 2 MiB snapshot can be returned successfully after registration. Exact command `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` — exit **0**, 32 passed, 0 failed, 0 skipped. `git diff --check` and `node --check` on the server, API tests and preview harness — exit **0**. Fresh Reviewer read the complete scoped diff bundle and returned **OK-WITH-NOTES**, no Blocking findings; the DoD row is checked above. One earlier parallel run of the same suite transiently failed native source tests with helper/settings startup errors; the exact rerun passed. API ticket is accepted in-place, not merged or committed.

## Historical evidence — not current acceptance
Preserved from the earlier ticket; not proof at main `10074c8`:
> Synthetic HTTP tests cover every API and authorization/error boundary; existing activity routes, SSE shape, and metadata projection remain unchanged. Evidence: `node --test tests/server.test.mjs tests/library-api.test.mjs tests/library-source.test.mjs` (exit 0; 34 tests passed).
