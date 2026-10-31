// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectTouchDevice, readDeviceEnv, touchEnabled, type DeviceEnv } from '../../src/engine/input/device';
import { InputManager } from '../../src/engine/input/input';
import { applyExpo, stickVector, throttleFromDrag, TouchInput } from '../../src/engine/input/touch';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';

const env = (patch: Partial<DeviceEnv>): DeviceEnv => ({
  maxTouchPoints: 0,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  platform: 'Linux x86_64',
  coarsePointer: false,
  canHover: true,
  ...patch,
});

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('detectTouchDevice', () => {
  it.each<[string, Partial<DeviceEnv>, boolean]>([
    [
      'iPhone',
      { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, coarsePointer: true, canHover: false },
      true,
    ],
    [
      'Android phone',
      { userAgent: PIXEL, platform: 'Linux armv8l', maxTouchPoints: 5, coarsePointer: true, canHover: false },
      true,
    ],
    [
      'Android tablet (no "Mobile" in the UA)',
      { userAgent: ANDROID_TABLET, maxTouchPoints: 5, coarsePointer: true, canHover: false },
      true,
    ],
    [
      'iPad (iPadOS reports itself as a Mac)',
      { platform: 'MacIntel', maxTouchPoints: 5, coarsePointer: true, canHover: false },
      true,
    ],
    [
      'iPad with a trackpad attached',
      { platform: 'MacIntel', maxTouchPoints: 5, coarsePointer: false, canHover: true },
      true,
    ],
    ['real Mac', { platform: 'MacIntel', maxTouchPoints: 0 }, false],
    ['Linux desktop', {}, false],
    [
      'Windows touchscreen laptop (has a mouse/trackpad)',
      { platform: 'Win32', maxTouchPoints: 10, coarsePointer: false, canHover: true },
      false,
    ],
    [
      'Windows tablet, finger only',
      { platform: 'Win32', maxTouchPoints: 10, coarsePointer: true, canHover: false },
      true,
    ],
    [
      'Chrome devtools phone emulation',
      { userAgent: PIXEL, maxTouchPoints: 1, coarsePointer: true, canHover: false },
      true,
    ],
    ['mobile user agent but no touch hardware (spoofed / headless)', { userAgent: PIXEL }, false],
  ])('%s → %s', (_name, patch, expected) => {
    expect(detectTouchDevice(env(patch))).toBe(expected);
  });
});

describe('touchEnabled', () => {
  it('follows detection on auto and is overridden by on/off', () => {
    expect(touchEnabled('auto', true)).toBe(true);
    expect(touchEnabled('auto', false)).toBe(false);
    expect(touchEnabled('on', false)).toBe(true);
    expect(touchEnabled('off', true)).toBe(false);
  });
});

describe('readDeviceEnv', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads touch points, user agent and the pointer media queries from the browser', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
    vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: PIXEL, platform: 'Linux armv8l' });
    const e = readDeviceEnv();
    expect(e).toMatchObject({ maxTouchPoints: 5, userAgent: PIXEL, coarsePointer: true, canHover: false });
    expect(detectTouchDevice(e)).toBe(true);
  });

  it('copes with browsers that have no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(readDeviceEnv()).toMatchObject({ coarsePointer: false, canHover: false });
  });
});

describe('stick maths', () => {
  it('expo softens the centre and keeps the ends', () => {
    expect(applyExpo(0, 0.5)).toBe(0);
    expect(applyExpo(1, 0.5)).toBe(1);
    expect(applyExpo(-1, 0.5)).toBe(-1);
    expect(applyExpo(0.5, 0)).toBe(0.5);
    expect(applyExpo(0.5, 1)).toBeCloseTo(0.125, 9);
    expect(Math.abs(applyExpo(0.3, 0.4))).toBeLessThan(0.3);
  });

  it('stickVector is zero in the dead zone, rescaled outside it, and capped at the radius', () => {
    expect(stickVector(0, 0, 60)).toEqual({ x: 0, y: 0 });
    expect(stickVector(2, 0, 60)).toEqual({ x: 0, y: 0 }); // 3% of the radius
    const half = stickVector(30, 0, 60);
    expect(half.x).toBeGreaterThan(0.45);
    expect(half.x).toBeLessThan(0.5);
    expect(stickVector(60, 0, 60).x).toBeCloseTo(1, 9);
    const far = stickVector(300, 400, 60); // way past the edge: still unit length, right direction
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 9);
    expect(far.x / far.y).toBeCloseTo(0.75, 9);
    expect(stickVector(-30, 40, 100).x).toBeLessThan(0);
    expect(stickVector(10, 10, 0)).toEqual({ x: 0, y: 0 });
  });

  it('throttle moves relative to where it was, never jumping, and stays in 0…1', () => {
    expect(throttleFromDrag(0.4, 0, 100)).toBe(0.4); // finger down, no movement
    expect(throttleFromDrag(0.4, 50, 100)).toBeCloseTo(0.9, 9);
    expect(throttleFromDrag(0.4, -20, 100)).toBeCloseTo(0.2, 9);
    expect(throttleFromDrag(0.9, 500, 100)).toBe(1);
    expect(throttleFromDrag(0.1, -500, 100)).toBe(0);
  });
});

describe('TouchInput', () => {
  it('stores clamped stick values and resets', () => {
    const t = new TouchInput();
    t.setLeft(2, 3);
    t.setRight(-5, 0.5);
    expect(t).toMatchObject({ yaw: 1, throttle: 1, roll: -1, pitch: 0.5 });
    t.cutThrottle();
    expect(t.throttle).toBe(0);
    t.reset();
    expect(t).toMatchObject({ yaw: 0, throttle: 0, roll: 0, pitch: 0 });
  });
});

describe('InputManager with touch controls', () => {
  const managers: InputManager[] = [];
  const make = () => {
    const m = new InputManager(structuredClone(DEFAULT_CONFIG));
    managers.push(m);
    return m;
  };
  afterEach(() => managers.splice(0).forEach((m) => m.dispose()));

  it('flies from the on-screen sticks when enabled and no gamepad is connected', () => {
    const m = make();
    m.touch.enabled = true;
    m.touch.setLeft(0.5, 0.7);
    m.touch.setRight(-0.25, 0.9);
    expect(m.poll(0.016, null)).toMatchObject({ yaw: 0.5, throttle: 0.7, roll: -0.25, pitch: 0.9 });
    expect(m.usingKeyboard).toBe(false);
  });

  it('ignores the sticks when touch is off, and keeps using the keyboard', () => {
    const m = make();
    m.touch.setLeft(0.5, 0.7);
    expect(m.poll(0.016, null)).toMatchObject({ yaw: 0, throttle: 0 });
    expect(m.usingKeyboard).toBe(true);
  });

  it('a connected gamepad always wins', () => {
    const m = make();
    m.touch.enabled = true;
    m.touch.setLeft(0.5, 0.7);
    const pad = { axes: [0, 0, -1, 0, -1], buttons: [] };
    expect(m.poll(0.016, pad)).toMatchObject({ throttle: 0, yaw: 0 });
  });

  it('the ARM and turtle buttons toggle the same switches as the keys', () => {
    const m = make();
    m.touch.enabled = true;
    expect(m.toggleArm()).toBe(true);
    expect(m.poll(0.016, null).armSwitch).toBe(true);
    expect(m.toggleTurtle()).toBe(true);
    expect(m.poll(0.016, null).turtleSwitch).toBe(true);
    expect(m.toggleArm()).toBe(false);
    expect(m.poll(0.016, null).armSwitch).toBe(false);
  });

  it('on-screen buttons fire the same events as the keys', () => {
    const m = make();
    const seen: string[] = [];
    for (const e of ['reset', 'camera', 'mode', 'menu', 'help'] as const) m.on(e, () => seen.push(e));
    for (const e of ['reset', 'camera', 'mode', 'menu', 'help'] as const) m.trigger(e);
    expect(seen).toEqual(['reset', 'camera', 'mode', 'menu', 'help']);
  });

  it('releaseAll lets go of the touch sticks too', () => {
    const m = make();
    m.touch.enabled = true;
    m.touch.setLeft(1, 1);
    m.releaseAll();
    expect(m.poll(0.016, null)).toMatchObject({ throttle: 0, yaw: 0 });
  });
});

describe('touch settings', () => {
  it('have sensible defaults and are clamped', async () => {
    const { parseConfig } = await import('../../src/state/configSchema');
    expect(DEFAULT_CONFIG.input.touch).toEqual({
      mode: 'auto',
      throttleHold: true,
      size: 1,
      expo: 0.35,
      haptics: true,
    });
    const bad = parseConfig({ input: { touch: { mode: 'maybe', size: 99, expo: -3 } } }).input.touch;
    expect(bad).toMatchObject({ mode: 'auto', size: 1.6, expo: 0 });
    expect(parseConfig({ input: { touch: { mode: 'on' } } }).input.touch.mode).toBe('on');
  });
});
