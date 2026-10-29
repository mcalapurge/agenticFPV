import { describe, expect, it } from 'vitest';
import { ConfigSchema, DEFAULT_CONFIG, getPath, parseConfig, setPath } from '../../src/state/configSchema';

describe('config schema', () => {
  it('builds a complete default config from nothing', () => {
    for (const input of [undefined, null, {}, 'garbage', 42]) expect(parseConfig(input)).toEqual(DEFAULT_CONFIG);
  });

  it('has Betaflight-like defaults', () => {
    expect(DEFAULT_CONFIG.pid.roll).toEqual({ p: 45, i: 80, d: 40, f: 120 });
    expect(DEFAULT_CONFIG.rates.type).toBe('actual');
    expect(DEFAULT_CONFIG.quad.preset).toBe('freestyle5');
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });

  it('keeps valid values and fills the rest from defaults', () => {
    const cfg = parseConfig({ pid: { roll: { p: 60 } }, rates: { type: 'betaflight' } });
    expect(cfg.pid.roll).toEqual({ ...DEFAULT_CONFIG.pid.roll, p: 60 });
    expect(cfg.pid.pitch).toEqual(DEFAULT_CONFIG.pid.pitch);
    expect(cfg.rates.type).toBe('betaflight');
  });

  it('falls back per-leaf on invalid values', () => {
    const cfg = parseConfig({ pid: { roll: { p: 'fast', i: null }, airmode: 'yes' }, rates: { type: 'kiss' } });
    expect(cfg.pid.roll.p).toBe(DEFAULT_CONFIG.pid.roll.p);
    expect(cfg.pid.roll.i).toBe(DEFAULT_CONFIG.pid.roll.i);
    expect(cfg.pid.airmode).toBe(DEFAULT_CONFIG.pid.airmode);
    expect(cfg.rates.type).toBe('actual');
  });

  it('rebuilds broken sections', () => {
    const cfg = parseConfig({ pid: 'broken', physics: null, rates: [] });
    expect(cfg.pid).toEqual(DEFAULT_CONFIG.pid);
    expect(cfg.physics).toEqual(DEFAULT_CONFIG.physics);
    expect(cfg.rates).toEqual(DEFAULT_CONFIG.rates);
  });

  it('clamps out-of-range numbers', () => {
    const cfg = parseConfig({ pid: { roll: { p: 9999, d: -5 }, angleLimit: 400 }, rates: { roll: { expo: 3 } } });
    expect(cfg.pid.roll.p).toBe(250);
    expect(cfg.pid.roll.d).toBe(0);
    expect(cfg.pid.angleLimit).toBe(90);
    expect(cfg.rates.roll.expo).toBe(1);
  });

  it('drops unknown keys', () => {
    const cfg = parseConfig({ hacked: true, pid: { roll: { p: 50, z: 1 } } }) as unknown as Record<string, unknown>;
    expect(cfg.hacked).toBeUndefined();
    expect((cfg.pid as { roll: Record<string, unknown> }).roll.z).toBeUndefined();
  });

  it('round-trips through JSON', () => {
    const json = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    expect(ConfigSchema.parse(json)).toEqual(DEFAULT_CONFIG);
  });
});

describe('typed paths', () => {
  it('get and set leaves and sections', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    expect(getPath(cfg, 'pid.roll.p')).toBe(45);
    setPath(cfg, 'pid.roll.p', 70);
    expect(cfg.pid.roll.p).toBe(70);
    setPath(cfg, 'rates.yaw', { rcRate: 1, rate: 2, expo: 0 });
    expect(getPath(cfg, 'rates.yaw')).toEqual({ rcRate: 1, rate: 2, expo: 0 });
  });
});
