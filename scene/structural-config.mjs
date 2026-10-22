// Structural geometry and fixed buffer capacities, not appearance tuning.
export const CFG = Object.freeze({
  radius: 10,
  neighbours: 3,
  maxEdgeLen: 4.5,
  dust: 4000,
  maxPulses: 1600,
  trail: 7,
});

export const MAX_ACTIVE_SUBAGENT_BRANCHES = 512;
export const MAX_FADING_SUBAGENT_BRANCHES = 64;
export const MAX_SUBAGENT_ANCHORS = 32;
