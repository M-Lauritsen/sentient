---
id: "01"
title: "Define module instances and browser-local workspace profiles"
owner: Lead
status: done
depends_on: []
parallel: yes
branch: main
dod: [TEST, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Provide a bounded, validated module registry and workspace-profile model without changing the visible UI.
## Acceptance
- Given no storage, defaults resolve deterministically to feed/active sessions/timeline.
- Given valid profiles, CRUD/select/reset round-trip validated layout and configuration only.
- Given malformed, unsupported, oversized or denied storage, preserve original data, expose an error and retain an explicitly unsaved in-memory recovery state.
- Given duplicate IDs, invalid types/filters, a second timeline or capacity overflow, reject the save without altering persisted data.
- Given save/select/reset, visual presets and observed data are neither read into profiles nor modified.
## Files (expected)
- New workspace-model.mjs and tests\workspace-model.test.mjs; naming may follow discovered shared helpers.
- plans\ui-workspace\workspace.md is the contract; do not add a parallel generic framework.
## Verify (exact command, run from repo root)
```powershell
node --test tests\workspace-model.test.mjs
```
Use the profile's single-file Node runner; the named test is created by this ticket. Include real JSON round-trips and synthetic denied/quota storage fixtures.
## Out of scope
- DOM integration, event collection, plugins, shared server persistence, imports/exports.
## Evidence (filled by Lead)
`node --test tests\workspace-model.test.mjs` · exit 0 · 9 tests passed · Reviewer verdict: OK (no Blocking, Should or Nit findings)
