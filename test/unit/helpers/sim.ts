// Headless flight-sim harness: flight controller + rigid-body quad stepped at 1 kHz, no renderer.

import { Vector3 } from 'three';
import { applyPreset } from '../../../src/engine/sim/presets';
import { FlightController, type Sticks } from '../../../src/engine/sim/flightController';
import { Quad, type CollisionResolver } from '../../../src/engine/sim/quad';
import { DEFAULT_CONFIG, type Config } from '../../../src/state/configSchema';

export const DT = 0.001;

export interface Sim {
  cfg: Config;
  fc: FlightController;
  quad: Quad;
  collide?: CollisionResolver;
}

export const centred = (throttle: number): Sticks => ({ throttle, roll: 0, pitch: 0, yaw: 0 });

/** Fresh armed sim, 50 m up. `preset` is applied before `mutate`. */
export function makeSim(mutate?: (cfg: Config) => void, preset?: string): Sim {
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (preset) applyPreset(cfg, preset);
  mutate?.(cfg);
  const fc = new FlightController(cfg, DT);
  const quad = new Quad(cfg);
  quad.reset(new Vector3(0, 50, 0), 0);
  fc.armed = true;
  return { cfg, fc, quad };
}

export function run(
  sim: Sim,
  seconds: number,
  rc: Sticks | ((t: number) => Sticks),
  onStep?: (t: number, sim: Sim) => void,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = typeof rc === 'function' ? rc(i * DT) : rc;
    const m = sim.fc.update(r, sim.quad.gyro, sim.quad.attitude);
    sim.quad.step(DT, m, sim.collide);
    onStep?.(i * DT, sim);
  }
}

/** Throttle that roughly hovers (bisection in angle mode, battery sag off). */
export function findHoverThrottle(preset?: string, iterations = 16): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < iterations; k++) {
    const mid = (lo + hi) / 2;
    const sim = makeSim((c) => {
      c.flight.mode = 'angle';
      c.physics.battery = false;
    }, preset);
    run(sim, 1.5, centred(mid));
    if (sim.quad.vel.y > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Body up-vector's world Y (1 = upright, -1 = inverted). */
export const upY = (sim: Sim) => new Vector3(0, 1, 0).applyQuaternion(sim.quad.quat).y;

export const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const std = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
