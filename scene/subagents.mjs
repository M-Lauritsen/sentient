import * as THREE from 'three';
import { CATEGORY_INDEX } from '../activity/activity-colors.mjs';
import { summarizeSubagents } from '../activity/activity-client.mjs';
import { MAX_ACTIVE_SUBAGENT_BRANCHES, MAX_FADING_SUBAGENT_BRANCHES, MAX_SUBAGENT_ANCHORS } from './structural-config.mjs';

export function createSubagentRenderer({ VISUAL, SCENE_RGB, brain, pixelRatio, getNetwork, getActivityState, getReducedMotion, document, performance }) {
  let SUBAGENT_FADE_SECONDS = VISUAL.subagents.fadeSeconds;
  let SUBAGENT_GROW_SECONDS = VISUAL.subagents.growSeconds;
  const subagentSummary = document.getElementById('subagent-summary');
  const branchLinePositions = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 6);
  const branchLineColors = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 6);
  const branchTipPositions = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 3);
  const branchTipColors = new Float32Array(MAX_ACTIVE_SUBAGENT_BRANCHES * 3);
  const fadingLinePositions = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 6);
  const fadingLineColors = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 6);
  const fadingTipPositions = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 3);
  const fadingTipColors = new Float32Array(MAX_FADING_SUBAGENT_BRANCHES * 3);
  const anchorPositions = new Float32Array(MAX_SUBAGENT_ANCHORS * 3);
  const anchorColors = new Float32Array(MAX_SUBAGENT_ANCHORS * 3);
  const activeSubagentBranches = [];
  const subagentBranchByKey = new Map();
  const fadingSubagentBranches = [];
  const subagentAnchors = [];
  const subagentAnchorBySid = new Map();

  const branchGeo = new THREE.BufferGeometry();
  branchGeo.setAttribute('position', new THREE.BufferAttribute(branchLinePositions, 3).setUsage(THREE.DynamicDrawUsage));
  branchGeo.setAttribute('color', new THREE.BufferAttribute(branchLineColors, 3).setUsage(THREE.DynamicDrawUsage));
  const branchLines = new THREE.LineSegments(branchGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  branchLines.frustumCulled = false;
  brain.add(branchLines);

  const branchTipGeo = new THREE.BufferGeometry();
  branchTipGeo.setAttribute('position', new THREE.BufferAttribute(branchTipPositions, 3).setUsage(THREE.DynamicDrawUsage));
  branchTipGeo.setAttribute('color', new THREE.BufferAttribute(branchTipColors, 3).setUsage(THREE.DynamicDrawUsage));
  const branchTips = new THREE.Points(branchTipGeo, new THREE.PointsMaterial({
    size: VISUAL.subagents.tipSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  branchTips.frustumCulled = false;
  brain.add(branchTips);

  const fadingGeo = new THREE.BufferGeometry();
  fadingGeo.setAttribute('position', new THREE.BufferAttribute(fadingLinePositions, 3).setUsage(THREE.DynamicDrawUsage));
  fadingGeo.setAttribute('color', new THREE.BufferAttribute(fadingLineColors, 3).setUsage(THREE.DynamicDrawUsage));
  const fadingLines = new THREE.LineSegments(fadingGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fadingLines.frustumCulled = false;
  brain.add(fadingLines);

  const fadingTipGeo = new THREE.BufferGeometry();
  fadingTipGeo.setAttribute('position', new THREE.BufferAttribute(fadingTipPositions, 3).setUsage(THREE.DynamicDrawUsage));
  fadingTipGeo.setAttribute('color', new THREE.BufferAttribute(fadingTipColors, 3).setUsage(THREE.DynamicDrawUsage));
  const fadingTips = new THREE.Points(fadingTipGeo, new THREE.PointsMaterial({
    size: VISUAL.subagents.fadingTipSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fadingTips.frustumCulled = false;
  brain.add(fadingTips);

  const anchorGeo = new THREE.BufferGeometry();
  anchorGeo.setAttribute('position', new THREE.BufferAttribute(anchorPositions, 3).setUsage(THREE.DynamicDrawUsage));
  anchorGeo.setAttribute('color', new THREE.BufferAttribute(anchorColors, 3).setUsage(THREE.DynamicDrawUsage));
  const anchorPoints = new THREE.Points(anchorGeo, new THREE.PointsMaterial({
    size: VISUAL.subagents.anchorSize * pixelRatio, sizeAttenuation: false, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  anchorPoints.frustumCulled = false;
  brain.add(anchorPoints);

  function hashTreeSid(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
  }

  function treeBranchKey(sessionSid, sid) {
    return `${sessionSid}:${sid}`;
  }

  function updateSubagentSummary(sessions) {
    const activityState = getActivityState();
    if (activityState.connection !== 'connected' || activityState.sourceStatus === 'unavailable' ||
        activityState.coverage === 'unknown') {
      subagentSummary.textContent = 'Delegated work status unavailable during a connection or source gap.';
      return;
    }
    const summary = summarizeSubagents(sessions);
    subagentSummary.textContent = activityState.coverage === 'partial'
      ? `Partial coverage. ${summary}`
      : summary;
  }

  function addSubagentBranch(session, child, animate) {
    const { nodePos } = getNetwork(); const reducedMotion = getReducedMotion();
    if (activeSubagentBranches.length >= MAX_ACTIVE_SUBAGENT_BRANCHES) return;
    const hash = hashTreeSid(child.sid);
    const anchorOffset = session.anchorIndex * 3;
    const nx = nodePos[anchorOffset], ny = nodePos[anchorOffset + 1], nz = nodePos[anchorOffset + 2];
    const normalLength = Math.hypot(nx, ny, nz) || 1;
    const normalX = nx / normalLength, normalY = ny / normalLength, normalZ = nz / normalLength;
    const y = ((hash & 0xffff) / 32767.5) - 1;
    const angle = ((hash >>> 16) / 65536) * Math.PI * 2;
    let tangentX = Math.sqrt(Math.max(0, 1 - y * y)) * Math.cos(angle);
    let tangentY = y;
    let tangentZ = Math.sqrt(Math.max(0, 1 - y * y)) * Math.sin(angle);
    const projection = tangentX * normalX + tangentY * normalY + tangentZ * normalZ;
    tangentX -= projection * normalX;
    tangentY -= projection * normalY;
    tangentZ -= projection * normalZ;
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
    const directionX = normalX + tangentX / tangentLength * 0.4;
    const directionY = normalY + tangentY / tangentLength * 0.4;
    const directionZ = normalZ + tangentZ / tangentLength * 0.4;
    const directionLength = Math.hypot(directionX, directionY, directionZ);
    const branch = {
      key: treeBranchKey(session.sid, child.sid),
      sid: child.sid,
      sessionSid: session.sid,
      anchorIndex: session.anchorIndex,
      directionX: directionX / directionLength,
      directionY: directionY / directionLength,
      directionZ: directionZ / directionLength,
      length: 2 + ((hash >>> 8) % 2001) / 1000,
      growthStart: animate ? performance.now() / 1000 : -Infinity,
      startedAt: performance.now() / 1000 - child.ageMs / 1000,
      fadeStart: 0,
      outcome: '',
      slot: activeSubagentBranches.length,
    };
    activeSubagentBranches.push(branch);
    subagentBranchByKey.set(branch.key, branch);
  }

  function retireSubagentBranch(sessionSid, sid, outcome, now) {
    const reducedMotion = getReducedMotion();
    const key = treeBranchKey(sessionSid, sid);
    const branch = subagentBranchByKey.get(key);
    if (!branch) return;
    const slot = branch.slot;
    const last = activeSubagentBranches.pop();
    if (slot < activeSubagentBranches.length) {
      activeSubagentBranches[slot] = last;
      last.slot = slot;
    }
    subagentBranchByKey.delete(key);
    if (reducedMotion || !VISUAL.effects.subagentTransitions) return;
    branch.outcome = outcome;
    branch.fadeStart = now;
    if (fadingSubagentBranches.length >= MAX_FADING_SUBAGENT_BRANCHES) fadingSubagentBranches.shift();
    fadingSubagentBranches.push(branch);
  }

  function applySubagentTree(tree) {
    const { N } = getNetwork(); const reducedMotion = getReducedMotion();
    const now = performance.now() / 1000;
    subagentAnchors.length = 0;
    subagentAnchorBySid.clear();
    for (const item of tree.sessions) {
      if (!item.subagents.length) continue;
      if (subagentAnchors.length >= MAX_SUBAGENT_ANCHORS) break;
      const session = { sid: item.sid, status: item.status, anchorIndex: hashTreeSid(item.sid) % N };
      subagentAnchors.push(session);
      subagentAnchorBySid.set(session.sid, session);
    }
    updateSubagentSummary(tree.sessions);
    if (tree.reset || document.hidden) {
      activeSubagentBranches.length = 0;
      subagentBranchByKey.clear();
      fadingSubagentBranches.length = 0;
      for (const item of tree.sessions) {
        const session = subagentAnchorBySid.get(item.sid);
        if (!session) continue;
        for (const child of item.subagents) addSubagentBranch(session, child, false);
      }
      return;
    }
    for (const outcome of ['completed', 'failed', 'cleared']) {
      for (const branch of tree[outcome]) retireSubagentBranch(branch.sessionSid, branch.sid, outcome, now);
    }
    for (const branch of tree.added) {
      const session = subagentAnchorBySid.get(branch.sessionSid);
      if (session) addSubagentBranch(session, branch, !reducedMotion && VISUAL.effects.subagentTransitions);
    }
  }

  function writeTreeColor(colors, offset, r, g, b, intensity) {
    colors[offset] = r * intensity;
    colors[offset + 1] = g * intensity;
    colors[offset + 2] = b * intensity;
  }

  function writeTreeCategory(colors, offset, category, intensity) {
    const rgb = category * 3;
    writeTreeColor(colors, offset, SCENE_RGB[rgb], SCENE_RGB[rgb + 1], SCENE_RGB[rgb + 2], intensity);
  }

  function renderSubagentTree(now) {
    const { nodePos } = getNetwork(); const reducedMotion = getReducedMotion();
    for (let i = 0; i < subagentAnchors.length; i++) {
      const session = subagentAnchors[i];
      const offset = session.anchorIndex * 3;
      const colorOffset = i * 3;
      anchorPositions[colorOffset] = nodePos[offset];
      anchorPositions[colorOffset + 1] = nodePos[offset + 1];
      anchorPositions[colorOffset + 2] = nodePos[offset + 2];
      if (session.status === 'running') writeTreeColor(anchorColors, colorOffset,
        ...VISUAL.subagents.runningAnchorColor, VISUAL.subagents.runningAnchorIntensity);
      else if (session.status === 'waiting') writeTreeCategory(anchorColors, colorOffset,
        CATEGORY_INDEX.waiting, VISUAL.subagents.waitingAnchorIntensity);
      else if (session.status === 'stuck') writeTreeColor(anchorColors, colorOffset,
        ...VISUAL.subagents.stuckAnchorColor, VISUAL.subagents.stuckAnchorIntensity);
      else writeTreeColor(anchorColors, colorOffset,
        ...VISUAL.subagents.quietAnchorColor, VISUAL.subagents.quietAnchorIntensity);
    }
    anchorGeo.setDrawRange(0, subagentAnchors.length);
    anchorGeo.attributes.position.needsUpdate = true;
    anchorGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < activeSubagentBranches.length; i++) {
      const branch = activeSubagentBranches[i];
      const anchorOffset = branch.anchorIndex * 3;
      const lineOffset = i * 6;
      const tipOffset = i * 3;
      const session = subagentAnchorBySid.get(branch.sessionSid);
      const growth = reducedMotion || !VISUAL.effects.subagentTransitions ? 1
        : Math.min(1, Math.max(0, (now - branch.growthStart) / SUBAGENT_GROW_SECONDS));
      const length = branch.length * growth;
      const x = nodePos[anchorOffset], y = nodePos[anchorOffset + 1], z = nodePos[anchorOffset + 2];
      const ex = x + branch.directionX * length;
      const ey = y + branch.directionY * length;
      const ez = z + branch.directionZ * length;
      branchLinePositions[lineOffset] = x;
      branchLinePositions[lineOffset + 1] = y;
      branchLinePositions[lineOffset + 2] = z;
      branchLinePositions[lineOffset + 3] = ex;
      branchLinePositions[lineOffset + 4] = ey;
      branchLinePositions[lineOffset + 5] = ez;
      branchTipPositions[tipOffset] = ex;
      branchTipPositions[tipOffset + 1] = ey;
      branchTipPositions[tipOffset + 2] = ez;
      const intensity = Math.min(VISUAL.subagents.maxIntensity, VISUAL.subagents.initialIntensity +
        (VISUAL.effects.subagentTransitions
          ? Math.max(0, now - branch.startedAt) * VISUAL.subagents.intensityPerSecond : 0));
      // No per-child last-activity attribution crosses the wire. Do not infer it
      // from aggregate events: delegated activity uses its role, waiting its cue.
      const category = session?.status === 'waiting' ? CATEGORY_INDEX.waiting : CATEGORY_INDEX.subagent;
      writeTreeCategory(branchLineColors, lineOffset, category, intensity);
      writeTreeCategory(branchLineColors, lineOffset + 3, category, intensity);
      writeTreeCategory(branchTipColors, tipOffset, category, intensity);
    }
    branchGeo.setDrawRange(0, activeSubagentBranches.length * 2);
    branchTipGeo.setDrawRange(0, activeSubagentBranches.length);
    branchGeo.attributes.position.needsUpdate = true;
    branchGeo.attributes.color.needsUpdate = true;
    branchTipGeo.attributes.position.needsUpdate = true;
    branchTipGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < fadingSubagentBranches.length;) {
      if (now - fadingSubagentBranches[i].fadeStart >= SUBAGENT_FADE_SECONDS) {
        fadingSubagentBranches[i] = fadingSubagentBranches[fadingSubagentBranches.length - 1];
        fadingSubagentBranches.pop();
      } else i++;
    }
    for (let i = 0; i < fadingSubagentBranches.length; i++) {
      const branch = fadingSubagentBranches[i];
      const offset = branch.anchorIndex * 3;
      const lineOffset = i * 6;
      const age = Math.max(0, (now - branch.fadeStart) / SUBAGENT_FADE_SECONDS);
      const flash = branch.outcome === 'failed' && age < VISUAL.subagents.failureFlashFraction
        ? VISUAL.subagents.failureFlashIntensity : 1;
      const intensity = (1 - age) * flash *
        (branch.outcome === 'completed' && age < VISUAL.subagents.completionFlashFraction
          ? VISUAL.subagents.completionFlashBase + age * VISUAL.subagents.completionFlashGrowth : 1);
      const x = nodePos[offset], y = nodePos[offset + 1], z = nodePos[offset + 2];
      fadingLinePositions[lineOffset] = x;
      fadingLinePositions[lineOffset + 1] = y;
      fadingLinePositions[lineOffset + 2] = z;
      fadingLinePositions[lineOffset + 3] = x + branch.directionX * branch.length;
      fadingLinePositions[lineOffset + 4] = y + branch.directionY * branch.length;
      fadingLinePositions[lineOffset + 5] = z + branch.directionZ * branch.length;
      fadingTipPositions[i * 3] = fadingLinePositions[lineOffset + 3];
      fadingTipPositions[i * 3 + 1] = fadingLinePositions[lineOffset + 4];
      fadingTipPositions[i * 3 + 2] = fadingLinePositions[lineOffset + 5];
      if (branch.outcome === 'failed') {
        writeTreeCategory(fadingLineColors, lineOffset, CATEGORY_INDEX.error, intensity);
        writeTreeCategory(fadingTipColors, i * 3, CATEGORY_INDEX.error, intensity);
      } else if (branch.outcome === 'cleared') {
        writeTreeColor(fadingLineColors, lineOffset, ...VISUAL.subagents.clearedLineColor, intensity);
        writeTreeColor(fadingTipColors, i * 3, ...VISUAL.subagents.clearedTipColor, intensity);
      } else {
        writeTreeCategory(fadingLineColors, lineOffset, CATEGORY_INDEX.subagent, intensity);
        writeTreeCategory(fadingTipColors, i * 3, CATEGORY_INDEX.subagent, intensity);
      }
      fadingLineColors[lineOffset + 3] = fadingLineColors[lineOffset];
      fadingLineColors[lineOffset + 4] = fadingLineColors[lineOffset + 1];
      fadingLineColors[lineOffset + 5] = fadingLineColors[lineOffset + 2];
    }
    fadingGeo.setDrawRange(0, fadingSubagentBranches.length * 2);
    fadingTipGeo.setDrawRange(0, fadingSubagentBranches.length);
    fadingGeo.attributes.position.needsUpdate = true;
    fadingGeo.attributes.color.needsUpdate = true;
    fadingTipGeo.attributes.position.needsUpdate = true;
    fadingTipGeo.attributes.color.needsUpdate = true;
  }

  function remapAnchors() {
    const { N } = getNetwork();
    for (const session of subagentAnchors) session.anchorIndex = hashTreeSid(session.sid) % N;
    for (const branch of [...activeSubagentBranches, ...fadingSubagentBranches]) {
      branch.anchorIndex = hashTreeSid(branch.sessionSid) % N;
    }
  }
  function finishTransitions() {
    for (const branch of activeSubagentBranches) branch.growthStart = -Infinity;
    fadingSubagentBranches.length = 0;
  }
  function applySettings(changed) {
    if (changed('subagents.growSeconds')) SUBAGENT_GROW_SECONDS = VISUAL.subagents.growSeconds;
    if (changed('subagents.fadeSeconds')) SUBAGENT_FADE_SECONDS = VISUAL.subagents.fadeSeconds;
    branchTips.material.size = VISUAL.subagents.tipSize * pixelRatio;
    fadingTips.material.size = VISUAL.subagents.fadingTipSize * pixelRatio;
    anchorPoints.material.size = VISUAL.subagents.anchorSize * pixelRatio;

  }

  return {
    applySubagentTree, updateSubagentSummary, renderSubagentTree, remapAnchors, finishTransitions, applySettings,
    addSubagentBranch, retireSubagentBranch,
    buffers: { subagentAnchors, subagentAnchorBySid, activeSubagentBranches, fadingSubagentBranches,
      anchorPositions, anchorColors, branchLinePositions, branchLineColors, fadingLineColors,
      branchGeo, branchTipGeo, fadingGeo, fadingTipGeo, anchorGeo,
      branchTips, fadingTips, anchorPoints },
  };
}
