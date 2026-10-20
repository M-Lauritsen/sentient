---
id: "01"
title: "Make the browser app installable and validate installed-app activation"
owner: Lead
status: todo
depends_on: []
parallel: yes
branch: feature/pwa-desktop-01
dod: [TEST, BROWSER, SECURITY, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Make SENTIENT installable as a true Edge/Chrome PWA and establish an evidenced browser-activation contract before launcher implementation.

## Acceptance
- Given the fixed IPv4 loopback origin, when the manifest and icons are fetched, then the browser receives a valid manifest with stable id/start_url/scope `/`, `SENTIENT OS`/`SENTIENT`, `standalone`, and genuine local 192/512 PNG icons.
- Given current `STATIC_FILES`/CSP/privacy guards, when new assets are requested, then explicit MIME mappings serve only allowlisted files and existing Host/origin/traversal/no-store protections remain intact.
- Given normal `npm start`, when either supported browser installs through its actual UI, then it creates a browser-managed installed app; promotion remains browser-controlled, with no guarantee an install icon is always shown.
- Given first-time setup, then document manual server start, explicit browser/profile installation and any I1 activation settings; the user must stop that independent server before later using the launcher.
- Given I1 in `../decisions.md`, when its one-working-day budget completes, then record real Windows Edge AND Chrome evidence for installed-app activation/profile selection, browser closed/running, and path quoting. Record explicit failure if unsupported, not an assumed universal `--app`/app-ID switch.
- Given an unsupported activation strategy, when I1 cannot pass, then leave 02 blocked and report the bounded limitation/options; manifest-only checks cannot approve launcher implementation.
- Given optional Library assets are absent, when installability tests run with synthetic activity fixtures, then installability must not require generating/replacing Library build output.

## Contract / prerequisite output
- Adopt decisions D8–D11 without reopening the approved PWA/launcher/runtime choices.
- I1 output establishes minimal browser/profile activation configuration, validation rules and setup/discovery; no arbitrary shell-command configuration, credentials, fabricated app IDs or silent profile substitution.
- Browser-process exit does not prove app closure. A plain app-mode URL window is not evidence of launching the installed PWA.
- No service worker, registration, offline shell, Cache API, activity/Library persistence, external icons/CDN or new packaging dependency.

## Files (expected)
- `index.html` — manifest link and minimal app metadata only.
- `manifest.webmanifest`, `icons/pwa-192.png`, `icons/pwa-512.png` — proposed new assets.
- `server.mjs` — only explicit PWA asset/MIME mapping changes.
- `tests/pwa-installability.test.mjs` — new node:test synthetic HTTP/manifest/icon tests.
- `tests/server.test.mjs`, `tests/ui-contract.test.mjs` — focused regressions if needed.
- `plans/pwa-desktop/decisions.md` — I1 evidence and selected bounded activation contract, no secrets.
- `README.md` — minimal installation guidance if necessary for this independent deliverable; final launcher guidance belongs to 03.

## Tests and synthetic fixtures
- New installability tests create temporary empty activity directories, use `createSentientServer({port:0,...})`, and clean up all servers/temp files.
- Assert manifest link/values/MIME, icon PNG signatures and decoded dimensions, valid same-origin URLs and no credentials/query tokens.
- Verify canonical production origin remains 127.0.0.1:43187; port 0 is test-only.
- Exercise wrong Host/cross-origin, denied traversal/symlink assets, HEAD behavior, existing no-store/CSP and absent unknown files; do not add wildcard routes.
- Assert no service-worker registration or activity/Library cache integration is introduced.
- Check actual browser fetch/install separately: static/DOM assertions do not prove Chromium installation.

## Verify (exact command, run from repo root)
```powershell
node --test tests/pwa-installability.test.mjs tests/server.test.mjs tests/ui-contract.test.mjs
npm test
```
These use the project profile's node:test command pattern; the new named test file must be delivered by this ticket. Do not execute optional builds as install hooks.

## Manual evidence (required, separate from automated output)
1. In stable Windows Edge and Chrome, record versions/policy/profile setup and install through browser UI at the canonical origin. Confirm name/icon/standalone launch and real local icon requests.
2. Execute I1 within one working day: validate explicit installed-app activation with browser closed/already running and a path containing spaces, missing browser/profile/install errors, and secret-free argument handling.
3. With the server stopped, invoke the browser-created shortcut: document that it cannot start Node and may display a browser-owned unavailable page.
4. Confirm network traffic stays local; installation adds no service worker/cache for activity or Library. Use synthetic journals only.

## DoD rows
| Row | This ticket's completion requirement |
| --- | --- |
| TEST | Scoped and full commands recorded at implementation HEAD; classify pre-existing failures with current evidence. |
| BROWSER | Actual Edge + Chrome installation and I1 activation evidence; I1 pass required before 02 starts. |
| SECURITY | Explicit allowlist/CSP/loopback/privacy retained; no external fetch or sensitive cache. |
| REVIEW | Fresh review verdict recorded after fixes. |
| BUILD / LINT / TYPECHECK | N/A: repository lacks applicable general scripts; no new build pipeline. |

## Out of scope
- Launcher/server lifecycle implementation, native windows, offline functionality, broad UI redesign, Library builds, publication/ignore changes.
- Branch is suggested metadata, not permission to manipulate the existing dirty user worktree.

## Evidence (filled by Lead)
- Automated command · exit code · last lines · implementation HEAD: pending
- Manual Edge/Chrome versions · setup · observed results · I1 verdict: pending
- Reviewer verdict: pending
