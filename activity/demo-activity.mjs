import { CATEGORIES, CATEGORY_INDEX, HOOK_TYPES } from './activity-colors.mjs';

// Synthetic, scene-only activity for previewing appearance settings. Its output
// must never reach the timeline, statistics, HUD counters or activity state.
export const DEMO_WAITING_IDS = Object.freeze(['demo-waiting-a', 'demo-waiting-b']);

const PULSE_COUNTS = [1, 4, 16];
const IMPACT_CATEGORIES = ['tool', 'shell', 'edit'];

function buildSteps() {
  const steps = [];
  for (const category of CATEGORIES) {
    if (category === 'waiting' || category === 'completion') continue;
    steps.push({ type: 'category', index: CATEGORY_INDEX[category] });
  }
  for (let index = 0; index < HOOK_TYPES.length; index++) steps.push({ type: 'hook', index });
  steps.push({ type: 'category', index: CATEGORY_INDEX.completion });
  steps.push({ type: 'impact' });
  return steps;
}

// Focused demos repeat one effect in isolation; waiting/running have no steps.
function buildFocusSteps(steps) {
  const completion = CATEGORY_INDEX.completion;
  return {
    hooks: steps.filter((step) => step.type === 'hook'),
    impact: steps.filter((step) => step.type === 'impact'),
    completion: steps.filter((step) => step.type === 'category' && step.index === completion),
    pulses: steps.filter((step) => step.type === 'category' && step.index !== completion),
    waiting: [],
    running: [],
  };
}

// Large cascades need time to read before the next one starts.
const SLOW_FOCUSES = new Set(['impact', 'completion']);

export function createDemoActivity({
  stepSeconds = 0.6,
  runningSessions = 2,
  waitingSeconds = 5,
} = {}) {
  const steps = buildSteps();
  const focusSteps = buildFocusSteps(steps);
  const cycleSeconds = steps.length * stepSeconds;
  const sceneByCategory = new Uint32Array(CATEGORIES.length);
  // Same shape as an impulse-buffer drain so the scene renderer can consume it;
  // byCategory and entries stay empty because demo activity is never recorded.
  const result = {
    active: false,
    byCategory: new Uint32Array(CATEGORIES.length),
    sceneByCategory,
    hookCounts: new Uint32Array(HOOK_TYPES.length),
    entries: Object.freeze([]),
    impacts: [],
    runningSessions: 0,
    waiting: false,
  };
  const impact = { category: 0, durationMs: 0 };
  let running = false;
  let elapsed = 0;
  let accumulated = 0;
  let stepIndex = 0;
  let cycle = 0;
  let focus = null;
  let activeSteps = steps;
  let interval = stepSeconds;

  function clearResult() {
    result.sceneByCategory.fill(0);
    result.hookCounts.fill(0);
    result.impacts.length = 0;
  }

  function fire(step, settings) {
    if (step.type === 'category') {
      result.sceneByCategory[step.index] = PULSE_COUNTS[cycle % PULSE_COUNTS.length];
    } else if (step.type === 'hook') {
      result.hookCounts[step.index] = 1;
    } else {
      const { minMs, maxMs } = settings.impact;
      const durationStep = cycle % 3;
      impact.category = CATEGORY_INDEX[IMPACT_CATEGORIES[cycle % IMPACT_CATEGORIES.length]];
      impact.durationMs = durationStep === 0 ? minMs
        : durationStep === 1 ? Math.sqrt(minMs * maxMs) : maxMs;
      result.impacts.push(impact);
    }
  }

  return {
    cycleSeconds,
    isRunning: () => running,
    focus: () => focus,
    start() {
      running = true;
      elapsed = 0;
      focus = null;
      activeSteps = steps;
      interval = stepSeconds;
      accumulated = interval;
      stepIndex = 0;
      cycle = 0;
    },
    stop() {
      running = false;
    },
    setFocus(next) {
      const normalized = Object.hasOwn(focusSteps, next) ? next : null;
      if (normalized === focus) return;
      focus = normalized;
      activeSteps = focus === null ? steps : focusSteps[focus];
      interval = SLOW_FOCUSES.has(focus) ? stepSeconds * 2 : stepSeconds;
      accumulated = interval;
      stepIndex = 0;
    },
    tick(dt, settings) {
      clearResult();
      result.active = running;
      if (!running) {
        result.runningSessions = 0;
        result.waiting = false;
        return result;
      }
      result.runningSessions = focus === null || focus === 'running' ? runningSessions : 0;
      if (Number.isFinite(dt) && dt > 0) {
        const step = Math.min(dt, interval);
        elapsed += step;
        accumulated += step;
      }
      // Waiting glow occupies the final part of each mixed cycle.
      result.waiting = focus === 'waiting' || (focus === null &&
        elapsed % cycleSeconds >= cycleSeconds - Math.min(waitingSeconds, cycleSeconds / 2));
      if (accumulated >= interval) {
        accumulated -= interval;
        if (activeSteps.length) {
          fire(activeSteps[stepIndex], settings);
          stepIndex++;
          if (stepIndex >= activeSteps.length) {
            stepIndex = 0;
            cycle++;
          }
        }
      }
      return result;
    },
  };
}
