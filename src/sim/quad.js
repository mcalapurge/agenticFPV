// Rigid-body quadcopter model.
// World frame: Three.js (Y up). Body frame: +X right, +Y up (thrust), -Z forward.

import { Vector3, Quaternion, Euler } from 'three';
import { MOTOR_LAYOUT } from './flightController.js';

const RAD2DEG = 180 / Math.PI;

export class Quad {
  constructor(config) {
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.omega = new Vector3(); // body rates rad/s
    this.motorSpeed = [0, 0, 0, 0]; // normalised rpm 0..1
    this.motorThrust = [0, 0, 0, 0]; // N
    this.gyro = [0, 0, 0]; // pilot-convention deg/s (roll, pitch, yaw), with noise
    this.attitude = { roll: 0, pitch: 0 };
    this.battery = { soc: 1, voltage: 0, current: 0, usedMah: 0 };
    this.propwashLevel = 0;
    this.lastImpact = 0;
    this.radius = 0.11;
    this._pw = [0, 0, 0];
    // scratch
    this._f = new Vector3();
    this._t = new Vector3();
    this._vb = new Vector3();
    this._qi = new Quaternion();
    this._tmp = new Vector3();
    this._dq = new Quaternion();
    this.applyConfig(config);
  }

  applyConfig(config) {
    const p = config.physics;
    this.cfg = p;
    this.mass = p.massG / 1000;
    this.maxThrust = (p.motorThrustG / 1000) * p.gravity;
    this.arm = p.armLengthMm / 1000 / Math.SQRT2; // per-axis offset
    this.inertia = new Vector3(p.inertiaPitch, p.inertiaYaw, p.inertiaRoll); // about body x, y, z
    this.maxRotorOmega = (p.maxRpm * 2 * Math.PI) / 60;
    this.motors = MOTOR_LAYOUT.map((m) => ({ x: m.x * this.arm, z: m.z * this.arm, dir: m.dir }));
    if (this.battery.voltage === 0) this.battery.voltage = p.cells * 4.2;
  }

  reset(position, yawRad = 0) {
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.quat.setFromEuler(new Euler(0, yawRad, 0));
    this.motorSpeed.fill(0);
    this.motorThrust.fill(0);
    this.battery.soc = 1;
    this.battery.usedMah = 0;
    this.battery.current = 0;
    this.battery.voltage = this.cfg.cells * 4.2;
    this._pw.fill(0);
    this.lastImpact = 0;
  }

  _batteryStep(dt) {
    const p = this.cfg;
    const b = this.battery;
    if (!p.battery) {
      b.voltage = p.cells * 4.0;
      b.current = 0;
      return 1;
    }
    let load = 0;
    for (const s of this.motorSpeed) load += s * s * s;
    b.current = (p.maxCurrentA * load) / 4 + 0.5;
    b.usedMah += (b.current * dt * 1000) / 3600;
    b.soc = Math.max(0, 1 - b.usedMah / p.capacityMah);
    const ocv = 3.0 + 1.2 * Math.pow(b.soc, 0.6);
    b.voltage = Math.max(p.cells * 2.8, p.cells * (ocv - b.current * p.internalResistance));
    // rpm ∝ voltage; referenced to 4.0 V/cell under load.
    return Math.min(1.08, b.voltage / (p.cells * 4.0));
  }

  /**
   * Advance the simulation.
   * @param {number} dt seconds
   * @param {number[]} cmds motor commands 0..1
   * @param {(quad: Quad) => void} [collide] optional collision resolver
   */
  step(dt, cmds, collide) {
    const p = this.cfg;
    const vFactor = this._batteryStep(dt);

    // Body-frame velocity.
    const qi = this._qi.copy(this.quat).invert();
    const vb = this._vb.copy(this.vel).applyQuaternion(qi);

    const force = this._f.set(0, 0, 0);
    const torque = this._t.set(0, 0, 0);
    const w = this.omega;

    // Motors & props.
    let totalThrust = 0;
    for (let i = 0; i < 4; i++) {
      const m = this.motors[i];
      const target = Math.max(0, cmds[i]) * vFactor;
      const tau = (target > this.motorSpeed[i] ? p.motorSpinUpMs : p.motorSpinDownMs) / 1000;
      const ds = (target - this.motorSpeed[i]) * (1 - Math.exp(-dt / tau));
      this.motorSpeed[i] += ds;
      const s = this.motorSpeed[i];
      // Reaction torque from accelerating the rotor (gives yaw its "snap").
      torque.y += m.dir * p.rotorInertia * this.maxRotorOmega * (ds / dt);

      // Axial inflow at this rotor including rotation (v + ω × r), r = (x, 0, z).
      const inflow = vb.y + (w.z * m.x - w.x * m.z);
      const pitchSpeed = p.propPitchSpeed * Math.max(s, 0.05);
      let eff = 1 - (inflow / pitchSpeed) * p.inflowGain;
      eff = Math.min(1.2, Math.max(0, eff));

      const thrust = this.maxThrust * s * s * eff;
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
    const thrustRatio = totalThrust / (4 * this.maxThrust);
    const pwTarget = descend > 1.5 ? Math.min(1, (descend - 1.5) / 6) * Math.min(1, thrustRatio * 4) : 0;
    this.propwashLevel += (pwTarget - this.propwashLevel) * Math.min(1, dt * 20);
    if (this.propwashLevel > 0.01 && p.propwash > 0) {
      const amp = this.propwashLevel * p.propwash * 0.06;
      for (let k = 0; k < 3; k++) this._pw[k] += ((Math.random() * 2 - 1) - this._pw[k]) * Math.min(1, dt * 90);
      torque.x += this._pw[0] * amp;
      torque.y += this._pw[1] * amp * 0.3;
      torque.z += this._pw[2] * amp;
      force.y -= totalThrust * this.propwashLevel * p.propwash * 0.12 * (0.5 + Math.random() * 0.5);
    }

    // Aerodynamic drag (quadratic, per body axis) + rotor H-force drag.
    const speed = vb.length();
    const q = 0.5 * p.airDensity * speed;
    force.x -= q * p.dragSide * vb.x;
    force.y -= q * p.dragTop * vb.y;
    force.z -= q * p.dragFront * vb.z;
    const hDrag = p.rotorDrag * (0.3 + thrustRatio * 2);
    force.x -= hDrag * vb.x;
    force.z -= hDrag * vb.z;

    // Angular drag.
    const wl = w.length();
    torque.x -= p.angularDrag * w.x * (1 + wl * 0.05);
    torque.y -= p.angularDrag * w.y * (1 + wl * 0.05);
    torque.z -= p.angularDrag * w.z * (1 + wl * 0.05);

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
      const ax = this._tmp.copy(w).normalize();
      this._dq.setFromAxisAngle(ax, ang);
      this.quat.multiply(this._dq).normalize();
    }

    if (collide) collide(this);

    this._updateSensors();
  }

  _updateSensors() {
    const w = this.omega;
    let avg = 0;
    for (const s of this.motorSpeed) avg += s;
    avg /= 4;
    const n = (this.noiseScale ?? 1) * avg * 6;
    // Pilot convention: roll = -ωz, pitch = -ωx, yaw = -ωy.
    this.gyro[0] = -w.z * RAD2DEG + (Math.random() * 2 - 1) * n;
    this.gyro[1] = -w.x * RAD2DEG + (Math.random() * 2 - 1) * n;
    this.gyro[2] = -w.y * RAD2DEG + (Math.random() * 2 - 1) * n * 0.5;

    // Attitude for angle mode / OSD.
    const up = this._tmp.set(0, 1, 0).applyQuaternion(this.quat);
    const upY = up.y;
    const right = this._tmp.set(1, 0, 0).applyQuaternion(this.quat);
    const rightY = right.y;
    const fwd = this._tmp.set(0, 0, -1).applyQuaternion(this.quat);
    const fwdY = fwd.y;
    this.attitude.roll = Math.atan2(-rightY, upY) * RAD2DEG;
    this.attitude.pitch = Math.atan2(-fwdY, upY) * RAD2DEG;
  }

  get speedKmh() {
    return this.vel.length() * 3.6;
  }
}
