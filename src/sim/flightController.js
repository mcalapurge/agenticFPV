// Betaflight-style flight controller: RC smoothing → rates → PID(+FF) → airmode mixer.
// Pilot axes convention: positive roll = roll right, positive pitch = nose down (stick forward),
// positive yaw = yaw right. Gyro rates arrive in the same convention, in deg/s.

import { applyRate, throttleCurve } from './rates.js';
import { PT1, PT2 } from './filters.js';

// Betaflight scaling constants (pid.h) so P/I/D/FF numbers match real tunes.
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FEEDFORWARD_SCALE = 0.013754;
const PID_MIXER_SCALING = 1000;

const AXES = ['roll', 'pitch', 'yaw'];

// Quad-X motor layout, Betaflight numbering, "props in" default.
// x: + right, z: + rear (body frame). dir: +1 = CW (viewed from top), -1 = CCW.
export const MOTOR_LAYOUT = [
  { name: 'M1 RR', x: 1, z: 1, dir: 1 },
  { name: 'M2 FR', x: 1, z: -1, dir: -1 },
  { name: 'M3 RL', x: -1, z: 1, dir: -1 },
  { name: 'M4 FL', x: -1, z: -1, dir: 1 },
];
const MIX = MOTOR_LAYOUT.map((m) => ({
  roll: -m.x, // roll right → left motors up
  pitch: m.z, // nose down → rear motors up
  yaw: -m.dir, // yaw right → CCW motors up
}));

export class FlightController {
  constructor(config, dt = 0.001) {
    this.dt = dt;
    this.config = config;
    this.armed = false;
    this.rcSmooth = { throttle: new PT2(), roll: new PT2(), pitch: new PT2(), yaw: new PT2() };
    this.gyroLpf = AXES.map(() => new PT1());
    this.dtermLpf = AXES.map(() => new PT1());
    this.ffLpf = AXES.map(() => new PT1());
    this.relaxLpf = AXES.map(() => new PT1());
    this.iTerm = [0, 0, 0];
    this.prevGyro = [0, 0, 0];
    this.prevSetpoint = [0, 0, 0];
    this.setpoint = [0, 0, 0];
    this.gyro = [0, 0, 0];
    this.pidOut = [0, 0, 0];
    this.terms = AXES.map(() => ({ p: 0, i: 0, d: 0, f: 0 }));
    this.motors = [0, 0, 0, 0];
    this.throttle = 0;
    this.applyConfig(config);
  }

  applyConfig(config) {
    this.config = config;
    const f = config.filters;
    for (const k in this.rcSmooth) this.rcSmooth[k].setCutoff(f.rcSmoothingHz, this.dt);
    this.gyroLpf.forEach((p) => p.setCutoff(f.gyroLpfHz, this.dt));
    this.dtermLpf.forEach((p) => p.setCutoff(f.dtermLpfHz, this.dt));
    this.ffLpf.forEach((p) => p.setCutoff(f.rcSmoothingHz, this.dt));
    this.relaxLpf.forEach((p) => p.setCutoff(15, this.dt));
  }

  reset() {
    this.iTerm.fill(0);
    this.prevGyro.fill(0);
    this.prevSetpoint.fill(0);
    this.motors.fill(0);
    for (const k in this.rcSmooth) this.rcSmooth[k].reset(0);
    this.gyroLpf.forEach((p) => p.reset());
    this.dtermLpf.forEach((p) => p.reset());
    this.ffLpf.forEach((p) => p.reset());
    this.relaxLpf.forEach((p) => p.reset());
  }

  /**
   * Run one PID loop.
   * @param {{throttle:number, roll:number, pitch:number, yaw:number}} rc  raw sticks (throttle 0..1, others -1..1)
   * @param {number[]} gyroRaw  [roll, pitch, yaw] deg/s (pilot convention)
   * @param {{roll:number,pitch:number}} attitude  current angles in deg (for angle mode)
   * @returns {number[]} motor commands 0..1
   */
  update(rc, gyroRaw, attitude) {
    const cfg = this.config;
    const dt = this.dt;
    const pid = cfg.pid;
    const rates = cfg.rates;

    // RC smoothing (sticks arrive at frame rate; the PID loop runs at 1 kHz).
    const thrRaw = this.rcSmooth.throttle.apply(rc.throttle);
    const sticks = {
      roll: this.rcSmooth.roll.apply(rc.roll),
      pitch: this.rcSmooth.pitch.apply(rc.pitch),
      yaw: this.rcSmooth.yaw.apply(rc.yaw),
    };
    const throttle = throttleCurve(thrRaw, rates.throttleMid, rates.throttleExpo) * rates.throttleLimit;
    this.throttle = throttle;

    // Setpoints.
    for (let a = 0; a < 3; a++) {
      const axis = AXES[a];
      let sp = applyRate(rates.type, sticks[axis], rates[axis]);
      if (cfg.flight.mode === 'angle' && a < 2) {
        const target = sticks[axis] * pid.angleLimit;
        const current = a === 0 ? attitude.roll : attitude.pitch;
        sp = Math.max(-800, Math.min(800, (target - current) * (pid.angleStrength / 10)));
      }
      this.setpoint[a] = sp;
    }

    // TPA (attenuates P and D at high throttle).
    let tpa = 1;
    if (throttle > pid.tpaBreakpoint) {
      tpa = 1 - (pid.tpaRate * (throttle - pid.tpaBreakpoint)) / Math.max(1e-3, 1 - pid.tpaBreakpoint);
    }

    const lowThrottleNoAirmode = !pid.airmode && throttle < 0.02;

    for (let a = 0; a < 3; a++) {
      const g = AXES[a];
      const gains = pid[g];
      const gyro = this.gyroLpf[a].apply(gyroRaw[a]);
      this.gyro[a] = gyro;
      const sp = this.setpoint[a];
      const err = sp - gyro;

      const p = gains.p * PTERM_SCALE * err * tpa;

      // I-term relax: suppress I accumulation while the setpoint is moving fast.
      const spHpf = Math.abs(sp - this.relaxLpf[a].apply(sp));
      const relax = pid.itermRelax ? Math.max(0, 1 - spHpf / pid.itermRelaxCutoff) : 1;
      if (this.armed && !lowThrottleNoAirmode) {
        this.iTerm[a] += gains.i * ITERM_SCALE * err * relax * dt;
        this.iTerm[a] = Math.max(-pid.iTermLimit, Math.min(pid.iTermLimit, this.iTerm[a]));
      } else {
        this.iTerm[a] = 0;
      }

      // D on measurement.
      const dRaw = (-(gyro - this.prevGyro[a]) / dt) * gains.d * DTERM_SCALE;
      this.prevGyro[a] = gyro;
      const d = this.dtermLpf[a].apply(dRaw) * tpa;

      const spDelta = (sp - this.prevSetpoint[a]) / dt;
      this.prevSetpoint[a] = sp;
      const f = this.ffLpf[a].apply(spDelta * (gains.f / 100) * FEEDFORWARD_SCALE);

      const limit = a === 2 ? pid.pidSumLimitYaw : pid.pidSumLimit;
      const sum = Math.max(-limit, Math.min(limit, p + this.iTerm[a] + d + f));
      this.pidOut[a] = sum / PID_MIXER_SCALING;
      const t = this.terms[a];
      t.p = p; t.i = this.iTerm[a]; t.d = d; t.f = f;
    }

    if (!this.armed) {
      this.motors.fill(0);
      return this.motors;
    }

    // Mixer.
    const [r, pch, y] = lowThrottleNoAirmode ? [0, 0, 0] : this.pidOut;
    let mixMin = Infinity;
    let mixMax = -Infinity;
    const mix = this._mix || (this._mix = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const m = MIX[i];
      mix[i] = r * m.roll + pch * m.pitch + y * m.yaw;
      if (mix[i] < mixMin) mixMin = mix[i];
      if (mix[i] > mixMax) mixMax = mix[i];
    }
    const range = mixMax - mixMin;
    let thr = throttle;
    if (range > 1) {
      for (let i = 0; i < 4; i++) mix[i] /= range;
      mixMin /= range;
      mixMax /= range;
      if (pid.airmode) thr = 0.5;
    }
    if (pid.airmode) thr = Math.min(1 - mixMax, Math.max(-mixMin, thr));

    const idle = cfg.flight.motorIdle;
    for (let i = 0; i < 4; i++) {
      const out = Math.max(0, Math.min(1, thr + mix[i]));
      this.motors[i] = idle + (1 - idle) * out;
    }
    return this.motors;
  }
}
