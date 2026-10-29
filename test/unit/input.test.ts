import { describe, expect, it } from 'vitest';
import {
  CalibrationWizard,
  INPUT_PRESETS,
  normaliseAxis,
  WIZARD_STEPS,
  type PadSnapshot,
} from '../../src/engine/input/input';

const ch = (patch = {}) => ({ axis: 0, invert: false, min: -1, center: 0, max: 1, ...patch });

describe('normaliseAxis', () => {
  it('maps throttle min..max to 0..1', () => {
    expect(normaliseAxis('throttle', -1, ch(), 0)).toBe(0);
    expect(normaliseAxis('throttle', 0, ch(), 0)).toBe(0.5);
    expect(normaliseAxis('throttle', 1, ch(), 0)).toBe(1);
    expect(normaliseAxis('throttle', 1, ch({ invert: true }), 0)).toBe(0);
    expect(normaliseAxis('throttle', 2, ch(), 0)).toBe(1);
  });

  it('maps sticks around an off-centre calibration', () => {
    const c = ch({ min: -0.8, center: 0.1, max: 0.9 });
    expect(normaliseAxis('roll', 0.1, c, 0)).toBe(0);
    expect(normaliseAxis('roll', 0.9, c, 0)).toBeCloseTo(1, 9);
    expect(normaliseAxis('roll', -0.8, c, 0)).toBeCloseTo(-1, 9);
    expect(normaliseAxis('roll', 0.5, c, 0)).toBeCloseTo(0.5, 9);
    expect(normaliseAxis('roll', 0.5, { ...c, invert: true }, 0)).toBeCloseTo(-0.5, 9);
  });

  it('applies a rescaled deadband', () => {
    expect(normaliseAxis('yaw', 0.04, ch(), 0.05)).toBe(0);
    expect(normaliseAxis('yaw', 1, ch(), 0.05)).toBe(1);
    expect(normaliseAxis('yaw', 0.525, ch(), 0.05)).toBeCloseTo(0.5, 9);
  });
});

/** Fake EdgeTX-style radio: axes roll, pitch, throttle, yaw, SA switch. */
function pad(
  axes: Partial<Record<'roll' | 'pitch' | 'throttle' | 'yaw' | 'sa', number>> = {},
  buttons: boolean[] = [],
): PadSnapshot {
  const a = { roll: 0.02, pitch: -0.01, throttle: -1, yaw: 0.03, sa: -1, ...axes };
  return { axes: [a.roll, a.pitch, a.throttle, a.yaw, a.sa], buttons: buttons.map((pressed) => ({ pressed })) };
}

describe('CalibrationWizard', () => {
  it('maps and calibrates a radio end to end', () => {
    const w = new CalibrationWizard();
    const script: Record<string, PadSnapshot> = {
      baseline: pad(),
      throttle: pad({ throttle: 1 }),
      center1: pad(),
      yaw: pad({ yaw: 0.98 }),
      center2: pad(),
      pitch: pad({ pitch: -0.97 }), // inverted pitch axis
      center3: pad(),
      roll: pad({ roll: 0.99 }),
      centers: pad(),
      arm: pad({ sa: 1 }),
    };
    let outcome;
    for (const step of WIZARD_STEPS) {
      if (step.range) {
        for (const v of [-0.95, 0.97]) w.track(pad({ roll: v, pitch: v, yaw: v, throttle: v }));
        outcome = w.next(pad());
      } else outcome = w.next(script[step.id]);
      if (outcome.kind === 'step') expect(outcome.warning).toBeUndefined();
    }
    expect(outcome?.kind).toBe('done');
    if (outcome?.kind !== 'done') return;
    const { channels, arm } = outcome.result;
    expect(channels.roll).toMatchObject({ axis: 0, invert: false, min: -0.95, max: 0.97, center: 0.02 });
    expect(channels.pitch).toMatchObject({ axis: 1, invert: true });
    expect(channels.throttle).toMatchObject({ axis: 2, invert: false });
    expect(channels.throttle?.center).toBeCloseTo(0.01, 9);
    expect(channels.yaw).toMatchObject({ axis: 3, center: 0.03 });
    expect(arm).toEqual({ type: 'axis', index: 4, threshold: 0, invert: false, toggle: false });
  });

  it('detects a button arm and allows skipping', () => {
    const run = (skip: boolean) => {
      const w = new CalibrationWizard();
      w.next(pad({}, [false, false]));
      while (!w.step.arm) {
        const st = w.step;
        const moved = st.ch ? pad({ [st.ch]: 1 }, [false, false]) : pad({}, [false, false]);
        w.next(moved);
      }
      return w.next(pad({}, [false, true]), skip);
    };
    const done = run(false);
    expect(done.kind === 'done' && done.result.arm).toEqual({
      type: 'button',
      index: 1,
      threshold: 0.5,
      invert: false,
      toggle: false,
    });
    const skipped = run(true);
    expect(skipped.kind === 'done' && skipped.result.arm).toBeNull();
  });

  it('warns without a pad or without movement', () => {
    const w = new CalibrationWizard();
    expect(w.next(null)).toMatchObject({ kind: 'step', index: 0, warning: expect.stringContaining('No controller') });
    w.next(pad());
    expect(w.next(pad())).toMatchObject({ index: 1, warning: expect.stringContaining('No stick movement') });
  });
});

describe('INPUT_PRESETS', () => {
  it('use four distinct axes', () => {
    for (const p of Object.values(INPUT_PRESETS)) {
      expect(new Set(Object.values(p.channels).map((c) => c.axis)).size).toBe(4);
    }
  });
});
