// Shared helpers for headless physics tests.
import { Vector3 } from 'three';
import { deepClone, DEFAULT_CONFIG } from '../src/config.js';
import { FlightController } from '../src/sim/flightController.js';
import { Quad } from '../src/sim/quad.js';

export const DT = 0.001;

export function makeSim(mutate) {
  const cfg = deepClone(DEFAULT_CONFIG);
  mutate?.(cfg);
  const fc = new FlightController(cfg, DT);
  const quad = new Quad(cfg);
  quad.noiseScale = cfg.filters.gyroNoise;
  quad.reset(new Vector3(0, 50, 0), 0);
  fc.armed = true;
  return { cfg, fc, quad };
}

export function run(sim, seconds, rc, onStep) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = typeof rc === 'function' ? rc(i * DT) : rc;
    const m = sim.fc.update(r, sim.quad.gyro, sim.quad.attitude);
    sim.quad.step(DT, m);
    onStep?.(i * DT, sim);
  }
}

/** Throttle that roughly hovers (found by bisection in angle mode). */
export function findHoverThrottle() {
  let lo = 0, hi = 1;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const sim = makeSim((c) => { c.flight.mode = 'angle'; c.physics.battery = false; });
    run(sim, 1.5, { throttle: mid, roll: 0, pitch: 0, yaw: 0 });
    if (sim.quad.vel.y > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
