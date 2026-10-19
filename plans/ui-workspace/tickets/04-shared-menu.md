---
id: "04"
title: "Replace top launch buttons with a shared lower-right menu"
owner: Lead
status: todo
depends_on: ["02"]
parallel: no
branch: feature/ui-workspace-04
dod: [TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW]
skill: "-"
prod: no
issue: ""
---
## Goal
Provide one accessible launcher for Library, Appearance, Workspace and Help without hiding source/coverage status.
## Acceptance
- Given pointer or keyboard, open/traverse/activate/dismiss the upward menu with correct focus and expanded state.
- Given an existing destination, focus it without duplicate initialization; Library retains its current read-only/error behaviour.
- Given the old temporary Workspace opener from 02, replace it rather than leaving competing navigation.
- Given Appearance not yet redesigned, route to its existing controller; 06 verifies the final drawer integration.
- Given narrow viewport/zoom, branding/menu/docks do not cover each other's essential controls.
- Given Library errors or disconnected source, menu/workspace/activity remain independently usable.
## Files (expected)
- navigation-ui.mjs; index.html; style.css; main.js; bootstrap.mjs or copilot-library-ui.mjs only as existing initialization requires; server.mjs; README.md.
- tests\navigation-ui.test.mjs; tests\ui-contract.test.mjs; tests\copilot-library-ui.test.mjs; tests\server.test.mjs.
## Verify (exact command, run from repo root)
```powershell
node --test tests\navigation-ui.test.mjs tests\ui-contract.test.mjs tests\copilot-library-ui.test.mjs tests\server.test.mjs
```
Use ticket 02's synthetic browser harness to prove real focus/keyboard and viewport behaviour.
## Out of scope
- Command palette, new Library capabilities, plugins, server controls.
## Evidence (filled by Lead)
command · exit code · last lines · synthetic-browser evidence · Reviewer verdict
