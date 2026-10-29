// Betaflight-style flight controller: RC smoothing → rates → PID(+FF) → airmode mixer.
// Pilot axes convention: positive roll = roll right, positive pitch = nose down (stick forward),
// positive yaw = yaw right. Gyro rates arrive in the same convention, in deg/s.

import type { Axis, Config } from '../../state/configSchema';
import { applyRate, throttleCurve } from './rates';
import { PT1, PT2 } from './filters';

// Betaflight scaling constants (pid.h) so P/I/D/FF numbers match real tunes.
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FEEDFORWARD_SCALE = 0.013754;
const PID_MIXER_SCALING = 1000;

const AXES: readonly Axis[] = ['roll', 'pitch', 'yaw'];

export interface Sticks {
  throttle: number; // 0..1
  roll: number; // -1..1
  pitch: number;
  yaw: number;
}

export interface Attitude {
  roll: number; // deg
  pitch: number;
}

export interface MotorDef {
  name: string;
  x: number;
  z: number;
  dir: 1 | -1;
}

// Quad-X motor layout, Betaflight numbering, "props in" default.
// x: + right, z: + rear (body frame). dir: +1 = CW (viewed from top), -1 = CCW.
export const MOTOR_LAYOUT: readonly MotorDef[] = [
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

export interface PidTerms {
  p: number;
  i: number;
  d: number;
  f: number;
}

export class FlightController {
  readonly dt: number;
  config: Config;
  armed = false;
  turtle = false;
  airmodeActive = false;
  throttle = 0;
  readonly setpoint = [0, 0, 0];
  readonly gyro = [0, 0, 0];
  readonly pidOut = [0, 0, 0];
  readonly terms: PidTerms[] = AXES.map(() => ({ p: 0, i: 0, d: 0, f: 0 }));
  readonly motors = [0, 0, 0, 0];

  private readonly rcSmooth = { throttle: new PT2(), roll: new PT2(), pitch: new PT2(), yaw: new PT2() };
  private readonly gyroLpf = AXES.map(() => new PT1());
  private readonly dtermLpf = AXES.map(() => new PT1());
  private readonly ffLpf = AXES.map(() => new PT1());
  private readonly relaxLpf = AXES.map(() => new PT1());
  private readonly iTerm = [0, 0, 0];
  private readonly prevGyro = [0, 0, 0];
  private readonly prevSetpoint = [0, 0, 0];
  private readonly mix = [0, 0, 0, 0];

  constructor(config: Config, dt = 0.001) {
    this.dt = dt;
    this.config = config;
    this.applyConfig(config);
  }

  applyConfig(config: Config): void {
    this.config = config;
    const f = config.filters;
    for (const s of Object.values(this.rcSmooth)) s.setCutoff(f.rcSmoothingHz, this.dt);
    this.gyroLpf.forEach((p) => p.setCutoff(f.gyroLpfHz, this.dt));
    this.dtermLpf.forEach((p) => p.setCutoff(f.dtermLpfHz, this.dt));
    this.ffLpf.forEach((p) => p.setCutoff(f.rcSmoothingHz, this.dt));
    this.relaxLpf.forEach((p) => p.setCutoff(15, this.dt));
  }

  reset(): void {
    this.iTerm.fill(0);
    this.prevGyro.fill(0);
    this.prevSetpoint.fill(0);
    this.motors.fill(0);
    this.airmodeActive = false;
    for (const s of Object.values(this.rcSmooth)) s.reset(0);
    for (const list of [this.gyroLpf, this.dtermLpf, this.ffLpf, this.relaxLpf]) list.forEach((p) => p.reset());
  }

  /**
   * Run one PID loop.
   * @param rc raw sticks (throttle 0..1, others -1..1)
   * @param gyroRaw [roll, pitch, yaw] deg/s (pilot convention)
   * @param attitude current angles in deg (for angle mode)
   * @returns motor commands 0..1 (negative = reversed, turtle mode)
   */
  update(rc: Sticks, gyroRaw: readonly number[], attitude: Attitude): number[] {
    const cfg = this.config;
    const dt = this.dt;
    const pid = cfg.pid;
    const rates = cfg.rates;

    // RC smoothing (sticks arrive at frame rate; the PID loop runs at 1 kHz).
    const thrRaw = this.rcSmooth.throttle.apply(rc.throttle);
    const sticks: Record<Axis, number> = {
      roll: this.rcSmooth.roll.apply(rc.roll),
      pitch: this.rcSmooth.pitch.apply(rc.pitch),
      yaw: this.rcSmooth.yaw.apply(rc.yaw),
    };
    const throttle = throttleCurve(thrRaw, rates.throttleMid, rates.throttleExpo) * rates.throttleLimit;
    this.throttle = throttle;

    // Turtle mode (Betaflight "crash flip"): PIDs off, sticks spin the motors on one side
    // in reverse to flip an upside-down quad back over.
    if (this.armed && this.turtle) {
      this.iTerm.fill(0);
      this.pidOut.fill(0);
      this.setpoint.fill(0);
      const mag = Math.hypot(sticks.roll, sticks.pitch, sticks.yaw);
      MOTOR_LAYOUT.forEach((m, i) => {
        // Reversed thrust on a motor pushes its side "down" in body frame:
        // roll right → right motors, pitch forward → front motors, yaw → same-spin pair.
        const amt = sticks.roll * m.x - sticks.pitch * m.z + sticks.yaw * m.dir;
        this.motors[i] = -(mag < 0.15 ? 0 : Math.max(0, Math.min(1, amt))) * cfg.physics.turtlePower;
      });
      return this.motors;
    }

    // Setpoints.
    AXES.forEach((axis, a) => {
      let sp = applyRate(rates.type, sticks[axis], rates[axis]);
      if (cfg.flight.mode === 'angle' && a < 2) {
        const target = sticks[axis] * pid.angleLimit;
        const current = a === 0 ? attitude.roll : attitude.pitch;
        sp = Math.max(-800, Math.min(800, (target - current) * (pid.angleStrength / 10)));
      }
      this.setpoint[a] = sp;
    });

    // TPA (attenuates P and D at high throttle).
    let tpa = 1;
    if (throttle > pid.tpaBreakpoint) {
      tpa = 1 - (pid.tpaRate * (throttle - pid.tpaBreakpoint)) / Math.max(1e-3, 1 - pid.tpaBreakpoint);
    }

    // Betaflight only activates airmode once throttle has been raised (prevents I-term
    // windup and motor spool-up while sitting on the ground after arming).
    if (!this.armed) this.airmodeActive = false;
    else if (throttle > 0.25) this.airmodeActive = true;
    const airmode = pid.airmode && this.airmodeActive;
    const lowThrottleNoAirmode = !airmode && throttle < 0.02;

    for (let a = 0; a < 3; a++) {
      const gains = pid[AXES[a]];
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
      t.p = p;
      t.i = this.iTerm[a];
      t.d = d;
      t.f = f;
    }

    if (!this.armed) {
      this.motors.fill(0);
      return this.motors;
    }

    // Mixer.
    const [r, pch, y] = lowThrottleNoAirmode ? [0, 0, 0] : this.pidOut;
    let mixMin = Infinity;
    let mixMax = -Infinity;
    const mix = this.mix;
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
      if (airmode) thr = 0.5;
    }
    if (airmode) thr = Math.min(1 - mixMax, Math.max(-mixMin, thr));

    const idle = cfg.flight.motorIdle;
    for (let i = 0; i < 4; i++) {
      const out = Math.max(0, Math.min(1, thr + mix[i]));
      this.motors[i] = idle + (1 - idle) * out;
    }
    return this.motors;
  }
}
