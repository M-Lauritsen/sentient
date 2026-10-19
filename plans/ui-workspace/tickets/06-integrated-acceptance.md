---
id: "06"
title: "Verify the combined workspace and document its behaviour"
owner: Lead
status: todo
depends_on: ["03", "04", "05"]
parallel: no
branch: feature/ui-workspace-06
dod: [SPEC, TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Prove the three UI changes work together without altering observation, privacy or visual configuration contracts.
## Acceptance
- Given Menu -> Appearance -> Library -> close, preview, focus, source subscription and workspace placement remain correct.
- Given drawer open, right dock is temporarily displaced/covered accessibly; close restores it and no profile placement is silently saved.
- Given a dirty workspace/profile switch, Save/Discard/Cancel is correct; denied storage never appears saved.
- Given hidden/removed modules, coverage gaps and reconnect, counts/history retain existing bounded and no-backfill semantics.
- Given real pointer/keyboard actions at specified viewports and zoom, no scene-drag conflict, inaccessible offscreen control or focus loss occurs.
- Given profile/default recovery and UI rollback, visual presets and Library registrations stay intact.
- README covers local preference scope, controls, no-data-persistence, reset/recovery and intentionally deferred plugins.
- Classify historical baseline failures using fresh evidence; no new regression is accepted as pre-existing without proof.
## Files (expected)
- Existing UI integration modules only for tightly coupled integration fixes; README.md.
- tests\workspace-ui.test.mjs; tests\navigation-ui.test.mjs; tests\ui-contract.test.mjs; synthetic harness from 02.
## Verify (exact command, run from repo root)
```powershell
npm test
npm run check:publication
```
Run both independently and record each exit. Publication may flag ignored plans; document it without deleting plans or weakening the scanner. Run the established synthetic harness and record exact command plus evidence for each UI/A11Y row. Do not use a production-journal screenshot.
## Out of scope
- Executable plugins, unrelated baseline fixes, deployment, automatic commits/PRs.
## Evidence (filled by Lead)
command · exit code · last lines · synthetic-browser matrix · Reviewer verdict
