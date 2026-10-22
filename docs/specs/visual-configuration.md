# Visual configuration: safe tuning, presets and live preview

**Status:** Approved, implemented and verified; evidence and limitations are in section 9.

**Audience:** Developers familiar with SENTIENT OS.

## 1. Goal and authorization

Make the existing 3D visual settings easier to experiment with, validate and
reuse, without changing the meaning or collection of observed activity.

This document combines five improvements into three sequential, independently
verifiable slices. Implementation was authorized after the user confirmed the
decisions in section 4 and approved the exact preset values in section 7.

The requirements below describe the delivered behavior and its acceptance
criteria.

## 2. Current implementation

The following behavior is present in the current workspace:

- `visual-settings.mjs` exports complete defaults, a selected preset, file
  overrides and a resolved effective configuration.
- `visual-config.mjs` owns setting metadata, validation, preset resolution and
  startup error handling. Invalid startup configuration prevents scene startup.
- The HUD's Visual settings dialog previews all in-scope settings and the
  `balanced`, `subtle`, `intense`, `aurora`, `ember` and `monochrome` presets
  without reloading the document.
- Export downloads a complete, loadable `visual-settings.mjs`; it does not write
  the repository file. Manual reload and opt-in five-second polling use a
  short-lived same-origin module worker.
- `activity-client.mjs` no longer imports visual settings, keeping server-side
  activity projection independent of browser configuration parsing.
- Preview and file reload preserve page-local activity totals, timeline history
  and session/subagent state. A full document refresh still resets page memory.
- `server.mjs` explicitly allowlists browser assets, sets `no-store`, serves on
  IPv4 loopback and provides activity through `/events`.
- Geometry, fixed buffer capacities, category palette and HUD/CSS ownership
  remain separate from visual tuning.
- Topology algorithms, motion and presentation rules live in individual
  `network-topology-design` modules with an explicit registry. `scene\network.mjs`
  owns shared graph construction, geometry allocation and moving-edge updates.
  `scene\network-renderer.mjs` installs replacements, with explicit pulse reset
  and delegated-anchor remapping wired in `main.js`.
- `scene\appearance.mjs` validates and prepares candidate resources before
  mutation, then delegates uniforms/materials/speed remapping to the owners in
  `scene\`. The active settings object retains its identity. Structural
  capacities live in `scene\structural-config.mjs`, not visual tuning.
- `activity-presentation.mjs` maps accepted activity and scene-only demos to
  effects; `hud-ui.mjs` owns source status, timeline drawing and observed counters
  while reusing the existing activity, workspace and statistics models.

Source references: `visual-settings.mjs`, `main.js`,
`scene\network.mjs`, `scene\appearance.mjs`, `scene\structural-config.mjs`,
`activity-presentation.mjs`, `hud-ui.mjs`, `network-topology-design\index.mjs`,
`activity-client.mjs`, `server.mjs`, `tests/visual-settings.test.mjs`,
and README sections "Editing visual settings" and "Privacy and limitations".

## 3. Scope and protected behavior

### Included

- Validate configuration structure, individual values and related values.
- Independently enable or disable selected decorative effects.
- Select named presets with explicit user overrides.
- Preview supported configuration changes without reloading the page.
- Export a reusable configuration.
- Optionally detect and apply externally saved configuration changes.

### Excluded

- Editing placement algorithms, geometry dimensions or buffer limits in this
  original scope. The later added topology selector with flat triangular wave mesh and twisting DNA helix
  without raising node capacities.
- Moving the category palette or general HUD/CSS styling into visual settings.
- Changing journal reading, event categorization, counts, session status,
  coverage rules, completion eligibility or hidden-tab discard.
- Replaying activity, generating demo events or attributing aggregate events to
  individual sessions.
- Server-side file writes, browser filesystem permissions, cloud storage,
  telemetry, CDN assets, new network exposure or deployment work.
- A general-purpose theme editor, plugin framework or configuration language.

### Invariants

- The initial resolved configuration preserves the current appearance.
- Configuration and export contain visual settings only, never activity
  metadata, session handles, paths, prompts or tool results.
- Reduced-motion behavior cannot be overridden by presets or controls.
- Disabling an effect changes only rendering, not feed/timeline/statistics.
- Applying appearance changes preserves the activity connection, accumulated
  page totals, timeline history, session state and observed subagent identities.
- Each accepted change applies as a complete configuration. No partially
  updated scene is presented as successfully configured.

## 4. Confirmed decisions

| ID | Decision | Confirmed behavior |
| --- | --- | --- |
| D1 | Saved source of truth | Keep `visual-settings.mjs` authoritative. UI changes are temporary until explicitly exported and manually saved. No localStorage or automatic file writes. |
| D2 | Automatic file hot reload | Automatic reload is opt-in and off by default; it checks every five seconds while the page is visible. Always provide manual "Reload from file". |
| D3 | Preview coverage | All in-scope visual settings can be edited. Settings requiring regeneration rebuild only their affected visual resources, not the full scene or activity state. |
| D4 | Presets | Ship `balanced`, `subtle`, `intense`, `aurora`, `ember` and `monochrome`; `balanced` matches the maintained file configuration. |
| D5 | File reload versus unsaved preview | Never silently overwrite a dirty preview. Offer explicit "Use file" or "Keep preview" actions. Keeping preview suppresses repeated prompts/application for that file version; a later file change prompts again. |
| D6 | Invalid startup configuration | Show an actionable configuration error and do not start the 3D scene with a silent substitute. A failed later update preserves the last valid configuration. |

All six decisions were confirmed before implementation. The five-second polling
interval and ten-second per-reload timeout are implementation details.

## 5. Configuration model

### Single effective configuration

Proposed resolution order, from lowest to highest precedence:

1. Maintained complete defaults.
2. Explicit file overrides.
3. Selected preset's explicit overrides.
4. Temporary preview overrides.

Presets override file values only for paths they define; all other file tuning
remains in effect. Preset definitions must not duplicate the full defaults.
Objects merge only through known setting paths; arrays replace whole values
rather than merging individual indices. Unknown keys are rejected, including
keys that could alter object prototypes. Resolution must not mutate defaults or
preset definitions.

The implementation should maintain one setting definition per configurable
path for type, constraints, label, unit and suitable editor. Reuse that metadata
for validation and controls rather than maintaining divergent copies.
Suggested slider ranges are not automatically hard validation bounds.

Preserve existing setting paths where practical. Any change to the exported
configuration format must include an explicit update path for the current
file; never silently discard existing user tuning.

### Validation

Validate every existing configurable field, not just newly added controls:

- Required groups/keys, supported types and unknown keys.
- Finite numeric values; integer requirements for counts and hops.
- Signed values where supported, including positions and rotation direction.
- Three-component vectors and linear RGB arrays with the appropriate constraints.
- Valid integer sRGB hex colors and booleans.
- Positive durations, shader exponents, grid spacings and load divisors.
- Nonnegative rates, sizes, decay and intensity; supported zero-as-off behavior.
- Bounded probabilities, opacities and fractions.
- Cross-field constraints, including camera zoom ordering, noncoincident camera
  position/target, waiting color-blend total, twinkle amplitude versus baseline,
  and impact duration/hop/spread ordering.
- Limits required by the actual renderer or storage representation, without
  mistaking documented tuning suggestions for mandatory limits.

Report all detected errors with setting paths and concise explanations. Do not
clamp values or substitute defaults silently. Distinguish JavaScript load/syntax
errors from value-validation errors, and show both as explicit failures.

## 6. Slice 1: Safe configuration and effect toggles

**Dependency:** None. Provides the common validation and resolution foundation.

Add explicitly named switches for these effects, all enabled initially:

| Effect | Disabled behavior |
| --- | --- |
| Dust | Hide decorative dust; retain all activity visuals. |
| Floor | Hide the grid and its ambient light pool. |
| Lattice breathing | Keep the lattice at its unmodulated scale. |
| Waiting glow | Remove the waiting color/opacity modulation; retain baseline core glow and the waiting HUD. |
| Waiting markers | Hide waiting marker sprites; retain the waiting HUD. |
| Subagent transitions | Display current branches without growth, flashes or retirement fades; retain current delegated-work visibility. |

Do not use a general "disable activity" switch. Existing zero-rate support for
the running stream remains supported.

### Acceptance criteria

- **S1-AC1:** The current configuration resolves successfully and keeps its
  existing values and visual defaults; all new effect switches default on.
- **S1-AC2:** Representative malformed values from every validation family are
  rejected with their exact setting paths. Related-value errors identify the
  fields involved. No invalid candidate becomes active.
- **S1-AC3:** Each switch suppresses exactly its intended effect. A contrasting
  enabled case proves the effect is not simply missing.
- **S1-AC4:** Synthetic activity produces unchanged feed, timeline and statistics
  with effects on or off. Reduced-motion safeguards remain effective.
- **S1-AC5:** A malformed initial file produces an actionable visible error;
  shared server imports must not prevent the page from displaying that error.

## 7. Slice 2: Presets and overrides

**Dependency:** Slice 1's resolution and validation.

Provide `balanced`, `subtle`, `intense`, `aurora`, `ember` and `monochrome`
presets using the existing setting groups and effect switches. Preset names
describe appearance, not activity volume, session health or success.

- `balanced`: Current defaults, with no preset overrides.
- `subtle`: Lower decorative brightness/motion and running-stream density.
- `intense`: Higher visible activity emphasis without increasing fixed pool
  capacities, creating fabricated activity or adding global flashes/shake.
- `aurora`: Teal/cyan colors with a dark green-blue backdrop and brighter glow.
- `ember`: Warm red/orange colors with stronger glow and no floor grid.
- `monochrome`: Muted grayscale base scene, reduced glow, and no dust or floor;
  activity-category colors remain visible.

Approved `subtle` overrides: `running.pulsesPerSecondPerSession=2`,
`running.baseHops=1`, `nodes.idleBrightness=0.25`,
`nodes.activeBrightness=1.4`, `pulses.headBrightness=1.2`,
`scene.categoryBrightness=0.7`, `scene.breathAmplitude=0.006`,
`scene.bloomStrength=0.55`, `scene.bloomLoad=0.2`,
`scene.dustBrightness=0.1`, `scene.floorBrightness=0.12`,
`scene.floorGlow=0.3`.

Approved `intense` overrides: `running.pulsesPerSecondPerSession=10`,
`nodes.activeBrightness=2.4`, `nodes.activeGrowth=2.5`,
`pulses.headBrightness=2.2`, `activity.maxIntensity=10`,
`scene.categoryBrightness=1.2`, `scene.bloomStrength=1.1`,
`scene.bloomLoad=0.42`, `scene.coreLoad=0.17`,
`scene.floorGlow=0.7`, `scene.dustBrightness=0.24`.

Neither preset changes capacities, geometry, palette, activity counts, global
flashes or camera effects. Do not scale every numeric field: camera coordinates,
durations, colors and probability fields have different meanings.

### Acceptance criteria

- **S2-AC1:** `balanced` resolves to the same effective settings as slice 1's
  initial configuration.
- **S2-AC2:** Every preset resolves to a valid complete configuration.
- **S2-AC3:** Preset values win over file values on paths they define; temporary
  overrides win over both. Array replacement and unknown-preset rejection are
  deterministic.
- **S2-AC4:** Switching presets does not mutate preset/default definitions or
  alter any activity state or category palette.
- **S2-AC5:** `subtle` and `intense` are visibly distinguishable using synthetic
  activity, with the same input counts and bounded renderer resources.

## 8. Slice 3: Live preview, export and file reload

**Dependency:** Slices 1 and 2.

### Controls

The HUD's Visual settings entry opens a keyboard-accessible native dialog.
Controls are grouped by the existing configuration sections:

- Numeric fields, with sliders only where a meaningful bounded range exists.
- Checkboxes for booleans, vector/color editors where appropriate, and preset
  selection.
- Units, brief help and setting-specific errors.
- Apply valid edits to the preview without a full page reload. Batch rapid edits
  to avoid repeated expensive regeneration.
- Provide "Reset preview" to return to the last accepted file configuration,
  "Reload from file" and "Export configuration".

Partially entered or invalid values must not affect the active scene. Editing
one control must not reset camera orbit/zoom unless that camera property is
explicitly changed or a preset/reset changes it.

### Applying settings

Classify setting application by actual consumers:

- Uniform/material changes: update the existing resources.
- Frame-read settings: update the shared effective configuration.
- Initialization-only appearance, such as node size distributions or glow
  texture stops: regenerate only the affected attribute/texture.

Prepare affected resources before committing a configuration; keep the last
valid scene on failure and dispose abandoned/replaced GPU resources.
Changing animation rates must not replay events or create a catch-up pulse
storm. Disabled transient effects must not replay suppressed transitions when
re-enabled.

### Export

Export downloads a loadable `visual-settings.mjs` containing the complete
defaults and current effective appearance as overrides on the `balanced`
preset. This snapshot preserves the exact current preview after reload; it
does not preserve the selected preset's label. It uses the same resolver and is
tested by importing the downloaded module format.

The export must reproduce the active valid appearance after manual save and
refresh, without depending on browser memory. Identify that export/download
does not itself save or overwrite the repository file.

### Reloading an externally edited file

Manual reload and optional automatic reload:

- Read only the designated `visual-settings.mjs` resource through a
  short-lived same-origin module worker.
- Validate a complete candidate before applying it.
- Preserve the last valid scene after syntax, fetch or validation failure and
  display an actionable error.
- Preserve connection, totals, timeline and session/subagent state.
- Handle unsaved preview conflicts according to D5.
- Poll every five seconds only when enabled and visible; allow one reload at a
  time, abort automatic work when hidden/disabled, and time out after ten
  seconds. Each worker is terminated after completion.
- Observe the existing explicit static allowlist, CSP and loopback restrictions.
  Never add an arbitrary-path reader, upload endpoint or file-write endpoint.

The worker imports only the existing repository-authored module. No `eval`,
cache-busting imports, arbitrary-path reader, upload endpoint or file-write
endpoint is used. Schema validation is not a sandbox for executing untrusted
modules.

### Acceptance criteria

- **S3-AC1:** Custom values reach the actual camera, shader uniforms, animation
  buffers and initialization-only appearance resources, not just form state.
- **S3-AC2:** Valid changes apply without a document reload, SSE reconnect,
  resetting page totals/timeline, or losing observed session/subagent state.
- **S3-AC3:** Invalid edits and failed file reloads leave the last valid scene
  intact with visible, field-specific errors where applicable.
- **S3-AC4:** Reset and file-reload conflict actions follow the approved ownership
  rules; no preview changes are silently persisted or overwritten.
- **S3-AC5:** Exporting, manually saving and refreshing reproduces the same
  effective configuration, including booleans, colors, vectors and overrides.
  Export contains configuration only.
- **S3-AC6:** Keyboard access, visible focus, labels, error associations, Escape
  behavior and focus restoration work; reduced motion still takes precedence.
- **S3-AC7:** Repeated edits/reloads do not accumulate textures, materials,
  listeners, timers or module instances. Hidden-tab return creates no backfill.
- **S3-AC8:** Tests demonstrate changed file configurations, opt-in/off behavior,
  invalid-file recovery and dirty-preview conflicts.

## 9. Verification approach

Use the existing Node test runner and browser runtime:

- Extend configuration/scene tests with valid and invalid inputs, precedence,
  switches, custom uniforms/buffers and export round trips.
- UI behavior tests cover valid/invalid edits, reset, reload conflict choices,
  invalid-file recovery, opt-in/visible-only automatic reload and dialog
  cancel-event/focus restoration.
- Synthetic HTTP tests verify the new assets remain explicitly allowlisted,
  `no-store`, and within the existing loopback/CSP boundary.
- Browser runtime checks returned HTTP 200 and rendered a 1280×720 scene canvas.
  Live edits, invalid-value rejection, reset, manual worker reload, export,
  cancel-event closure, focus restoration and activity continuity were
  observed. Instrumented preview/reset disposed both replaced glow textures;
  three manual reloads each terminated their worker. The browser harness did
  not provide a physical Escape keypress. VM extraction and shader-string
  assertions alone are not proof of successful WebGL rendering.
- `npm test` passed: 163 tests, 0 failures. `node --check` passed for
  `visual-config.mjs`, `visual-settings-ui.mjs`, `visual-settings-worker.mjs`
  and `main.js`; `git diff --check` passed.
- In-browser manual reload observed an unchanged configuration; changed-file
  and conflict transitions are covered by focused UI behavior tests using
  candidate file configurations. An actual external filesystem edit was not
  performed in the browser session.
- `npm run check:publication` passed with 0 findings; the tool notes that manual
  review is still required for publication.

## 10. Delivery and rollback

The three slices are implemented. No dependencies were added. No migrations,
deployment, commit or push are authorized by this spec.

Keep each slice separately reversible. Preserve the current tuned values so
the configuration can return to the balanced appearance without losing user
work. No migrations, deployment, commit or push are authorized by this spec.

The file remains the source of truth. To roll back a preview, use **Reset
preview**; to restore an earlier persistent configuration, restore the desired
`visual-settings.mjs` source and use **Reload from file** or refresh the page.
