import { resolveVisualSettings } from './visual-config.mjs';

// Visual-only browser settings: edit values, save, then reload from the panel.
// Values below ARE the defaults (all environments); ranges are useful tuning
// suggestions, not clamps. Use finite numbers (nonnegative unless signed below) and integer hop/count
// values. No sliders, storage, server configuration or activity semantics here.
// nodes.count rebuilds the network live; in-flight visual pulses are cleared.
// Palette authority: activity-colors.mjs. Other geometry/pool capacities: main.js CFG.
// Colors below are decorative, not activity categories. RGB arrays use linear
// 0–1 channels; hex colors use Three.js's existing sRGB conversion.
// The Visual settings panel uses sRGB colour pickers for both formats and
// converts RGB arrays automatically; keep arrays linear when editing this file.
// Camera positions/targets use signed world units. Frequencies use radians/second.
export const VISUAL = {
	camera: {
		fov: 50, // Degrees; keep between 1 and 179.
		position: [0, 4, 31], // Initial x/y/z; try z 20–50.
		target: [0, 0, 0], // Orbit center x/y/z.
		damping: 0.06, // Orbit damping factor, 0–1.
		minDistance: 14, // Closest zoom, world units; > 0, <= maxDistance.
		maxDistance: 60, // Farthest zoom, world units.
		autoRotate: true, // false disables automatic orbit.
		autoRotateSpeed: 0.35, // OrbitControls speed; negative reverses rotation.
	},

	// NODES — point size, light output and how much excited nodes approach white.
	// Size is perspective-scaled, so it also depends on camera distance and DPR.
	nodes: {
		count: 4000, // Actual network nodes, integer 2–4000; rebuilds the network live.
		scale: 120, // Default 95; point projection scale, try 50–150.
		size: 1, // Default 1; multiplier on all base node sizes, try 0.5–2.
		activeGrowth: 2.0, // Default 2; extra size per unit of node energy, try 0–4.
		idleBrightness: 0.4, // Default 0.4; idle light before twinkle, try 0–1.
		activeBrightness: 1.8, // Default 1.8; light per unit of energy/heat, try 0–3.
		hotMix: 1.4, // Default 1.4; warm-color mix per unit of heat, try 0–2.
		whiteThreshold: 0.7, // Default 0.7; energy/heat where whitening starts, try 0–2.
		whiteMix: 1, // Default 1; whitening rate above threshold, try 0–2 (0 disables).
		baseSizeMin: 0.6, // Ordinary random base size, try 0.2–2.
		baseSizeRange: 1, // Added random size, try 0–2.
		largeChance: 0.04, // Probability of a large node, 0–1.
		largeSizeMin: 2.6, // Large-node base size, try 1–4.
		largeSizeRange: 1, // Added random large size, try 0–2.
		energyCap: 1.8, // Maximum excitation, try 0.5–3.
		decay: 2, // Energy/heat exponential decay per second; 0 keeps excitation.
		twinkleBase: 0.75, // Idle twinkle baseline, try 0–1.
		twinkleAmplitude: 0.25, // Twinkle amplitude; <= twinkleBase.
		twinkleSpeed: 1.7, // Twinkle frequency, try 0–4.
		twinkleSpatial: [3.1, 0, 2.3], // Phase variation per world unit on x/y/z.
		coreFalloff: 2.2, // Point shape exponent, > 0; try 1–4.
		baseColor: [0.16, 0.45, 1], // Idle linear RGB.
		hotColor: [1, 0.52, 0.12], // Excited linear RGB.
		whiteColor: [1, 0.92, 0.8], // Whitening linear RGB.
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
		minTrailSize: 0.35, // Tail size fraction, 0–1; head remains full size.
		coreFalloff: 1.8, // Point shape exponent, > 0; try 1–4.
		nodeEnergy: 0.5, // Ordinary pulse energy at arrival, try 0–2.
		thinkingEdgeIntensity: 0.6, // Running/reasoning edge light, try 0–2.
		stepEdgeIntensity: 0.45, // Tool/activity edge light, try 0–2.
	},

	// RUNNING — background stream scales with observed running sessions.
	// Does not change event-triggered bursts; the fixed pulse pool still applies.
	running: {
		pulsesPerSecondPerSession: 6, // Default 6 pulses/s/session; try 0–20 (0 disables).
		maxSessions: 32, // Default 32; session multiplier cap, integer 0–64.
		baseHops: 2, // Hop budget before session-count growth, integer 0–8.
		maxExtraHops: 5, // Added log2(session count + 1) hops cap, integer 0–10.
		spread: 1, // Initial edges per pulse, integer 0–4.
		nodeEnergy: 0.45, // Seed excitation per pulse, try 0–2.
	},

	// ACTIVITY — counts strengthen bounded bursts; feed/data counts are unchanged.
	activity: {
		maxIntensity: 8, // Log2(grouped count) intensity cap, integer >= 1; try 1–12.
		maxSpread: 3, // Initial edges per grouped burst, integer 0–8.
		reasoningBaseHops: 2, // Added to reasoning burst intensity, integer 0–8.
		errorHops: 0, // Error hop budget, integer 0–8.
		reasoningEnergy: 0.45, // Seed energy per intensity, try 0–1.
		stepHeat: 0.7, // Seed heat per intensity, try 0–1.
		stepHeatCap: 1.2, // Ordinary activity heat cap, try 0–3.
	},

	subagents: {
		growSeconds: 0.22, // Branch growth time, > 0; try 0.1–1.
		fadeSeconds: 2, // Retired branch fade time, > 0; try 0.5–5.
		tipSize: 5, // Active tip pixels before DPR scaling, try 2–10.
		fadingTipSize: 4, // Retired tip pixels, try 2–10.
		anchorSize: 8, // Session anchor pixels, try 3–12.
		initialIntensity: 0.55, // Branch light at start, try 0–1.
		intensityPerSecond: 0.08, // Light growth with age, try 0–0.5.
		maxIntensity: 1, // Branch light cap, try 0–2.
		runningAnchorColor: [0.2, 0.6, 1], // Decorative linear RGB.
		runningAnchorIntensity: 1.1, // Anchor light multiplier, try 0–2.
		waitingAnchorIntensity: 0.9, // Uses waiting category color, try 0–2.
		stuckAnchorColor: [0.5, 0.55, 0.65],
		stuckAnchorIntensity: 0.55,
		quietAnchorColor: [0.16, 0.32, 0.56],
		quietAnchorIntensity: 0.35,
		clearedLineColor: [0.55, 0.58, 0.64],
		clearedTipColor: [0.65, 0.68, 0.72],
		failureFlashFraction: 0.12, // Fraction of fade duration, 0–1.
		failureFlashIntensity: 2, // Initial failure light multiplier, try 0–3.
		completionFlashFraction: 0.15, // Fraction of fade duration, 0–1.
		completionFlashBase: 0.6, // Initial completion light multiplier.
		completionFlashGrowth: 6, // Added multiplier per normalized fade age.
	},

	waiting: {
		markerOpacity: 0.9, // Waiting marker opacity, 0–1.
		markerSize: 0.55, // Sprite size in world units, try 0.2–1.
		breathSpeed: 0.7, // Waiting glow frequency, try 0–2.
		colorMixMin: 0.5, // Minimum blend toward waiting color, 0–1.
		colorMixRange: 0.5, // Added oscillating blend; min + range <= 1.
		opacityBase: 0.025, // Added waiting glow opacity, try 0–0.1.
		opacityBreath: 0.025, // Extra opacity times color blend, try 0–0.1.
	},

	effects: {
		dust: true,
		floor: true,
		latticeBreathing: true,
		waitingGlow: true,
		waitingMarkers: true,
		subagentTransitions: true,
	},

	dust: {
		scale: 40, // Point projection scale, try 10–80.
		color: [0.2, 0.45, 1], // Decorative linear RGB.
		twinkleBase: 0.25, // Twinkle baseline, try 0–1.
		twinkleAmplitude: 0.75, // Added twinkle light, try 0–1.
		twinkleSpeed: 0.9, // Frequency, try 0–3.
		twinklePhase: 7, // Random phase multiplier, try 0–12.
		twinklePower: 3, // Twinkle peak sharpness, > 0; try 1–6.
		rotationSpeed: -0.02, // Y rotation frequency; negative reverses direction.
		tiltSpeed: 0.05, // X sway frequency, try 0–0.2.
		tiltAmplitude: 0.1, // X sway radians, try 0–0.5.
	},

	floor: {
		fineSpacing: 2.5, // Fine grid world units, > 0.
		fineIntensity: 0.45, // Fine grid light multiplier, try 0–1.
		coarseSpacing: 12.5, // Coarse grid world units, > 0.
		coarseIntensity: 0.8, // Coarse grid light multiplier, try 0–1.
		color: [0.1, 0.32, 1], // Grid linear RGB.
		poolColor: [0.12, 0.32, 0.95], // Ambient pool linear RGB.
		poolFade: 0.1, // Pool radial decay per world unit, try 0.01–0.3.
		poolBase: 0.06, // Pool light between grid lines, try 0–0.3.
		poolGrid: 0.6, // Added pool light along grid lines, try 0–1.
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
		nodeEnergy: 0.9, // Default 0.9; arrival energy, capped by nodes.energyCap.
		edgeIntensity: 0.5, // Default 0.5; local edge palette light multiplier, try 0–2.
	},

	// IMPACT — extra burst when a timed run ends (tool call, turn, subagent),
	// sized by how long it ran. Duration maps log-scaled from minMs (smallest
	// burst) to maxMs (largest); shorter runs make no impact burst. Colored by
	// the run's activity category. At most four impact bursts per frame.
	impact: {
		minMs: 2000, // Default 2000 ms; shortest run that bursts, try 500–10000.
		maxMs: 120000, // Default 120000 ms; run length for full burst, try 30000–600000.
		minHops: 1, // Default 1; hop budget at minMs, integer 0–6.
		maxHops: 8, // Default 8; hop budget at maxMs, integer 1–12.
		minSpread: 1, // Default 1; initial edges at minMs, integer 1–6.
		maxSpread: 6, // Default 6; initial edges at maxMs, integer 1–12.
		neighbourSeeds: 4, // Default 4; adjacent seeds at maxMs (scaled from 0), integer 0–8.
		neighbourHops: 4, // Default 4; neighbour hop budget at maxMs (scaled from 0), integer 0–10.
		neighbourSpread: 2, // Default 2; initial edges per neighbour seed, integer 0–4.
		branchChance: 0.35, // Default 0.35; probability of 2 rather than 1 child, 0–1.
		seedHeat: 2, // Default 2; heat on central node at maxMs (scaled), try 0–3.
		nodeEnergy: 0.7, // Default 0.7; arrival energy, capped by nodes.energyCap.
		edgeIntensity: 0.8, // Default 0.8; edge palette light multiplier, try 0–2.
		head: 2.6, // Default 2.6; head size factor, try 1–5.
	},

	// SCENE — ordinary load-driven ambience, independent of completion events.
	// Brightness/opacity are unitless; bloom uses Three.js UnrealBloomPass units.
	// Edge fade is exponential decay per second; larger means shorter afterglow.
	scene: {
		background: 0x020409, // Decorative sRGB hex color.
		edgeVisibility: 'always', // 'always', 'active' (activity only), or 'hidden'; pulses unaffected.
		categoryBrightness: 0.9, // Linear scene category light multiplier, try 0–2.
		edgeBaseColor: [0.012, 0.04, 0.13], // Idle edge linear RGB.
		edgeVariationMin: 0.45, // Minimum random idle edge brightness, try 0–1.
		edgeVariationRange: 0.55, // Added random edge brightness, try 0–1.
		breathSpeed: 0.8, // Whole-lattice breathing frequency, try 0–2.
		breathAmplitude: 0.012, // Scale oscillation; keep < 1, try 0–0.05.
		loadPulseScale: 500, // Active pulses for full ambient load, > 0.
		loadSessionScale: 64, // Active sessions for full ambient load, > 0.
		loadSmoothing: 3, // Ambient response per second, try 0–10.
		coreColor: 0x3d8bff, // Decorative sRGB hex color.
		coreSize: 16, // Core sprite world units, try 8–24.
		haloColor: 0x2a6bff, // Decorative sRGB hex color.
		haloSize: 38, // Halo sprite world units, try 20–50.
		glowKnee: 0.25, // Radial texture's middle stop position, strictly 0–1.
		glowKneeOpacity: 0.35, // Middle stop opacity, 0–1.
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

export const VISUAL_PRESET = 'balanced';
export const VISUAL_OVERRIDES = {};
const resolution = resolveVisualSettings(VISUAL, VISUAL_PRESET, VISUAL_OVERRIDES);
export const EFFECTIVE_VISUAL = resolution.settings;
export const VISUAL_ERRORS = resolution.errors;
