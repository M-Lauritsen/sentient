import * as THREE from 'three';
import { CATEGORY_HEX } from '../activity-colors.mjs';

export function createAmbience({ VISUAL, CFG, brain, scene, bloom, pixelRatio, getNetwork, document, random = Math.random }) {
  // ---------- dust ----------
  {
    const pos = new Float32Array(CFG.dust * 3);
    const phase = new Float32Array(CFG.dust);
    const v = new THREE.Vector3();
    for (let i = 0; i < CFG.dust; i++) {
      v.randomDirection().multiplyScalar(CFG.radius * (0.2 + Math.pow(random(), 0.5) * 1.5));
      v.toArray(pos, i * 3);
      phase[i] = random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    var dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uScale: { value: VISUAL.dust.scale * pixelRatio },
        uBrightness: { value: VISUAL.scene.dustBrightness },
        uColor: { value: new THREE.Vector3(...VISUAL.dust.color) },
        uTwinkleBase: { value: VISUAL.dust.twinkleBase },
        uTwinkleAmplitude: { value: VISUAL.dust.twinkleAmplitude },
        uTwinkleSpeed: { value: VISUAL.dust.twinkleSpeed },
        uTwinklePhase: { value: VISUAL.dust.twinklePhase },
        uTwinklePower: { value: VISUAL.dust.twinklePower },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uScale;
        uniform float uTwinkleBase;
        uniform float uTwinkleAmplitude;
        uniform float uTwinkleSpeed;
        uniform float uTwinklePhase;
        uniform float uTwinklePower;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = uTwinkleBase + uTwinkleAmplitude * pow(0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aPhase * uTwinklePhase), uTwinklePower);
          gl_PointSize = uScale / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uBrightness;
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor * vA * uBrightness * smoothstep(0.5, 0.0, d), 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    var dust = new THREE.Points(geo, dustMat);
    dust.visible = VISUAL.effects.dust;
    scene.add(dust);
  }

  // ---------- core glow ----------
  function radialTexture(settings = VISUAL) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(settings.scene.glowKnee, `rgba(255,255,255,${settings.scene.glowKneeOpacity})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  let glowTex = radialTexture();
  const coreGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: VISUAL.scene.coreColor,
      transparent: true,
      opacity: VISUAL.scene.coreOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  coreGlow.scale.setScalar(VISUAL.scene.coreSize);
  brain.add(coreGlow);
  const baseCoreColor = new THREE.Color(VISUAL.scene.coreColor);
  const waitingCoreColor = new THREE.Color(CATEGORY_HEX.waiting);
  const waitingMarkerMaterial = new THREE.SpriteMaterial({
    map: glowTex,
    color: CATEGORY_HEX.waiting,
    transparent: true,
    opacity: VISUAL.waiting.markerOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const waitingMarkerGroups = Array.from({ length: 8 }, () => {
    const cluster = new THREE.Group();
    for (const [x, y, z] of [[0, 0, 0], [0.32, 0.12, 0], [-0.2, -0.26, 0.18]]) {
      const marker = new THREE.Sprite(waitingMarkerMaterial);
      marker.position.set(x, y, z);
      marker.scale.setScalar(VISUAL.waiting.markerSize);
      cluster.add(marker);
    }
    cluster.visible = false;
    brain.add(cluster);
    return cluster;
  });
  const haloGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: VISUAL.scene.haloColor,
      transparent: true,
      opacity: VISUAL.scene.haloOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  haloGlow.scale.setScalar(VISUAL.scene.haloSize);
  brain.add(haloGlow);

  // ---------- grid floor ----------
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 0 },
      uBrightness: { value: VISUAL.scene.floorBrightness },
      uFade: { value: VISUAL.scene.floorFade },
      uFineSpacing: { value: VISUAL.floor.fineSpacing },
      uFineIntensity: { value: VISUAL.floor.fineIntensity },
      uCoarseSpacing: { value: VISUAL.floor.coarseSpacing },
      uCoarseIntensity: { value: VISUAL.floor.coarseIntensity },
      uColor: { value: new THREE.Vector3(...VISUAL.floor.color) },
      uPoolColor: { value: new THREE.Vector3(...VISUAL.floor.poolColor) },
      uPoolFade: { value: VISUAL.floor.poolFade },
      uPoolBase: { value: VISUAL.floor.poolBase },
      uPoolGrid: { value: VISUAL.floor.poolGrid },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      uniform float uBrightness;
      uniform float uFade;
      uniform float uFineSpacing;
      uniform float uFineIntensity;
      uniform float uCoarseSpacing;
      uniform float uCoarseIntensity;
      uniform vec3 uColor;
      uniform vec3 uPoolColor;
      uniform float uPoolFade;
      uniform float uPoolBase;
      uniform float uPoolGrid;
      varying vec3 vW;
      float grid(vec2 p, float s) {
        vec2 q = p / s;
        vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vW.xz);
        float g = grid(vW.xz, uFineSpacing) * uFineIntensity + grid(vW.xz, uCoarseSpacing) * uCoarseIntensity;
        float fade = exp(-d * uFade);
        vec3 col = uColor * g * fade * uBrightness;
        float pool = exp(-d * uPoolFade) * uGlow;
        col += uPoolColor * pool * (uPoolBase + g * uPoolGrid);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    extensions: { derivatives: true },
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -15;
  floor.visible = VISUAL.effects.floor;
  scene.add(floor);

  function renderWaitingMarkers(sessionIds) {
    const { N, nodePos } = getNetwork();
    const waiting = Array.isArray(sessionIds) ? sessionIds.slice(0, 8) : [];
    for (let index = 0; index < waitingMarkerGroups.length; index++) {
      const cluster = waitingMarkerGroups[index];
      const id = waiting[index];
      cluster.visible = VISUAL.effects.waitingMarkers && Boolean(id);
      if (!id) continue;
      let hash = 0;
      for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      const node = hash % N;
      cluster.userData.anchorIndex = node;
      cluster.position.set(nodePos[node * 3], nodePos[node * 3 + 1], nodePos[node * 3 + 2]);
    }
  }

  let smoothedLoad = 0;
  function update(dt, now, activePulses, activityState, demoFrame) {
    // ambience
    const load = Math.min(1, activePulses / VISUAL.scene.loadPulseScale + activityState.activeSessions / VISUAL.scene.loadSessionScale);
    smoothedLoad += (load - smoothedLoad) * Math.min(1, dt * VISUAL.scene.loadSmoothing);

    const breathe = VISUAL.effects.latticeBreathing
      ? 1 + Math.sin(now * VISUAL.scene.breathSpeed) * VISUAL.scene.breathAmplitude : 1;
    brain.scale.setScalar(breathe);
    const waitingGlow = ((activityState.connection === 'connected' || activityState.connection === 'recovering') &&
      activityState.sourceStatus !== 'unavailable' && activityState.waitingSessions > 0) || demoFrame.waiting;
    const waitBreath = VISUAL.waiting.colorMixMin +
      VISUAL.waiting.colorMixRange * (0.5 + 0.5 * Math.sin(now * VISUAL.waiting.breathSpeed));
    const showWaitingGlow = VISUAL.effects.waitingGlow && waitingGlow;
    coreGlow.material.color.lerpColors(baseCoreColor, waitingCoreColor, showWaitingGlow ? waitBreath : 0);
    coreGlow.material.opacity = VISUAL.scene.coreOpacity + smoothedLoad * VISUAL.scene.coreLoad;
    if (showWaitingGlow) coreGlow.material.opacity += VISUAL.waiting.opacityBase + waitBreath * VISUAL.waiting.opacityBreath;
    haloGlow.material.opacity = VISUAL.scene.haloOpacity + smoothedLoad * VISUAL.scene.haloLoad;
    bloom.strength = VISUAL.scene.bloomStrength + smoothedLoad * VISUAL.scene.bloomLoad;
    dust.rotation.y = now * VISUAL.dust.rotationSpeed;
    dust.rotation.x = Math.sin(now * VISUAL.dust.tiltSpeed) * VISUAL.dust.tiltAmplitude;

    dustMat.uniforms.uTime.value = now;
    floorMat.uniforms.uTime.value = now;
    floorMat.uniforms.uGlow.value = smoothedLoad * VISUAL.scene.floorGlow;

  }

  function applySettings(nextGlowTexture) {
    const dustUniforms = dustMat.uniforms;
    dustUniforms.uScale.value = VISUAL.dust.scale * pixelRatio;
    dustUniforms.uBrightness.value = VISUAL.scene.dustBrightness;
    dustUniforms.uColor.value.set(...VISUAL.dust.color);
    dustUniforms.uTwinkleBase.value = VISUAL.dust.twinkleBase;
    dustUniforms.uTwinkleAmplitude.value = VISUAL.dust.twinkleAmplitude;
    dustUniforms.uTwinkleSpeed.value = VISUAL.dust.twinkleSpeed;
    dustUniforms.uTwinklePhase.value = VISUAL.dust.twinklePhase;
    dustUniforms.uTwinklePower.value = VISUAL.dust.twinklePower;
    dust.visible = VISUAL.effects.dust;

    if (nextGlowTexture) {
      const previousTexture = glowTex;
      glowTex = nextGlowTexture;
      coreGlow.material.map = glowTex;
      waitingMarkerMaterial.map = glowTex;
      haloGlow.material.map = glowTex;
      coreGlow.material.needsUpdate = true;
      waitingMarkerMaterial.needsUpdate = true;
      haloGlow.material.needsUpdate = true;
      previousTexture.dispose();
    }
    coreGlow.material.color.set(VISUAL.scene.coreColor);
    baseCoreColor.set(VISUAL.scene.coreColor);
    coreGlow.scale.setScalar(VISUAL.scene.coreSize);
    haloGlow.material.color.set(VISUAL.scene.haloColor);
    haloGlow.scale.setScalar(VISUAL.scene.haloSize);
    waitingMarkerMaterial.opacity = VISUAL.waiting.markerOpacity;
    for (const group of waitingMarkerGroups) {
      for (const marker of group.children) marker.scale.setScalar(VISUAL.waiting.markerSize);
    }

    const floorUniforms = floorMat.uniforms;
    floorUniforms.uBrightness.value = VISUAL.scene.floorBrightness;
    floorUniforms.uFade.value = VISUAL.scene.floorFade;
    floorUniforms.uFineSpacing.value = VISUAL.floor.fineSpacing;
    floorUniforms.uFineIntensity.value = VISUAL.floor.fineIntensity;
    floorUniforms.uCoarseSpacing.value = VISUAL.floor.coarseSpacing;
    floorUniforms.uCoarseIntensity.value = VISUAL.floor.coarseIntensity;
    floorUniforms.uColor.value.set(...VISUAL.floor.color);
    floorUniforms.uPoolColor.value.set(...VISUAL.floor.poolColor);
    floorUniforms.uPoolFade.value = VISUAL.floor.poolFade;
    floorUniforms.uPoolBase.value = VISUAL.floor.poolBase;
    floorUniforms.uPoolGrid.value = VISUAL.floor.poolGrid;
    floor.visible = VISUAL.effects.floor;

  }

  function followMarkers(nodePos) {
    for (const cluster of waitingMarkerGroups) {
      if (!cluster.visible || cluster.userData.anchorIndex === undefined) continue;
      cluster.position.fromArray(nodePos, cluster.userData.anchorIndex * 3);
    }
  }

  return {
    radialTexture, renderWaitingMarkers, followMarkers, update, applySettings,
    resources: { dust, dustMat, coreGlow, haloGlow, waitingMarkerMaterial, waitingMarkerGroups, floor, floorMat },
  };
}
