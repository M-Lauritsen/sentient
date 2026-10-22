function endDissolve(y, radius) {
  const end = Math.max(0, Math.min(1, (Math.abs(y) / (radius * 1.1) - 0.72) / 0.28));
  return end * end * (3 - 2 * end);
}

export const dna = {
  id: 'dna',
  moving: true,
  presentation: {
    rotationZ: -0.55,
    autoOrbit: false,
    nodeDissolveHalfLength: 1.1,
    edgeBrightness(nodePos, a, b, radius) {
      return (1 - endDissolve(Math.max(Math.abs(nodePos[a * 3 + 1]),
        Math.abs(nodePos[b * 3 + 1])), radius)) ** 4;
    },
    pulseBrightness(y, isHead, radius) {
      const dissolve = endDissolve(y, radius);
      return isHead ? 1 - 0.85 * dissolve : (1 - dissolve) ** 4;
    },
  },
  createLayout({ N, radius }) {
    const samples = Math.max(1, Math.floor(N * 0.4));
    const interior = N - samples * 2;
    const rungs = Math.min(36, samples, interior);
    return {
      placeNode(nodePos, i) {
        if (i >= samples * 2) return;
        const t = samples === 1 ? 0.5 : Math.floor(i / 2) / (samples - 1);
        const angle = t * Math.PI * 5 + (i % 2) * Math.PI;
        nodePos[i * 3] = Math.cos(angle) * radius * 0.26;
        nodePos[i * 3 + 1] = (t - 0.5) * radius * 2.2;
        nodePos[i * 3 + 2] = Math.sin(angle) * radius * 0.26;
      },
      connect({ nodePos, addEdge }) {
        for (let i = 2; i < samples * 2; i++) addEdge(i - 2, i);
        let next = samples * 2;
        if (!interior) addEdge(0, 1);
        for (let rung = 0; rung < rungs; rung++) {
          const sample = rungs === 1 ? Math.floor((samples - 1) / 2)
            : Math.round(rung * (samples - 1) / (rungs - 1));
          const a = sample * 2, b = a + 1;
          const count = Math.floor(interior / rungs) + (rung < interior % rungs ? 1 : 0);
          let previous = a;
          for (let j = 1; j <= count; j++) {
            const node = next++;
            const t = j / (count + 1);
            for (let c = 0; c < 3; c++) {
              nodePos[node * 3 + c] = nodePos[a * 3 + c] * (1 - t) + nodePos[b * 3 + c] * t;
            }
            addEdge(previous, node);
            previous = node;
          }
          addEdge(previous, b);
        }
      },
      finishPositions(nodePos) {
        for (let i = 0; i < N; i++) {
          const offset = i * 3;
          const scatter = endDissolve(nodePos[offset + 1], radius) * radius * 0.28;
          // Stable per-node scatter opens only the tips.
          nodePos[offset] += Math.sin(i * 127.1 + 1.7) * scatter;
          nodePos[offset + 2] += Math.sin(i * 311.7 + 4.3) * scatter;
        }
      },
    };
  },
  updateMotion({ N, nodePos, nodeRestPos }, settings, dt, reducedMotion, phases) {
    if (!reducedMotion && settings.camera.autoRotate) {
      phases.dna += dt * settings.camera.autoRotateSpeed * Math.PI / 3;
    }
    for (let i = 0; i < N; i++) {
      const offset = i * 3;
      const x = nodeRestPos[offset], y = nodeRestPos[offset + 1], z = nodeRestPos[offset + 2];
      // Travelling torsion twists about the strand's own axis, not the camera.
      const angle = phases.dna + 0.22 * (Math.sin(y * 0.5 - phases.dna) - Math.sin(y * 0.5));
      const cos = Math.cos(angle), sin = Math.sin(angle);
      nodePos[offset] = x * cos - z * sin;
      nodePos[offset + 2] = x * sin + z * cos;
    }
  },
};
