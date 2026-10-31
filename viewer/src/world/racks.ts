// Racks and perimeter wall. All rack cells are one InstancedMesh: each cell is a 1 m bay built so neighbours
// tile seamlessly (posts sit on cell corners, beams span the full cell). Stock colour and empty slots vary per
// instance in the shader, so variety costs no extra draw calls.
import * as THREE from 'three/webgpu';
import { attribute, float, hash, instanceIndex, int, max, mix, positionLocal, step, uniformArray, varying, vertexColor } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOODS, PAINT } from '../palette';
import { CELL_RACK, CELL_WALL, cellsOfKind, type Grid } from './grid';
import { hazardStripes, part } from './parts';
import { environmentBrightness } from './focus';

// Kept low (two storage levels, 1 m) so robots in the 1 m aisles stay visible from the overview angle.
const RACK_HEIGHT = 1.0;
const BEAM_LEVELS = [0.48, 0.98];
const DECK_LEVELS = [0.48];
const EMPTY_SLOT_CHANCE = 0.2;

// [x centre, width, depth, height] per slot, two slots per level, levels resting on plinth / deck.
const SLOT_FLOORS = [0.06, 0.51];
const SLOTS: [number, number, number, number][][] = [
  [[-0.23, 0.4, 0.78, 0.34], [0.23, 0.38, 0.7, 0.3]],
  [[-0.22, 0.38, 0.72, 0.36], [0.23, 0.4, 0.78, 0.3]],
];

function buildRackCell(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [part(0.98, 0.06, 0.98, 0, 0.03, 0, PAINT.rackPlinth)];
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) parts.push(part(0.06, RACK_HEIGHT, 0.06, x, RACK_HEIGHT / 2, z, PAINT.rackUpright));
  }
  for (const y of BEAM_LEVELS) {
    for (const z of [-0.5, 0.5]) parts.push(part(1.0, 0.07, 0.05, 0, y, z, PAINT.rackBeam));
  }
  for (const x of [-0.5, 0.5]) parts.push(part(0.04, 0.05, 1.0, x, BEAM_LEVELS[BEAM_LEVELS.length - 1], 0, PAINT.rackUpright));
  for (const y of DECK_LEVELS) parts.push(part(0.94, 0.02, 0.94, 0, y + 0.02, 0, PAINT.rackDeck));
  SLOTS.forEach((level, li) => {
    level.forEach(([x, w, d, h], k) => {
      parts.push(part(w, h, d, x, SLOT_FLOORS[li] + h / 2, 0, 0xffffff, { goods: true, slot: li * 2 + k }));
    });
  });
  return mergeGeometries(parts)!;
}

function buildWallCell(): THREE.BufferGeometry {
  return mergeGeometries([
    part(1.0, 0.55, 1.0, 0, 0.275, 0, PAINT.wallBody),
    part(1.04, 0.1, 1.04, 0, 0.6, 0, 0xffffff, { hazard: true }),
  ])!;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, cells: [number, number][]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  const m = new THREE.Matrix4();
  cells.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation(x + 0.5, 0, y + 0.5)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createRacks(grid: Grid): THREE.Group {
  const group = new THREE.Group();

  const rackMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.2 });
  const slot = attribute('slot', 'float');
  const goods = attribute('goods', 'float');
  const seed = float(instanceIndex).mul(8).add(slot);
  const palette = uniformArray<'color'>(GOODS.map((c) => new THREE.Color(c)), 'color');
  const tint = varying(palette.element(int(hash(seed).mul(GOODS.length))));
  const keep = max(step(EMPTY_SLOT_CHANCE, hash(seed.add(500000))), goods.oneMinus());
  rackMat.colorNode = mix(vertexColor(), tint, goods).mul(environmentBrightness);
  rackMat.positionNode = mix(attribute('slotCenter', 'vec3'), positionLocal, keep);
  group.add(instanced(buildRackCell(), rackMat, cellsOfKind(grid, CELL_RACK)));

  const wallMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.05 });
  wallMat.colorNode = mix(vertexColor(), hazardStripes(), attribute('hazard', 'float')).mul(environmentBrightness);
  group.add(instanced(buildWallCell(), wallMat, cellsOfKind(grid, CELL_WALL)));

  return group;
}
