// Visual-only browser settings: edit numbers, save, then refresh the page.
// Values below ARE the defaults (all environments); ranges are useful tuning
// suggestions, not clamps. Use finite nonnegative numbers and integer hop/count
// values. No sliders, storage, server configuration or activity semantics here.
// Palette authority: activity-colors.mjs. Geometry/pool capacities: main.js CFG.
export const VISUAL = {
	// NODES — point size, light output and how much excited nodes approach white.
	// Size is perspective-scaled, so it also depends on camera distance and DPR.
	nodes: {
		scale: 95, // Default 95; point projection scale, try 50–150.
		size: 1, // Default 1; multiplier on all base node sizes, try 0.5–2.
		activeGrowth: 2.0, // Default 2; extra size per unit of node energy, try 0–4.
		idleBrightness: 0.4, // Default 0.4; idle light before twinkle, try 0–1.
		activeBrightness: 1.8, // Default 1.8; light per unit of energy/heat, try 0–3.
		hotMix: 1.4, // Default 1.4; warm-color mix per unit of heat, try 0–2.
		whiteThreshold: 0.7, // Default 0.7; energy/heat where whitening starts, try 0–2.
		whiteMix: 1, // Default 1; whitening rate above threshold, try 0–2 (0 disables).
	},

	// PULSES — travelling point heads and the fixed-capacity trails behind them.
	// Spacing is a fraction of the current edge, NOT seconds or world distance.
	// Speed is world units/second, uniformly sampled from min to min + range.
	pulses: {
		scale: 110, // Default 110; point projection scale, try 60–160.
		head: 2.2, // Default 2.2; ordinary head size factor, try 1–4.
		completionHead: 3.0, // Default 3; completion head size factor, try 1–5.
		trailSpacing: 0.05, // Default 0.05 edge lengths/sample, try 0.01–0.15.
		completionTrailSpacing: 0.07, // Default 0.07 edge lengths/sample, try 0.01–0.15.
		speedMin: 4, // Default 4 world units/s; try 1–10.
		speedRange: 4, // Default 4 world units/s added randomly; try 0–8.
		headBrightness: 1.6, // Default 1.6; palette light multiplier at head, try 0–3.
		trailFalloff: 1.6, // Default 1.6; trail size/light falloff exponent, try 0.5–3.
	},

	// COMPLETION — local lattice cascade only, never a scene-wide effect.
	// Hops are remaining edge transitions AFTER the initial edge. Spread and
	// seeds are capped by existing adjacency; the fixed pulse pool still applies.
	completion: {
		hops: 7, // Default 7; central seed hop budget, integer 0–12.
		neighbourHops: 5, // Default 5; neighbouring seed hop budget, integer 0–10.
		spread: 8, // Default 8; initial edges from central seed, integer 0–12.
		neighbourSeeds: 4, // Default 4; adjacent nodes seeded too, integer 0–8.
		neighbourSpread: 2, // Default 2; initial edges per neighbouring seed, integer 0–4.
		branchChance: 0.42, // Default 0.42; probability of 2 rather than 1 child, 0–1.
		seedHeat: 2.5, // Default 2.5; heat on central node, try 0–3.
		nodeEnergy: 0.9, // Default 0.9; energy added at each arrival (cap 1.8), try 0–1.8.
		edgeIntensity: 0.5, // Default 1; local edge palette light multiplier, try 0–2.
	},

	// SCENE — ordinary load-driven ambience, independent of completion events.
	// Brightness/opacity are unitless; bloom uses Three.js UnrealBloomPass units.
	// Edge fade is exponential decay per second; larger means shorter afterglow.
	scene: {
		bloomStrength: 0.85, // Default 0.85; bloom at zero smoothed load, try 0–1.5.
		bloomLoad: 0.3, // Default 0.3; extra bloom at full load, try 0–0.8.
		bloomRadius: 0.45, // Default 0.45; bloom blur radius, useful range 0–1.
		bloomThreshold: 0.12, // Default 0.12; luminance threshold for bloom, try 0–1.
		edgeFade: 2.4, // Default 2.4 /s; edge light decay, try 0.5–6.
		coreOpacity: 0.015, // Default 0.015; idle central glow opacity, try 0–0.1.
		coreLoad: 0.12, // Default 0.12; extra core opacity at full load, try 0–0.3.
		haloOpacity: 0.025, // Default 0.025; idle outer halo opacity, try 0–0.1.
		haloLoad: 0.03, // Default 0.03; extra halo opacity at full load, try 0–0.1.
		dustBrightness: 0.18, // Default 0.18; twinkling dust light multiplier, try 0–0.5.
		floorBrightness: 0.22, // Default 0.22; grid light multiplier, try 0–0.5.
		floorFade: 0.028, // Default 0.028 /world unit; radial grid decay, try 0.01–0.1.
		floorGlow: 0.5, // Default 0.5; floor pool glow at full load, try 0–1.
	},
};
