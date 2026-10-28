// Sphere vs oriented-box collision with a 3D spatial-hash broadphase.

import { Vector3, Quaternion } from 'three';

const CELL = 4;

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
    this.groundY = 0;
    this._local = new Vector3();
    this._n = new Vector3();
    this._seen = new Set();
    this.ground = true;
    for (const k of ['_pw', '_nb', '_vp', '_a', '_t', '_tb', '_ang', '_sd', '_sp', '_so', '_sdl']) this[k] = new Vector3();
    this._qi = new Quaternion();
  }

  /**
   * @param {Vector3} center
   * @param {Vector3} half  half extents
   * @param {Quaternion} [quat]
   */
  addBox(center, half, quat) {
    const q = quat ? quat.clone() : new Quaternion();
    const box = { center: center.clone(), half: half.clone(), quat: q, inv: q.clone().invert(), id: this.boxes.length };
    this.boxes.push(box);
    // World AABB of the oriented box.
    const ext = new Vector3();
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((a) => a.applyQuaternion(q));
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
          const key = `${x},${y},${z}`;
          let cell = this.grid.get(key);
          if (!cell) this.grid.set(key, (cell = []));
          cell.push(box);
        }
    return box;
  }

  _candidates(p, r) {
    const out = this._cand || (this._cand = []);
    out.length = 0;
    this._seen.clear();
    for (let x = Math.floor((p.x - r) / CELL); x <= Math.floor((p.x + r) / CELL); x++)
      for (let y = Math.floor((p.y - r) / CELL); y <= Math.floor((p.y + r) / CELL); y++)
        for (let z = Math.floor((p.z - r) / CELL); z <= Math.floor((p.z + r) / CELL); z++) {
          const cell = this.grid.get(`${x},${y},${z}`);
          if (!cell) continue;
          for (const b of cell) {
            if (this._seen.has(b.id)) continue;
            this._seen.add(b.id);
            out.push(b);
          }
        }
    return out;
  }

  /**
   * Resolve the quad's contact spheres against the world with rigid-body impulses
   * (normal restitution + Coulomb friction), so it tumbles and comes to rest realistically.
   * Returns the max impact speed (m/s) this call.
   */
  resolveQuad(quad, physics) {
    let impact = 0;
    const cands = this._candidates(quad.pos, quad.radius + 0.05);
    const n = this._n;
    for (const cp of quad.contactPoints) {
      const r = cp.r;
      const pw = this._pw.copy(cp.p).applyQuaternion(quad.quat).add(quad.pos);
      if (this.ground && pw.y < this.groundY + r) {
        impact = Math.max(impact, this._contact(quad, cp, pw, n.set(0, 1, 0), this.groundY + r - pw.y, physics));
      }
      for (const b of cands) {
        const local = this._local.copy(pw).sub(b.center).applyQuaternion(b.inv);
        const cx = Math.max(-b.half.x, Math.min(b.half.x, local.x));
        const cy = Math.max(-b.half.y, Math.min(b.half.y, local.y));
        const cz = Math.max(-b.half.z, Math.min(b.half.z, local.z));
        const dx = local.x - cx, dy = local.y - cy, dz = local.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let pen;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          n.set(dx / d, dy / d, dz / d);
          pen = r - d;
        } else {
          // Centre inside the box: push out through the nearest face.
          const fx = b.half.x - Math.abs(local.x);
          const fy = b.half.y - Math.abs(local.y);
          const fz = b.half.z - Math.abs(local.z);
          if (fx <= fy && fx <= fz) { n.set(Math.sign(local.x) || 1, 0, 0); pen = fx + r; }
          else if (fy <= fz) { n.set(0, Math.sign(local.y) || 1, 0); pen = fy + r; }
          else { n.set(0, 0, Math.sign(local.z) || 1); pen = fz + r; }
        }
        n.applyQuaternion(b.quat);
        impact = Math.max(impact, this._contact(quad, cp, pw, n, pen, physics));
      }
    }
    if (impact > 0) quad.lastImpact = Math.max(quad.lastImpact, impact);
    return impact;
  }

  _contact(quad, cp, pw, n, pen, physics) {
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
    this._applyImpulse(quad, rb, n, nb, jn);

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
      this._applyImpulse(quad, rb, t, tb, jt);
    }
    return impact;
  }

  _applyImpulse(quad, rb, dirWorld, dirBody, j) {
    const I = quad.inertia;
    quad.vel.addScaledVector(dirWorld, j / quad.mass);
    const ang = this._ang.copy(rb).cross(dirBody).multiplyScalar(j);
    quad.omega.x += ang.x / I.x;
    quad.omega.y += ang.y / I.y;
    quad.omega.z += ang.z / I.z;
  }

  /** Number of boxes the segment a→b passes through (stops counting at `max`). */
  countOccluders(a, b, max = 8) {
    const dir = this._sd.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-6) return 0;
    dir.divideScalar(len);
    this._seen.clear();
    let count = 0;
    for (let s = 0; s <= len; s += CELL * 0.5) {
      const p = this._sp.copy(a).addScaledVector(dir, s);
      const cell = this.grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)},${Math.floor(p.z / CELL)}`);
      if (!cell) continue;
      for (const box of cell) {
        if (this._seen.has(box.id)) continue;
        this._seen.add(box.id);
        if (this._segBox(a, dir, len, box) && ++count >= max) return count;
      }
    }
    return count;
  }

  _segBox(a, dir, len, b) {
    const o = this._so.copy(a).sub(b.center).applyQuaternion(b.inv);
    const d = this._sdl.copy(dir).applyQuaternion(b.inv);
    let tmin = 0, tmax = len;
    for (const ax of ['x', 'y', 'z']) {
      const h = b.half[ax];
      if (Math.abs(d[ax]) < 1e-9) {
        if (Math.abs(o[ax]) > h) return false;
      } else {
        let t1 = (-h - o[ax]) / d[ax], t2 = (h - o[ax]) / d[ax];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  /** Remove every box (used for dynamic layers like race gates). */
  clear() {
    this.boxes.length = 0;
    this.grid.clear();
  }
}
