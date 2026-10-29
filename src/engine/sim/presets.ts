// Quad classes. Each preset overrides physics (and a matching PID tune) and picks a 3D model style.
// Inertias are scaled from mass × arm² of real builds; PIDs are verified by test/unit/presets.test.ts.

import type { Axis, Config, PhysicsConfig, PidAxisConfig } from '../../state/configSchema';

export type ModelStyle = 'freestyle' | 'race' | 'toothpick' | 'cinewhoop' | 'longrange' | 'whoop';

export interface ModelSpec {
  style: ModelStyle;
  blades: number;
  frameColor: string;
  propColor: string;
  accent: string;
  ducted?: boolean;
  gps?: boolean;
}

export interface QuadPreset {
  name: string;
  model: ModelSpec;
  physics: Partial<PhysicsConfig>;
  pid: Record<Axis, PidAxisConfig>;
}

export const QUAD_PRESETS = {
  freestyle5: {
    name: '5" Freestyle (6S)',
    model: { style: 'freestyle', blades: 3, frameColor: '#1b1c1f', propColor: '#ff7a1a', accent: '#ff6a00' },
    physics: {
      massG: 650, motorThrustG: 1450, armLengthMm: 112, propInches: 5.1,
      inertiaRoll: 0.0022, inertiaPitch: 0.0028, inertiaYaw: 0.0045,
      motorSpinUpMs: 22, motorSpinDownMs: 38, yawTorqueCoef: 0.018, rotorInertia: 2.0e-6, maxRpm: 30000,
      propPitchSpeed: 55, inflowGain: 0.6, dragFront: 0.012, dragSide: 0.016, dragTop: 0.045,
      rotorDrag: 0.1, angularDrag: 0.0004, cells: 6, capacityMah: 1300, internalResistance: 0.004, maxCurrentA: 140,
    },
    pid: {
      roll: { p: 45, i: 80, d: 40, f: 120 }, pitch: { p: 47, i: 84, d: 46, f: 125 }, yaw: { p: 45, i: 80, d: 0, f: 120 },
    },
  },
  race5: {
    name: '5" Race (6S, light)',
    model: { style: 'race', blades: 3, frameColor: '#141414', propColor: '#22c8ff', accent: '#22c8ff' },
    physics: {
      massG: 520, motorThrustG: 1650, armLengthMm: 108, propInches: 5.1,
      inertiaRoll: 0.0016, inertiaPitch: 0.0021, inertiaYaw: 0.0034,
      motorSpinUpMs: 18, motorSpinDownMs: 32, yawTorqueCoef: 0.018, rotorInertia: 1.8e-6, maxRpm: 33000,
      propPitchSpeed: 66, inflowGain: 0.6, dragFront: 0.009, dragSide: 0.013, dragTop: 0.04,
      rotorDrag: 0.08, angularDrag: 0.0003, cells: 6, capacityMah: 1100, internalResistance: 0.004, maxCurrentA: 160,
    },
    pid: {
      roll: { p: 48, i: 85, d: 38, f: 140 }, pitch: { p: 52, i: 90, d: 44, f: 145 }, yaw: { p: 48, i: 85, d: 0, f: 130 },
    },
  },
  toothpick3: {
    name: '3" Toothpick (4S)',
    model: { style: 'toothpick', blades: 3, frameColor: '#202020', propColor: '#c9ff2e', accent: '#c9ff2e' },
    physics: {
      massG: 115, motorThrustG: 240, armLengthMm: 66, propInches: 3.0,
      inertiaRoll: 0.00013, inertiaPitch: 0.00016, inertiaYaw: 0.00026,
      motorSpinUpMs: 13, motorSpinDownMs: 22, yawTorqueCoef: 0.01, rotorInertia: 2.2e-7, maxRpm: 45000,
      propPitchSpeed: 42, inflowGain: 0.6, dragFront: 0.0028, dragSide: 0.0035, dragTop: 0.009,
      rotorDrag: 0.025, angularDrag: 0.00003, cells: 4, capacityMah: 450, internalResistance: 0.012, maxCurrentA: 40,
    },
    pid: {
      roll: { p: 40, i: 75, d: 28, f: 110 }, pitch: { p: 42, i: 78, d: 32, f: 115 }, yaw: { p: 40, i: 75, d: 0, f: 110 },
    },
  },
  cinewhoop3: {
    name: '3" Cinewhoop (ducted, 6S)',
    model: { style: 'cinewhoop', blades: 5, frameColor: '#222', propColor: '#e8e8e8', accent: '#ff2e63', ducted: true },
    physics: {
      massG: 330, motorThrustG: 420, armLengthMm: 72, propInches: 3.0,
      inertiaRoll: 0.0007, inertiaPitch: 0.0008, inertiaYaw: 0.0012,
      motorSpinUpMs: 18, motorSpinDownMs: 30, yawTorqueCoef: 0.012, rotorInertia: 3e-7, maxRpm: 40000,
      propPitchSpeed: 34, inflowGain: 0.7, dragFront: 0.014, dragSide: 0.014, dragTop: 0.035,
      rotorDrag: 0.12, angularDrag: 0.0002, cells: 6, capacityMah: 850, internalResistance: 0.006, maxCurrentA: 70,
    },
    pid: {
      roll: { p: 50, i: 90, d: 42, f: 90 }, pitch: { p: 52, i: 92, d: 45, f: 90 }, yaw: { p: 55, i: 90, d: 0, f: 90 },
    },
  },
  longrange7: {
    name: '7" Long Range (6S)',
    model: { style: 'longrange', blades: 2, frameColor: '#1d1f22', propColor: '#3a3a3a', accent: '#46d37b', gps: true },
    physics: {
      massG: 980, motorThrustG: 2100, armLengthMm: 160, propInches: 7.0,
      inertiaRoll: 0.0068, inertiaPitch: 0.0078, inertiaYaw: 0.0095,
      motorSpinUpMs: 34, motorSpinDownMs: 60, yawTorqueCoef: 0.024, rotorInertia: 6e-6, maxRpm: 20000,
      propPitchSpeed: 52, inflowGain: 0.6, dragFront: 0.016, dragSide: 0.022, dragTop: 0.07,
      rotorDrag: 0.16, angularDrag: 0.0012, cells: 6, capacityMah: 4000, internalResistance: 0.008, maxCurrentA: 110,
    },
    pid: {
      roll: { p: 42, i: 80, d: 46, f: 110 }, pitch: { p: 44, i: 82, d: 50, f: 115 }, yaw: { p: 55, i: 60, d: 0, f: 60 },
    },
  },
  whoop65: {
    name: '65mm Tiny Whoop (1S)',
    model: { style: 'whoop', blades: 4, frameColor: '#e9e9e9', propColor: '#ff3b3b', accent: '#ff3b3b', ducted: true },
    physics: {
      massG: 22, motorThrustG: 17, armLengthMm: 32, propInches: 1.2,
      inertiaRoll: 0.000009, inertiaPitch: 0.00001, inertiaYaw: 0.000016,
      motorSpinUpMs: 16, motorSpinDownMs: 26, yawTorqueCoef: 0.006, rotorInertia: 6e-9, maxRpm: 50000,
      propPitchSpeed: 16, inflowGain: 0.7, dragFront: 0.0016, dragSide: 0.0016, dragTop: 0.0045,
      rotorDrag: 0.008, angularDrag: 0.000002, cells: 1, capacityMah: 300, internalResistance: 0.05, maxCurrentA: 12,
    },
    pid: {
      roll: { p: 60, i: 90, d: 45, f: 60 }, pitch: { p: 60, i: 90, d: 45, f: 60 }, yaw: { p: 60, i: 90, d: 0, f: 60 },
    },
  },
} satisfies Record<string, QuadPreset>;

export type PresetId = keyof typeof QUAD_PRESETS;

export const getPreset = (id: string): QuadPreset =>
  (QUAD_PRESETS as Record<string, QuadPreset>)[id] ?? QUAD_PRESETS.freestyle5;

/** Apply a preset to a config (or an Immer draft) in place. Rates are left alone. */
export function applyPreset(config: Config, id: string): void {
  const p = (QUAD_PRESETS as Record<string, QuadPreset>)[id];
  if (!p) return;
  config.quad.preset = id;
  Object.assign(config.physics, p.physics);
  for (const ax of ['roll', 'pitch', 'yaw'] as const) Object.assign(config.pid[ax], p.pid[ax]);
}
