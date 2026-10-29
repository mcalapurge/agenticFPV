// DVR-style replay: ring buffer of the last N seconds (pose + motors), with scrubbing and speed control.

import { Quaternion, Vector3 } from 'three';
import type { QuadView } from '../sim/quad';

const STRIDE = 12; // t, px, py, pz, qx, qy, qz, qw, m0..m3

/** Recordable state (the live quad). */
export interface Recordable {
  pos: Vector3;
  quat: Quaternion;
  motorSpeed: readonly number[];
}

class ReplayView implements QuadView {
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  readonly vel = new Vector3();
  readonly motorSpeed = [0, 0, 0, 0];
  readonly propwashLevel = 0;
  get speedKmh(): number {
    return this.vel.length() * 3.6;
  }
}

export const formatReplayTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export class Replay {
  readonly capacity: number;
  readonly rate: number;
  private readonly buf: Float64Array;
  count = 0;
  private head = 0; // next write index
  private lastT = -Infinity;
  active = false;
  playing = true;
  speed = 1;
  cursor = 0; // playback time
  /** Looks like a Quad, for rendering/audio during playback. */
  readonly view = new ReplayView();
  private readonly q2 = new Quaternion();

  constructor(seconds = 90, rate = 60) {
    this.capacity = seconds * rate;
    this.rate = rate;
    this.buf = new Float64Array(this.capacity * STRIDE);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
    this.lastT = -Infinity;
  }

  record(t: number, quad: Recordable): void {
    if (this.active || t - this.lastT < 1 / this.rate) return;
    this.lastT = t;
    const o = this.head * STRIDE;
    const b = this.buf;
    b[o] = t;
    b[o + 1] = quad.pos.x;
    b[o + 2] = quad.pos.y;
    b[o + 3] = quad.pos.z;
    b[o + 4] = quad.quat.x;
    b[o + 5] = quad.quat.y;
    b[o + 6] = quad.quat.z;
    b[o + 7] = quad.quat.w;
    for (let i = 0; i < 4; i++) b[o + 8 + i] = quad.motorSpeed[i];
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** Buffer offset of the k-th oldest sample. */
  private idx(k: number): number {
    return ((this.head - this.count + k + this.capacity) % this.capacity) * STRIDE;
  }

  get start(): number {
    return this.count ? this.buf[this.idx(0)] : 0;
  }

  get end(): number {
    return this.count ? this.buf[this.idx(this.count - 1)] : 0;
  }

  get duration(): number {
    return this.end - this.start;
  }

  enter(): boolean {
    if (this.count < 10) return false;
    this.active = true;
    this.playing = true;
    this.speed = 1;
    this.cursor = this.start;
    return true;
  }

  exit(): void {
    this.active = false;
  }

  seek(delta: number): void {
    this.cursor = Math.min(this.end, Math.max(this.start, this.cursor + delta));
  }

  setSpeed(speed: number): void {
    this.speed = Math.min(4, Math.max(0.125, speed));
  }

  update(dt: number): void {
    if (!this.active || !this.count) return;
    if (this.playing) {
      this.cursor += dt * this.speed;
      if (this.cursor >= this.end) this.cursor = this.start; // loop
    }
    // Binary search on the time-ordered ring.
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.buf[this.idx(mid)] <= this.cursor) lo = mid;
      else hi = mid;
    }
    const a = this.idx(lo);
    const b = this.idx(hi);
    const B = this.buf;
    const f = Math.min(1, Math.max(0, (this.cursor - B[a]) / Math.max(1e-6, B[b] - B[a])));
    const v = this.view;
    const prev = v.pos.clone();
    v.pos.set(
      B[a + 1] + (B[b + 1] - B[a + 1]) * f,
      B[a + 2] + (B[b + 2] - B[a + 2]) * f,
      B[a + 3] + (B[b + 3] - B[a + 3]) * f,
    );
    const step = dt * this.speed;
    if (step > 0) v.vel.copy(v.pos).sub(prev).divideScalar(step);
    v.quat.set(B[a + 4], B[a + 5], B[a + 6], B[a + 7]);
    this.q2.set(B[b + 4], B[b + 5], B[b + 6], B[b + 7]);
    v.quat.slerp(this.q2, f);
    for (let i = 0; i < 4; i++) v.motorSpeed[i] = B[a + 8 + i] + (B[b + 8 + i] - B[a + 8 + i]) * f;
  }

  label(): string {
    const t = this.cursor - this.start;
    return `▶ REPLAY ${this.playing ? '' : '❚❚ '}×${this.speed}  ${formatReplayTime(t)} / ${formatReplayTime(this.duration)}\n←/→ seek · ↑/↓ speed · SPACE pause · C camera · P exit`;
  }
}
