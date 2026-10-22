import { Vector3 } from 'three';

export const lattice = {
  id: 'lattice',
  createLayout({ N, radius, random }) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const dir = new Vector3();
    return {
      placeNode(nodePos, i) {
        const y = 1 - ((i + 0.5) / N) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = golden * i;
        dir.set(Math.cos(th) * r, y, Math.sin(th) * r);
        dir.x += (random() - 0.5) * 0.12;
        dir.y += (random() - 0.5) * 0.12;
        dir.z += (random() - 0.5) * 0.12;
        dir.normalize();
        const shell = radius * (0.3 + 0.7 * Math.pow(random(), 0.28));
        dir.multiplyScalar(shell).toArray(nodePos, i * 3);
      },
    };
  },
};
