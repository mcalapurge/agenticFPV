// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { InputManager } from '../../src/engine/input/input';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';

const managers: InputManager[] = [];
function make() {
  const m = new InputManager(structuredClone(DEFAULT_CONFIG));
  managers.push(m);
  return m;
}
const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
const tap = (k: string) => {
  key('keydown', k);
  key('keyup', k);
};

afterEach(() => managers.splice(0).forEach((m) => m.dispose()));

describe('InputManager keyboard fallback', () => {
  it('holds throttle while W is held and keeps it after release', () => {
    const m = make();
    key('keydown', 'w');
    for (let i = 0; i < 10; i++) m.poll(0.05, null);
    key('keyup', 'w');
    const t = m.poll(0.05, null).throttle;
    expect(t).toBeCloseTo(0.4, 5);
    expect(m.poll(0.05, null).throttle).toBe(t);
  });

  it('cuts throttle on an X tap that falls between two polls (slow frame rates)', () => {
    const m = make();
    key('keydown', 'w');
    m.poll(0.5, null);
    key('keyup', 'w');
    tap('x');
    expect(m.poll(0.016, null).throttle).toBe(0);
  });

  it('Space toggles the arm switch, T toggles turtle', () => {
    const m = make();
    tap(' ');
    expect(m.poll(0.016, null).armSwitch).toBe(true);
    tap('t');
    expect(m.poll(0.016, null).turtleSwitch).toBe(true);
    tap(' ');
    expect(m.poll(0.016, null).armSwitch).toBe(false);
  });

  it('emits menu/reset/camera events and stops after unsubscribe', () => {
    const m = make();
    const seen: string[] = [];
    const offs = (['menu', 'reset', 'camera', 'mode', 'help'] as const).map((e) => m.on(e, () => seen.push(e)));
    for (const k of ['Escape', 'r', 'c', 'm', 'h']) tap(k);
    expect(seen).toEqual(['menu', 'reset', 'camera', 'mode', 'help']);
    offs.forEach((off) => off());
    tap('r');
    expect(seen).toHaveLength(5);
  });

  it('ignores keys typed into form fields', () => {
    const m = make();
    const input = document.body.appendChild(document.createElement('input'));
    key('keydown', ' ', input);
    key('keydown', 'w', input);
    expect(m.poll(0.5, null)).toMatchObject({ armSwitch: false, throttle: 0 });
    input.remove();
  });

  it('lets a key hook swallow keys', () => {
    const m = make();
    m.keyHook = (k) => k === 'r';
    let resets = 0;
    m.on('reset', () => resets++);
    tap('r');
    expect(resets).toBe(0);
  });

  it('reads a gamepad through the channel map and arm switch', () => {
    const m = make();
    const pad = { axes: [0.5, -0.5, 1, 0, 1], buttons: [] };
    const st = m.poll(0.016, pad);
    expect(st).toMatchObject({ throttle: 1, yaw: 0, armSwitch: true });
    expect(st.roll).toBeCloseTo(0.5, 1); // rescaled by the 1% default deadband
    expect(st.pitch).toBeCloseTo(-0.5, 1);
    expect(m.usingKeyboard).toBe(false);
  });
});
