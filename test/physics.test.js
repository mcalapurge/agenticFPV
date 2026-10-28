import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, run, findHoverThrottle } from './sim-harness.js';
import { actualRate, betaflightRate } from '../src/sim/rates.js';

test('rates: actual rates hit center sensitivity and max', () => {
  const r = { rcRate: 70, rate: 670, expo: 0.54 };
  assert.equal(actualRate(0, r), 0);
  assert.ok(Math.abs(actualRate(1, r) - 670) < 1e-9);
  assert.ok(Math.abs(actualRate(-1, r) + 670) < 1e-9);
  // slope near center ≈ center sensitivity
  assert.ok(Math.abs(actualRate(0.001, r) / 0.001 - 70) < 1);
});

test('rates: betaflight 1.0/0.7/0 gives ~667 deg/s', () => {
  const v = betaflightRate(1, { rcRate: 100, rate: 70, expo: 0 });
  assert.ok(Math.abs(v - 666.7) < 1, `got ${v}`);
});

test('hover throttle is plausible for a 5" quad', () => {
  const h = findHoverThrottle();
  assert.ok(h > 0.15 && h < 0.45, `hover throttle ${h}`);
});

for (const [axis, idx] of [['roll', 0], ['pitch', 1], ['yaw', 2]]) {
  test(`${axis} step response tracks setpoint without oscillation`, () => {
    const hover = findHoverThrottle();
    const sim = makeSim((c) => { c.physics.battery = false; });
    run(sim, 0.3, { throttle: hover, roll: 0, pitch: 0, yaw: 0 });
    const rc = { throttle: hover, roll: 0, pitch: 0, yaw: 0, [axis]: 0.5 };
    let maxRate = 0;
    const samples = [];
    run(sim, 0.4, rc, (t, s) => {
      maxRate = Math.max(maxRate, s.fc.gyro[idx]);
      samples.push(s.fc.gyro[idx]);
    });
    const sp = sim.fc.setpoint[idx];
    const final = samples.slice(-100).reduce((a, b) => a + b, 0) / 100;
    const overshoot = (maxRate - sp) / sp;
    console.log(`${axis}: sp=${sp.toFixed(0)} final=${final.toFixed(0)} overshoot=${(overshoot * 100).toFixed(1)}%`);
    assert.ok(Math.abs(final - sp) / sp < 0.08, `final ${final} vs ${sp}`);
    assert.ok(overshoot < 0.25, `overshoot ${overshoot}`);
  });
}

test('top speed is in the 5" freestyle range (100-190 km/h)', () => {
  const sim = makeSim((c) => { c.flight.mode = 'angle'; c.pid.angleLimit = 75; c.physics.battery = false; });
  sim.quad.pos.y = 500;
  run(sim, 8, { throttle: 1, roll: 0, pitch: 1, yaw: 0 });
  const horiz = Math.hypot(sim.quad.vel.x, sim.quad.vel.z) * 3.6;
  console.log(`top speed ${horiz.toFixed(0)} km/h, vy=${sim.quad.vel.y.toFixed(1)}`);
  assert.ok(horiz > 100 && horiz < 190, `speed ${horiz}`);
});

test('full flip completes and quad recovers level-ish rates', () => {
  const sim = makeSim((c) => { c.physics.battery = false; });
  run(sim, 0.2, { throttle: 0.3, roll: 0, pitch: 0, yaw: 0 });
  run(sim, 0.55, { throttle: 0.1, roll: 1, pitch: 0, yaw: 0 });
  run(sim, 0.3, { throttle: 0.3, roll: 0, pitch: 0, yaw: 0 });
  const rates = sim.quad.gyro.map(Math.abs);
  assert.ok(rates.every((r) => r < 40), `residual rates ${rates}`);
});
