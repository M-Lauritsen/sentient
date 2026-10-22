import { resolveVisualSettings, WAVE_DEFAULTS } from './appearance/visual-config.mjs';
import { HOOK_DEFAULTS } from './activity/activity-colors.mjs';

export const VISUAL = {
  "hooks": { ...HOOK_DEFAULTS },
  "topology": "lattice",
  "waves": { ...WAVE_DEFAULTS },
  "camera": {
    "fov": 50,
    "position": [
      0,
      4,
      31
    ],
    "target": [
      0,
      0,
      0
    ],
    "damping": 0.06,
    "minDistance": 14,
    "maxDistance": 60,
    "autoRotate": true,
    "autoRotateSpeed": 0.35
  },
  "nodes": {
    "count": 4000,
    "scale": 120,
    "size": 1,
    "activeGrowth": 2,
    "idleBrightness": 0.4,
    "activeBrightness": 1.8,
    "hotMix": 1.4,
    "whiteThreshold": 0.7,
    "whiteMix": 1,
    "baseSizeMin": 0.6,
    "baseSizeRange": 1,
    "largeChance": 0.04,
    "largeSizeMin": 2.6,
    "largeSizeRange": 1,
    "energyCap": 1.8,
    "decay": 2,
    "twinkleBase": 0.75,
    "twinkleAmplitude": 0.25,
    "twinkleSpeed": 1.7,
    "twinkleSpatial": [
      3.1,
      0,
      2.3
    ],
    "coreFalloff": 2.2,
    "baseColor": [
      0.16,
      0.45,
      1
    ],
    "hotColor": [
      1,
      0.52,
      0.12
    ],
    "whiteColor": [
      1,
      0.92,
      0.8
    ]
  },
  "pulses": {
    "scale": 110,
    "head": 2.2,
    "completionHead": 3,
    "trailSpacing": 0.05,
    "completionTrailSpacing": 0.07,
    "speedMin": 4,
    "speedRange": 4,
    "headBrightness": 1.6,
    "trailFalloff": 1.6,
    "minTrailSize": 0.35,
    "coreFalloff": 1.8,
    "nodeEnergy": 0.5,
    "thinkingEdgeIntensity": 0.6,
    "stepEdgeIntensity": 0.45
  },
  "running": {
    "pulsesPerSecondPerSession": 6,
    "maxSessions": 32,
    "baseHops": 2,
    "maxExtraHops": 5,
    "spread": 1,
    "nodeEnergy": 0.45
  },
  "activity": {
    "maxIntensity": 8,
    "maxSpread": 3,
    "reasoningBaseHops": 2,
    "errorHops": 0,
    "reasoningEnergy": 0.45,
    "stepHeat": 0.7,
    "stepHeatCap": 1.2
  },
  "subagents": {
    "growSeconds": 0.22,
    "fadeSeconds": 2,
    "tipSize": 5,
    "fadingTipSize": 4,
    "anchorSize": 8,
    "initialIntensity": 0.55,
    "intensityPerSecond": 0.08,
    "maxIntensity": 1,
    "runningAnchorColor": [
      0.2,
      0.6,
      1
    ],
    "runningAnchorIntensity": 1.1,
    "waitingAnchorIntensity": 0.9,
    "stuckAnchorColor": [
      0.5,
      0.55,
      0.65
    ],
    "stuckAnchorIntensity": 0.55,
    "quietAnchorColor": [
      0.16,
      0.32,
      0.56
    ],
    "quietAnchorIntensity": 0.35,
    "clearedLineColor": [
      0.55,
      0.58,
      0.64
    ],
    "clearedTipColor": [
      0.65,
      0.68,
      0.72
    ],
    "failureFlashFraction": 0.12,
    "failureFlashIntensity": 2,
    "completionFlashFraction": 0.15,
    "completionFlashBase": 0.6,
    "completionFlashGrowth": 6
  },
  "waiting": {
    "markerOpacity": 0.9,
    "markerSize": 0.55,
    "breathSpeed": 0.7,
    "colorMixMin": 0.5,
    "colorMixRange": 0.5,
    "opacityBase": 0.025,
    "opacityBreath": 0.025
  },
  "effects": {
    "dust": true,
    "floor": true,
    "latticeBreathing": true,
    "waitingGlow": true,
    "waitingMarkers": true,
    "subagentTransitions": true
  },
  "dust": {
    "scale": 40,
    "color": [
      0.2,
      0.45,
      1
    ],
    "twinkleBase": 0.25,
    "twinkleAmplitude": 0.75,
    "twinkleSpeed": 0.9,
    "twinklePhase": 7,
    "twinklePower": 3,
    "rotationSpeed": -0.02,
    "tiltSpeed": 0.05,
    "tiltAmplitude": 0.1
  },
  "floor": {
    "fineSpacing": 2.5,
    "fineIntensity": 0.45,
    "coarseSpacing": 12.5,
    "coarseIntensity": 0.8,
    "color": [
      0.1,
      0.32,
      1
    ],
    "poolColor": [
      0.12,
      0.32,
      0.95
    ],
    "poolFade": 0.1,
    "poolBase": 0.06,
    "poolGrid": 0.6
  },
  "completion": {
    "hops": 7,
    "neighbourHops": 5,
    "spread": 8,
    "neighbourSeeds": 4,
    "neighbourSpread": 2,
    "branchChance": 0.42,
    "seedHeat": 2.5,
    "nodeEnergy": 0.9,
    "edgeIntensity": 0.5
  },
  "impact": {
    "minMs": 2000,
    "maxMs": 120000,
    "minHops": 1,
    "maxHops": 8,
    "minSpread": 1,
    "maxSpread": 6,
    "neighbourSeeds": 4,
    "neighbourHops": 4,
    "neighbourSpread": 2,
    "branchChance": 0.35,
    "seedHeat": 2,
    "nodeEnergy": 0.7,
    "edgeIntensity": 0.8,
    "head": 2.6
  },
  "scene": {
    "background": 132105,
    "edgeVisibility": "always",
    "categoryBrightness": 0.9,
    "edgeBaseColor": [
      0.012,
      0.04,
      0.13
    ],
    "edgeVariationMin": 0.45,
    "edgeVariationRange": 0.55,
    "breathSpeed": 0.8,
    "breathAmplitude": 0.012,
    "loadPulseScale": 500,
    "loadSessionScale": 64,
    "loadSmoothing": 3,
    "coreColor": 4033535,
    "coreSize": 16,
    "haloColor": 2780159,
    "haloSize": 38,
    "glowKnee": 0.25,
    "glowKneeOpacity": 0.35,
    "bloomStrength": 0.85,
    "bloomLoad": 0.3,
    "bloomRadius": 0.45,
    "bloomThreshold": 0.12,
    "edgeFade": 2.4,
    "coreOpacity": 0.015,
    "coreLoad": 0.12,
    "haloOpacity": 0.025,
    "haloLoad": 0.03,
    "dustBrightness": 0.18,
    "floorBrightness": 0.22,
    "floorFade": 0.028,
    "floorGlow": 0.5
  }
};
export const VISUAL_PRESET = "balanced";
export const VISUAL_OVERRIDES = {
  "topology": "lattice",
  "camera": {
    "fov": 50,
    "position": [
      0,
      4,
      31
    ],
    "target": [
      0,
      0,
      0
    ],
    "damping": 0.06,
    "minDistance": 14,
    "maxDistance": 60,
    "autoRotate": true,
    "autoRotateSpeed": 0.35
  },
  "nodes": {
    "count": 4000,
    "scale": 120,
    "size": 1,
    "activeGrowth": 2.5,
    "idleBrightness": 0.4,
    "activeBrightness": 2.4,
    "hotMix": 1.4,
    "whiteThreshold": 0.7,
    "whiteMix": 1,
    "baseSizeMin": 0.6,
    "baseSizeRange": 1,
    "largeChance": 0.04,
    "largeSizeMin": 2.6,
    "largeSizeRange": 1,
    "energyCap": 1.8,
    "decay": 2,
    "twinkleBase": 0.75,
    "twinkleAmplitude": 0.25,
    "twinkleSpeed": 1.7,
    "twinkleSpatial": [
      3.1,
      0,
      2.3
    ],
    "coreFalloff": 2.2,
    "baseColor": [
      0.16,
      0.45,
      1
    ],
    "hotColor": [
      1,
      0.52,
      0.12
    ],
    "whiteColor": [
      1,
      0.92,
      0.8
    ]
  },
  "pulses": {
    "scale": 110,
    "head": 1.5,
    "completionHead": 3,
    "trailSpacing": 0.05,
    "completionTrailSpacing": 0.07,
    "speedMin": 4,
    "speedRange": 4,
    "headBrightness": 1.2,
    "trailFalloff": 1,
    "minTrailSize": 0.35,
    "coreFalloff": 1.2,
    "nodeEnergy": 0.5,
    "thinkingEdgeIntensity": 0.6,
    "stepEdgeIntensity": 0.45
  },
  "running": {
    "pulsesPerSecondPerSession": 10,
    "maxSessions": 32,
    "baseHops": 2,
    "maxExtraHops": 5,
    "spread": 1,
    "nodeEnergy": 0.45
  },
  "activity": {
    "maxIntensity": 10,
    "maxSpread": 3,
    "reasoningBaseHops": 2,
    "errorHops": 0,
    "reasoningEnergy": 0.45,
    "stepHeat": 0.7,
    "stepHeatCap": 1.2
  },
  "subagents": {
    "growSeconds": 0.22,
    "fadeSeconds": 2,
    "tipSize": 5,
    "fadingTipSize": 4,
    "anchorSize": 8,
    "initialIntensity": 0.55,
    "intensityPerSecond": 0.08,
    "maxIntensity": 1,
    "runningAnchorColor": [
      0.2,
      0.6,
      1
    ],
    "runningAnchorIntensity": 1.1,
    "waitingAnchorIntensity": 0.9,
    "stuckAnchorColor": [
      0.5,
      0.55,
      0.65
    ],
    "stuckAnchorIntensity": 0.55,
    "quietAnchorColor": [
      0.16,
      0.32,
      0.56
    ],
    "quietAnchorIntensity": 0.35,
    "clearedLineColor": [
      0.55,
      0.58,
      0.64
    ],
    "clearedTipColor": [
      0.65,
      0.68,
      0.72
    ],
    "failureFlashFraction": 0.12,
    "failureFlashIntensity": 2,
    "completionFlashFraction": 0.15,
    "completionFlashBase": 0.6,
    "completionFlashGrowth": 6
  },
  "waiting": {
    "markerOpacity": 0.9,
    "markerSize": 0.55,
    "breathSpeed": 0.7,
    "colorMixMin": 0.5,
    "colorMixRange": 0.5,
    "opacityBase": 0.025,
    "opacityBreath": 0.025
  },
  "effects": {
    "dust": true,
    "floor": false,
    "latticeBreathing": true,
    "waitingGlow": true,
    "waitingMarkers": true,
    "subagentTransitions": true
  },
  "dust": {
    "scale": 80,
    "color": [
      0.2,
      0.45,
      1
    ],
    "twinkleBase": 0.25,
    "twinkleAmplitude": 0.75,
    "twinkleSpeed": 0.9,
    "twinklePhase": 7,
    "twinklePower": 3,
    "rotationSpeed": -0.02,
    "tiltSpeed": 0.05,
    "tiltAmplitude": 0.1
  },
  "floor": {
    "fineSpacing": 2.5,
    "fineIntensity": 0.45,
    "coarseSpacing": 12.5,
    "coarseIntensity": 0.8,
    "color": [
      0.1,
      0.32,
      1
    ],
    "poolColor": [
      0.12,
      0.32,
      0.95
    ],
    "poolFade": 0.1,
    "poolBase": 0.06,
    "poolGrid": 0.6
  },
  "completion": {
    "hops": 7,
    "neighbourHops": 5,
    "spread": 8,
    "neighbourSeeds": 4,
    "neighbourSpread": 2,
    "branchChance": 0.42,
    "seedHeat": 2.5,
    "nodeEnergy": 0.9,
    "edgeIntensity": 0.5
  },
  "impact": {
    "minMs": 2000,
    "maxMs": 120000,
    "minHops": 1,
    "maxHops": 8,
    "minSpread": 1,
    "maxSpread": 6,
    "neighbourSeeds": 4,
    "neighbourHops": 4,
    "neighbourSpread": 2,
    "branchChance": 0.35,
    "seedHeat": 2,
    "nodeEnergy": 0.7,
    "edgeIntensity": 0.8,
    "head": 2.6
  },
  "scene": {
    "background": 132105,
    "edgeVisibility": "active",
    "categoryBrightness": 1.2,
    "edgeBaseColor": [
      0.012,
      0.04,
      0.13
    ],
    "edgeVariationMin": 0.45,
    "edgeVariationRange": 0.55,
    "breathSpeed": 0.8,
    "breathAmplitude": 0.012,
    "loadPulseScale": 500,
    "loadSessionScale": 64,
    "loadSmoothing": 3,
    "coreColor": 4033535,
    "coreSize": 16,
    "haloColor": 2780159,
    "haloSize": 38,
    "glowKnee": 0.25,
    "glowKneeOpacity": 0.35,
    "bloomStrength": 1.1,
    "bloomLoad": 0.42,
    "bloomRadius": 0.45,
    "bloomThreshold": 0.12,
    "edgeFade": 2.4,
    "coreOpacity": 0.015,
    "coreLoad": 0.17,
    "haloOpacity": 0.025,
    "haloLoad": 0.03,
    "dustBrightness": 0.24,
    "floorBrightness": 0.22,
    "floorFade": 0.028,
    "floorGlow": 0.7
  }
};
const resolved = resolveVisualSettings(VISUAL, VISUAL_PRESET, VISUAL_OVERRIDES);
export const EFFECTIVE_VISUAL = resolved.settings;
export const VISUAL_ERRORS = resolved.errors;
