import { describe, expect, it } from 'vitest';
import { applyBetaflightCli, parseBetaflightCli } from '../../src/engine/sim/bfcli';
import { actualRate } from '../../src/engine/sim/rates';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';

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

describe('Betaflight CLI import', () => {
  it('parses profiles and remembers the active selection', () => {
    const p = parseBetaflightCli(DIFF);
    expect(p.activeProfile).toBe(0);
    expect(p.activeRate).toBe(0);
    expect(p.pid.p_roll).toBe('50');
    expect(p.features.AIRMODE).toBe(false);
  });

  it('applies the active PID and rate profiles from a diff all', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    const changes = applyBetaflightCli(cfg, DIFF);
    expect(cfg.pid.roll).toEqual({ p: 50, i: 90, d: 42, f: 135 });
    expect(cfg.pid.pitch).toMatchObject({ p: 55, d: 47 });
    expect(cfg.pid.tpaRate).toBe(0.7);
    expect(cfg.pid.tpaBreakpoint).toBeCloseTo(0.45, 9);
    expect(cfg.pid.airmode).toBe(false);
    expect(cfg.filters.gyroLpfHz).toBe(300);
    expect(cfg.filters.dtermLpfHz).toBe(90);
    expect(cfg.flight.motorIdle).toBe(0.045);
    expect(cfg.rates.type).toBe('actual');
    expect(cfg.rates.roll).toEqual({ rcRate: 70, rate: 800, expo: 0.4 });
    expect(cfg.rates.throttleMid).toBe(0.45);
    expect(actualRate(1, cfg.rates.roll)).toBeCloseTo(800, 9);
    expect(changes.length).toBeGreaterThan(10);
  });

  it('leaves the config untouched for non-CLI text', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    expect(applyBetaflightCli(cfg, 'hello world')).toEqual([]);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});
