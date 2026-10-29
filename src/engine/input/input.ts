// Gamepad / USB RC-transmitter input with calibration, plus a keyboard fallback.

import type { ChannelConfig, ChannelName, Config, SwitchConfig } from '../../state/configSchema';
import type { Sticks } from '../sim/flightController';

export const CHANNELS: readonly ChannelName[] = ['throttle', 'yaw', 'pitch', 'roll'];

export interface InputPreset {
  channels: Record<ChannelName, ChannelConfig>;
  arm: SwitchConfig;
}

const ch = (axis: number, invert = false): ChannelConfig => ({ axis, invert, min: -1, center: 0, max: 1 });

export const INPUT_PRESETS: Record<string, InputPreset> = {
  'RC transmitter (EdgeTX / OpenTX USB joystick)': {
    channels: { roll: ch(0), pitch: ch(1), throttle: ch(2), yaw: ch(3) },
    arm: { type: 'axis', index: 4, threshold: 0.3, invert: false, toggle: false },
  },
  'Gamepad (Mode 2, Xbox/PS layout)': {
    channels: { yaw: ch(0), throttle: ch(1, true), roll: ch(2), pitch: ch(3, true) },
    arm: { type: 'button', index: 9, threshold: 0.5, invert: false, toggle: true },
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalise a raw axis value using calibration. Throttle → 0..1, others → -1..1 (with deadband). */
export function normaliseAxis(name: ChannelName, raw: number, c: ChannelConfig, deadband: number): number {
  if (name === 'throttle') {
    let v = (raw - c.min) / Math.max(1e-6, c.max - c.min);
    if (c.invert) v = 1 - v;
    return clamp(v, 0, 1);
  }
  let v = raw >= c.center ? (raw - c.center) / Math.max(1e-6, c.max - c.center) : (raw - c.center) / Math.max(1e-6, c.center - c.min);
  if (c.invert) v = -v;
  v = Math.abs(v) < deadband ? 0 : Math.sign(v) * ((Math.abs(v) - deadband) / (1 - deadband));
  return clamp(v, -1, 1);
}

/** Minimal view of a gamepad (lets tests feed fake pads). */
export interface PadSnapshot {
  id?: string;
  index?: number;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export interface InputState extends Sticks {
  armSwitch: boolean;
  angleSwitch: boolean | null;
  turtleSwitch: boolean;
}

export type InputEvent = 'reset' | 'camera' | 'menu' | 'mode' | 'help' | 'gamepads';

/** Return true to swallow the key (replay transport, track editor…). */
export type KeyHook = (key: string, e: KeyboardEvent) => boolean;

export class InputManager {
  config: Config;
  readonly keys = new Set<string>();
  readonly kb: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  readonly state: InputState = { throttle: 0, yaw: 0, pitch: 0, roll: 0, armSwitch: false, angleSwitch: null, turtleSwitch: false };
  usingKeyboard = true;
  kbArm = false;
  kbTurtle = false;
  keyHook: KeyHook | null = null;

  private readonly toggles = new Map<string, boolean>();
  private prevButtons: boolean[] = [];
  private readonly listeners = new Map<InputEvent, Set<() => void>>();
  private readonly onKeyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.onKey(e, false);
  private readonly onPads = () => this.emit('gamepads');

  constructor(config: Config) {
    this.config = config;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', this.onPads);
    window.addEventListener('gamepaddisconnected', this.onPads);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepadconnected', this.onPads);
    window.removeEventListener('gamepaddisconnected', this.onPads);
  }

  on(evt: InputEvent, fn: () => void): () => void {
    let set = this.listeners.get(evt);
    if (!set) this.listeners.set(evt, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(evt: InputEvent): void {
    this.listeners.get(evt)?.forEach((fn) => fn());
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (down && this.keyHook?.(k, e)) {
      e.preventDefault();
      return;
    }
    if (down && !e.repeat) {
      if (k === 'r') this.emit('reset');
      if (k === 'c') this.emit('camera');
      if (k === 'escape' || k === 'tab') {
        e.preventDefault();
        this.emit('menu');
      }
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        this.kbArm = !this.kbArm;
      }
      if (k === 'm') this.emit('mode');
      if (k === 't') this.kbTurtle = !this.kbTurtle;
      if (k === 'h') this.emit('help');
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  }

  listGamepads(): Gamepad[] {
    return navigator.getGamepads ? navigator.getGamepads().filter((p): p is Gamepad => !!p) : [];
  }

  getGamepad(): Gamepad | null {
    const pads = this.listGamepads();
    return pads.find((p) => p.index === this.config.input.gamepadIndex) ?? pads[0] ?? null;
  }

  private readSwitch(pad: PadSnapshot, sw: SwitchConfig, key: string): boolean | null {
    if (sw.type === 'none') return null;
    if (sw.type === 'axis') {
      const v = pad.axes[sw.index];
      if (v === undefined) return null;
      return sw.invert ? v < sw.threshold : v > sw.threshold;
    }
    const b = pad.buttons[sw.index];
    if (!b) return null;
    if (sw.toggle) {
      if (b.pressed && !this.prevButtons[sw.index]) this.toggles.set(key, !this.toggles.get(key));
      return this.toggles.get(key) ?? false;
    }
    return sw.invert ? !b.pressed : b.pressed;
  }

  poll(dt: number, pad: PadSnapshot | null = this.getGamepad()): InputState {
    const s = this.state;
    const cfgIn = this.config.input;
    if (pad) {
      this.usingKeyboard = false;
      for (const name of CHANNELS) {
        const c = cfgIn.channels[name];
        s[name] = normaliseAxis(name, pad.axes[c.axis] ?? 0, c, cfgIn.deadband);
      }
      const arm = this.readSwitch(pad, cfgIn.arm, 'arm');
      s.armSwitch = arm ?? this.kbArm;
      s.angleSwitch = this.readSwitch(pad, cfgIn.mode, 'mode');
      s.turtleSwitch = this.readSwitch(pad, cfgIn.turtle, 'turtle') ?? this.kbTurtle;
      const rb = cfgIn.reset;
      if (rb.type === 'button' && rb.index >= 0 && pad.buttons[rb.index]?.pressed && !this.prevButtons[rb.index]) {
        this.emit('reset');
      }
      this.prevButtons = pad.buttons.map((b) => b.pressed);
    } else {
      this.usingKeyboard = true;
      this.keyboard(dt);
      Object.assign(s, this.kb);
      s.armSwitch = this.kbArm;
      s.angleSwitch = null;
      s.turtleSwitch = this.kbTurtle;
    }
    return s;
  }

  private keyboard(dt: number): void {
    const k = this.keys;
    const approach = (cur: number, target: number, rate: number) => cur + clamp(target - cur, -rate * dt, rate * dt);
    const axis = (neg: string, pos: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    // Throttle holds its value: W/S move it, X cuts it.
    this.kb.throttle = clamp(this.kb.throttle + axis('s', 'w') * dt * 0.8, 0, 1);
    if (k.has('x')) this.kb.throttle = 0;
    this.kb.yaw = approach(this.kb.yaw, axis('a', 'd') * 0.7, 6);
    this.kb.pitch = approach(this.kb.pitch, axis('arrowdown', 'arrowup') * 0.6, 5);
    this.kb.roll = approach(this.kb.roll, axis('arrowleft', 'arrowright') * 0.6, 5);
  }
}

// ── Calibration wizard ───────────────────────────────────────────────────────

export interface WizardStep {
  id: string;
  text: string;
  ch?: ChannelName;
  baseline?: boolean;
  range?: boolean;
  centers?: boolean;
  arm?: boolean;
}

export interface CalibrationResult {
  channels: Partial<Record<ChannelName, ChannelConfig>>;
  arm: SwitchConfig | null;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { id: 'baseline', text: 'Centre roll/pitch/yaw, throttle fully DOWN, arm switch OFF. Then press Next.', baseline: true },
  { id: 'throttle', text: 'Move THROTTLE fully UP and hold it. Press Next.', ch: 'throttle' },
  { id: 'center1', text: 'Throttle back DOWN, sticks centred. Press Next.', baseline: true },
  { id: 'yaw', text: 'Push YAW fully RIGHT and hold. Press Next.', ch: 'yaw' },
  { id: 'center2', text: 'Release to centre. Press Next.', baseline: true },
  { id: 'pitch', text: 'Push PITCH fully UP (forward) and hold. Press Next.', ch: 'pitch' },
  { id: 'center3', text: 'Release to centre. Press Next.', baseline: true },
  { id: 'roll', text: 'Push ROLL fully RIGHT and hold. Press Next.', ch: 'roll' },
  { id: 'range', text: 'Now stir BOTH sticks around their full range several times (corners!). Press Next.', range: true },
  { id: 'centers', text: 'Let the sticks return to centre (throttle DOWN). Press Next.', centers: true },
  { id: 'arm', text: 'Flip your ARM switch ON (or press the button you want to arm with). Press Next. (Skip to use Space key.)', arm: true },
];

export type WizardOutcome =
  | { kind: 'step'; step: WizardStep; index: number; warning?: string }
  | { kind: 'done'; result: CalibrationResult };

/**
 * Step-by-step calibration as a pure state machine over pad snapshots:
 * call `track(pad)` every frame and `next(pad)` when the user presses Next.
 */
export class CalibrationWizard {
  index = 0;
  private baseline: readonly number[] = [];
  private baseButtons: boolean[] = [];
  private min: number[] = [];
  private max: number[] = [];
  private found: Partial<Record<ChannelName, { axis: number; invert: boolean; center?: number }>> = {};
  private arm: SwitchConfig | null = null;

  get step(): WizardStep {
    return WIZARD_STEPS[this.index];
  }

  get total(): number {
    return WIZARD_STEPS.length;
  }

  /** Track axis extremes while on the "range" step. */
  track(pad: PadSnapshot | null): void {
    if (!pad || !this.step?.range) return;
    pad.axes.forEach((v, i) => {
      this.min[i] = Math.min(this.min[i] ?? v, v);
      this.max[i] = Math.max(this.max[i] ?? v, v);
    });
  }

  private used(axis: number): boolean {
    return Object.values(this.found).some((c) => c?.axis === axis);
  }

  next(pad: PadSnapshot | null, skip = false): WizardOutcome {
    const st = this.step;
    if (!pad) {
      return { kind: 'step', step: st, index: this.index, warning: 'No controller detected. Plug in your transmitter (USB joystick mode) and move a stick.' };
    }
    const axes = [...pad.axes];
    if (st.baseline) {
      this.baseline = axes;
      this.baseButtons = pad.buttons.map((b) => b.pressed);
    } else if (st.ch) {
      let best = -1;
      let bestD = 0;
      axes.forEach((v, i) => {
        const d = v - (this.baseline[i] ?? 0);
        if (!this.used(i) && Math.abs(d) > Math.abs(bestD)) {
          best = i;
          bestD = d;
        }
      });
      if (best < 0 || Math.abs(bestD) < 0.3) {
        return { kind: 'step', step: st, index: this.index, warning: 'No stick movement detected — try again.' };
      }
      this.found[st.ch] = { axis: best, invert: bestD < 0 };
    } else if (st.centers) {
      for (const name of ['yaw', 'pitch', 'roll'] as const) {
        const c = this.found[name];
        if (c) c.center = axes[c.axis];
      }
    } else if (st.arm && !skip) {
      let found: SwitchConfig | null = null;
      axes.forEach((v, i) => {
        const d = v - (this.baseline[i] ?? 0);
        if (!found && !this.used(i) && Math.abs(d) > 0.4) {
          found = { type: 'axis', index: i, threshold: ((this.baseline[i] ?? 0) + v) / 2, invert: d < 0, toggle: false };
        }
      });
      pad.buttons.forEach((b, i) => {
        if (!found && b.pressed !== this.baseButtons[i]) {
          found = { type: 'button', index: i, threshold: 0.5, invert: !b.pressed, toggle: false };
        }
      });
      this.arm = found;
    }

    this.index++;
    if (this.index >= WIZARD_STEPS.length) return { kind: 'done', result: this.result() };
    if (this.step.range) {
      this.min = [];
      this.max = [];
    }
    return { kind: 'step', step: this.step, index: this.index };
  }

  private result(): CalibrationResult {
    const channels: CalibrationResult['channels'] = {};
    for (const name of CHANNELS) {
      const r = this.found[name];
      if (!r) continue;
      const min = this.min[r.axis] ?? -1;
      const max = this.max[r.axis] ?? 1;
      channels[name] = {
        axis: r.axis,
        invert: r.invert,
        min,
        max,
        center: name === 'throttle' ? (min + max) / 2 : (r.center ?? (min + max) / 2),
      };
    }
    return { channels, arm: this.arm };
  }
}
