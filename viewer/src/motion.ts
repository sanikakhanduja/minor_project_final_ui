// Robot pose sampling. Everything is derived from the replay frames, so any time t can be sampled
// in any order (scrubbing backwards is exact). Within a step a robot first turns in place, then drives;
// consecutive straight moves keep their speed instead of stopping at every cell.
import type { Frame } from './types';

const DEFAULT_YAW = Math.PI / 2; // face +X (along the aisles) until the first move
const TURN_SPAN_90 = 0.3; // fraction of a step spent turning 90 degrees
const LEAN_PER_ACCEL = 0.006; // radians of pitch per (cell / step^2)
const MAX_LEAN = 0.05;

export interface RobotPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** headings[s * n + r] = yaw robot r faces while standing on frames[s].pos[r]. */
export function computeHeadings(frames: Frame[]): Float32Array {
  const steps = frames.length;
  const n = steps > 0 ? frames[0].pos.length : 0;
  const headings = new Float32Array(steps * n);
  for (let r = 0; r < n; r++) {
    let current = DEFAULT_YAW;
    for (let s = 0; s + 1 < steps; s++) {
      const dx = frames[s + 1].pos[r][0] - frames[s].pos[r][0];
      const dy = frames[s + 1].pos[r][1] - frames[s].pos[r][1];
      if (dx !== 0 || dy !== 0) { current = Math.atan2(dx, dy); break; }
    }
    for (let s = 0; s < steps; s++) {
      headings[s * n + r] = current;
      if (s + 1 < steps) {
        const dx = frames[s + 1].pos[r][0] - frames[s].pos[r][0];
        const dy = frames[s + 1].pos[r][1] - frames[s].pos[r][1];
        if (dx !== 0 || dy !== 0) current = Math.atan2(dx, dy);
      }
    }
  }
  return headings;
}

export function samplePose(frames: Frame[], headings: Float32Array, r: number, t: number, out: RobotPose): RobotPose {
  const last = frames.length - 1;
  const n = frames[0].pos.length;
  const s = Math.max(0, Math.min(Math.floor(t), last));
  const a = s >= last ? 0 : t - s;
  const [x0, y0] = frames[s].pos[r];
  const yaw0 = headings[s * n + r];

  out.x = x0 + 0.5;
  out.z = y0 + 0.5;
  out.yaw = yaw0;
  out.pitch = 0;
  if (s >= last) return out;

  const dx = frames[s + 1].pos[r][0] - x0;
  const dy = frames[s + 1].pos[r][1] - y0;
  if (dx === 0 && dy === 0) return out;

  const yawMove = Math.atan2(dx, dy);
  const turn = shortestAngle(yawMove - yaw0);
  const exitSpeed = sameMove(frames, s + 1, r, dx, dy) ? 1 : 0;

  let u = a;
  let span = 1;
  let entrySpeed = sameMove(frames, s - 1, r, dx, dy) ? 1 : 0;
  if (Math.abs(turn) > 1e-3) {
    const turnSpan = Math.min(TURN_SPAN_90 * Math.abs(turn) / (Math.PI / 2), 0.5);
    if (a < turnSpan) {
      out.yaw = yaw0 + turn * smoothstep(a / turnSpan);
      return out;
    }
    u = (a - turnSpan) / (1 - turnSpan);
    span = 1 - turnSpan;
    entrySpeed = 0;
  }

  // Cubic Hermite from rest/at-speed to rest/at-speed; tangents are in cells per unit of u.
  const m0 = entrySpeed * span;
  const m1 = exitSpeed * span;
  const u2 = u * u;
  const u3 = u2 * u;
  const f = (-2 * u3 + 3 * u2) + (u3 - 2 * u2 + u) * m0 + (u3 - u2) * m1;
  const accel = ((6 - 12 * u) + (6 * u - 4) * m0 + (6 * u - 2) * m1) / (span * span);

  out.x = x0 + 0.5 + dx * f;
  out.z = y0 + 0.5 + dy * f;
  out.yaw = yawMove;
  out.pitch = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -accel * LEAN_PER_ACCEL));
  return out;
}

function sameMove(frames: Frame[], s: number, r: number, dx: number, dy: number): boolean {
  if (s < 0 || s + 1 >= frames.length) return false;
  return frames[s + 1].pos[r][0] - frames[s].pos[r][0] === dx && frames[s + 1].pos[r][1] - frames[s].pos[r][1] === dy;
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
