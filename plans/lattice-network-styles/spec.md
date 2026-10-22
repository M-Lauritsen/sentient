# Lattice and network styles

**Status:** Organic topology, flat triangular Waves and twisting DNA are implemented. Waves follows
the supplied reference's planar structure and travelling motion.
Exact reference parity is not claimed.

**Audience:** Developers familiar with SENTIENT OS.

## 1. Goal and source

Offer a different network appearance in the existing visual settings while
preserving the current lattice as the default. This specification records the
resolved design and acceptance criteria for the organic graph explored in
[the spike](../spikes/lattice-network-styles.md). No specific visual-reference
image or identifier was supplied, so the implementation is a generic organic
style and does not claim exact reference parity.

This extends the existing visual-configuration scope with a root-level
topology selector. Implementation was explicitly authorized.

## 2. Verified current behavior

- `main.js` builds the default lattice with Fibonacci-sphere placement and
  supports an organic randomized distribution in the same spherical shell.
  Both derive nearest-neighbor edges and store endpoints, lengths, and
  per-node adjacency.
- Activity pulses travel those edges. Completion, impact, and other neighbor
  effects also use the adjacency graph.
- The root-level `topology` setting accepts `lattice`, `organic`, `waves` or `dna`; old
  configurations without this setting resolve to `lattice`.
- The Visual settings dialog stages node-count edits and rebuilds the network
  when that value is committed.
- A successful rebuild replaces and disposes the previous node and edge
  geometry. Old-graph pulses and node/edge excitation are cleared; observed
  activity totals, timeline history, pending observed activity, and
  session/subagent state are retained.
- `tests/visual-settings.test.mjs` covers valid graph endpoints, rebuild and
  disposal, preservation of activity state, and failure recovery.
- The current configuration accepts 2–4000 nodes. This is an existing node
  bound, not a performance guarantee for every proposed topology.

Sources: `main.js`, `visual-config.mjs`, `visual-settings-ui.mjs`, and
`tests/visual-settings.test.mjs`.

## 3. Scope and invariants

### Included

- Provide the current lattice and a graph-compatible organic point
  distribution as selectable topologies.
- Reuse the current node/edge activity rendering where the selected style
  provides a graph.
- Rebuild topology-dependent resources safely when a committed style changes.

### Excluded

- Changing activity collection, classification, counts, coverage, or status.
- Changing category colors, HUD/CSS styling, or unrelated visual settings.
- Replacing edge-based activity pulses with a new animation model in this work.
- A flowing point-field renderer without graph edges. The later flat Waves
  extension uses a regular triangular graph and preserves edge activity.
- Raising existing resource bounds or claiming a performance target without
  measurement.

### Invariants

- Omitting a topology setting from existing saved configurations resolves to
  the current lattice and preserves its current appearance.
- A topology choice changes only visual placement/connectivity/presentation. It does not
  create, discard, or reinterpret observed activity.
- Every graph-backed topology supplies valid node and edge data for the
  existing pulse, adjacency, and neighbor-effect consumers.
- Rebuilding constructs and validates candidate resources before replacing the
  active network. On failure, the previous network and settings remain active,
  and partially allocated geometry is disposed.
- Rebuilding disposes replaced geometry and keeps buffers bounded by validated
  settings and the chosen topology's measured limits.
- On a successful topology rebuild, clear old-graph pulses and reset node/edge
  excitation. Preserve pending observations, totals, timeline,
  session/subagent state, and subsequent activity processing.

## 4. Options and recommendation

| Option | Description | Assessment |
| --- | --- | --- |
| Existing mesh, new looks | Tune density, edge visibility, color, glow, or motion without changing placement/connectivity. | Lowest cost; useful as visual tuning, but does not provide a different network structure. |
| Organic graph | Change point distribution while reusing the current nearest-neighbor rule, graph data, and edge-based activity pulses. | Selected first alternative; generic organic appearance, with no exact reference-parity claim. |
| Regular grid | Generate a regular graph and its rendering resources. | Distinct generation model; defer until selected as a target. |
| Flowing point field | Render a point surface without assuming the existing edge graph. | Highest cost; requires a separate, deliberate mapping for edge-based activity pulses or a separate animation model. Defer from this scope. |

The selected design keeps the current lattice as the default and adds the
organic graph as the first selectable topology. Both retain the existing
nearest-neighbor graph construction and edge-based activity rendering.

## 5. Candidate design

### Selection and compatibility

- Expose topology selection through the existing Visual settings flow.
- Preserve the current lattice as the default for old and new configurations.
- Use the root-level `topology` setting with stable values `lattice` and
  `organic`. Legacy files without this key default to `lattice`; existing
  tuning remains intact.
- Selecting a topology previews the change through one network rebuild.
  Unrelated setting edits do not repeatedly allocate networks.

### Graph-compatible organic topology

- Generate randomized points inside the existing spherical shell for
  `organic`; keep the current Fibonacci-sphere placement for `lattice`.
- Reuse the current nearest-neighbor edge rule for both topologies.
- Return the same logical graph data needed by current consumers: node
  positions and state arrays, edge endpoints and lengths, and adjacency lists.
- Ensure every generated edge refers to two distinct in-range nodes and is
  represented in both endpoint adjacency lists. Ensure nodes used by
  neighbor-based effects have usable adjacency.
- Keep node and edge storage within validated bounds. The current supported
  node count remains 2–4000.
- Organic output is randomized; deterministic placement, a triangulation
  algorithm, and exact visual parity are not requirements.

### Rebuild lifecycle and activity

- Validate the candidate settings before allocating or applying the new graph.
- Build candidate graph arrays and Three.js geometry off the active network.
- If construction fails, dispose candidate resources and leave the active
  network and settings unchanged.
- On success, swap the node/edge geometry and graph data together, then dispose
  the replaced geometry.
- Clear old-graph transient pulses and reset node/edge excitation when the new
  network is installed. Do not drain or discard pending observed activity,
  reset totals or timeline history, or lose session/subagent state. Remap
  visual anchors to valid nodes and verify later activity still renders.

## 6. Confirmed decisions and remaining limitation

| ID | Resolution |
| --- | --- |
| D1 | Organic is the first selectable alternative; lattice remains the default. |
| D2 | Approximate the selected reference while keeping nodes, connecting edges, and edge-traveling activity pulses recognizable. No reference image/identifier was supplied, so exact parity remains unverified. |
| D3 | Use the root-level `topology` setting with stable values `lattice` and `organic`; missing legacy values resolve to `lattice`. |
| D4 | Measure at the supported maximum of 4,000 nodes and report resource counts and build time. Set numeric targets only from evidence; no latency SLA is approved. |
| D5 | On a committed topology change, clear old-graph pulses and node/edge excitation. Preserve pending observations, totals, timeline history, and session/subagent state. |

### Performance observation

On Windows with Node.js v26.7.0 and the repository's Three.js dependency, five
isolated `buildNetwork` samples at 4,000 organic nodes took 125.65 ms median
(100.77–166.34 ms). One measured build produced 4,000 nodes, 7,629 edges,
four node-geometry attributes, two edge-geometry attributes, and two geometry
objects. This measures graph construction and Three.js geometry allocation,
not the full settings-commit, network-install, or rendering path; it is an
observation, not a performance guarantee.

## 7. Acceptance criteria and validation

The implementation is evaluated against these criteria:

- **NS-AC1:** An old configuration without a topology setting loads as the
  current lattice and preserves current visual behavior.
- **NS-AC2:** Each approved graph topology produces finite node positions,
  valid in-range edge endpoints, valid edge lengths, and consistent adjacency.
- **NS-AC3:** Activity pulses and neighbor-based effects operate on each
  supported graph topology without invalid references or non-finite rendered
  values.
- **NS-AC4:** Selecting a topology builds and installs one valid candidate
  network; unrelated setting edits do not rebuild it again.
- **NS-AC5:** A failed validation or resource construction leaves the previous
  settings and network active and disposes any partially constructed resources.
- **NS-AC6:** A successful topology change disposes replaced geometry, clears
  old-graph pulses and node/edge excitation, and preserves observed pending
  activity, totals, timeline history, session/subagent state, and continued
  activity processing.
- **NS-AC7:** Existing configuration resolution, visual settings behavior,
  and current-lattice rendering remain covered by regression tests.
- **NS-AC8:** Tests use synthetic activity and deterministic fixtures where
  practical; no real journal data is needed.
- **NS-AC9:** Benchmark the supported maximum node count and record resource
  counts and build time; do not assert a numeric performance target without
  evidence.

Current relevant test command: `node --test tests/visual-settings.test.mjs`.
Focused coverage is in `tests/visual-settings.test.mjs` for topology
selection/reset/export, graph validity, activity rendering, failed rebuild
recovery, geometry disposal, transient-visual clearing, and observed-state
preservation. Run `npm test` for the full regression suite.

## 8. Flat triangular Waves extension

### Approved brief and scope

The supplied image shows a blue/pink triangulated surface with travelling
crests. The first iteration retained a volume following the initial clarification.
The user's later correction, **"it should be flat"**, supersedes that choice:
Waves is now a flat sheet, not a displaced sphere.

- **Point distribution:** Place nodes in a rectangular X/Z grid at rest height
  zero. Use the exact requested node count, including incomplete final rows.
- **Connectivity:** Connect horizontal, vertical and diagonal grid neighbours
  into a connected triangular sheet. Do not reconnect it on each frame.
- **Presentation:** Apply two spatially coherent travelling sine components
  as vertical displacement from immutable rest positions. This produces
  moving crests and a changing silhouette, unlike static Lattice and Organic.
- **Activity mapping:** Keep the existing impulse spawning, branching,
  excitation, categories and trail interpolation. Update current endpoints
  and lengths before activity rendering. Waiting markers and delegated-work
  roots follow the same moved nodes.
- **Non-goals:** Reference palette replacement, new
  activity semantics, new dependencies, changed defaults or buffer capacities.

### Configuration and lifecycle acceptance

`topology: 'waves'` selects the style through the existing Network selector.
Lattice remains the default. The optional `waves` group receives compatibility
defaults `{ amplitude: 1.6, wavelength: 10, speed: 0.8 }` for old files/presets.
Amplitude is constrained to 0–3 world units, wavelength to 4–40 world units,
and phase speed to 0–3 radians/second. The second component has 0.35 times the
amplitude. These are ordinary validated Motion controls, supporting live edits,
reset, presets and export; tuning them does not rebuild the graph.

Zero amplitude restores rest positions without accumulated drift. Zero speed
or reduced motion freezes phase. Existing breathing remains a separate
presentation effect. Decorative waves never generate observed activity.
Existing edge visibility choices remain respected. Waves tilts the shared
network group 0.55 radians toward the viewer; other styles retain zero tilt.

Wave positions and edge-position attributes use existing geometry with dynamic
uploads. A conservative bounding sphere covers the maximum displacement.
The graph's fixed endpoint indices and adjacency remain unchanged, while
lengths are recomputed from the displaced positions. No per-frame geometry
objects or position arrays are allocated.

Selection uses the same candidate-build/install/dispose and failed-rebuild
recovery contract as Organic. Only successful topology changes clear the
old graph's transient excitation and pulses; ongoing waves do not clear them.
Pending observations, totals, timeline and session/subagent state remain intact.

### Evidence and limitations

Focused tests cover flat rest heights, triangular connectivity, full-sheet
reachability, spatial variation, time-varying crests,
bounded displacement, drift-free restoration, finite positive lengths,
matching edge endpoints, adjacency, pulse interpolation and arrival excitation,
waiting/delegated anchors, reduced motion, settings compatibility, live tuning,
personal presets/export, rebuild disposal/recovery and observed-state retention.
Construction is exercised at 2, 37 and 4,000 nodes.

The original volumetric preview is superseded by this correction. Two rendered
captures of the corrected 4,000-node mesh, with automatic rotation disabled,
showed a single triangular sheet with travelling crests and visible synthetic
activity highlights, without a spherical envelope. Inspection used an empty
synthetic journal root and the existing Appearance demo. Exact parity with the
reference's pink palette is not claimed.

On Windows, Node.js v26.7.0, Three.js r160 (0.160.0), five isolated builds per
style at 4,000 nodes gave the following observations:

| Style | Build median (range), ms | Edges in final sample |
| --- | --- | --- |
| Lattice | 178.35 (161.90–192.66) | 7,510 |
| Organic | 109.83 (85.76–171.06) | 7,623 |
| Flat Waves | 4.15 (3.50–6.66) | 11,747 |

Each style allocated two geometry objects with six attributes total (four node,
two edge). Waves additionally retained 48,000 bytes of rest positions. After
100 warmup updates, 600 wave updates averaged 13.09 ms each in a Node VM harness;
positions stayed finite and edge lengths positive. This includes VM/global
lookup overhead and excludes GPU uploads, rendering, settings commit and
installation. It is not a browser FPS measurement, SLA or performance guarantee.

Validation of the flat correction: `node --test tests/visual-settings.test.mjs`
passed 63 tests. Parallel `npm test` passed 429/431, with unrelated Windows
hidden-launcher startup/cleanup failures. Running the complete suite with
`node --test --test-concurrency=1 tests/*.test.mjs` passed all 431 tests.
`git diff --check` passed. No launcher code or concurrency settings were
changed to hide the parallel failures.

## 9. DNA double-helix extension

### Approved design and acceptance

The user supplied three blue particle/line DNA references and confirmed an
additional selectable DNA style, not a replacement default. Two connected
helical strands twist around their own length instead of auto-orbiting the
camera; impulses appear throughout the helix without changing activity meanings.
The existing NS-AC1 through NS-AC9 criteria apply.

- **Point distribution:** A long double helix with opposite strand pairs,
  2.5 turns and a diagonal presentation. Dense backbone samples receive 80%
  of nodes (rounded down to pairs, minimum one pair); remaining nodes
  subdivide up to 36 evenly spaced rungs. Exact counts from 2 through 4,000
  remain supported. Very small counts necessarily show only a coarse ladder.
- **Connectivity:** Each backbone connects successive samples; rung chains
  join opposite strand samples. The complete graph is connected, including
  odd node counts and minimal configurations. No nearest-neighbor shortcuts
  cut across helical folds.
- **Presentation:** Rotate radial positions from immutable rest coordinates
  with a travelling torsion phase. Axial positions and radial distances stay
  fixed; both ends stay on the same axis. All DNA nodes at a rung height use
  the same phase so rungs remain straight.
- **Activity mapping:** Existing random seeds cover nodes throughout both
  backbones and rungs. Keep categories, burst strengths, branching and
  observations unchanged. Recompute current edge positions and lengths before
  pulse updates. Waiting markers, delegated-work roots and trails follow
  moving endpoints without per-frame geometry or position-array allocation.

`topology: 'dna'` selects **DNA** in Appearance's existing Network selector.
Legacy files, defaults, reset, presets, overrides and export retain their
existing contracts. No new configuration group, dependencies or capacity
changes are required. DNA uses the existing automatic-rotation switch, speed
and direction for strand twisting (phase speed is the multiplier times pi/3
radians/second). It suppresses camera auto-orbit without changing the saved
camera values. Leaving DNA restores the configured auto-orbit. Manual camera
interaction remains available. Zero speed, disabled automatic rotation and
reduced motion freeze the torsion. Wave tuning does not affect DNA.

Selection shares the candidate-build/install/dispose and failure-recovery path.
Success clears old-graph transient excitation/pulses but preserves pending
observations, totals, timeline and session/subagent state. Motion alone does
not rebuild, dispose resources or clear activity.

### Evidence and limitations

Focused tests cover configuration compatibility and selection, personal
presets, reset/export, counts 2, 3, 4, 37 and 4,000, finite positive edge
lengths, adjacency, full-helix reachability, opposite strand geometry, fixed
axial/radial profile, twisting, reverse/zero speed, reduced motion, camera
orbit restoration, moving edge endpoints, pulse interpolation/excitation at
both tips/strands and rung interiors, moving waiting/delegated anchors,
disposal, failed rebuild recovery and observed-state retention.

Rendered inspection used an isolated loopback server with an empty synthetic
journal directory and the existing labelled Appearance demo. Two DNA captures
showed a long double helix with changing strand phase and distributed activity;
Always visible lines exposed the connecting rungs. Switching back showed the
existing volumetric lattice, not a helix. The narrow preview cropped the wide
diagonal silhouette at its sides; manual zoom remains available. This is a
generic interpretation of the supplied references, not exact image parity.

On Windows, Node.js v26.7.0 and Three.js r160 (0.160.0), five isolated 4,000-node
DNA builds took 6.16 ms median (5.56-8.66 ms). Each allocated 4,034 edges, two
geometry objects, six attributes total, and 48,000 bytes of rest positions.
After 100 warmup updates, 600 DNA motion updates averaged 7.82 ms in a Node VM
harness; positions remained finite and lengths positive. These observations
exclude GPU uploads, rendering, settings commit and installation, include VM
overhead, and are not browser FPS measurements or performance guarantees.

`node --test tests/visual-settings.test.mjs` passed 67 tests and `npm test`
passed all 435 tests.

### Dissolving tips refinement

The user approved the DNA design and requested only dissolving ends, using
the supplied particle-dispersal reference. The outer 14% at each end now
progressively scatters radial particle positions with a deterministic smooth
envelope. Axial positions and the central 72% are unchanged. Node opacity
fades toward 15% at the tips; idle connecting lines fade completely so the
particles do not form a visible tangled net. The later active-tip correction
also fades activity lines and pulse trails toward zero, leaving pulse heads
as soft glints (15% brightness at the extreme tips). Central activity stays
full brightness. Graph traversal and excitation state remain unchanged. Node counts, graph
connectivity, twist, settings, camera and other styles are unchanged.
The existing bounds cover the scattered tips. No extra geometry, attributes,
dependencies or settings are introduced.

Synthetic rendered inspection confirmed scattered, fading particles at both
ends with the central double helix intact, both with demo activity and after
disabling it. Focused validation passed 68 tests. Parallel `npm test` encountered
Windows hidden-launcher startup/locked-directory failures; the full serial
command `node --test --test-concurrency=1 tests/*.test.mjs` passed all 436 tests.
`git diff --check` passed.

Five isolated builds of the refined 4,000-node DNA on Windows, Node.js v26.7.0,
Three.js r160 measured 14.24 ms median (9.74-17.34 ms). Resource counts remain
4,034 edges, two geometries, six attributes and 48,000 bytes of rest positions.
These construction observations exclude rendering/GPU uploads and do not
constitute an FPS or latency guarantee.

The active-tip correction addresses the user's screenshot of bright zigzag
connections and long trails between scattered particles. Synthetic rendered
inspection confirmed softer particle-like activity at both ends. Focused
validation passed 68 tests, including progressive active-edge fading, both
tip pulse heads/trails, unchanged central brightness and retained excitation.
The full serial suite passed 434/436 tests, with two Windows hidden-launcher
startup/locked-directory failures in `desktop-hidden-launcher.test.mjs`;
full-suite success is not claimed for this correction.
