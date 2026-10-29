// Closed-loop flight physics: hover, step response, top speed, flips, ground contact, turtle, wind.

import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CollisionWorld } from '../../src/engine/sim/collision';
import type { Axis } from '../../src/state/configSchema';
import { centred, findHoverThrottle, makeSim, mean, run, upY, type Sim } from './helpers/sim';

let hover = 0;
beforeAll(() => {
  hover = findHoverThrottle();
});

describe('hover', () => {
  it('needs a plausible throttle for a 5" quad', () => {
    expect(hover).toBeGreaterThan(0.15);
    expect(hover).toBeLessThan(0.45);
  });
});

describe.each<[Axis, number]>([
  ['roll', 0],
  ['pitch', 1],
  ['yaw', 2],
])('%s step response', (axis, idx) => {
  it('tracks the setpoint without large overshoot', () => {
    const sim = makeSim((c) => void (c.physics.battery = false));
    run(sim, 0.3, centred(hover));
    const samples: number[] = [];
    run(sim, 0.4, { ...centred(hover), [axis]: 0.5 }, (_t, s) => samples.push(s.fc.gyro[idx]));
    const sp = sim.fc.setpoint[idx];
    const final = mean(samples.slice(-100));
    const overshoot = (Math.max(...samples) - sp) / sp;
    expect(Math.abs(final - sp) / sp).toBeLessThan(0.08);
    expect(overshoot).toBeLessThan(0.25);
  });
});

describe('flight envelope', () => {
  it('reaches a 5" freestyle top speed (100–190 km/h)', () => {
    const sim = makeSim((c) => {
      c.flight.mode = 'angle';
      c.pid.angleLimit = 75;
      c.physics.battery = false;
    });
    sim.quad.pos.y = 500;
    run(sim, 8, { throttle: 1, roll: 0, pitch: 1, yaw: 0 });
    const kmh = Math.hypot(sim.quad.vel.x, sim.quad.vel.z) * 3.6;
    expect(kmh).toBeGreaterThan(100);
    expect(kmh).toBeLessThan(190);
  });

  it('completes a full flip and settles', () => {
    const sim = makeSim((c) => void (c.physics.battery = false));
    run(sim, 0.2, centred(0.3));
    run(sim, 0.55, { throttle: 0.1, roll: 1, pitch: 0, yaw: 0 });
    run(sim, 0.3, centred(0.3));
    for (const r of sim.quad.gyro) expect(Math.abs(r)).toBeLessThan(40);
  });

  it('wind pushes a self-levelling quad downwind', () => {
    const sim = makeSim((c) => {
      c.flight.mode = 'angle';
      c.physics.battery = false;
      c.physics.windSpeed = 8;
      c.physics.windDir = 0; // from the north (-Z) toward +Z
      c.physics.windGust = 0;
    });
    run(sim, 3, centred(hover));
    expect(sim.quad.vel.z).toBeGreaterThan(1);
  });

  it('battery sags under load', () => {
    const sim = makeSim();
    const v0 = sim.quad.battery.voltage;
    run(sim, 2, centred(1));
    expect(sim.quad.battery.voltage).toBeLessThan(v0);
    expect(sim.quad.battery.usedMah).toBeGreaterThan(0);
  });
});

describe('ground contact', () => {
  function groundSim(): Sim {
    const sim = makeSim((c) => void (c.physics.battery = false));
    const world = new CollisionWorld();
    sim.collide = (q) => void world.resolveQuad(q, sim.cfg.physics);
    return sim;
  }

  it('a dropped quad tumbles and comes to rest flat', () => {
    const sim = groundSim();
    sim.fc.armed = false;
    sim.quad.pos.set(0, 2, 0);
    sim.quad.quat.setFromAxisAngle(new Vector3(1, 0, 1).normalize(), 2.2);
    sim.quad.omega.set(3, 1, -4);
    run(sim, 4, centred(0));
    const q = sim.quad;
    expect(q.pos.y).toBeGreaterThan(0);
    expect(q.pos.y).toBeLessThan(0.15);
    expect(q.vel.length()).toBeLessThan(0.05);
    expect(q.omega.length()).toBeLessThan(0.2);
    expect(Math.abs(upY(sim))).toBeGreaterThan(0.9);
  });

  it('turtle mode flips an inverted quad back over', () => {
    const sim = groundSim();
    sim.quad.pos.set(0, 0.06, 0);
    sim.quad.quat.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    sim.fc.armed = false;
    run(sim, 1, centred(0));
    expect(upY(sim)).toBeLessThan(-0.9);
    sim.fc.armed = true;
    sim.fc.turtle = true;
    // Like a pilot: hold the stick until it tips past vertical, then let go and disarm.
    for (let t = 0; upY(sim) < 0.2 && t < 3; t += 0.01) run(sim, 0.01, { throttle: 0, roll: 1, pitch: 0, yaw: 0 });
    sim.fc.armed = false;
    run(sim, 2, centred(0));
    expect(upY(sim)).toBeGreaterThan(0.9);
  });
});
