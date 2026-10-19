# Copilot Library / Explore
Major: yes (filesystem/settings, new HTTP contracts, rendering and UI; five tickets).

## Gate A: PASS
- Purpose approved at checkpoint ①: overview agents, skills and instructions in a read-only library, defaulting to the current user's `.copilot`.
- Approved decisions: readable front matter above rendered Markdown; HUD-matched responsive Library dialog; root and explicit category-folder registrations.
- Approved acceptance: persist SENTIENT registrations only; manual refresh; no source editing/execution/watching, active-config claims, or activity/SSE mixing.
- Non-goals: arbitrary filesystem browsing, session journals, Copilot installation/configuration, implementation in this planning pass.
- Blast radius: isolated filesystem/settings and HTTP boundary, local renderer/assets, dialog integration and privacy documentation.
- Approved DoD rows: SOURCE, API, RENDER, UI, RELEASE, defined with verification in [requirements.md](requirements.md#9-acceptance-and-definition-of-done).
- Checkpoints ① and ② approved by the user on 2026-10-19, including all five tickets and technical defaults as the planning baseline. No implementation authorization is implied.

## Design note
- Contract: protected JSON bootstrap/list/ID-only detail/register/unregister/refresh under `/api/library`; bounded bodies, stable errors, no-store; see requirements §4.
- Data: versioned SENTIENT-owned additional registrations `{path,mode,category?}` plus revision; implicit default, process/generation-scoped opaque IDs.
- CMS/content model: none; source Markdown/front matter stays untouched and inert; unknown metadata retained, malformed metadata warned.
- UI: large native dialog; loading, empty, partial, error, stale, saving/conflict states; mixed-case readable content and accessible focus.
- Security: local-only same-origin reads/mutations; category-only traversal; Windows path/link/race/ACL protection; bounded parsing; no remote embeds or activity leakage.
- Rollback: remove/disable library integration and ignore settings; preserve scene/activity and all source folders; settings deletion requires explicit local action.

## Authorized implementation amendment · 2026-10-19
User explicitly approved native Windows helper design/build integration after the Node-only safety blocker; implementation of all five tickets is authorized, in place on the existing user-owned checkout. No branch/commit/push/deploy or claim of merged predecessors is authorized. Dependency gates mean verified in-place predecessor delivery for this session, recorded honestly.
Native choice: maintained x64 C# source, compiled by the already installed Windows .NET Framework 4.x compiler, no NuGet/download/global installation. `npm run build:library-helper` builds an ignored local executable; deployment must build/distribute the helper alongside the Node application, not source alone. Windows local fixed NTFS only until separately proven; unsupported/missing helper fails closed. Persistent private stdio worker, bounded frames/one outstanding operation/no port/no shell, IDs/deadline/process cleanup. NT root-relative opens with reparse refusal, pinned no-share-delete ancestor handles, opened identity/volume/final-name validation before reads, exclusive-to-writers file handles and link-count/change rechecks. Handle-relative protected settings creation, ACL verification, stable exclusive OS-handle lock, hash precondition and flushed temporary handle-relative rename. Native mechanism requires fresh Reviewer and actual Windows synthetic race/ACL/crash evidence; this amendment does not mark SOURCE complete or relax any acceptance.

## Authoritative specification and delivery
[requirements.md](requirements.md) defines contracts, journeys, proposed defaults, failure behavior and acceptance; it replaces the missing historical `specs/08-copilot-library.md` reference.
01 source/settings → 02 API → 03 renderer → 04 dialog → 05 documentation/regressions. Each ticket has one Lead owner, its own DoD and exact verification.
Dependencies mean merged predecessors, never unfinished work; each ticket must be runnable in a fresh branch/session with synthetic fixtures.
Independent document review: no Blocking findings; isolation-procedure note addressed in documents, not re-reviewed; see [review.md](review.md). Stop at planning; do not create tracker issues or implement.

## Facts, assumptions and deferrals
Current-checkout baseline supplied: main HEAD `10074c8`, initially clean; library runtime absent. Historical ticket evidence is not proof at this HEAD.
Inspected: Node >=22 ESM; only manifest dependency Three.js 0.160.0; explicit static allowlists; IPv4 loopback; `npm test`, `npm run check:publication`, `npm start`.
Root `AGENTS.md` and `docs/project-profile.md` are absent; commands derive from package/README. Templates read from the user's GSD skill references.
`plans/copilot-library` is ignored/untracked; documentation persistence/sharing needs explicit handling later, not a change to ignore rules now.
Numeric budgets, Windows settings location, link subset and API shapes were approved at checkpoint ② as reversible planning defaults, not proven implementation capabilities.
Safe metadata parsing belongs to 01; Markdown/sanitizer selection to 03. Windows handle/ACL feasibility must be demonstrated in 01 or reported blocked, never silently weakened.
No source/journal inspection, runtime/test implementation, commit, push or deploy is included. Future verification is not satisfied by these documents.
