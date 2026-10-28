import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { deepClone, DEFAULT_CONFIG } from '../src/config.js';
import { QUAD_PRESETS, applyPreset } from '../src/sim/presets.js';
import { FlightController } from '../src/sim/flightController.js';
import { Quad } from '../src/sim/quad.js';

const DT = 0.001;
function sim(id, mutate) {
  const cfg = deepClone(DEFAULT_CONFIG);
  applyPreset(cfg, id);
  cfg.physics.battery = false;
  mutate?.(cfg);
  const fc = new FlightController(cfg, DT);
  const quad = new Quad(cfg);
  quad.reset(new Vector3(0, 100, 0), 0);
  fc.armed = true;
  return { cfg, fc, quad };
}
function run(s, secs, rc, cb) {
  for (let i = 0; i < secs / DT; i++) {
    s.quad.step(DT, s.fc.update(rc, s.quad.gyro, s.quad.attitude));
    cb?.(s);
  }
}
function hover(id) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 16; k++) {
    const m = (lo + hi) / 2;
    const s = sim(id, (c) => { c.flight.mode = 'angle'; });
    run(s, 1.5, { throttle: m, roll: 0, pitch: 0, yaw: 0 });
    s.quad.vel.y > 0 ? (hi = m) : (lo = m);
  }
  return (lo + hi) / 2;
}

for (const id of Object.keys(QUAD_PRESETS)) {
  test(`preset ${id}: hovers and tracks rate steps cleanly`, () => {
    const h = hover(id);
    const lines = [`${id}: hover ${(h * 100).toFixed(0)}%`];
    assert.ok(h > 0.1 && h < 0.6, `hover ${h}`);
    ['roll', 'pitch', 'yaw'].forEach((axis, idx) => {
      const s = sim(id);
      run(s, 0.3, { throttle: h, roll: 0, pitch: 0, yaw: 0 });
      const trace = [];
      run(s, 0.5, { throttle: h, roll: 0, pitch: 0, yaw: 0, [axis]: 0.5 }, (q) => trace.push(q.fc.gyro[idx]));
      const sp = s.fc.setpoint[idx];
      const tail = trace.slice(-150);
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      const std = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
      const over = (Math.max(...trace) - sp) / sp;
      const rise = trace.findIndex((v) => v > sp * 0.9);
      lines.push(`${axis} over ${(over * 100).toFixed(0)}% rise ${rise}ms err ${((mean / sp - 1) * 100).toFixed(1)}% std ${std.toFixed(1)}`);
      assert.ok(Math.abs(mean - sp) / sp < 0.1, `${axis} tracking ${mean} vs ${sp}`);
      assert.ok(over < 0.3, `${axis} overshoot ${over}`);
      assert.ok(std < sp * 0.06, `${axis} oscillation std ${std}`);
    });
    console.log(lines.join(' | '));
  });
}
