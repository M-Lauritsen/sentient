# UI workspace redesign
status: approved-for-future-implementation
Major: yes (workspace, navigation and appearance; six delivery tickets).
Gate A: PASS (purpose + DoD approved in this conversation).
Issue: none | Lane: planned | Branch: user-owned checkout; no Git changes authorized.
Outcome: a scene-first, configurable workspace with discoverable navigation and approachable visual tuning.
Acceptance: all requirements in workspace.md, navigation.md and appearance.md; plugin-future.md remains design-only.
Blast radius: local browser UI and local preference storage; no deployment or Prod change.
Contract/schema/content-model impact: versioned browser-local workspace preferences; no activity/SSE/server API or visual-file schema changes.
Security review: yes for the future plugin trust boundary; current delivery requires privacy-focused independent review, not a plugin implementation.
Rollback: revert UI delivery changes; ignore the new workspace storage key; preserve visual presets and user source files.
Assumptions: friendly labels, bounded workspace capacity and breakpoint details are reversible design choices, not new data semantics.
DoD rows: SPEC, TEST, UI/A11Y, PRIVACY, COMPAT, REVIEW; BUILD/LINT/TYPECHECK/MIGRATION/PROD N/A for this scope.
SPEC: each requested area has states, acceptance, boundaries, rollback and runnable delivery tickets; future plugin decisions explicitly blocked.
TEST: targeted Node tests per ticket, then npm test at integration; current failures must be reproduced/classified before claiming regression freedom.
UI/A11Y: synthetic browser checks at 1440x900, 1024x768, 640x800 and 390x844; 200% zoom, keyboard, no-drag pointer alternatives, reduced motion and focus.
PRIVACY: no journals, IDs, paths, prompts, arguments, results or Library content in custom views/preferences; local-only asset serving.
COMPAT: preserve collection, coverage semantics, timeline/history, statistics, visual precision, presets, export and file-reload conflicts.
REVIEW: fresh Reviewer verdict; address Blocking findings before any implementation is called complete.
Planning completion: specifications and ticket approval only; no runtime validation claimed and no implementation authorized.
Approved decisions: docked modules with explicit Edit layout; configured custom views now; separate deferred plugin design; browser-local workspace profiles.
Proposed UI defaults: lower-right labelled Menu; nonmodal Appearance drawer; quick controls plus searchable advanced tuning.
Protected invariants: unknown is never zero/idle; hidden panels never stop observation; palette and structural capacity authorities remain unchanged.
Contract sketch: workspace v1 stores named profiles of validated module instances and dock/order/size/preferences, never observed data.
Module sketch: immutable definition registry plus instance preferences; collection owned outside views; instances subscribe/unsubscribe without owning source lifetime.
Data change: browser-only sentient-os.workspaces.v1, separate from sentient-os.visual-presets.v1; no server writes or migrations.
UI states: loading, empty, available, partial/unknown, disconnected, validation error, storage failure, dirty preview and reload conflict.
Dependencies: 01 -> 02 -> 03/04; 05 independent; 03/04/05 -> 06; shared-file edits serialized.
Future boundary: executable plugins, installation, external integrations and raw-data access are not part of delivery.
Sources: docs/project-profile.md; index.html; style.css; main.js; activity-client.mjs; session-stats-ui.mjs; visual-config.mjs; visual-settings-ui.mjs; README.md.
External references: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ ; https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
External references: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range ; https://gridstackjs.com/
Baseline caveat: profile records three test failures and publication failures involving ignored plans; these are historical, not a fresh run.
Delivery guard: no framework migration, new dependency, commit, push, issue or production-code edit authorized by this planning request.
Approval: checkpoints 1 and 2 complete; user explicitly deferred implementation; checkpoint 3 applies only to later implementation/PR review.
