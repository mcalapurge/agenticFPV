// Every quad preset must fly: plausible hover and clean rate tracking on all three axes.

import { describe, expect, it } from 'vitest';
import { applyPreset, getPreset, QUAD_PRESETS } from '../../src/engine/sim/presets';
import { DEFAULT_CONFIG, type Axis } from '../../src/state/configSchema';
import { centred, findHoverThrottle, makeSim, mean, run, std } from './helpers/sim';

const AXES: Axis[] = ['roll', 'pitch', 'yaw'];

describe.each(Object.keys(QUAD_PRESETS))('preset %s', (id) => {
  it('hovers and tracks rate steps cleanly', () => {
    const h = findHoverThrottle(id);
    expect(h).toBeGreaterThan(0.1);
    expect(h).toBeLessThan(0.6);
    AXES.forEach((axis, idx) => {
      const s = makeSim((c) => void (c.physics.battery = false), id);
      s.quad.pos.y = 100;
      run(s, 0.3, centred(h));
      const trace: number[] = [];
      run(s, 0.5, { ...centred(h), [axis]: 0.5 }, (_t, q) => trace.push(q.fc.gyro[idx]));
      const sp = s.fc.setpoint[idx];
      const tail = trace.slice(-150);
      expect(Math.abs(mean(tail) - sp) / sp, `${axis} tracking`).toBeLessThan(0.1);
      expect((Math.max(...trace) - sp) / sp, `${axis} overshoot`).toBeLessThan(0.3);
      expect(std(tail), `${axis} oscillation`).toBeLessThan(sp * 0.06);
    });
  });
});

describe('applyPreset', () => {
  it('copies physics and PIDs but leaves rates alone', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.rates.roll.rate = 999;
    applyPreset(cfg, 'race5');
    const p = getPreset('race5');
    expect(cfg.quad.preset).toBe('race5');
    expect(cfg.physics).toMatchObject(p.physics);
    expect(cfg.pid.roll).toMatchObject(p.pid.roll);
    expect(cfg.rates.roll.rate).toBe(999);
  });

  it('ignores unknown preset ids', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    applyPreset(cfg, 'nope');
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(getPreset('nope')).toBe(QUAD_PRESETS.freestyle5);
  });
});
