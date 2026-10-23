---
name: threejs
description: "Builds browser-based Three.js experiences, including interactive games and immersive visual effects integrated into websites."
---

# Three.js web experiences

Use this skill when a task creates or changes a Three.js scene, rendering, 3D interaction, gameplay, or a visual effect embedded in a website. First identify whether the goal is a game, a website visual, or a combination. Do not use Three.js merely because a task is about a website.

## Before implementation

- Clarify the intended user-visible experience, interactions, and essential content. Keep important information and navigation available as usable HTML; 3D should support, not obscure, the purpose of the page.
- Inspect the repository's framework, Three.js version, rendering setup, test commands, and existing conventions. Follow the established architecture, including client-only boundaries in SSR projects.
- Check current official Three.js documentation for version-sensitive APIs and behaviors. Do not assume a renderer, framework, physics engine, controls library, or asset pipeline; use existing dependencies unless the task requires otherwise.
- Resolve material choices about gameplay, interaction, or visual behavior before implementing them. Do not turn a small effect into a game architecture or add optional infrastructure.

## Implementation guidance

### Shared scene lifecycle

- Keep scene creation, frame updates, and teardown understandable and aligned with the host framework's lifecycle. Clean up event listeners, animation loops, observers, controls, and loaded or generated resources when the experience is removed.
- Handle the actual container size and update the camera projection when dimensions change. Avoid needlessly rendering while hidden or when no animation is required.
- Manage GPU-backed resources explicitly: dispose of owned geometries, materials, textures, and render targets when no longer needed. Avoid disposing shared resources still in use. See the [Three.js cleanup manual](https://threejs.org/manual/en/cleanup.html).
- Handle loading and runtime failures without silently presenting an empty or broken experience. Preserve a usable non-3D page or interaction path where the content requires one.
- Keep input understandable and remove listeners on teardown. Support relevant mouse, touch, and keyboard interaction without making pointer movement the only way to reach essential content or controls.

### Interactive games

- Implement only the game systems the requested experience needs: input, game state, simulation/update, camera, collision or physics, and feedback. Prefer simple, testable state and update logic over unnecessary engine abstractions.
- Make start, active, paused, game-over, and restart behavior clear when those states are part of the requested game. Account for focus loss and viewport changes where they affect play.
- Keep rendering separate from gameplay rules enough to test important outcomes without depending only on frame-by-frame visual inspection.

### Website visual effects

- Tie animation and interaction to a clear visual purpose, such as a product reveal, hero scene, or meaningful pointer or scroll response. Avoid motion that competes with reading, navigation, or other page actions.
- Keep effect content complementary to semantic page content. Provide HTML text, controls, and useful alternatives when the scene conveys information or functionality.
- Respect reduced-motion preferences for non-essential movement and provide a way to pause or avoid prolonged animation when appropriate to the experience.

## Performance and accessibility

- Consider mobile devices and lower-powered hardware: constrain pixel ratio and texture sizes appropriately, avoid unnecessary draw calls and expensive effects, and load only assets needed for the experience.
- Prefer measured, task-relevant performance improvements over speculative optimization. Identify tradeoffs when a visual requirement materially affects performance.
- Preserve semantic HTML, keyboard access, focus behavior, contrast, and accessible names for controls. A canvas-only presentation is not an accessible substitute for meaningful text or actions.
- Treat automated accessibility checks as supporting evidence; do not claim conformance without the applicable manual review.

## Validation and handoff

- Run the repository's focused typecheck, tests, or build for the changed surface.
- Verify the actual experience at a relevant viewport and exercise its important interaction and lifecycle behavior when a browser check is available. For games, exercise a representative play path; for website effects, confirm the surrounding page remains usable.
- Report exact checks and observed results. State clearly when browser, device, or accessibility validation could not be performed; do not claim it passed by inference.

## Boundaries

- Follow the repository's frontend ownership and instructions. This skill does not replace a UX designer, accessibility reviewer, security reviewer, or the project's implementation owner.
- Do not invent product behavior, select a visual style without direction, introduce dependencies without a demonstrated need, or document unshipped behavior.
- Do not claim performance, accessibility, or compatibility guarantees without evidence.
