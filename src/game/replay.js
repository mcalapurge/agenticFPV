// DVR-style replay: ring buffer of the last N seconds (pose + motors), with scrubbing and speed control.

import * as THREE from 'three';

const STRIDE = 12; // t, px, py, pz, qx, qy, qz, qw, m0..m3

export class Replay {
  constructor(seconds = 90, rate = 60) {
    this.capacity = seconds * rate;
    this.rate = rate;
    this.buf = new Float32Array(this.capacity * STRIDE);
    this.count = 0;
    this.head = 0; // next write index
    this.lastT = -Infinity;
    this.active = false;
    this.playing = true;
    this.speed = 1;
    this.cursor = 0; // playback time
    // Proxy object that looks like a Quad for rendering/audio.
    this.view = {
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      motorSpeed: [0, 0, 0, 0],
      propwashLevel: 0,
      get speedKmh() { return this.vel.length() * 3.6; },
    };
    this._q2 = new THREE.Quaternion();
  }

  clear() {
    this.count = 0;
    this.head = 0;
    this.lastT = -Infinity;
  }

  record(t, quad) {
    if (this.active || t - this.lastT < 1 / this.rate) return;
    this.lastT = t;
    const o = this.head * STRIDE;
    const b = this.buf;
    b[o] = t;
    b[o + 1] = quad.pos.x; b[o + 2] = quad.pos.y; b[o + 3] = quad.pos.z;
    b[o + 4] = quad.quat.x; b[o + 5] = quad.quat.y; b[o + 6] = quad.quat.z; b[o + 7] = quad.quat.w;
    for (let i = 0; i < 4; i++) b[o + 8 + i] = quad.motorSpeed[i];
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  _idx(k) {
    // k-th oldest sample → buffer index
    return ((this.head - this.count + k + this.capacity) % this.capacity) * STRIDE;
  }

  get start() {
    return this.count ? this.buf[this._idx(0)] : 0;
  }

  get end() {
    return this.count ? this.buf[this._idx(this.count - 1)] : 0;
  }

  get duration() {
    return this.end - this.start;
  }

  enter() {
    if (this.count < 10) return false;
    this.active = true;
    this.playing = true;
    this.speed = 1;
    this.cursor = this.start;
    return true;
  }

  exit() {
    this.active = false;
  }

  seek(delta) {
    this.cursor = Math.min(this.end, Math.max(this.start, this.cursor + delta));
  }

  update(dt) {
    if (!this.active || !this.count) return;
    if (this.playing) {
      this.cursor += dt * this.speed;
      if (this.cursor >= this.end) this.cursor = this.start; // loop
    }
    // Binary search on the time-ordered ring.
    let lo = 0, hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.buf[this._idx(mid)] <= this.cursor) lo = mid;
      else hi = mid;
    }
    const a = this._idx(lo), b = this._idx(hi);
    const B = this.buf;
    const span = Math.max(1e-6, B[b] - B[a]);
    const f = Math.min(1, Math.max(0, (this.cursor - B[a]) / span));
    const v = this.view;
    const px = v.pos.x, py = v.pos.y, pz = v.pos.z;
    v.pos.set(B[a + 1] + (B[b + 1] - B[a + 1]) * f, B[a + 2] + (B[b + 2] - B[a + 2]) * f, B[a + 3] + (B[b + 3] - B[a + 3]) * f);
    if (dt > 0) v.vel.set((v.pos.x - px) / (dt * this.speed || 1), (v.pos.y - py) / (dt * this.speed || 1), (v.pos.z - pz) / (dt * this.speed || 1));
    v.quat.set(B[a + 4], B[a + 5], B[a + 6], B[a + 7]);
    this._q2.set(B[b + 4], B[b + 5], B[b + 6], B[b + 7]);
    v.quat.slerp(this._q2, f);
    for (let i = 0; i < 4; i++) v.motorSpeed[i] = B[a + 8 + i] + (B[b + 8 + i] - B[a + 8 + i]) * f;
  }

  label() {
    const t = this.cursor - this.start;
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    return `▶ REPLAY ${this.playing ? '' : '❚❚ '}×${this.speed}  ${fmt(t)} / ${fmt(this.duration)}\n←/→ seek · ↑/↓ speed · SPACE pause · C camera · P exit`;
  }
}
