// Rigid-body quadcopter model.
// World frame: Three.js (Y up). Body frame: +X right, +Y up (thrust), -Z forward.

import { Euler, Quaternion, Vector3 } from 'three';
import type { Config, PhysicsConfig } from '../../state/configSchema';
import { MOTOR_LAYOUT, type Attitude } from './flightController';

const RAD2DEG = 180 / Math.PI;

/** What renderers, audio and effects need from a quad (the live sim or a replay proxy). */
export interface QuadView {
  readonly pos: Vector3;
  readonly quat: Quaternion;
  readonly vel: Vector3;
  readonly motorSpeed: number[];
  readonly propwashLevel: number;
  readonly speedKmh: number;
}

export interface ContactPoint {
  p: Vector3; // body frame
  r: number;
}

export interface BatteryState {
  soc: number;
  voltage: number;
  current: number;
  usedMah: number;
}

interface MotorPos {
  x: number;
  z: number;
  dir: number;
}

export type CollisionResolver = (quad: Quad) => void;

export class Quad implements QuadView {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  readonly omega = new Vector3(); // body rates rad/s
  readonly motorSpeed = [0, 0, 0, 0]; // normalised rpm -1..1
  readonly motorThrust = [0, 0, 0, 0]; // N
  readonly gyro = [0, 0, 0]; // pilot-convention deg/s (roll, pitch, yaw), with noise
  readonly attitude: Attitude = { roll: 0, pitch: 0 };
  readonly battery: BatteryState = { soc: 1, voltage: 0, current: 0, usedMah: 0 };
  readonly wind = new Vector3(); // current wind (world, m/s)
  propwashLevel = 0;
  lastImpact = 0;
  noiseScale = 1;

  // Derived from config in applyConfig().
  cfg!: PhysicsConfig;
  mass = 1;
  maxThrust = 1;
  arm = 0.08; // per-axis motor offset (m)
  inertia = new Vector3(1, 1, 1); // about body x, y, z
  radius = 0.11; // broadphase radius
  contactPoints: ContactPoint[] = [];
  private maxRotorOmega = 1;
  private motors: MotorPos[] = [];
  private windBase = new Vector3();

  private readonly gust = new Vector3();
  private readonly pw = [0, 0, 0];
  private readonly _f = new Vector3();
  private readonly _t = new Vector3();
  private readonly _vb = new Vector3();
  private readonly _qi = new Quaternion();
  private readonly _tmp = new Vector3();
  private readonly _dq = new Quaternion();

  constructor(config: Config) {
    this.applyConfig(config);
  }

  applyConfig(config: Config): void {
    const p = config.physics;
    this.cfg = p;
    this.noiseScale = config.filters.gyroNoise;
    this.mass = p.massG / 1000;
    this.maxThrust = (p.motorThrustG / 1000) * p.gravity;
    this.arm = p.armLengthMm / 1000 / Math.SQRT2;
    this.inertia = new Vector3(p.inertiaPitch, p.inertiaYaw, p.inertiaRoll);
    this.maxRotorOmega = (p.maxRpm * 2 * Math.PI) / 60;
    this.motors = MOTOR_LAYOUT.map((m) => ({ x: m.x * this.arm, z: m.z * this.arm, dir: m.dir }));
    // Collision hull: one sphere per prop, the body and the battery on top.
    const propR = (p.propInches * 0.0254) / 2;
    const bodyR = Math.max(0.02, this.arm * 0.45);
    this.contactPoints = [
      ...this.motors.map((m) => ({ p: new Vector3(m.x, 0.01, m.z), r: propR * 0.92 })),
      { p: new Vector3(0, 0.012, 0), r: bodyR },
      { p: new Vector3(0, bodyR * 1.25, 0), r: bodyR * 0.75 },
    ];
    this.radius = Math.hypot(this.arm, this.arm) + propR;
    // windDir = compass bearing the wind blows FROM (0 = north = -Z).
    const wd = (p.windDir * Math.PI) / 180;
    this.windBase = new Vector3(Math.sin(wd), 0, Math.cos(wd)).multiplyScalar(p.windSpeed);
    if (this.battery.voltage === 0) this.battery.voltage = p.cells * 4.2;
  }

  reset(position: Vector3, yawRad = 0): void {
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.quat.setFromEuler(new Euler(0, yawRad, 0));
    this.motorSpeed.fill(0);
    this.motorThrust.fill(0);
    Object.assign(this.battery, { soc: 1, usedMah: 0, current: 0, voltage: this.cfg.cells * 4.2 });
    this.pw.fill(0);
    this.gust.set(0, 0, 0);
    this.lastImpact = 0;
  }

  private batteryStep(dt: number): number {
    const p = this.cfg;
    const b = this.battery;
    if (!p.battery) {
      b.voltage = p.cells * 4.0;
      b.current = 0;
      return 1;
    }
    let load = 0;
    for (const s of this.motorSpeed) load += Math.abs(s * s * s);
    b.current = (p.maxCurrentA * load) / 4 + 0.5;
    b.usedMah += (b.current * dt * 1000) / 3600;
    b.soc = Math.max(0, 1 - b.usedMah / p.capacityMah);
    const ocv = 3.0 + 1.2 * Math.pow(b.soc, 0.6);
    b.voltage = Math.max(p.cells * 2.8, p.cells * (ocv - b.current * p.internalResistance));
    // rpm ∝ voltage; referenced to 4.0 V/cell under load.
    return Math.min(1.08, b.voltage / (p.cells * 4.0));
  }

  /**
   * Advance the simulation by `dt` seconds.
   * @param cmds motor commands -1..1 (negative = reversed, turtle mode)
   * @param collide optional collision resolver
   */
  step(dt: number, cmds: readonly number[], collide?: CollisionResolver): void {
    const p = this.cfg;
    const vFactor = this.batteryStep(dt);

    // Wind with time-correlated gusts (more turbulent with altitude).
    if (p.windSpeed > 0 || p.windGust > 0) {
      const g = this.gust;
      // Ornstein–Uhlenbeck process: stationary std = amp, correlation time ≈ 0.7 s.
      const k = Math.min(1, dt * 1.5);
      const amp = (p.windSpeed * 0.6 + 1.5) * p.windGust * Math.min(1, 0.4 + this.pos.y / 15);
      const n = amp * Math.sqrt(2 * k) * 1.732;
      g.x += -g.x * k + (Math.random() * 2 - 1) * n;
      g.y += -g.y * k + (Math.random() * 2 - 1) * n * 0.3;
      g.z += -g.z * k + (Math.random() * 2 - 1) * n;
      this.wind.copy(this.windBase).add(g);
    } else {
      this.wind.set(0, 0, 0);
    }

    // Body-frame airspeed.
    const qi = this._qi.copy(this.quat).invert();
    const vb = this._vb.copy(this.vel).sub(this.wind).applyQuaternion(qi);

    const force = this._f.set(0, 0, 0);
    const torque = this._t.set(0, 0, 0);
    const w = this.omega;

    // Motors & props.
    let totalThrust = 0;
    for (let i = 0; i < 4; i++) {
      const m = this.motors[i];
      const target = Math.max(-1, Math.min(1, cmds[i])) * vFactor;
      const speedingUp =
        Math.abs(target) > Math.abs(this.motorSpeed[i]) && Math.sign(target) === Math.sign(this.motorSpeed[i] || target);
      const tau = (speedingUp ? p.motorSpinUpMs : p.motorSpinDownMs) / 1000;
      const ds = (target - this.motorSpeed[i]) * (1 - Math.exp(-dt / tau));
      this.motorSpeed[i] += ds;
      const s = this.motorSpeed[i];
      // Reaction torque from accelerating the rotor (gives yaw its "snap").
      torque.y += m.dir * p.rotorInertia * this.maxRotorOmega * (ds / dt);

      // Axial inflow at this rotor including rotation (v + ω × r), r = (x, 0, z).
      const inflow = vb.y + (w.z * m.x - w.x * m.z);
      let thrust: number;
      if (s >= 0) {
        const pitchSpeed = p.propPitchSpeed * Math.max(s, 0.05);
        const eff = Math.min(1.2, Math.max(0, 1 - (inflow / pitchSpeed) * p.inflowGain));
        thrust = this.maxThrust * s * s * eff;
      } else {
        // Reversed prop (turtle mode / 3D): much less efficient.
        thrust = -this.maxThrust * s * s * p.reverseThrust;
      }
      this.motorThrust[i] = thrust;
      totalThrust += thrust;
      // r × F with F = (0, T, 0)
      torque.x += -m.z * thrust;
      torque.z += m.x * thrust;
      torque.y += m.dir * p.yawTorqueCoef * thrust;
    }
    force.y += totalThrust;

    // Prop-wash: descending through own wake → turbulent torque and lost thrust.
    const descend = -vb.y;
    const thrustRatio = Math.max(0, totalThrust) / (4 * this.maxThrust);
    const pwTarget = descend > 1.5 ? Math.min(1, (descend - 1.5) / 6) * Math.min(1, thrustRatio * 4) : 0;
    this.propwashLevel += (pwTarget - this.propwashLevel) * Math.min(1, dt * 20);
    if (this.propwashLevel > 0.01 && p.propwash > 0) {
      // Scaled by the airframe's roll authority so small quads get proportionate buffeting.
      const amp = this.propwashLevel * p.propwash * 0.053 * this.maxThrust * this.arm;
      for (let k = 0; k < 3; k++) this.pw[k] += (Math.random() * 2 - 1 - this.pw[k]) * Math.min(1, dt * 90);
      torque.x += this.pw[0] * amp;
      torque.y += this.pw[1] * amp * 0.3;
      torque.z += this.pw[2] * amp;
      force.y -= totalThrust * this.propwashLevel * p.propwash * 0.12 * (0.5 + Math.random() * 0.5);
    }

    // Aerodynamic drag (quadratic, per body axis) + rotor H-force drag.
    const q = 0.5 * p.airDensity * vb.length();
    force.x -= q * p.dragSide * vb.x;
    force.y -= q * p.dragTop * vb.y;
    force.z -= q * p.dragFront * vb.z;
    const hDrag = p.rotorDrag * (0.3 + thrustRatio * 2);
    force.x -= hDrag * vb.x;
    force.z -= hDrag * vb.z;

    // Angular drag.
    const wd = p.angularDrag * (1 + w.length() * 0.05);
    torque.x -= wd * w.x;
    torque.y -= wd * w.y;
    torque.z -= wd * w.z;

    // Linear integration (world frame).
    const fw = force.applyQuaternion(this.quat);
    fw.y -= this.mass * p.gravity;
    this.vel.addScaledVector(fw, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);

    // Euler's rotation equation: I ω̇ = τ − ω × (I ω).
    const I = this.inertia;
    const Iw = this._tmp.set(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyroX = w.y * Iw.z - w.z * Iw.y;
    const gyroY = w.z * Iw.x - w.x * Iw.z;
    const gyroZ = w.x * Iw.y - w.y * Iw.x;
    w.x += ((torque.x - gyroX) / I.x) * dt;
    w.y += ((torque.y - gyroY) / I.y) * dt;
    w.z += ((torque.z - gyroZ) / I.z) * dt;

    // Quaternion integration (body rates → right-multiply).
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      this._dq.setFromAxisAngle(this._tmp.copy(w).normalize(), ang);
      this.quat.multiply(this._dq).normalize();
    }

    collide?.(this);
    this.updateSensors();
  }

  private updateSensors(): void {
    const w = this.omega;
    let avg = 0;
    for (const s of this.motorSpeed) avg += s;
    const n = this.noiseScale * (avg / 4) * 6;
    // Pilot convention: roll = -ωz, pitch = -ωx, yaw = -ωy.
    this.gyro[0] = -w.z * RAD2DEG + (Math.random() * 2 - 1) * n;
    this.gyro[1] = -w.x * RAD2DEG + (Math.random() * 2 - 1) * n;
    this.gyro[2] = -w.y * RAD2DEG + (Math.random() * 2 - 1) * n * 0.5;

    // Attitude for angle mode / OSD.
    const upY = this._tmp.set(0, 1, 0).applyQuaternion(this.quat).y;
    const rightY = this._tmp.set(1, 0, 0).applyQuaternion(this.quat).y;
    const fwdY = this._tmp.set(0, 0, -1).applyQuaternion(this.quat).y;
    this.attitude.roll = Math.atan2(-rightY, upY) * RAD2DEG;
    this.attitude.pitch = Math.atan2(-fwdY, upY) * RAD2DEG;
  }

  get speedKmh(): number {
    return this.vel.length() * 3.6;
  }
}
