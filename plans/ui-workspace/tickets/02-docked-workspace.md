---
id: "02"
title: "Integrate accessible docked modules and workspace editing"
owner: Lead
status: todo
depends_on: ["01"]
parallel: no
branch: feature/ui-workspace-02
dod: [TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Replace fixed feed/session/timeline placement with the scene-first docked workspace and reachable layout/profile controls.
## Acceptance
- Given normal mode, scene dragging still orbits and no panel moves; Edit layout exposes header handles.
- Given drag or Move to dock / earlier / later / named size controls, equivalent layouts are reachable by pointer and keyboard.
- Given hide/re-add/collapse/profile switch, collection, coverage, timeline and totals retain their documented lifetimes.
- Given source updates, module visibility is not overwritten by renderSessions.
- Given timeline enlargement then move/profile switch/close, one live timeline survives with correct placement and focus.
- Given all catalogue types, feed/sessions/timeline/totals/legend render current bounded data; profile CRUD and dirty-switch confirmation are reachable through a temporary Workspace opener.
- Given mobile width/zoom, the workspace drawer is scrollable and returning to desktop restores dock preferences.
- Add new browser modules to server STATIC_FILES; no CDN/new dependency.
## Files (expected)
- workspace-ui.mjs; main.js; index.html; style.css; session-stats-ui.mjs; server.mjs; README.md.
- tests\workspace-ui.test.mjs; tests\ui-contract.test.mjs; tests\server.test.mjs.
## Verify (exact command, run from repo root)
```powershell
node --test tests\workspace-ui.test.mjs tests\workspace-model.test.mjs tests\ui-contract.test.mjs tests\activity-client.test.mjs tests\server.test.mjs
```
Also perform synthetic-data browser checks from spec.md; DOM tests alone do not prove pointer capture, layout or focus in a real browser. Record exact synthetic harness command introduced by this ticket; do not open real journals.
## Out of scope
- Custom-view configuration editor (03), shared menu (04), appearance redesign (05), executable plugins.
## Evidence (filled by Lead)
command · exit code · last lines · synthetic-browser evidence · Reviewer verdict
