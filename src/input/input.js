// Gamepad / USB RC-transmitter input with calibration, plus a keyboard fallback.

export const CHANNELS = ['throttle', 'yaw', 'pitch', 'roll'];

export const INPUT_PRESETS = {
  'RC transmitter (EdgeTX / OpenTX USB joystick)': {
    channels: {
      roll: { axis: 0, invert: false, min: -1, center: 0, max: 1 },
      pitch: { axis: 1, invert: false, min: -1, center: 0, max: 1 },
      throttle: { axis: 2, invert: false, min: -1, center: 0, max: 1 },
      yaw: { axis: 3, invert: false, min: -1, center: 0, max: 1 },
    },
    arm: { type: 'axis', index: 4, threshold: 0.3, invert: false },
  },
  'Gamepad (Mode 2, Xbox/PS layout)': {
    channels: {
      yaw: { axis: 0, invert: false, min: -1, center: 0, max: 1 },
      throttle: { axis: 1, invert: true, min: -1, center: 0, max: 1 },
      roll: { axis: 2, invert: false, min: -1, center: 0, max: 1 },
      pitch: { axis: 3, invert: true, min: -1, center: 0, max: 1 },
    },
    arm: { type: 'button', index: 9, threshold: 0.5, invert: false, toggle: true },
  },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class InputManager {
  constructor(config) {
    this.config = config;
    this.keys = new Set();
    this.kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.usingKeyboard = true;
    this.state = { throttle: 0, yaw: 0, pitch: 0, roll: 0, armSwitch: false, angleSwitch: null };
    this._kbArm = false;
    this._btnToggleArm = false;
    this._prevButtons = [];
    this.listeners = {}; // edge-triggered actions: reset, camera, menu, arm toggle
    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('gamepadconnected', () => this.onChange?.());
    window.addEventListener('gamepaddisconnected', () => this.onChange?.());
  }

  on(evt, fn) {
    this.listeners[evt] = fn;
  }

  _emit(evt) {
    this.listeners[evt]?.();
  }

  _onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    if (down && !e.repeat) {
      if (k === 'r') this._emit('reset');
      if (k === 'c') this._emit('camera');
      if (k === 'escape' || k === 'tab') {
        e.preventDefault();
        this._emit('menu');
      }
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        this._kbArm = !this._kbArm;
      }
      if (k === 'm') this._emit('mode');
      if (k === 'h') this._emit('help');
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  }

  getGamepad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) return null;
    return pads.find((p) => p.index === this.config.input.gamepadIndex) || pads[0];
  }

  listGamepads() {
    return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  }

  /** Normalise a raw axis value using calibration. Throttle → 0..1, others → -1..1. */
  normalise(name, raw) {
    const c = this.config.input.channels[name];
    let v;
    if (name === 'throttle') {
      v = (raw - c.min) / Math.max(1e-6, c.max - c.min);
      if (c.invert) v = 1 - v;
      return clamp(v, 0, 1);
    }
    if (raw >= c.center) v = (raw - c.center) / Math.max(1e-6, c.max - c.center);
    else v = (raw - c.center) / Math.max(1e-6, c.center - c.min);
    if (c.invert) v = -v;
    const db = this.config.input.deadband;
    if (Math.abs(v) < db) v = 0;
    else v = Math.sign(v) * ((Math.abs(v) - db) / (1 - db));
    return clamp(v, -1, 1);
  }

  _switch(pad, sw, key) {
    if (!pad || !sw || sw.type === 'none') return null;
    if (sw.type === 'axis') {
      const v = pad.axes[sw.index];
      if (v === undefined) return null;
      return sw.invert ? v < sw.threshold : v > sw.threshold;
    }
    if (sw.type === 'button') {
      const b = pad.buttons[sw.index];
      if (!b) return null;
      if (sw.toggle) {
        const prev = this._prevButtons[sw.index];
        if (b.pressed && !prev) this[key] = !this[key];
        return this[key];
      }
      return sw.invert ? !b.pressed : b.pressed;
    }
    return null;
  }

  poll(dt) {
    const pad = this.getGamepad();
    const s = this.state;
    const cfgIn = this.config.input;
    if (pad) {
      this.usingKeyboard = false;
      for (const ch of CHANNELS) {
        const c = cfgIn.channels[ch];
        const raw = pad.axes[c.axis] ?? 0;
        s[ch] = this.normalise(ch, raw);
      }
      const arm = this._switch(pad, cfgIn.arm, '_btnToggleArm');
      s.armSwitch = arm === null ? this._kbArm : arm;
      s.angleSwitch = this._switch(pad, cfgIn.mode, '_btnToggleMode');
      const rb = cfgIn.reset;
      if (rb?.type === 'button' && rb.index >= 0) {
        const b = pad.buttons[rb.index];
        if (b?.pressed && !this._prevButtons[rb.index]) this._emit('reset');
      }
      this._prevButtons = pad.buttons.map((b) => b.pressed);
    } else {
      this.usingKeyboard = true;
      this._keyboard(dt);
      Object.assign(s, this.kb);
      s.armSwitch = this._kbArm;
      s.angleSwitch = null;
    }
    return s;
  }

  _keyboard(dt) {
    const k = this.keys;
    const approach = (cur, target, rate) => cur + clamp(target - cur, -rate * dt, rate * dt);
    const axis = (neg, pos) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    // Throttle holds its value: W/S move it, X cuts it.
    this.kb.throttle = clamp(this.kb.throttle + axis('s', 'w') * dt * 0.8, 0, 1);
    if (k.has('x')) this.kb.throttle = 0;
    this.kb.yaw = approach(this.kb.yaw, axis('a', 'd') * 0.7, 6);
    this.kb.pitch = approach(this.kb.pitch, axis('arrowdown', 'arrowup') * 0.6, 5);
    this.kb.roll = approach(this.kb.roll, axis('arrowleft', 'arrowright') * 0.6, 5);
  }
}

/**
 * Step-by-step calibration wizard. Drives itself from `update()` with raw pad axes.
 */
export class CalibrationWizard {
  constructor(input, onStep, onDone) {
    this.input = input;
    this.onStep = onStep;
    this.onDone = onDone;
    this.result = { channels: {}, arm: null };
    this.steps = [
      { id: 'baseline', text: 'Centre roll/pitch/yaw, throttle fully DOWN, arm switch OFF. Then press Next.' },
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
    this.index = 0;
    this.min = [];
    this.max = [];
  }

  _pad() {
    return this.input.getGamepad();
  }

  start() {
    this.index = 0;
    this.onStep(this.steps[0], 0, this.steps.length);
  }

  /** Called every frame while the wizard is open (tracks ranges). */
  update() {
    const pad = this._pad();
    if (!pad) return;
    const st = this.steps[this.index];
    if (st?.range) {
      pad.axes.forEach((v, i) => {
        this.min[i] = Math.min(this.min[i] ?? v, v);
        this.max[i] = Math.max(this.max[i] ?? v, v);
      });
    }
  }

  next(skip = false) {
    const pad = this._pad();
    if (!pad) {
      this.onStep({ text: 'No controller detected. Plug in your transmitter (USB joystick mode) and move a stick.' }, this.index, this.steps.length);
      return;
    }
    const st = this.steps[this.index];
    const axes = [...pad.axes];
    if (st.id === 'baseline' || st.baseline) {
      this.baseline = axes;
      this.baseButtons = pad.buttons.map((b) => b.pressed);
    } else if (st.ch) {
      let best = -1, bestD = 0;
      axes.forEach((v, i) => {
        const used = Object.values(this.result.channels).some((c) => c.axis === i);
        const d = v - (this.baseline?.[i] ?? 0);
        if (!used && Math.abs(d) > Math.abs(bestD)) { best = i; bestD = d; }
      });
      if (best < 0 || Math.abs(bestD) < 0.3) {
        this.onStep({ ...st, text: `${st.text}  ⚠ No stick movement detected — try again.` }, this.index, this.steps.length);
        return;
      }
      this.result.channels[st.ch] = { axis: best, invert: bestD < 0 };
    } else if (st.centers) {
      for (const ch of ['yaw', 'pitch', 'roll']) {
        const c = this.result.channels[ch];
        if (c) c.center = axes[c.axis];
      }
    } else if (st.arm && !skip) {
      let found = null;
      axes.forEach((v, i) => {
        const d = v - (this.baseline?.[i] ?? 0);
        const used = Object.values(this.result.channels).some((c) => c.axis === i);
        if (!used && Math.abs(d) > 0.4 && !found) found = { type: 'axis', index: i, threshold: ((this.baseline[i] ?? 0) + v) / 2, invert: d < 0 };
      });
      pad.buttons.forEach((b, i) => {
        if (!found && b.pressed !== this.baseButtons?.[i]) found = { type: 'button', index: i, threshold: 0.5, invert: !b.pressed, toggle: false };
      });
      this.result.arm = found;
    }

    this.index++;
    if (this.index >= this.steps.length) {
      this._finish();
      return;
    }
    if (this.steps[this.index].range) {
      this.min = [];
      this.max = [];
    }
    this.onStep(this.steps[this.index], this.index, this.steps.length);
  }

  _finish() {
    const cfg = this.input.config.input;
    for (const ch of CHANNELS) {
      const r = this.result.channels[ch];
      if (!r) continue;
      const min = this.min[r.axis] ?? -1;
      const max = this.max[r.axis] ?? 1;
      cfg.channels[ch] = {
        axis: r.axis,
        invert: r.invert,
        min,
        max,
        center: ch === 'throttle' ? (min + max) / 2 : r.center ?? (min + max) / 2,
      };
    }
    if (this.result.arm) cfg.arm = this.result.arm;
    this.onDone();
  }
}
