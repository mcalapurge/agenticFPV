import { describe, expect, it } from 'vitest';
import { PT1, PT2 } from '../../src/engine/sim/filters';
import { actualRate, applyRate, betaflightRate, throttleCurve } from '../../src/engine/sim/rates';
import { fmtTime } from '../../src/engine/format';

describe('Actual rates', () => {
  const r = { rcRate: 70, rate: 670, expo: 0.54 };

  it('hit zero, max rate and are symmetric', () => {
    expect(actualRate(0, r)).toBe(0);
    expect(actualRate(1, r)).toBeCloseTo(670, 9);
    expect(actualRate(-1, r)).toBeCloseTo(-670, 9);
  });

  it('use center sensitivity as the slope at centre', () => {
    expect(actualRate(0.001, r) / 0.001).toBeCloseTo(70, 0);
  });

  it('clamp stick input to ±1', () => {
    expect(actualRate(2, r)).toBeCloseTo(670, 9);
  });

  it('are monotonic', () => {
    let prev = -Infinity;
    for (let s = -1; s <= 1; s += 0.01) {
      const v = actualRate(s, r);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('Betaflight rates', () => {
  it('1.00 / 0.70 / 0 gives ~667 deg/s', () => {
    expect(betaflightRate(1, { rcRate: 100, rate: 70, expo: 0 })).toBeCloseTo(666.7, 0);
  });

  it('cap at ±1998 deg/s', () => {
    expect(betaflightRate(1, { rcRate: 255, rate: 99, expo: 0 })).toBe(1998);
  });

  it('applyRate dispatches on type', () => {
    const ax = { rcRate: 100, rate: 70, expo: 0 };
    expect(applyRate('betaflight', 0.5, ax)).toBe(betaflightRate(0.5, ax));
    expect(applyRate('actual', 0.5, ax)).toBe(actualRate(0.5, ax));
  });
});

describe('throttle curve', () => {
  it('is linear with no expo and pins the mid point', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(throttleCurve(t, 0.5, 0)).toBeCloseTo(t, 9);
    expect(throttleCurve(0.4, 0.4, 0.8)).toBeCloseTo(0.4, 9);
  });

  it('flattens around mid with expo and keeps the end points', () => {
    expect(throttleCurve(0, 0.5, 1)).toBe(0);
    expect(throttleCurve(1, 0.5, 1)).toBe(1);
    expect(Math.abs(throttleCurve(0.6, 0.5, 1) - 0.5)).toBeLessThan(0.02);
  });
});

describe('PT1 / PT2 filters', () => {
  it('PT1 reaches ~63% of a step after one time constant', () => {
    const f = new PT1(10, 0.001);
    const tau = 1 / (2 * Math.PI * 10);
    let y = 0;
    for (let i = 0; i < Math.round(tau / 0.001); i++) y = f.apply(1);
    expect(y).toBeGreaterThan(0.6);
    expect(y).toBeLessThan(0.66);
  });

  it('PT1 with cutoff 0 passes through', () => {
    expect(new PT1(0).apply(5)).toBe(5);
  });

  it('PT2 lags PT1 but converges', () => {
    const a = new PT1(20);
    const b = new PT2(20);
    let ya = 0;
    let yb = 0;
    for (let i = 0; i < 5; i++) {
      ya = a.apply(1);
      yb = b.apply(1);
    }
    expect(yb).toBeLessThan(ya);
    for (let i = 0; i < 2000; i++) yb = b.apply(1);
    expect(yb).toBeCloseTo(1, 6);
  });
});

describe('fmtTime', () => {
  it('formats mm:ss.cc', () => {
    expect(fmtTime(0)).toBe('00:00.00');
    expect(fmtTime(61.234)).toBe('01:01.23');
    expect(fmtTime(9.5)).toBe('00:09.50');
  });
});
