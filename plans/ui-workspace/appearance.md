# Appearance settings redesign

## Purpose and preserved contract
Make routine tuning understandable while retaining all 166 current settings, exact file paths/formats and existing validation. Do not remove advanced controls or redefine activity semantics.

## Container and information architecture
- Replace the large blocking visual modal with a nonmodal right-side drawer, sized to leave the scene visible on desktop. At narrow widths it may fill the viewport, with an explicit return-to-scene action.
- Drawer temporarily overlays or displaces the right dock without persisting a layout change. Closing restores that dock; workspace editing is unavailable while Appearance is open.
- Opening focuses the drawer heading; Tab may leave it. Escape closes only when no nested popup/modal is handling Escape. No backdrop dims the scene.
- Top area contains built-in/personal preset selection, clear unsaved-preview status and save/update actions.
- Quick controls: node count, node size, active-node brightness, pulse speed, glow strength, automatic rotation/speed, connecting-line visibility and dust/floor switches.
- Detailed sections: Camera; Network (nodes/connections); Motion (pulses/running stream); Event effects (activity/completion/impact/subagents/waiting); Atmosphere (dust/floor/glow).
- Advanced exposes all existing paths, searchable by friendly label, help text and original configuration path. Search opens matching sections and announces result count; no matches offers Clear search.
- Every setting has one canonical field definition and draft value shared by Quick and Advanced; duplicate projections never diverge or cause double application.
- File reload, automatic reload and export move into a clearly labelled File actions section. Personal-preset save does not imply source-file save.

## Control presentation
| Existing setting(s) | Presentation |
| --- | --- |
| nodes.activeGrowth | Size increase during activity |
| nodes.decay | Excitation fade rate; higher means faster |
| pulses.speedMin + pulses.speedRange | Pulse speed minimum/maximum |
| camera.autoRotate + camera.autoRotateSpeed | Automatic rotation switch, speed magnitude and direction |
| effects.dust + dust.* | Dust enable switch beside its controls |
| effects.floor + floor.* | Floor enable switch beside its controls |
| scene.bloomStrength | Glow strength; technical help identifies bloom |
| Camera position/target | Named X/Y/Z numeric fields in advanced |

- Use slider + exact numeric input for finite bounded controls; show units, useful step, current value and reset.
- Keep hard validity constraints separate from suggested slider domains. Suggested ranges are not new validation clamps.
- Valid numbers outside a suggested slider range remain unchanged and visible in the numeric field, with an out-of-slider-range hint; never feed them through a range input as the authoritative value.
- Preserve exclusive bounds and cross-field rules. Integer fields use integer steps; exact numeric entry preserves finer valid precision where permitted.
- Speed maximum maps to speedMin + speedRange; editing minimum keeps displayed maximum fixed unless invalid, then shows an error without applying. Invalid/incomplete paired edits leave the last valid scene unchanged.
- Rotation direction maps the existing signed multiplier; zero is stopped, not an invented third direction value in exported configuration.
- Do not collapse independent brightness/size/energy parameters into an undocumented master multiplier. Optional future macro controls require their own explicit mapping.
- Disabling an effect visually groups its inactive controls and explains they are retained; values are not reset or lost.
- Colour pickers remain sRGB; linear arrays/hex exports and untouched precision stay unchanged. Activity-category colours remain owned by activity-colors.mjs, outside this redesign.
- Proposed slider steps/domains live as presentation metadata, not modifications to valid configuration values. Start from documented useful ranges, with precision checks and synthetic preview review.

## Preview, persistence and performance
- Ordinary valid edits preview live through existing frame batching. Invalid text stays visible with field errors and an accessible summary.
- Node-count numeric edits apply on Enter/blur; node-count slider applies on release or keyboard commit, not each movement/repeat. The draft value updates visibly without rebuilding until commit.
- One committed node-count edit causes at most one topology rebuild. Failed validation/rebuild keeps the previous network active and reports the error.
- Explain that node-count rebuild clears visual pulses but preserves connection, feed, timeline and totals.
- Reset field/group targets values from the last loaded file configuration and updates draft/preview consistently. Reset preview retains its existing whole-configuration meaning.
- Changing presets uses existing resolution and personal-preset semantics; do not introduce a new persistence layer for preview edits.
- Closing/reopening preserves the current in-page preview. File reload conflicts retain Use file / Keep preview and failure messages.
- Browser storage failure/corrupt preset handling remains explicit. Workspace profiles and visual presets are independent.

## Acceptance
| Scenario | Expected result |
| --- | --- |
| Enumerate Advanced controls | All 166 existing definition paths reachable exactly once as canonical settings; Quick references the same values |
| Search friendly name / technical path | Same setting found; current draft and error preserved |
| Slider or numeric edit | Synced display, correct units, validated scene value; no silent clamping |
| Valid out-of-slider-range preset/file | Exact value survives opening, searching, switching sections and export |
| Combined minimum/maximum or signed rotation | Round-trip to existing source representation; invalid combination cannot partially apply |
| Drag node count across many values | No rebuild until commit; one rebuild for the final committed value |
| Preset/save/reset/export/reload/conflict | Existing semantics and untouched colour precision retained |
| Empty search/error/reload failure | Clear status and recovery; last valid scene continues |
| Keyboard / 200% zoom / reduced motion | Every control reachable, labelled and usable; existing animation safeguards unchanged |

## Non-goals and rollback
No palette editor, geometry/capacity controls, framework migration, source writes, new visual schema, event replay or history persistence.
Rollback restores the existing modal and presentation; stored visual presets and configuration files remain compatible.
Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range
