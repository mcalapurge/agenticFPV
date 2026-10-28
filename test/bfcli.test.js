import test from 'node:test';
import assert from 'node:assert/strict';
import { deepClone, DEFAULT_CONFIG } from '../src/config.js';
import { applyBetaflightCli } from '../src/sim/bfcli.js';
import { actualRate } from '../src/sim/rates.js';

const DIFF = `
# diff all
# version
# Betaflight / STM32F7X2 (S7X2) 4.4.2 Jun  4 2023
feature -AIRMODE
set gyro_lpf1_static_hz = 300
set dshot_idle_value = 450
profile 0
set p_roll = 50
set i_roll = 90
set d_roll = 42
set f_roll = 135
set p_pitch = 55
set d_pitch = 47
set tpa_rate = 70
set tpa_breakpoint = 1450
set dterm_lpf1_static_hz = 90
profile 1
set p_roll = 99
rateprofile 0
set rates_type = ACTUAL
set roll_rc_rate = 7
set roll_srate = 80
set roll_expo = 40
set thr_mid = 45
rateprofile 2
set roll_srate = 10
# restore original profile selection
profile 0
rateprofile 0
`;

test('betaflight diff all imports the active profiles', () => {
  const cfg = deepClone(DEFAULT_CONFIG);
  const changes = applyBetaflightCli(cfg, DIFF);
  assert.deepEqual(cfg.pid.roll, { p: 50, i: 90, d: 42, f: 135 });
  assert.equal(cfg.pid.pitch.p, 55);
  assert.equal(cfg.pid.pitch.d, 47);
  assert.equal(cfg.pid.tpaRate, 0.7);
  assert.ok(Math.abs(cfg.pid.tpaBreakpoint - 0.45) < 1e-9);
  assert.equal(cfg.pid.airmode, false);
  assert.equal(cfg.filters.gyroLpfHz, 300);
  assert.equal(cfg.filters.dtermLpfHz, 90);
  assert.equal(cfg.flight.motorIdle, 0.045);
  assert.equal(cfg.rates.type, 'actual');
  assert.equal(cfg.rates.roll.rcRate, 70);
  assert.equal(cfg.rates.roll.rate, 800);
  assert.equal(cfg.rates.roll.expo, 0.4);
  assert.equal(cfg.rates.throttleMid, 0.45);
  assert.ok(Math.abs(actualRate(1, cfg.rates.roll) - 800) < 1e-9);
  assert.ok(changes.length > 10);
});
