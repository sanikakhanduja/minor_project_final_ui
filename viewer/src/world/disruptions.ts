// Disruption markers as pooled InstancedMeshes, recomputed from the replay every frame (no accumulated state).
import * as THREE from 'three/webgpu';
import { attribute, float, mix, pow, uniform, uv, vertexColor } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RobotPose } from '../motion';
import { BEACON, PAINT } from '../palette';
import type { Replay } from '../types';
import { hazardStripes, part } from './parts';

// The replay does not record when a blocked cell clears. Until it does, a blockage is shown from
// t_detected for its recovery window plus this many steps. Viewer-side assumption, not data.
const ASSUMED_LINGER_STEPS = 15;

/** Hazard-striped barrier block that fills most of a blocked cell. */
function buildBarrier(): THREE.BufferGeometry {
  return mergeGeometries([
    part(0.86, 0.06, 0.86, 0, 0.03, 0, PAINT.hazardBlack),
    part(0.72, 0.62, 0.72, 0, 0.37, 0, 0xffffff, { hazard: true }),
    part(0.78, 0.06, 0.78, 0, 0.71, 0, PAINT.hazardBlack),
  ])!;
}

export class DisruptionLayer {
  readonly group = new THREE.Group();
  private readonly barrierGeo = buildBarrier();
  private readonly barrierMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  private readonly tileGeo = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
  private readonly ringGeo = new THREE.RingGeometry(0.4, 0.5, 32).rotateX(-Math.PI / 2);
  private readonly tileMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b3b).multiplyScalar(1.4), transparent: true, depthWrite: false });
  private readonly failMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3030).multiplyScalar(1.6), transparent: true, depthWrite: false });
  private readonly delayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb020).multiplyScalar(1.6), transparent: true, depthWrite: false });
  private barriers: THREE.InstancedMesh | null = null;
  private tiles: THREE.InstancedMesh | null = null;
  private failRings: THREE.InstancedMesh | null = null;
  private delayRings: THREE.InstancedMesh | null = null;
  // Light columns over every active disruption so they can be found from the full overview.
  private readonly beaconGeo = new THREE.CylinderGeometry(0.4, 0.4, 5, 16, 1, true).translate(0, 2.5, 0);
  private readonly beaconMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private readonly beaconPulse = uniform(1);
  private beacons: THREE.InstancedMesh | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly beaconColors = {
    blocked_cell: new THREE.Color(BEACON.blocked_cell).multiplyScalar(2.2),
    robot_failure: new THREE.Color(BEACON.robot_failure).multiplyScalar(2.2),
    robot_delay: new THREE.Color(BEACON.robot_delay).multiplyScalar(2.2),
  };

  constructor() {
    this.barrierMat.colorNode = mix(vertexColor(), hazardStripes(), attribute('hazard', 'float'));
    this.beaconMat.opacityNode = pow(float(1).sub(uv().y), 1.4).mul(0.85).mul(this.beaconPulse);
  }

  /** Size the pools for the worst case in this replay. */
  setReplay(replay: Replay) {
    let blocked = 0;
    let failures = 0;
    let delays = 0;
    for (const inc of replay.incidents) {
      for (const d of inc.disruptions) {
        if (d.type === 'blocked_cell') blocked += d.cells?.length ?? 0;
        else if (d.type === 'robot_failure') failures++;
        else delays++;
      }
    }
    this.barriers = this.resize(this.barriers, this.barrierGeo, this.barrierMat, blocked, true);
    this.tiles = this.resize(this.tiles, this.tileGeo, this.tileMat, blocked, false);
    this.failRings = this.resize(this.failRings, this.ringGeo, this.failMat, failures, false);
    this.delayRings = this.resize(this.delayRings, this.ringGeo, this.delayMat, delays, false);
    this.beacons = this.resize(this.beacons, this.beaconGeo, this.beaconMat, blocked + failures + delays, false);
    this.beacons.setColorAt(0, this.beaconColors.blocked_cell);
    this.beacons.renderOrder = 60;
  }

  private resize(mesh: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) {
    if (mesh && mesh.instanceMatrix.count >= n) return mesh;
    if (mesh) { this.group.remove(mesh); mesh.dispose(); }
    const next = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
    next.castShadow = shadow;
    next.frustumCulled = false;
    next.count = 0;
    this.group.add(next);
    return next;
  }

  /** beaconScale grows the light columns with camera distance so they stay visible when zoomed out. */
  update(replay: Replay, t: number, poses: RobotPose[], timeSec: number, beaconScale: number) {
    if (!this.barriers || !this.tiles || !this.failRings || !this.delayRings || !this.beacons) return;
    const beacons = this.beacons;
    let nBeacon = 0;
    const beacon = (x: number, z: number, type: keyof typeof BEACON) => {
      this.m.makeScale(beaconScale, beaconScale, beaconScale).setPosition(x, 0, z);
      beacons.setMatrixAt(nBeacon, this.m);
      beacons.setColorAt(nBeacon++, this.beaconColors[type]);
    };
    const step = Math.max(0, Math.min(Math.floor(t), replay.frames.length - 1));
    const states = replay.frames[step].state;
    let nb = 0;
    let nf = 0;
    let nd = 0;
    for (const inc of replay.incidents) {
      const active = step >= inc.t_detected && step <= inc.t_detected + inc.outcome.recovery_steps + ASSUMED_LINGER_STEPS;
      for (const d of inc.disruptions) {
        if (d.type === 'blocked_cell' && active) {
          for (const [cx, cy] of d.cells ?? []) {
            this.m.makeTranslation(cx + 0.5, 0, cy + 0.5);
            this.barriers.setMatrixAt(nb, this.m);
            this.m.makeTranslation(cx + 0.5, 0.012, cy + 0.5);
            this.tiles.setMatrixAt(nb, this.m);
            beacon(cx + 0.5, cy + 0.5, 'blocked_cell');
            nb++;
          }
        } else if (d.type === 'robot_failure' && d.robot != null && step >= inc.t_detected && states[d.robot] === 'failed') {
          const pose = poses[d.robot];
          this.failRings.setMatrixAt(nf++, this.m.makeTranslation(pose.x, 0.02, pose.z));
          beacon(pose.x, pose.z, 'robot_failure');
        } else if (d.type === 'robot_delay' && d.robot != null && active && poses[d.robot]) {
          const pose = poses[d.robot];
          this.delayRings.setMatrixAt(nd++, this.m.makeTranslation(pose.x, 0.02, pose.z));
          beacon(pose.x, pose.z, 'robot_delay');
        }
      }
    }
    this.barriers.count = nb;
    this.tiles.count = nb;
    this.failRings.count = nf;
    this.delayRings.count = nd;
    beacons.count = nBeacon;
    for (const mesh of [this.barriers, this.tiles, this.failRings, this.delayRings, beacons]) mesh.instanceMatrix.needsUpdate = true;
    if (beacons.instanceColor) beacons.instanceColor.needsUpdate = true;
    this.beaconPulse.value = 0.75 + 0.25 * Math.sin(timeSec * 3);

    this.tileMat.opacity = 0.35 + 0.2 * Math.sin(timeSec * 4);
    this.failMat.opacity = 0.55 + 0.35 * Math.sin(timeSec * 4);
    this.delayMat.opacity = 0.45 + 0.35 * Math.sin(timeSec * 3);
  }
}
