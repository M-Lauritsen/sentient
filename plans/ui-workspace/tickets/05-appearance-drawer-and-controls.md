---
id: "05"
title: "Reorganize visual tuning into an Appearance drawer"
owner: Lead
status: todo
depends_on: []
parallel: yes
branch: feature/ui-workspace-05
dod: [TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Expose quick controls and complete searchable advanced tuning in a nonmodal drawer with understandable labels and precise inputs.
## Acceptance
- Given existing definitions, all 166 paths remain reachable with shared canonical draft state and no schema/precision loss.
- Given a valid out-of-slider-range file/preset value, it survives navigation, preview, save and export without clamping.
- Given slider/numeric/paired range/direction edits, preserve original constraints and mapping; invalid drafts never partially apply.
- Given repeated node-count draft changes, no topology rebuild occurs until commit, then at most one final rebuild occurs.
- Given preset/reset/export/reload/conflict/storage failures, preserve existing outcomes, explicit errors and last-valid-scene behaviour.
- Given opening/closing, retain preview and allow keyboard access outside the nonmodal drawer; no scene-dimming backdrop.
- Given existing file preview, direct opener remains supported until 04/06 integrate the shared menu.
## Files (expected)
- visual-settings-ui.mjs; visual-config.mjs presentation metadata only; index.html; style.css; main.js; README.md.
- tests\visual-settings.test.mjs; tests\ui-contract.test.mjs; tests\activity-colors.test.mjs.
## Verify (exact command, run from repo root)
```powershell
node --test tests\visual-settings.test.mjs tests\ui-contract.test.mjs tests\activity-colors.test.mjs
```
Browser-check with a synthetic-input harness owned by this ticket; use or extend an existing synthetic fixture server if suitable. Record its exact invocation; do not depend on 02 landing first. Assert committed rebuild counts and exact exported settings, not just presence of sliders.
## Out of scope
- New persistence, category palette editing, activity changes, master-multiplier macros, geometry/capacity controls.
## Evidence (filled by Lead)
command · exit code · last lines · synthetic-browser evidence · Reviewer verdict
