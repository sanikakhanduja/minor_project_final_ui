// Single source for 3D colours. Stylised industrial: the environment stays neutral (concrete, galvanised and
// steel-blue racking, cardboard stock) so the safety-orange robots are the only saturated actors in the scene.
import type { RobotState } from './types';

export const PAINT = {
  robotShell: 0xf0821e,
  robotChassis: 0x2b2f36,
  robotRubber: 0x16181c,
  robotSensor: 0x0d1117,
  robotMetal: 0x9aa3ad,
  rackUpright: 0x2c3e52,
  rackBeam: 0x47729a,
  rackDeck: 0x8b939c,
  rackPlinth: 0x24282e,
  wallBody: 0x6f767e,
  hazardYellow: 0xf2b705,
  hazardBlack: 0x1b1d21,
  concrete: 0x8e9398,
  seam: 0x5d6268,
  laneYellow: 0xf2c230,
  ground: 0x3b4249,
  skyTop: 0x2a3b4f,
  skyHorizon: 0x93a5b5,
} as const;

// Stock on the racks: mostly cardboard, some grey and blue plastic totes. Kept muted on purpose.
export const GOODS = [0xb8916a, 0xa67f58, 0xc6a37c, 0xb8916a, 0x8a929b, 0x6f7a86, 0x4f6f8f, 0xa67f58];

// Status light colours (HDR multiplier applied where they are used so bloom picks them up).
export const STATE_LIGHT: Record<RobotState, number> = {
  moving: 0x45c8ff,
  idle: 0x3ddc84,
  delayed: 0xffb020,
  replanning: 0xc86bff,
  failed: 0xff3030,
};

export const SELECTED_LIGHT = 0xffffff;

// Holographic overlay colours (plans, regions, links), keyed so congestion levels can index directly.
export const HOLO = {
  repaired: 0x3cc8ff,
  invalidated: 0xff4646,
  link: 0xd65cff,
  low: 0x3cc8ff,
  medium: 0xffb020,
  high: 0xff4646,
} as const;

// Light-column beacons over active disruptions, visible from the full overview.
export const BEACON = {
  blocked_cell: 0xff3b3b,
  robot_failure: 0xff3b6e,
  robot_delay: 0xffb020,
} as const;
