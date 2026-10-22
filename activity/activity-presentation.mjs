import { createImpulseBuffer, createCategoryBurstPlan, createThinkingPulseClock, impulseIntensity, impactBurst } from './activity-client.mjs';
import { CATEGORIES, CATEGORY_INDEX, HOOK_TYPES } from './activity-colors.mjs';
import { createDemoActivity, DEMO_WAITING_IDS } from './demo-activity.mjs';

export function createActivityPresentation({ VISUAL, document, performance, hud, pulses, subagents, ambience, getNetwork, getActivityState }) {
  const impulseBuffer = createImpulseBuffer();
  const categoryBurstPlan = createCategoryBurstPlan();
  const demoActivity = createDemoActivity();
  let demoFrame = demoActivity.tick(0, VISUAL);
  // Set when observed state or settings re-render the waiting markers without demo IDs.
  let demoMarkersDirty = false;

  // ---------- interaction ----------
  const thinkingPulseClock = createThinkingPulseClock(VISUAL.running);

  // Blue running-state stream: observed running work (thinking, tools and
  // delegated agents), not a claim of hidden cognition.
  function renderThinking(dt) {
    const activityState = getActivityState();
    const { N, nodeEnergy } = getNetwork();
    const sessions = Math.min(activityState.runningSessions ?? 0, VISUAL.running.maxSessions);
    const count = thinkingPulseClock.tick(dt, activityState, document.hidden);
    for (let i = 0; i < count; i++) {
      const node = (Math.random() * N) | 0;
      const hops = VISUAL.running.baseHops + Math.min(VISUAL.running.maxExtraHops, Math.floor(Math.log2(sessions + 1)));
      pulses.fireFrom(node, hops, 0, -1, VISUAL.running.spread);
      nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap, nodeEnergy[node] + VISUAL.running.nodeEnergy);
    }
  }

  document.addEventListener('visibilitychange', () => {
    impulseBuffer.clear();
    hud.timeline.setCoverage(!document.hidden && getActivityState().connection === 'connected' &&
      getActivityState().sourceStatus === 'available' && getActivityState().coverage !== 'partial' &&
      getActivityState().coverage !== 'unknown', performance.now());
    if (document.hidden) {
      thinkingPulseClock.reset();
    } else {
      subagents.applySubagentTree({
        sessions: getActivityState().treeSessions ?? [],
        added: [],
        completed: [],
        failed: [],
        cleared: [],
        reset: true,
      });
    }
  });

  function renderCompletionCascade(node) {
    const { nodeHot, adjacency } = getNetwork();
    const edges = adjacency[node];
    nodeHot[node] = VISUAL.completion.seedHeat;
    pulses.fireFrom(node, VISUAL.completion.hops, 2, -1, Math.min(VISUAL.completion.spread, edges.length), CATEGORY_INDEX.completion);
    for (let i = 0; i < Math.min(VISUAL.completion.neighbourSeeds, edges.length); i++) {
      pulses.fireFrom(pulses.otherEnd(edges[i], node), VISUAL.completion.neighbourHops, 2, node,
        VISUAL.completion.neighbourSpread, CATEGORY_INDEX.completion);
    }
  }

  function renderImpactBurst(node, category, durationMs) {
    const { nodeHot, adjacency } = getNetwork();
    const burst = impactBurst(durationMs, VISUAL.impact);
    if (!burst) return;
    const edges = adjacency[node];
    nodeHot[node] = Math.max(nodeHot[node], burst.seedHeat);
    pulses.fireFrom(node, burst.hops, 3, -1, Math.min(burst.spread, edges.length), category);
    for (let i = 0; i < Math.min(burst.neighbourSeeds, edges.length); i++) {
      pulses.fireFrom(pulses.otherEnd(edges[i], node), burst.neighbourHops, 3, node, burst.neighbourSpread, category);
    }
  }

  function renderObservedImpulses(source = impulseBuffer, observed = true) {
    const { N, nodeEnergy, nodeHot } = getNetwork();
    const { byCategory, sceneByCategory, hookCounts, entries, impacts } = source.drain();
    if (document.hidden) return;
    if (observed) hud.timeline.add(byCategory, performance.now());
    for (let i = 0; i < impacts.length; i++) {
      renderImpactBurst((Math.random() * N) | 0, impacts[i].category, impacts[i].durationMs);
    }
    for (let i = 0; observed && i < entries.length; i++) {
      const { kind, toolName, eventType, count } = entries[i];
      hud.impulseFeed.add(kind, toolName, eventType, count);
    }
    renderHookPulses(hookCounts);
    // Counts strengthen a bounded impulse, rather than rendering one per token.
    const plan = categoryBurstPlan.plan(sceneByCategory);
    for (let i = 0; i < plan.length; i++) {
      const node = (Math.random() * N) | 0;
      const intensity = impulseIntensity(plan.counts[i], VISUAL.activity);
      const kind = plan.kinds[i];
      const category = plan.categories[i];
      if (kind === 2) {
        renderCompletionCascade(node);
        continue;
      }
      const hops = category === CATEGORY_INDEX.error ? VISUAL.activity.errorHops
        : kind === 0 ? VISUAL.activity.reasoningBaseHops + intensity : intensity;
      pulses.fireFrom(node, hops, kind, -1, Math.min(VISUAL.activity.maxSpread, intensity), category);
      if (kind === 0) nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap,
        nodeEnergy[node] + VISUAL.activity.reasoningEnergy * intensity);
      else nodeHot[node] = Math.min(VISUAL.activity.stepHeatCap, nodeHot[node] + VISUAL.activity.stepHeat * intensity);
    }
  }

  function renderHookPulses(counts) {
    const { N, nodeHot } = getNetwork();
    for (let index = 0; index < HOOK_TYPES.length; index++) {
      const strength = VISUAL.hooks[`${HOOK_TYPES[index]}Impact`];
      if (!counts[index] || strength === 0) continue;
      const intensity = Math.min(VISUAL.activity.maxIntensity,
        Math.max(1, Math.round(impulseIntensity(counts[index], VISUAL.activity) * strength)));
      const node = (Math.random() * N) | 0;
      pulses.fireFrom(node, intensity, 1, -1, Math.min(VISUAL.activity.maxSpread, intensity),
        CATEGORIES.length + index);
      nodeHot[node] = Math.min(VISUAL.activity.stepHeatCap,
        nodeHot[node] + VISUAL.activity.stepHeat * intensity);
    }
  }

  function observedWaitingIds() {
    return (getActivityState().connection === 'connected' || getActivityState().connection === 'recovering') &&
      getActivityState().sourceStatus !== 'unavailable' ? getActivityState().waitingSessionIds : NO_WAITING_IDS;
  }

  function renderDemoActivity(dt) {
    const { N, nodeEnergy } = getNetwork();
    const wasActive = demoFrame.active;
    const wasWaiting = demoFrame.waiting;
    demoFrame = demoActivity.tick(dt, VISUAL);
    if (demoFrame.active !== wasActive || demoFrame.waiting !== wasWaiting ||
        (demoMarkersDirty && demoFrame.active)) {
      demoMarkersDirty = false;
      const observedIds = observedWaitingIds();
      demoMarkerIds.length = 0;
      for (let i = 0; Array.isArray(observedIds) && i < observedIds.length; i++) demoMarkerIds.push(observedIds[i]);
      for (let i = 0; demoFrame.waiting && i < DEMO_WAITING_IDS.length; i++) demoMarkerIds.push(DEMO_WAITING_IDS[i]);
      ambience.renderWaitingMarkers(demoMarkerIds);
    }
    // The badge stays until the last tagged demo pulse has finished.
    const badgeVisible = demoFrame.active || pulses.demoPulses > 0;
    if (badgeVisible !== demoBadgeVisible) {
      demoBadgeVisible = badgeVisible;
      demoBadge.hidden = !badgeVisible;
    }
    if (!demoFrame.active) return;
    pulses.demoSpawn = 1;
    renderObservedImpulses(demoSource, false);
    demoThinkingState.runningSessions = demoFrame.runningSessions;
    const count = demoThinkingPulseClock.tick(dt, demoThinkingState, document.hidden);
    const hops = VISUAL.running.baseHops +
      Math.min(VISUAL.running.maxExtraHops, Math.floor(Math.log2(demoFrame.runningSessions + 1)));
    for (let i = 0; i < count; i++) {
      const node = (Math.random() * N) | 0;
      pulses.fireFrom(node, hops, 0, -1, VISUAL.running.spread);
      nodeEnergy[node] = Math.min(VISUAL.nodes.energyCap, nodeEnergy[node] + VISUAL.running.nodeEnergy);
    }
    pulses.demoSpawn = 0;
  }

  function setDemoRunning(running) {
    if (running === demoActivity.isRunning()) return;
    if (running) demoActivity.start();
    else {
      demoActivity.stop();
      demoThinkingPulseClock.reset();
    }
    demoToggle.checked = running;
    if (running) {
      demoBadgeVisible = true;
      demoBadge.hidden = false;
    }
  }
  const NO_WAITING_IDS = Object.freeze([]);

  // Appearance demo: synthetic scene-only bursts. It bypasses the timeline,
  // impulse feed, statistics, activity state and HUD counters.
  const demoSource = { drain: () => demoFrame };
  const demoThinkingPulseClock = createThinkingPulseClock(VISUAL.running);
  const demoThinkingState = { connection: 'connected', sourceStatus: 'available', runningSessions: 0 };
  const demoMarkerIds = [];
  let demoBadgeVisible = false;

  const demoToggle = document.getElementById('visual-settings-demo');
  const demoBadge = document.getElementById('demo-badge');

  demoToggle.addEventListener('change', () => setDemoRunning(demoToggle.checked));

  function receiveActivity(activity) {
    if (!document.hidden) impulseBuffer.add(activity);
    hud.acceptActivity(activity);
  }

  return {
    renderThinking, renderObservedImpulses, renderDemoActivity, receiveActivity, setDemoRunning,
    renderCompletionCascade, renderImpactBurst, renderHookPulses, observedWaitingIds,
    get demoFrame() { return demoFrame; },
    markDemoDirty() { demoMarkersDirty = true; },
    resetThinking() { thinkingPulseClock.reset(); },
    clearImpulses() { impulseBuffer.clear(); },
    previewMode(reducedMotion) { return !demoActivity.isRunning() ? 'off' : reducedMotion ? 'focus' : 'sweep'; },
    setDemoFocus(focus) { demoActivity.setFocus(focus); },
  };
}
