import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, run, findHoverThrottle } from './sim-harness.js';
import { actualRate, betaflightRate } from '../src/sim/rates.js';
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/sim/collision.js';

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

function groundSim(mutate) {
  const sim = makeSim((c) => { c.physics.battery = false; mutate?.(c); });
  const world = new CollisionWorld();
  sim.collide = (q) => world.resolveQuad(q, sim.cfg.physics);
  return sim;
}
function runCollide(sim, seconds, rc) {
  for (let i = 0; i < seconds * 1000; i++) {
    const m = sim.fc.update(rc, sim.quad.gyro, sim.quad.attitude);
    sim.quad.step(0.001, m, sim.collide);
  }
}
const upY = (q) => new Vector3(0, 1, 0).applyQuaternion(q.quat).y;

test('dropped quad tumbles and comes to rest on the ground', () => {
  const sim = groundSim();
  sim.fc.armed = false;
  sim.quad.pos.set(0, 2, 0);
  sim.quad.quat.setFromAxisAngle(new Vector3(1, 0, 1).normalize(), 2.2);
  sim.quad.omega.set(3, 1, -4);
  runCollide(sim, 4, { throttle: 0, roll: 0, pitch: 0, yaw: 0 });
  const q = sim.quad;
  console.log(`rest: y=${q.pos.y.toFixed(3)} v=${q.vel.length().toFixed(3)} w=${q.omega.length().toFixed(3)} upY=${upY(q).toFixed(2)}`);
  assert.ok(q.pos.y > 0 && q.pos.y < 0.15, `height ${q.pos.y}`);
  assert.ok(q.vel.length() < 0.05 && q.omega.length() < 0.2, 'not at rest');
  assert.ok(Math.abs(upY(q)) > 0.9, 'should rest flat (upright or inverted)');
});

test('turtle mode flips an inverted quad back over', () => {
  const sim = groundSim();
  sim.quad.pos.set(0, 0.06, 0);
  sim.quad.quat.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI); // upside down
  sim.fc.armed = false;
  runCollide(sim, 1, { throttle: 0, roll: 0, pitch: 0, yaw: 0 });
  assert.ok(upY(sim.quad) < -0.9, 'starts inverted');
  sim.fc.armed = true;
  sim.fc.turtle = true;
  // Like a pilot: hold the stick until it tips past vertical, then let go and disarm.
  let t = 0;
  while (upY(sim.quad) < 0.2 && t < 3) {
    runCollide(sim, 0.01, { throttle: 0, roll: 1, pitch: 0, yaw: 0 });
    t += 0.01;
  }
  sim.fc.armed = false;
  runCollide(sim, 2, { throttle: 0, roll: 0, pitch: 0, yaw: 0 });
  console.log(`after turtle upY=${upY(sim.quad).toFixed(2)}`);
  assert.ok(upY(sim.quad) > 0.9, 'quad should be upright');
});

test('wind pushes a self-levelling quad downwind', () => {
  const hover = findHoverThrottle();
  const sim = makeSim((c) => { c.flight.mode = 'angle'; c.physics.battery = false; c.physics.windSpeed = 8; c.physics.windDir = 0; c.physics.windGust = 0; });
  run(sim, 3, { throttle: hover, roll: 0, pitch: 0, yaw: 0 });
  // windDir 0 = blowing from the north (-Z) toward +Z
  console.log(`wind drift vz=${sim.quad.vel.z.toFixed(2)}`);
  assert.ok(sim.quad.vel.z > 1, `vz ${sim.quad.vel.z}`);
});
