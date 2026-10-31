// Selected-incident overlay in a holographic "planning mode" style: route ribbons on the floor (with a faint
// x-ray pass so racks never hide them), a congestion volume, links to interacting incidents and rings under
// the affected robots. Progress along the repaired route comes from the replay step, not from accumulated state.
import * as THREE from 'three/webgpu';
import { abs, attribute, float, fract, fwidth, min, mix, positionLocal, smoothstep, step, time, uniform, uv } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { RobotPose } from '../motion';
import { HOLO } from '../palette';
import type { Cell, Incident, Replay } from '../types';

type FloatNode = Node<'float'>;

const REGION_HEIGHT = 1.5;
const GHOST_OPACITY = 0.3; // strength of the see-through pass behind racks

interface Ribbon {
  cum: number[]; // cumulative distance at each path index (waits add 0)
  startStep: number; // replay step at which the robot occupies path index 0
  progress: { value: number }; // uniform: metres of the route already driven
  active: { value: number }; // uniform: 1 once the repair has executed
  executedAt: number;
}

/** Flat ribbon along cell centres with mitred 90 degree corners. Attributes: along (m), side (-1..1), and
 *  center + offset so the shader can widen it (position = center + offset * widthScale). */
function ribbonGeometry(cells: Cell[], width: number, y: number): { geometry: THREE.BufferGeometry; cum: number[] } {
  const pts: THREE.Vector2[] = [];
  const cum: number[] = [];
  let dist = 0;
  cells.forEach(([x, z], i) => {
    const p = new THREE.Vector2(x + 0.5, z + 0.5);
    if (i > 0) dist += p.distanceTo(pts[pts.length - 1]);
    cum.push(dist);
    if (pts.length === 0 || !p.equals(pts[pts.length - 1])) pts.push(p);
  });
  const along: number[] = [];
  let d = 0;
  pts.forEach((p, i) => { if (i > 0) d += p.distanceTo(pts[i - 1]); along.push(d); });

  const positions: number[] = [];
  const centers: number[] = [];
  const offsets: number[] = [];
  const alongAttr: number[] = [];
  const sideAttr: number[] = [];
  const indices: number[] = [];
  const perp = (v: THREE.Vector2) => new THREE.Vector2(-v.y, v.x);
  for (let i = 0; i < pts.length; i++) {
    const prev = i > 0 ? pts[i].clone().sub(pts[i - 1]).normalize() : null;
    const next = i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]).normalize() : null;
    let n: THREE.Vector2;
    let len = width / 2;
    if (prev && next && prev.dot(next) > -0.9) {
      n = perp(prev.clone().add(next).normalize());
      len = width / 2 / Math.max(n.dot(perp(prev)), 0.3);
    } else {
      n = perp((prev ?? next ?? new THREE.Vector2(1, 0)).clone());
    }
    for (const side of [1, -1]) {
      positions.push(pts[i].x + n.x * len * side, y, pts[i].y + n.y * len * side);
      centers.push(pts[i].x, y, pts[i].y);
      offsets.push(n.x * len * side, 0, n.y * len * side);
      alongAttr.push(along[i]);
      sideAttr.push(side);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('center', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 3));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(alongAttr, 1));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(sideAttr, 1));
  geometry.setIndex(indices);
  return { geometry, cum };
}

// Ribbons widen with camera distance so routes stay legible when zoomed out.
const ribbonWidth = uniform(1);
const ribbonPosition = attribute('center', 'vec3').add(attribute('offset', 'vec3').mul(ribbonWidth));

function holoMaterial(hex: number, intensity: number, alpha: FloatNode, ghost: boolean, widen = false): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  if (widen) mat.positionNode = ribbonPosition;
  mat.color = new THREE.Color(hex).multiplyScalar(intensity);
  mat.opacityNode = ghost ? alpha.mul(GHOST_OPACITY) : alpha;
  mat.depthTest = !ghost;
  return mat;
}

/** Adds the mesh twice: normally, and as a faint pass without depth test so it shows through racks. */
function addWithGhost(group: THREE.Group, geometry: THREE.BufferGeometry, make: (ghost: boolean) => THREE.Material, order: number) {
  const ghost = new THREE.Mesh(geometry, make(true));
  ghost.renderOrder = order;
  ghost.frustumCulled = false; // the shader widens the ribbon beyond its geometric bounds
  const solid = new THREE.Mesh(geometry, make(false));
  solid.renderOrder = order + 1;
  solid.frustumCulled = false;
  group.add(ghost, solid);
}

function regionVolume(inc: Incident, hex: number, strength: number): THREE.Mesh {
  const [[x0, y0], [x1, y1]] = inc.congestion.region;
  const w = Math.abs(x1 - x0) + 1;
  const d = Math.abs(y1 - y0) + 1;
  const geometry = new THREE.BoxGeometry(w, REGION_HEIGHT, d).translate(0, REGION_HEIGHT / 2, 0);
  const e = min(uv(), uv().oneMinus()).div(fwidth(uv()).max(1e-5));
  const edge = float(1).sub(smoothstep(1.0, 2.5, min(e.x, e.y)));
  const h = positionLocal.y.div(REGION_HEIGHT);
  const scan = float(1).sub(smoothstep(0.0, 0.03, abs(fract(h.sub(time.mul(0.25))).sub(0.5))));
  const alpha = float(0.035).add(edge.mul(0.7)).add(scan.mul(0.12)).mul(strength);
  const mesh = new THREE.Mesh(geometry, holoMaterial(hex, 1.5, alpha, false));
  mesh.position.set((x0 + x1) / 2 + 0.5, 0.01, (y0 + y1) / 2 + 0.5);
  mesh.renderOrder = 20;
  return mesh;
}

function regionCenter(inc: Incident): THREE.Vector3 {
  const [[x0, y0], [x1, y1]] = inc.congestion.region;
  return new THREE.Vector3((x0 + x1) / 2 + 0.5, 0, (y0 + y1) / 2 + 0.5);
}

/**
 * Fraction of repaired-path cells that match where the robot actually is in the frames
 * (cell k is occupied at step executed_at + 1 + k). null when no frames cover the path.
 */
export function pathAlignment(replay: Replay, inc: Incident): number | null {
  let compared = 0;
  let matched = 0;
  for (const [rid, path] of Object.entries(inc.paths.repaired)) {
    const r = Number(rid);
    path.forEach(([x, y], k) => {
      const frame = replay.frames[inc.executed_at + 1 + k];
      if (!frame || !frame.pos[r]) return;
      compared++;
      if (frame.pos[r][0] === x && frame.pos[r][1] === y) matched++;
    });
  }
  return compared === 0 ? null : matched / compared;
}

export class IncidentOverlay {
  readonly group = new THREE.Group();
  /** Share of repaired-path cells consistent with the frames; null if unknown or no incident. */
  alignment: number | null = null;
  private incident: Incident | null = null;
  private ribbons: Ribbon[] = [];
  private invalidatedFade = uniform(1);
  private links: Line2[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly ringGeo = new THREE.RingGeometry(0.47, 0.57, 40).rotateX(-Math.PI / 2);
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(HOLO.repaired).multiplyScalar(1.8), transparent: true, depthWrite: false });
  private rings: THREE.InstancedMesh | null = null;
  private readonly m = new THREE.Matrix4();

  setIncident(inc: Incident | null, replay: Replay | null) {
    for (const obj of [...this.group.children]) {
      this.group.remove(obj);
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry !== this.ringGeo) mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && mat !== this.ringMat) mat.dispose();
    }
    this.ribbons = [];
    this.links = [];
    this.rings = null;
    this.incident = inc;
    this.alignment = null;
    if (!inc || !replay) return;

    this.alignment = pathAlignment(replay, inc);
    const [[x0, y0], [x1, y1]] = inc.congestion.region;
    this.bounds.set(new THREE.Vector3(Math.min(x0, x1), 0, Math.min(y0, y1)), new THREE.Vector3(Math.max(x0, x1) + 1, 0, Math.max(y0, y1) + 1));

    const levelColor = HOLO[inc.congestion.level];
    this.group.add(regionVolume(inc, levelColor, 1));

    // Invalidated plans: dashed red rails.
    for (const path of Object.values(inc.paths.invalidated)) {
      if (path.length < 2) continue;
      const { geometry } = ribbonGeometry(path, 0.62, 0.025);
      const side = abs(attribute('side', 'float'));
      const along = attribute('along', 'float');
      const rail = smoothstep(0.7, 0.8, side);
      const dash = step(fract(along.mul(1.6)), 0.55);
      const alpha = rail.mul(dash).mul(0.9).add(0.05).mul(this.invalidatedFade);
      addWithGhost(this.group, geometry, (ghost) => holoMaterial(HOLO.invalidated, 1.8, alpha, ghost, true), 30);
      path.forEach(([x, z]) => this.bounds.expandByPoint(new THREE.Vector3(x + 0.5, 0, z + 0.5)));
    }

    // Repaired routes: cyan core with chevrons flowing toward the destination; the driven part dims.
    for (const [rid, path] of Object.entries(inc.paths.repaired)) {
      if (path.length < 1) continue;
      const r = Number(rid);
      // Path index 0 is occupied at executed_at + 1; prepend where the robot was at executed_at if it is adjacent.
      const before = replay.frames[inc.executed_at]?.pos[r];
      const adjacent = before && Math.abs(before[0] - path[0][0]) + Math.abs(before[1] - path[0][1]) === 1;
      const cells = adjacent ? [before, ...path] : path;
      const startStep = adjacent ? inc.executed_at : inc.executed_at + 1;
      if (cells.length < 2) continue;

      const { geometry, cum } = ribbonGeometry(cells, 0.32, 0.035);
      const progress = uniform(0);
      const active = uniform(0);
      const along = attribute('along', 'float');
      const side = abs(attribute('side', 'float'));
      const chevron = fract(along.add(side.mul(0.2)).mul(2.2).sub(time.mul(1.4)));
      const chevronMask = smoothstep(0.0, 0.06, chevron).mul(float(1).sub(smoothstep(0.32, 0.4, chevron)));
      const rim = smoothstep(0.75, 0.95, side);
      const remaining = step(progress, along);
      const head = float(1).sub(smoothstep(0.0, 0.5, abs(along.sub(progress)))).mul(active);
      const alpha = float(0.35).add(chevronMask.mul(0.6).mul(active)).add(rim.mul(0.5))
        .mul(mix(float(0.25), float(1), remaining)).add(head.mul(0.6)).min(1);
      addWithGhost(this.group, geometry, (ghost) => holoMaterial(HOLO.repaired, 2.0, alpha, ghost, true), 40);
      this.ribbons.push({ cum, startStep, progress, active, executedAt: inc.executed_at });
      cells.forEach(([x, z]) => this.bounds.expandByPoint(new THREE.Vector3(x + 0.5, 0, z + 0.5)));
    }

    // Interacting incidents: faint partner volume plus an animated arc between the two regions.
    const from = regionCenter(inc);
    for (const otherId of inc.interacts_with) {
      const other = replay.incidents.find((i) => i.id === otherId);
      if (!other) continue;
      this.group.add(regionVolume(other, HOLO.link, 0.6));
      const to = regionCenter(other);
      const lift = 2.5 + from.distanceTo(to) * 0.15;
      const curve = new THREE.QuadraticBezierCurve3(
        from.clone().setY(REGION_HEIGHT),
        from.clone().lerp(to, 0.5).setY(REGION_HEIGHT + lift),
        to.clone().setY(REGION_HEIGHT),
      );
      const geom = new LineGeometry();
      geom.setPositions(curve.getPoints(48).flatMap((p) => [p.x, p.y, p.z]));
      const mat = new THREE.Line2NodeMaterial({ color: new THREE.Color(HOLO.link).multiplyScalar(1.6), linewidth: 3, dashed: true, dashSize: 0.9, gapSize: 0.5, transparent: true, depthWrite: false });
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 50;
      this.links.push(line);
      this.group.add(line);
      this.bounds.expandByPoint(to);
    }

    const affected = inc.affected_robots.length;
    if (affected > 0) {
      this.rings = new THREE.InstancedMesh(this.ringGeo, this.ringMat, affected);
      this.rings.frustumCulled = false;
      this.rings.renderOrder = 45;
      this.group.add(this.rings);
    }
  }

  /** widthScale: ribbon widening factor, driven by camera distance. */
  update(t: number, poses: RobotPose[], dt: number, timeSec: number, widthScale: number) {
    const inc = this.incident;
    if (!inc) return;
    ribbonWidth.value = widthScale;
    for (const rb of this.ribbons) {
      const u = Math.max(0, Math.min(t - rb.startStep, rb.cum.length - 1));
      const i0 = Math.floor(u);
      const i1 = Math.min(i0 + 1, rb.cum.length - 1);
      rb.progress.value = rb.cum[i0] + (rb.cum[i1] - rb.cum[i0]) * (u - i0);
      rb.active.value = t >= rb.executedAt ? 1 : 0;
    }
    this.invalidatedFade.value = t >= inc.executed_at ? 0.45 : 1;
    for (const line of this.links) (line.material as THREE.Line2NodeMaterial).dashOffset -= dt * 1.5;

    if (this.rings) {
      const pulse = 1 + 0.08 * Math.sin(timeSec * 4);
      let n = 0;
      for (const r of inc.affected_robots) {
        const pose = poses[r];
        if (!pose) continue;
        this.m.makeScale(pulse, 1, pulse).setPosition(pose.x, 0.03, pose.z);
        this.rings.setMatrixAt(n++, this.m);
      }
      this.rings.count = n;
      this.rings.instanceMatrix.needsUpdate = true;
    }
  }

  /** Floor-plane box covering the region, routes and linked incidents (for camera framing). */
  focusBounds(): THREE.Box3 | null {
    return this.incident ? this.bounds : null;
  }

  /** Point above the incident for its screen-space callout. */
  anchor(out: THREE.Vector3): THREE.Vector3 | null {
    const inc = this.incident;
    if (!inc) return null;
    const cell = inc.disruptions[0]?.cells?.[0];
    if (cell) return out.set(cell[0] + 0.5, REGION_HEIGHT + 1.4, cell[1] + 0.5);
    return out.copy(regionCenter(inc)).setY(REGION_HEIGHT + 1.4);
  }
}
