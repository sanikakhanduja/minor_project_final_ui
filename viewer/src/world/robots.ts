// AMR fleet: three InstancedMeshes (chassis, painted shell, status lights) sharing one matrix per robot.
// Capacity follows the replay's robot count. Poses come from motion.ts, colours from the frame's state.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeHeadings, samplePose, type RobotPose } from '../motion';
import { PAINT, SELECTED_LIGHT, STATE_LIGHT } from '../palette';
import type { Frame } from '../types';

const LIGHT_INTENSITY = 2.6; // HDR multiplier so bloom catches status lights
const DIMMED = 0.3; // robots outside the selected incident
const MARKER_Y = 1.9; // overview markers float just above rack height
const MARKER_INTENSITY = 1.15; // lower than the lights so the state colour survives tone mapping

function chamferedSquare(size: number, chamfer: number): THREE.Shape {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + chamfer, -h);
  s.lineTo(h - chamfer, -h);
  s.lineTo(h, -h + chamfer);
  s.lineTo(h, h - chamfer);
  s.lineTo(h - chamfer, h);
  s.lineTo(-h + chamfer, h);
  s.lineTo(-h, h - chamfer);
  s.lineTo(-h, -h + chamfer);
  s.closePath();
  return s;
}

/** Extrude a shape upward from y0; bevel adds `bevel` on every side. */
function slab(shape: THREE.Shape, y0: number, height: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  return g.rotateX(-Math.PI / 2).translate(0, y0 + bevel, 0);
}

function tinted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function cylinder(r: number, h: number, x: number, y: number, z: number, axisX = false, segments = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, segments);
  if (axisX) g.rotateZ(Math.PI / 2);
  return g.translate(x, y, z);
}

const MAST: [number, number] = [0.2, -0.2];
const MAST_TOP = 0.56;

function buildChassis(): THREE.BufferGeometry {
  return mergeGeometries([
    tinted(slab(chamferedSquare(0.68, 0.1), 0.05, 0.14, 0.01), PAINT.robotChassis),
    tinted(cylinder(0.065, 0.05, -0.33, 0.065, 0.12, true), PAINT.robotRubber),
    tinted(cylinder(0.065, 0.05, 0.33, 0.065, 0.12, true), PAINT.robotRubber),
    tinted(cylinder(0.035, 0.04, -0.26, 0.035, -0.22, true, 10), PAINT.robotRubber),
    tinted(cylinder(0.035, 0.04, 0.26, 0.035, -0.22, true, 10), PAINT.robotRubber),
    tinted(new THREE.BoxGeometry(0.36, 0.05, 0.02).translate(0, 0.12, 0.352), PAINT.robotSensor),
    tinted(cylinder(0.22, 0.03, 0, 0.325, 0, false, 28), PAINT.robotMetal),
    tinted(cylinder(0.016, MAST_TOP - 0.31, MAST[0], (MAST_TOP + 0.31) / 2, MAST[1], false, 8), PAINT.robotChassis),
  ])!;
}

function buildShell(): THREE.BufferGeometry {
  return plain(slab(chamferedSquare(0.62, 0.09), 0.18, 0.13, 0.02));
}

function buildLights(): THREE.BufferGeometry {
  const ring = chamferedSquare(0.71, 0.105);
  ring.holes.push(chamferedSquare(0.64, 0.09));
  return mergeGeometries([
    plain(slab(ring, 0.185, 0.02, 0)),
    plain(cylinder(0.04, 0.06, MAST[0], MAST_TOP + 0.03, MAST[1], false, 12)),
    plain(new THREE.BoxGeometry(0.07, 0.03, 0.015).translate(-0.2, 0.15, 0.354)),
    plain(new THREE.BoxGeometry(0.07, 0.03, 0.015).translate(0.2, 0.15, 0.354)),
  ])!;
}

/** Flat arrow pointing +Z, the overview marker that shows status colour and heading. */
function buildMarker(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.6);
  s.lineTo(0.45, 0.4);
  s.lineTo(0, 0.18);
  s.lineTo(-0.45, 0.4);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

export interface FleetHighlight {
  selected: number | null;
  affected: Set<number> | null; // robots in the selected incident; others are dimmed
}

export class RobotFleet {
  readonly group = new THREE.Group();
  readonly poses: RobotPose[] = [];
  private readonly chassisGeo = buildChassis();
  private readonly shellGeo = buildShell();
  private readonly lightGeo = buildLights();
  private readonly markerGeo = buildMarker();
  private readonly chassisMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  private readonly shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.12 });
  private readonly lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private meshes: THREE.InstancedMesh[] = [];
  private capacity = 0;
  private readonly headingCache = new WeakMap<Frame[], Float32Array>();
  private readonly selectionRing: THREE.Mesh;
  private readonly goalMarker: THREE.Group;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly shellColor = new THREE.Color(PAINT.robotShell);

  constructor() {
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.58, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(SELECTED_LIGHT).multiplyScalar(2), transparent: true, depthWrite: false }),
    );
    this.selectionRing.visible = false;
    this.group.add(this.selectionRing);

    const goalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(STATE_LIGHT.idle).multiplyScalar(2), transparent: true, opacity: 0.85, depthWrite: false });
    this.goalMarker = new THREE.Group();
    this.goalMarker.add(new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 32).rotateX(-Math.PI / 2).translate(0, 0.02, 0), goalMat));
    this.goalMarker.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8).translate(0, 0.8, 0), goalMat));
    this.goalMarker.visible = false;
    this.group.add(this.goalMarker);
  }

  private setCount(n: number) {
    if (n > this.capacity) {
      for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
      this.capacity = n;
      this.meshes = [
        new THREE.InstancedMesh(this.chassisGeo, this.chassisMat, n),
        new THREE.InstancedMesh(this.shellGeo, this.shellMat, n),
        new THREE.InstancedMesh(this.lightGeo, this.lightMat, n),
        new THREE.InstancedMesh(this.markerGeo, this.lightMat, n),
      ];
      this.meshes[0].castShadow = this.meshes[1].castShadow = true;
      this.meshes[0].receiveShadow = this.meshes[1].receiveShadow = true;
      for (const m of this.meshes) {
        m.frustumCulled = false; // instances move every frame; the static bounding sphere would be wrong
        m.setColorAt(0, this.tmpColor.set(0xffffff));
        this.group.add(m);
      }
    }
    for (const m of this.meshes) m.count = n;
    while (this.poses.length < n) this.poses.push({ x: 0, z: 0, yaw: 0, pitch: 0 });
  }

  /** markerScale: size of the overview markers (0 hides them), driven by camera distance. */
  update(frames: Frame[], t: number, highlight: FleetHighlight, timeSec: number, markerScale: number) {
    if (frames.length === 0) return;
    const n = frames[0].pos.length;
    this.setCount(n);
    let headings = this.headingCache.get(frames);
    if (!headings) { headings = computeHeadings(frames); this.headingCache.set(frames, headings); }

    const step = Math.max(0, Math.min(Math.floor(t), frames.length - 1));
    const states = frames[step].state;
    const [chassis, shell, lights, markers] = this.meshes;
    markers.visible = markerScale > 0;
    const d = this.dummy;
    const c = this.tmpColor;

    for (let r = 0; r < n; r++) {
      const pose = samplePose(frames, headings, r, t, this.poses[r]);
      d.position.set(pose.x, 0, pose.z);
      d.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
      d.updateMatrix();
      chassis.setMatrixAt(r, d.matrix);
      shell.setMatrixAt(r, d.matrix);
      lights.setMatrixAt(r, d.matrix);

      const dim = highlight.affected && !highlight.affected.has(r) ? DIMMED : 1;
      shell.setColorAt(r, c.copy(this.shellColor).multiplyScalar(dim));

      const state = states[r];
      let pulse = 1;
      if (state === 'delayed') pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2));
      else if (state === 'replanning') pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 4));
      else if (state === 'failed') pulse = Math.sin(timeSec * Math.PI * 4) > 0 ? 1 : 0.15;
      if (r === highlight.selected) c.set(SELECTED_LIGHT).multiplyScalar(LIGHT_INTENSITY * 1.3);
      else c.set(STATE_LIGHT[state] ?? STATE_LIGHT.moving).multiplyScalar(LIGHT_INTENSITY * pulse * dim);
      lights.setColorAt(r, c);

      if (markerScale > 0) {
        d.position.y = MARKER_Y;
        d.rotation.set(0, pose.yaw, 0);
        d.scale.set(markerScale, 1, markerScale);
        d.updateMatrix();
        markers.setMatrixAt(r, d.matrix);
        markers.setColorAt(r, c.multiplyScalar(MARKER_INTENSITY / LIGHT_INTENSITY));
        d.scale.set(1, 1, 1);
      }
    }
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    const sel = highlight.selected;
    this.selectionRing.visible = sel !== null && sel < n;
    if (sel !== null && sel < n) {
      const pose = this.poses[sel];
      this.selectionRing.position.set(pose.x, 0.025, pose.z);
      this.selectionRing.scale.setScalar(1 + 0.06 * Math.sin(timeSec * 5));
    }
    const goal = sel !== null ? frames[step].goals?.[sel] : undefined;
    this.goalMarker.visible = !!goal;
    if (goal) this.goalMarker.position.set(goal[0] + 0.5, 0, goal[1] + 0.5);
  }

  /** Robot id under the ray, or null. */
  pick(raycaster: THREE.Raycaster): number | null {
    for (const m of this.meshes.slice(0, 2)) {
      m.computeBoundingSphere();
      const hit = raycaster.intersectObject(m, false)[0];
      if (hit && hit.instanceId !== undefined) return hit.instanceId;
    }
    return null;
  }
}
