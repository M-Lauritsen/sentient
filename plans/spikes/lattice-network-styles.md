# Lattice network styles

- **Question:** How difficult is it to offer alternate lattice/network looks based on the supplied references?
- **Decision:** Whether to build a selectable topology/style option in the existing visual settings.
- **Evidence:** `main.js` builds node positions, nearest-neighbor edges, adjacency, and dynamic Three.js buffers in `buildNetwork`; activity pulses travel those edges. Visual settings already support live preview and rebuild the network when node count changes.
- **Evidence:** `docs/specs/visual-configuration.md` explicitly excluded topology/placement changes from the existing visual-settings work.
- **Option 1 — Existing mesh, new looks:** Tune density, edge visibility, color, glow, and motion. Lowest cost; resembles the first two references but doesn't create a different network structure.
- **Option 2 — Organic mesh preset:** Alternative point distribution and neighbor rules, rebuilding the node/edge graph on selection. Moderate cost; closest to the first reference, while retaining edge-based activity pulses.
- **Option 3 — Regular grid / flowing point field:** Distinct generation and rendering models. Highest cost; edge-based pulses need a deliberate mapping or a separate animation model.
- **Recommendation:** Start with a small topology selector and an organic triangulated mesh option; keep current lattice as default. Treat the flowing point surface as a later, separate renderer option.
- **Tradeoff:** Rebuilds should preserve activity state and bounded buffers; a point-field renderer may not communicate activity with the current edge pulses as clearly.
- **Confidence:** High that this is feasible; medium on effort until the first target style and visual parity requirements are chosen.
- **Open question:** Which reference style should be the first selectable option?
- **Next lane:** Standard implementation when the first style is selected; planned if the goal expands to multiple rendering models.
- **Reference:** Three.js `BufferGeometry` API, https://threejs.org/docs/#api/en/core/BufferGeometry
