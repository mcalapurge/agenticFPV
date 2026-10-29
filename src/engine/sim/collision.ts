// Sphere vs oriented-box collision with a 3D spatial-hash broadphase.

import { Quaternion, Vector3 } from 'three';
import type { PhysicsConfig } from '../../state/configSchema';
import type { ContactPoint } from './quad';

const CELL = 4;
const AXES = ['x', 'y', 'z'] as const;

export interface Box {
  id: number;
  center: Vector3;
  half: Vector3;
  quat: Quaternion;
  inv: Quaternion;
}

/** The rigid body the resolver pushes around (implemented by Quad). */
export interface CollisionBody {
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  omega: Vector3;
  inertia: Vector3;
  mass: number;
  radius: number;
  contactPoints: ContactPoint[];
  lastImpact: number;
}

export type ContactParams = Pick<PhysicsConfig, 'restitution' | 'friction'>;

export interface RayHit {
  t: number;
  normal: Vector3;
}

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class CollisionWorld {
  readonly boxes: Box[] = [];
  readonly grid = new Map<string, Box[]>();
  groundY = 0;
  ground = true;

  private readonly seen = new Set<number>();
  private readonly cand: Box[] = [];
  private readonly _local = new Vector3();
  private readonly _n = new Vector3();
  private readonly _pw = new Vector3();
  private readonly _nb = new Vector3();
  private readonly _vp = new Vector3();
  private readonly _a = new Vector3();
  private readonly _t = new Vector3();
  private readonly _tb = new Vector3();
  private readonly _ang = new Vector3();
  private readonly _sd = new Vector3();
  private readonly _sp = new Vector3();
  private readonly _so = new Vector3();
  private readonly _sdl = new Vector3();
  private readonly _qi = new Quaternion();

  addBox(center: Vector3, half: Vector3, quat?: Quaternion): Box {
    const q = quat ? quat.clone() : new Quaternion();
    const box: Box = { center: center.clone(), half: half.clone(), quat: q, inv: q.clone().invert(), id: this.boxes.length };
    this.boxes.push(box);
    // World AABB of the oriented box.
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((a) => a.applyQuaternion(q));
    const ext = new Vector3();
    for (let k = 0; k < 3; k++) {
      ext.setComponent(
        k,
        Math.abs(axes[0].getComponent(k)) * half.x +
          Math.abs(axes[1].getComponent(k)) * half.y +
          Math.abs(axes[2].getComponent(k)) * half.z,
      );
    }
    const min = center.clone().sub(ext);
    const max = center.clone().add(ext);
    for (let x = Math.floor(min.x / CELL); x <= Math.floor(max.x / CELL); x++)
      for (let y = Math.floor(min.y / CELL); y <= Math.floor(max.y / CELL); y++)
        for (let z = Math.floor(min.z / CELL); z <= Math.floor(max.z / CELL); z++) {
          const key = cellKey(x, y, z);
          let cell = this.grid.get(key);
          if (!cell) this.grid.set(key, (cell = []));
          cell.push(box);
        }
    return box;
  }

  private cellAt(p: Vector3): Box[] | undefined {
    return this.grid.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL)));
  }

  private candidates(p: Vector3, r: number): Box[] {
    const out = this.cand;
    out.length = 0;
    this.seen.clear();
    for (let x = Math.floor((p.x - r) / CELL); x <= Math.floor((p.x + r) / CELL); x++)
      for (let y = Math.floor((p.y - r) / CELL); y <= Math.floor((p.y + r) / CELL); y++)
        for (let z = Math.floor((p.z - r) / CELL); z <= Math.floor((p.z + r) / CELL); z++) {
          const cell = this.grid.get(cellKey(x, y, z));
          if (!cell) continue;
          for (const b of cell) {
            if (this.seen.has(b.id)) continue;
            this.seen.add(b.id);
            out.push(b);
          }
        }
    return out;
  }

  /**
   * Resolve the body's contact spheres against the world with rigid-body impulses
   * (normal restitution + Coulomb friction), so it tumbles and comes to rest realistically.
   * Returns the max impact speed (m/s) this call.
   */
  resolveQuad(quad: CollisionBody, physics: ContactParams): number {
    let impact = 0;
    const cands = this.candidates(quad.pos, quad.radius + 0.05);
    const n = this._n;
    for (const cp of quad.contactPoints) {
      const r = cp.r;
      const pw = this._pw.copy(cp.p).applyQuaternion(quad.quat).add(quad.pos);
      if (this.ground && pw.y < this.groundY + r) {
        impact = Math.max(impact, this.contact(quad, cp, pw, n.set(0, 1, 0), this.groundY + r - pw.y, physics));
      }
      for (const b of cands) {
        const local = this._local.copy(pw).sub(b.center).applyQuaternion(b.inv);
        const cx = Math.max(-b.half.x, Math.min(b.half.x, local.x));
        const cy = Math.max(-b.half.y, Math.min(b.half.y, local.y));
        const cz = Math.max(-b.half.z, Math.min(b.half.z, local.z));
        const dx = local.x - cx;
        const dy = local.y - cy;
        const dz = local.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let pen: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          n.set(dx / d, dy / d, dz / d);
          pen = r - d;
        } else {
          // Centre inside the box: push out through the nearest face.
          const fx = b.half.x - Math.abs(local.x);
          const fy = b.half.y - Math.abs(local.y);
          const fz = b.half.z - Math.abs(local.z);
          if (fx <= fy && fx <= fz) {
            n.set(Math.sign(local.x) || 1, 0, 0);
            pen = fx + r;
          } else if (fy <= fz) {
            n.set(0, Math.sign(local.y) || 1, 0);
            pen = fy + r;
          } else {
            n.set(0, 0, Math.sign(local.z) || 1);
            pen = fz + r;
          }
        }
        n.applyQuaternion(b.quat);
        impact = Math.max(impact, this.contact(quad, cp, pw, n, pen, physics));
      }
    }
    if (impact > 0) quad.lastImpact = Math.max(quad.lastImpact, impact);
    return impact;
  }

  private contact(
    quad: CollisionBody,
    cp: ContactPoint,
    pw: Vector3,
    n: Vector3,
    pen: number,
    physics: ContactParams,
  ): number {
    quad.pos.addScaledVector(n, pen);
    pw.addScaledVector(n, pen);
    const I = quad.inertia;
    const m = quad.mass;
    const w = quad.omega;
    const rb = cp.p;
    const qi = this._qi.copy(quad.quat).invert();
    const nb = this._nb.copy(n).applyQuaternion(qi);

    // Contact-point velocity: v + R(ω × r)
    const vp = this._vp.copy(w).cross(rb).applyQuaternion(quad.quat).add(quad.vel);
    const vn = vp.dot(n);
    if (vn >= 0) return 0;
    const impact = -vn;
    const e = impact > 1 ? physics.restitution : 0;

    // Effective mass along the normal: 1/m + n·((I⁻¹(r×n))×r)
    const a = this._a.copy(rb).cross(nb);
    a.set(a.x / I.x, a.y / I.y, a.z / I.z);
    const k = 1 / m + nb.dot(a.cross(rb));
    const jn = (-(1 + e) * vn) / k;
    this.applyImpulse(quad, rb, n, nb, jn);

    // Coulomb friction.
    vp.copy(w).cross(rb).applyQuaternion(quad.quat).add(quad.vel);
    const t = this._t.copy(vp).addScaledVector(n, -vp.dot(n));
    const vt = t.length();
    if (vt > 1e-5) {
      t.multiplyScalar(-1 / vt);
      const tb = this._tb.copy(t).applyQuaternion(qi);
      const at = this._a.copy(rb).cross(tb);
      at.set(at.x / I.x, at.y / I.y, at.z / I.z);
      const kt = 1 / m + tb.dot(at.cross(rb));
      const jt = Math.min(vt / kt, physics.friction * jn);
      this.applyImpulse(quad, rb, t, tb, jt);
    }
    return impact;
  }

  private applyImpulse(quad: CollisionBody, rb: Vector3, dirWorld: Vector3, dirBody: Vector3, j: number): void {
    const I = quad.inertia;
    quad.vel.addScaledVector(dirWorld, j / quad.mass);
    const ang = this._ang.copy(rb).cross(dirBody).multiplyScalar(j);
    quad.omega.x += ang.x / I.x;
    quad.omega.y += ang.y / I.y;
    quad.omega.z += ang.z / I.z;
  }

  /** Number of boxes the segment a→b passes through (stops counting at `max`). */
  countOccluders(a: Vector3, b: Vector3, max = 8): number {
    const dir = this._sd.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-6) return 0;
    dir.divideScalar(len);
    this.seen.clear();
    let count = 0;
    for (let s = 0; s <= len; s += CELL * 0.5) {
      const cell = this.cellAt(this._sp.copy(a).addScaledVector(dir, s));
      if (!cell) continue;
      for (const box of cell) {
        if (this.seen.has(box.id)) continue;
        this.seen.add(box.id);
        if (this.rayBox(a, dir, len, box) !== null && ++count >= max) return count;
      }
    }
    return count;
  }

  /**
   * Nearest hit along a ray (ground plane included), or null.
   * Used for visual effects (prop-wash dust), so it favours speed over exhaustive traversal.
   */
  raycast(origin: Vector3, dir: Vector3, maxDist: number): RayHit | null {
    let best = Infinity;
    const normal = new Vector3();
    if (this.ground && dir.y < -1e-6) {
      const t = (this.groundY - origin.y) / dir.y;
      if (t >= 0 && t <= maxDist) {
        best = t;
        normal.set(0, 1, 0);
      }
    }
    this.seen.clear();
    const step = Math.min(CELL * 0.25, Math.max(0.25, maxDist));
    for (let s = 0; s <= maxDist + step; s += step) {
      const cell = this.cellAt(this._sp.copy(origin).addScaledVector(dir, Math.min(s, maxDist)));
      if (cell) {
        for (const box of cell) {
          if (this.seen.has(box.id)) continue;
          this.seen.add(box.id);
          const hit = this.rayBox(origin, dir, Math.min(best, maxDist), box);
          if (hit && hit.t < best) {
            best = hit.t;
            normal.copy(hit.normal);
          }
        }
      }
      if (s > best) break;
    }
    return best <= maxDist ? { t: best, normal } : null;
  }

  /**
   * Slab test of a ray against an oriented box. Returns the entry distance and face normal;
   * a ray starting inside the box reports t = 0 with a zero normal.
   */
  private rayBox(a: Vector3, dir: Vector3, maxT: number, b: Box): RayHit | null {
    const o = this._so.copy(a).sub(b.center).applyQuaternion(b.inv);
    const d = this._sdl.copy(dir).applyQuaternion(b.inv);
    let tmin = 0;
    let tmax = maxT;
    let axis = -1;
    let sign = 0;
    for (let k = 0; k < 3; k++) {
      const ax = AXES[k];
      const h = b.half[ax];
      if (Math.abs(d[ax]) < 1e-9) {
        if (Math.abs(o[ax]) > h) return null;
      } else {
        let t1 = (-h - o[ax]) / d[ax];
        let t2 = (h - o[ax]) / d[ax];
        let s1 = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          s1 = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = k;
          sign = s1;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    const normal = new Vector3();
    if (axis >= 0) normal.setComponent(axis, sign).applyQuaternion(b.quat);
    return { t: tmin, normal };
  }

  /** Remove every box (used for dynamic layers like race gates). */
  clear(): void {
    this.boxes.length = 0;
    this.grid.clear();
  }
}
