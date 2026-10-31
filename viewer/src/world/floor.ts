// Foundation floor: one plane whose shader reads a one-texel-per-cell map texture to paint
// 4 m foundation plates, the 1 m cell grid, yellow lane lines along rack edges and hazard bands along walls.
import * as THREE from 'three/webgpu';
import { abs, color, float, floor, fract, fwidth, max, min, mix, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type FloatNode = Node<'float'>;
import { PAINT } from '../palette';
import { CELL_RACK, CELL_WALL, type Grid } from './grid';
import { environmentBrightness } from './focus';

const PLATE_SIZE = 4;

export function createFloor(grid: Grid, concrete: THREE.Texture | null): THREE.Group {
  const { width: w, height: h } = grid;
  const group = new THREE.Group();

  // R = rack, G = wall.
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = grid.cells[i] === CELL_RACK ? 255 : 0;
    data[i * 4 + 1] = grid.cells[i] === CELL_WALL ? 255 : 0;
    data[i * 4 + 3] = 255;
  }
  const mapTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  mapTex.magFilter = THREE.NearestFilter;
  mapTex.minFilter = THREE.NearestFilter;
  mapTex.generateMipmaps = false;
  mapTex.needsUpdate = true;

  const p = positionWorld.xz;
  const cell = floor(p);
  const local = fract(p);
  const aa = max(fwidth(p.x), fwidth(p.y)).max(1e-4); // metres per pixel
  const at = (ox: number, oy: number) => texture(mapTex, cell.add(vec2(ox + 0.5, oy + 0.5)).div(vec2(w, h))).level(float(0));
  const here = at(0, 0);
  const left = at(-1, 0);
  const right = at(1, 0);
  const down = at(0, -1);
  const up = at(0, 1);
  const open = float(1).sub(here.r).mul(float(1).sub(here.g));

  // Anti-aliased line of half-width hw at distance d. Once the line is thinner than a pixel its strength
  // falls to its average coverage, so distant seams fade instead of smearing across the whole plate.
  const line = (d: FloatNode, halfWidth: number) =>
    float(1).sub(smoothstep(halfWidth, aa.add(halfWidth), d)).mul(float(halfWidth * 2).div(aa).min(1));
  const band = (d: FloatNode, center: number, halfWidth: number) => line(abs(d.sub(center)), halfWidth);
  const edgeZone = (d: FloatNode, depth: number) => float(1).sub(smoothstep(depth, aa.add(depth), d));

  // Foundation plates: dark seam plus a slight bevel falloff toward each plate edge.
  const plate = fract(p.div(PLATE_SIZE));
  const toSeam = min(min(plate.x, plate.x.oneMinus()), min(plate.y, plate.y.oneMinus())).mul(PLATE_SIZE);
  const seam = line(toSeam, 0.025);
  const bevel = smoothstep(0.0, 0.3, toSeam).mul(0.12).add(0.88);

  // 1 m cell grid, faded out once lines get thinner than a pixel.
  const toCellEdge = min(min(local.x, local.x.oneMinus()), min(local.y, local.y.oneMinus()));
  const gridLine = line(toCellEdge, 0.012).mul(float(1).sub(smoothstep(0.02, 0.07, aa)));

  const lane = max(
    max(left.r.mul(band(local.x, 0.09, 0.025)), right.r.mul(band(local.x.oneMinus(), 0.09, 0.025))),
    max(down.r.mul(band(local.y, 0.09, 0.025)), up.r.mul(band(local.y.oneMinus(), 0.09, 0.025))),
  ).mul(open);

  const hazardZone = max(
    max(left.g.mul(edgeZone(local.x, 0.32)), right.g.mul(edgeZone(local.x.oneMinus(), 0.32))),
    max(down.g.mul(edgeZone(local.y, 0.32)), up.g.mul(edgeZone(local.y.oneMinus(), 0.32))),
  ).mul(open);
  const stripeCoord = p.x.add(p.y).mul(1.6);
  const stripe = smoothstep(0.5, fwidth(stripeCoord).add(0.5), fract(stripeCoord));
  const hazard = mix(color(PAINT.hazardBlack), color(PAINT.hazardYellow), stripe);

  let detail: FloatNode = float(1);
  if (concrete) {
    concrete.wrapS = THREE.RepeatWrapping;
    concrete.wrapT = THREE.RepeatWrapping;
    concrete.colorSpace = THREE.SRGBColorSpace;
    const lum = texture(concrete, p.div(PLATE_SIZE)).rgb.dot(vec3(0.299, 0.587, 0.114));
    detail = mix(float(1), lum.mul(2.0), 0.35);
  }
  const plated = color(PAINT.concrete).mul(bevel).mul(detail);
  const seamed = mix(plated, color(PAINT.seam), seam).mul(float(1).sub(gridLine.mul(0.16)));
  const shaded = mix(seamed, seamed.mul(0.5), here.r);
  const laned = mix(shaded, color(PAINT.laneYellow), lane);
  const base = mix(laned, hazard, hazardZone);

  const floorMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  floorMat.colorNode = base.mul(environmentBrightness);
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), floorMat);
  floorMesh.position.set(w / 2, 0, h / 2);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Slab edge so the floor reads as a raised foundation platform. Its top sits a visible step below the
  // floor; closer than a few cm and the two surfaces z-fight at overview distance.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.6, 0.5, h + 0.6),
    new THREE.MeshStandardMaterial({ color: PAINT.seam, roughness: 0.9 }),
  );
  slab.position.set(w / 2, -0.31, h / 2);
  slab.receiveShadow = true;
  group.add(slab);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PAINT.ground, roughness: 1 }),
  );
  ground.position.set(w / 2, -0.5, h / 2);
  group.add(ground);

  return group;
}
