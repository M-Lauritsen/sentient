export const waves = {
  id: 'waves',
  moving: true,
  presentation: { rotationX: 0.55 },
  createLayout({ N, radius }) {
    const columns = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / columns);
    const spacing = radius * 2 / Math.max(1, columns - 1);
    return {
      placeNode(nodePos, i) {
        nodePos[i * 3] = (i % columns - (columns - 1) / 2) * spacing;
        nodePos[i * 3 + 2] = (Math.floor(i / columns) - (rows - 1) / 2) * spacing;
      },
      connect({ addEdge }) {
        for (let i = 0; i < N; i++) {
          const column = i % columns;
          if (column + 1 < columns && i + 1 < N) addEdge(i, i + 1);
          if (i + columns < N) addEdge(i, i + columns);
          if (column + 1 < columns && i + columns + 1 < N) addEdge(i, i + columns + 1);
        }
      },
    };
  },
  updateMotion({ N, nodePos, nodeRestPos }, settings, dt, reducedMotion, phases) {
    if (!reducedMotion) phases.waves += dt * settings.waves.speed;
    const frequency = Math.PI * 2 / settings.waves.wavelength;
    const amplitude = settings.waves.amplitude;
    for (let i = 0; i < N; i++) {
      const offset = i * 3;
      const x = nodeRestPos[offset], z = nodeRestPos[offset + 2];
      // Displace from rest heights without cumulative drift.
      nodePos[offset + 1] = nodeRestPos[offset + 1] + amplitude * (
        Math.sin(frequency * (x + z * 0.35) - phases.waves) +
        0.35 * Math.sin(frequency * (z - x * 0.25) + phases.waves * 0.7));
    }
  },
};
