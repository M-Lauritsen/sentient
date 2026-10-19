# Scene-first modular workspace

## Purpose and scope
Let users choose which information surrounds the lattice without making ordinary scene interaction a layout operation. Docked regions, not arbitrary floating windows or a full-screen dashboard, are the first release.

## Module catalogue and custom views
| Type | Default | Instance configuration |
| --- | --- | --- |
| Activity feed | Left dock | Category filter; compact/comfortable rows; optional legend |
| Active sessions | Right dock | All/running/waiting state filter; compact/comfortable rows |
| Timeline | Bottom dock | Compact/expanded dock size; aggregate data only |
| Activity totals | Available to add | Selected categories; compact/list presentation; since-page-load label |
| Legend | Available to add | Category names, glyphs and colours |

- A configured custom module is a named instance of a catalogue type, not JavaScript, HTML, a data query, or an external URL.
- Users can create multiple differently configured feed, sessions, totals or legend instances. Timeline is singleton in v1 because its live canvas is currently reparented for enlargement; a second instance is disabled with an explanation.
- Every instance has a stable local instance key, type, display name, dock, order, size and type-specific configuration. Instance keys are not session handles.
- Default filters include all supported categories/states. A filter never changes collection, the scene, other views, statistics or completion semantics.
- Empty filtered results say "No matching activity" or "No matching sessions"; unavailable/partial observation remains explicitly unknown, never an empty-results claim.
- Filters cannot request prompts, titles, paths, commands, results, raw session IDs, Library documents or per-session timeline attribution.
- The feed reuses one bounded in-memory accepted-feed model; filtered instances do not add independent event buffers. Existing feed retention/arrival grouping stays authoritative.
- Session statistics remain available from session rows; page totals can be their own module without changing their page-local counting scope.

## Layout interaction
- Normal mode has no draggable content. Headers expose collapse, configure, expand where supported, and Remove from workspace. Removal never deletes data or source files.
- Edit layout exposes header drag handles, valid dock targets and ordering indicators. Dragging uses headers only and cannot start OrbitControls.
- Pointer alternatives: choose Move to left/right/bottom and Move earlier/later from the module actions; resize using named Compact/Standard/Large choices. All actions also work by keyboard.
- Escape cancels an active drag; leaving Edit layout ends edit affordances. Moving/removing the focused module restores focus to its surviving header, neighbouring module or Workspace control.
- Dock order is explicit. No overlap with source/coverage, the menu or the page boundary; the centre remains reserved for the scene.
- Collapsing/hiding/removing presentation never stops subscriptions at the data-owner level, resets a timeline, clears totals or changes coverage.
- Module visibility preferences and source availability are separate state: renderSessions must not override a user's hidden/collapsed choice.
- The existing timeline enlargement uses the same timeline model/content, restores its current dock on close and restores focus. A layout switch closes enlargement before moving its instance.
- Each dock has internal overflow; panel growth cannot push essential controls offscreen. Interactive panel regions consume pointer input, empty scene regions continue to orbit/zoom.

## Responsive behaviour and profiles
- Wide screens show left/right docks and bottom timeline; narrow screens use a scrollable workspace drawer with the same module order and a button to return to the scene.
- The narrow-screen arrangement is a responsive projection, not a saved rewrite of the desktop docks. Resizing back restores desktop placement.
- Default scene-first layout is always recoverable through Reset layout. Reset affects the active layout only; deleting saved profiles requires explicit confirmation.
- Profiles support save as, select, update, rename and delete; default layout cannot be deleted. Switching with unsaved edits requires Save / Discard / Cancel.
- Persist browser-local layout/configuration only. Proposed storage contract: key sentient-os.workspaces.v1; envelope {version:1, activeProfileId, profiles}; each profile has id, name and instances.
- Proposed engineering bounds: 10 saved profiles, 12 instances per profile, names 1-48 trimmed characters without control characters, and a serialized payload limit of 64 KiB. Enforce before save and explain limits.
- Validate plain records, known types/docks/sizes/filter values, unique IDs, complete ordering and singleton limits. No eval, arbitrary property merging or HTML insertion.
- Missing storage uses defaults. Corrupt/unsupported data is preserved, an error is shown, and an explicitly temporary default workspace is offered; never silently overwrite it.
- Quota/denied storage preserves the in-memory layout, reports "Not saved", and allows retry. A successful save is never reported before storage succeeds.
- Browser data clearing removes profiles. No server synchronization, workspace file export/import, cross-tab conflict resolution or observed-data persistence in v1.

## States and acceptance
| State/action | Required result |
| --- | --- |
| First load | Default modules appear with connecting/loading states; no baseline replay |
| Empty with known coverage | Accurate empty state; counters retain their documented scopes |
| Partial/disconnected | Explicit coverage warning in every affected view and persistent source strip |
| Hide/re-add module | Current data appears without resetting the source, timeline or totals |
| Two filtered feed instances | Same accepted arrivals projected independently; no duplicate collection |
| Move/resize by drag or actions | Equivalent reachable layout; no camera movement or lost focus |
| Resize viewport / 200% zoom | Essential actions reachable, no inaccessible offscreen module |
| Reload saved workspace | Configuration restored, but activity/history/totals start with existing page-load semantics |
| Invalid stored profile | Original value retained; visible recovery path; no code/content interpreted |

## Implementation boundaries and rollback
Use small ES modules for registry/model/storage and workspace presentation; reuse activity projections and render helpers. No new layout dependency is needed for docked v1. Browser-loaded modules require explicit server allowlisting.
Undoing the UI integration restores fixed HUD placement; leave preference data untouched and ignore its key. Do not delete personal visual presets or Library registrations.
