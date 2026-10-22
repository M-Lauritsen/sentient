import { Vector3 } from 'three';

export const organic = {
  id: 'organic',
  createLayout({ radius, random }) {
    const dir = new Vector3();
    return {
      placeNode(nodePos, i) {
        const y = random() * 2 - 1;
        const angle = random() * Math.PI * 2;
        const radial = Math.sqrt(1 - y * y);
        const shell = radius * (0.3 + 0.7 * Math.cbrt(random()));
        dir.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial)
          .multiplyScalar(shell).toArray(nodePos, i * 3);
      },
    };
  },
};
