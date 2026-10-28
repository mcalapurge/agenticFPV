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

  /** Resolve a sphere against the world, returns max impact speed (m/s) this call. */
  resolveQuad(quad, physics) {
    const r = quad.radius;
    let impact = 0;
    // Ground plane.
    if (quad.pos.y < this.groundY + r) {
      impact = Math.max(impact, this._respond(quad, this._n.set(0, 1, 0), this.groundY + r - quad.pos.y, physics));
    }
    for (const b of this._candidates(quad.pos, r)) {
      const local = this._local.copy(quad.pos).sub(b.center).applyQuaternion(b.inv);
      const cx = Math.max(-b.half.x, Math.min(b.half.x, local.x));
      const cy = Math.max(-b.half.y, Math.min(b.half.y, local.y));
      const cz = Math.max(-b.half.z, Math.min(b.half.z, local.z));
      const dx = local.x - cx, dy = local.y - cy, dz = local.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let pen;
      const n = this._n;
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
      impact = Math.max(impact, this._respond(quad, n, pen, physics));
    }
    if (impact > 0) quad.lastImpact = Math.max(quad.lastImpact, impact);
    return impact;
  }

  _respond(quad, n, pen, physics) {
    quad.pos.addScaledVector(n, pen);
    const vn = quad.vel.dot(n);
    if (vn >= 0) return 0;
    const impact = -vn;
    // Normal restitution.
    quad.vel.addScaledVector(n, -(1 + physics.restitution) * vn);
    // Tangential friction.
    const vnNew = quad.vel.dot(n);
    const tx = quad.vel.x - n.x * vnNew, ty = quad.vel.y - n.y * vnNew, tz = quad.vel.z - n.z * vnNew;
    const f = Math.min(1, physics.friction * Math.min(1, impact / 3 + 0.2));
    quad.vel.x -= tx * f;
    quad.vel.y -= ty * f;
    quad.vel.z -= tz * f;
    // Hits knock the quad around.
    if (impact > 0.5) {
      const k = Math.min(30, impact * 2.5);
      quad.omega.x += (Math.random() * 2 - 1) * k;
      quad.omega.y += (Math.random() * 2 - 1) * k * 0.3;
      quad.omega.z += (Math.random() * 2 - 1) * k;
    }
    return impact;
  }
}
