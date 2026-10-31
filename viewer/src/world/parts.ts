// Shared building blocks for procedural, vertex-coloured models that merge into one geometry.
import * as THREE from 'three/webgpu';
import { color, fract, fwidth, mix, positionWorld, smoothstep } from 'three/tsl';
import { PAINT } from '../palette';

export interface PartOptions {
  goods?: boolean; // tinted per instance by the rack shader
  slot?: number; // goods slot id, seeds the per-instance variation
  hazard?: boolean; // painted with hazardStripes()
}

/** Box with every attribute the procedural shaders read, so parts can be merged freely. */
export function part(sx: number, sy: number, sz: number, cx: number, cy: number, cz: number, hex: number, opts: PartOptions = {}): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex);
  const colors = new Float32Array(n * 3);
  const centers = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors.set([c.r, c.g, c.b], i * 3);
    centers.set([cx, cy, cz], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('slotCenter', new THREE.BufferAttribute(centers, 3));
  g.setAttribute('goods', new THREE.BufferAttribute(new Float32Array(n).fill(opts.goods ? 1 : 0), 1));
  g.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(n).fill(opts.slot ?? 0), 1));
  g.setAttribute('hazard', new THREE.BufferAttribute(new Float32Array(n).fill(opts.hazard ? 1 : 0), 1));
  return g;
}

/** Diagonal yellow/black safety stripes in world space, anti-aliased. */
export function hazardStripes() {
  const coord = positionWorld.x.add(positionWorld.z).add(positionWorld.y).mul(1.6);
  return mix(color(PAINT.hazardBlack), color(PAINT.hazardYellow), smoothstep(0.5, fwidth(coord).add(0.5), fract(coord)));
}
