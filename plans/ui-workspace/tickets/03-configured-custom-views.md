---
id: "03"
title: "Add configured custom module views"
owner: Lead
status: todo
depends_on: ["02"]
parallel: no
branch: feature/ui-workspace-03
dod: [TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Let users create and configure named module instances from the built-in catalogue.
## Acceptance
- Given Add module, choose type/name/options and add to a chosen dock with validated defaults.
- Given two feed instances with different category filters, each projects the same accepted bounded feed independently without duplicate collection/storage.
- Given session state or selected-category filters, only existing safe fields are used; empty matches and unknown coverage stay distinct.
- Given configure/remove/re-add/reload, profile preferences persist but observed events/totals/history never persist.
- Given arbitrary strings, script-like names, unknown properties or unsupported per-session timeline filters, render names as text and reject unsupported configuration explicitly.
- Given a second timeline request, explain its singleton limit without corrupting the profile.
## Files (expected)
- workspace-ui.mjs; workspace-model.mjs; activity-client.mjs only if needed to expose the shared bounded feed model; main.js; session-stats-ui.mjs; README.md.
- tests\workspace-ui.test.mjs; tests\workspace-model.test.mjs; tests\activity-client.test.mjs.
## Verify (exact command, run from repo root)
```powershell
node --test tests\workspace-model.test.mjs tests\workspace-ui.test.mjs tests\activity-client.test.mjs tests\ui-contract.test.mjs
```
Use synthetic accepted arrivals, clocks and coverage gaps; browser-check add/configure/remove and non-drag movement using ticket 02's harness.
## Out of scope
- Script execution, arbitrary HTML/data queries, Library content, new raw-data APIs, session-attributed timeline.
## Evidence (filled by Lead)
command · exit code · last lines · synthetic-browser evidence · Reviewer verdict
