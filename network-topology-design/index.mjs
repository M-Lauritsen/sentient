import { lattice } from './lattice.mjs';
import { organic } from './organic.mjs';
import { waves } from './waves.mjs';
import { dna } from './dna.mjs';

const designs = new Map([lattice, organic, waves, dna].map(design => [design.id, {
  ...design,
  presentation: {
    rotationX: 0,
    rotationZ: 0,
    autoOrbit: true,
    nodeDissolveHalfLength: 0,
    ...design.presentation,
  },
}]));

export function getTopologyDesign(id) {
  const design = designs.get(id ?? 'lattice');
  if (!design) throw new Error(`Unknown network topology: ${id}`);
  return design;
}

export function createTopologyMotionState() {
  return Object.fromEntries([...designs].filter(([, design]) => design.moving).map(([id]) => [id, 0]));
}
