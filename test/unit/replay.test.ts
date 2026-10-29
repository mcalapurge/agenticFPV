import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { formatReplayTime, Replay } from '../../src/engine/game/replay';

const quadAt = (x: number, m = 0.5) => ({
  pos: new Vector3(x, 1, 0),
  quat: new Quaternion(),
  motorSpeed: [m, m, m, m],
});

function filled(seconds: number, capacitySeconds = 90) {
  const r = new Replay(capacitySeconds, 60);
  for (let i = 0; i <= seconds * 1000; i++) {
    const t = i / 1000;
    r.record(t, quadAt(t * 10)); // 10 m/s along x
  }
  return r;
}

describe('Replay', () => {
  it('records at the sample rate, not the physics rate', () => {
    const r = filled(2);
    expect(r.count).toBeGreaterThanOrEqual(115); // 1 ms ticks quantise the 16.7 ms interval up to 17 ms
    expect(r.count).toBeLessThanOrEqual(121);
    expect(r.start).toBe(0);
    expect(r.duration).toBeCloseTo(2, 1);
  });

  it('keeps only the newest samples when the ring wraps', () => {
    const r = filled(5, 2);
    expect(r.count).toBe(120);
    expect(r.end).toBeCloseTo(5, 1);
    expect(r.start).toBeCloseTo(3, 1);
  });

  it('needs some footage before entering', () => {
    expect(filled(0.05).enter()).toBe(false);
    expect(filled(1).enter()).toBe(true);
  });

  it('interpolates pose, velocity and motors during playback', () => {
    const r = filled(2);
    r.enter();
    r.update(0); // at start
    r.cursor = 1.005;
    r.playing = false;
    r.update(0);
    expect(r.view.pos.x).toBeCloseTo(10.05, 1);
    expect(r.view.motorSpeed[0]).toBeCloseTo(0.5, 9);
    r.playing = true;
    r.update(0.1);
    expect(r.view.vel.x).toBeCloseTo(10, 0);
    expect(r.view.speedKmh).toBeCloseTo(36, -1);
  });

  it('loops, seeks within bounds and clamps speed', () => {
    const r = filled(2);
    r.enter();
    r.seek(100);
    expect(r.cursor).toBe(r.end);
    r.seek(-100);
    expect(r.cursor).toBe(r.start);
    r.cursor = r.end - 0.01;
    r.update(0.05);
    expect(r.cursor).toBe(r.start);
    r.setSpeed(10);
    expect(r.speed).toBe(4);
    r.setSpeed(0);
    expect(r.speed).toBe(0.125);
  });

  it('stops recording while active and clears', () => {
    const r = filled(1);
    r.enter();
    const n = r.count;
    r.record(10, quadAt(0));
    expect(r.count).toBe(n);
    r.exit();
    r.clear();
    expect(r.count).toBe(0);
    expect(r.duration).toBe(0);
  });

  it('formats m:ss.s', () => {
    expect(formatReplayTime(0)).toBe('0:00.0');
    expect(formatReplayTime(75.25)).toBe('1:15.3');
  });
});
