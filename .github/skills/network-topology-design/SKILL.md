---
name: network-topology-design
description: 'Turn an SENTIENT OS network-style design idea into a clearly distinguishable, selectable, graph-safe visual style with evidence-based tests and performance checks.'
---

# Network Style from Design

## Purpose

Translate a visual design idea into a network style that is both recognizable
in the rendered application and compatible with SENTIENT OS activity
visualization. Use this skill when the user asks to design, plan, or implement
a new network appearance based on a reference, sketch, mood, or other design
idea.

This workflow exists because changing only point randomness can produce a
technically different distribution that still looks like the existing network.
The user-visible distinction must be defined and checked, not inferred from a
different algorithm name.

## Boundaries

- Follow the caller's authorization. A request to brainstorm or specify a
  style does not authorize implementation.
- Preserve the supplied idea, reference, exclusions, default behavior, and
  confirmed decisions. Do not invent approval for a new default, data behavior,
  graph semantics, dependency, or performance target.
- Treat reference parity as unverified unless a relevant rendered comparison
  was actually performed. If no reference was supplied, describe the result as
  a generic interpretation.
- Do not expose, copy into fixtures, or send real session journals, prompts,
  tool results, or other private activity data. Use synthetic activity.
- Keep unrelated working-tree edits intact. Do not commit, push, or deploy.

## Workflow

### 1. Establish the design brief

Record the requested outcome, source design idea, affected surfaces, explicit
non-goals, and allowed work. Identify what a viewer should notice that is
different from the current style.

Separate these concepts rather than using “topology” for all of them:

- **Point distribution:** where nodes are placed.
- **Connectivity:** which nodes are connected and how edges are generated.
- **Presentation:** how nodes, edges, density, color, depth, or motion are drawn.
- **Activity mapping:** how observed activity travels or appears on the graph.

State which of these the design actually changes. If the idea or expected
difference is ambiguous enough to change behavior, scope, or effort, ask one
focused question before dependent work. Do not ask the user to provide
repository facts that can be inspected.

### 2. Inspect the existing system

Read applicable repository instructions and the nearest design/configuration
documentation. Trace the current path through:

1. Visual setting definitions, validation, defaults, presets, overrides,
   backward compatibility, UI staging/reset/export, and live application.
2. Network construction, geometry allocation/disposal, bounded capacities,
   and rebuild failure handling.
3. Every consumer of node positions, edge endpoints/lengths, adjacency,
   node/edge excitation, pulses, waiting markers, and session/subagent anchors.
4. Focused tests and the documented node-count/runtime limits.

Reuse existing graph data and lifecycle when they satisfy the design. Do not
force a graph-based solution if the idea requires a different rendering or
activity-mapping model; describe the contract impact and clarify scope first.

### 3. Turn the idea into observable acceptance

Before implementation, define a small set of verifiable properties:

- What visible characteristic makes this style distinguishable from each
  existing style (for example, silhouette, density pattern, directional
  structure, clustering, edge layout, or depth distribution)?
- Which node, edge, and activity cues must remain recognizable?
- Which configuration value selects it, when should the change apply, and
  what is the default for old and new settings?
- What graph invariants, rebuild behavior, failure recovery, and observed-state
  preservation are required?
- Which supported maximum size must be measured, and which resource counts and
  build timings should be reported?

Use a supplied reference or an approved design description as the comparison
basis. Do not claim “looks like” or “clearly different” based only on source
code, a selected enum value, or graph-validity tests. If rendered inspection is
unavailable, mark visual acceptance unverified.

### 4. Implement the smallest complete change

- Follow existing configuration/UI patterns. If the selected setting is
  root-level or otherwise outside existing grouped paths, update all relevant
  definition, validation, compatibility, preset/override, editing, reset,
  preview, and export paths consistently.
- Preserve existing defaults and legacy configuration behavior unless the
  user approved a change.
- Make the new style's observable visual differentiator intentional. Do not
  equate a randomized point sampler with a distinct network topology when
  connectivity is unchanged.
- Keep graph positions finite; edge endpoints distinct and in range; lengths
  finite and positive; adjacency consistent and usable by neighbor effects.
  Keep buffers within validated limits.
- Build candidate resources before replacing the active network. On failure,
  preserve the previous network and settings and dispose partial allocations.
- On success, dispose replaced resources and apply only the approved transient
  visual reset. Preserve pending/observed activity, totals, timeline, and
  session/subagent state unless the user explicitly approved otherwise.
- Update the canonical user documentation and any implementation spec that
  directly describes the changed setting or behavior.

### 5. Verify the experience and contract

Add focused synthetic tests for:

- Legacy/default configuration and valid/invalid style values.
- Selection, live application, reset, preset/override behavior, and export.
- The new style's distinguishing property, using a deterministic fixture or
  stable measurable property where appropriate.
- Graph validity, edge traversal/activity rendering, and neighbor effects.
- Failed rebuild recovery, geometry disposal, transient-visual behavior, and
  preservation of observed state.

Then:

1. Run the focused test command and fix failures before broad validation.
2. Inspect the rendered application with the intended selection and compare it
   with the supplied design basis. Verify both the new style and the unchanged
   default when feasible.
3. Measure builds at the supported maximum node count. Record runtime version,
   relevant dependency context, sample count/range or median, node/edge counts,
   and geometry/resource counts. Measurements are observations, not SLAs.
4. Run the repository's full test suite and diff/whitespace checks when
   lifecycle, shared configuration, or visual behavior changed.
5. Review the final changes against the user's request and preserve unrelated
   working-tree changes.

## Stop and escalate

Stop before dependent implementation when a material user choice is unresolved,
including whether the change affects placement, connectivity, presentation,
activity semantics, defaults, or the acceptable visual difference. Do not
silently choose a new activity mapping or claim visual parity without evidence.

If implementation is authorized but no reference or sufficiently concrete
design exists, proceed only with the user's approved generic interpretation;
state the limitation and leave reference parity unverified.

## Completion report

Report the selected style and its observable difference, changed configuration
and rebuild behavior, focused/full validation results, measured resource and
timing evidence, and any unverified visual or performance criteria. Distinguish
verified behavior from design interpretation and limitation.
