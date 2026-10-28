// "Abandoned Works" — procedural map of derelict industrial buildings.
// Every solid box is both rendered (merged per material) and registered as a collider.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  rand, rr, setSeed, concreteTexture, brickTexture, asphaltTexture, metalTexture, woodTexture,
  grassAlphaTexture, graffitiTexture,
} from './textures.js';

const TEX_SCALE = 4; // metres per texture tile

class Builder {
  constructor(materials, collision) {
    this.materials = materials;
    this.collision = collision;
    this.geoms = new Map(); // material name → geometries[]
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  _push(mat, geom) {
    if (!this.geoms.has(mat)) this.geoms.set(mat, []);
    this.geoms.get(mat).push(geom);
  }

  /**
   * Add a box. (x, z) centre, y = bottom. rot = [rx, ry, rz] radians (about box centre).
   */
  box(x, y, z, w, h, d, mat = 'concrete', { rot, collide = true, scale = TEX_SCALE } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    // Face order: +x, -x, +y, -y, +z, -z (4 verts each). Scale UVs to world size.
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const ou = rand(), ov = rand();
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * (dims[f][0] / scale) + ou, uv.getY(i) * (dims[f][1] / scale) + ov);
      }
    }
    this._e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    this._q.setFromEuler(this._e);
    const c = new THREE.Vector3(x, y + h / 2, z);
    this._m.compose(c, this._q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this._m);
    this._push(mat, g);
    if (collide) this.collision.addBox(c, new THREE.Vector3(w / 2, h / 2, d / 2), this._q);
  }

  /** Arbitrary geometry (already positioned), no collider. */
  geom(g, mat) {
    this._push(mat, g);
  }

  cylinder(x, y, z, rTop, rBot, h, mat, { segs = 16, collide = true, uvScale = 1 } = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((2 * Math.PI * rBot) / TEX_SCALE) * uvScale, uv.getY(i) * (h / TEX_SCALE));
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (collide) {
      const r = Math.max(rTop, rBot) * 0.92;
      const c = new THREE.Vector3(x, y + h / 2, z);
      const half = new THREE.Vector3(r, h / 2, r);
      this.collision.addBox(c, half);
      this.collision.addBox(c, half, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4));
    }
  }

  /**
   * Straight wall from (x0,z0) to (x1,z1) with rectangular openings.
   * openings: [{at, width, bottom, height}] — `at` = distance from start to opening centre.
   */
  wall(x0, z0, x1, z1, y, height, thick, mat, openings = []) {
    const dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const ry = Math.atan2(-uz, ux);
    const seg = (a, b, yb, h) => {
      if (b - a < 0.05 || h < 0.05) return;
      const m = (a + b) / 2;
      this.box(x0 + ux * m, yb, z0 + uz * m, b - a, h, thick, mat, { rot: [0, ry, 0] });
    };
    const ops = openings.filter((o) => o).sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const o of ops) {
      const a = o.at - o.width / 2, b = o.at + o.width / 2;
      seg(cursor, a, y, height);
      seg(a, b, y, o.bottom); // sill
      seg(a, b, y + o.bottom + o.height, height - o.bottom - o.height); // lintel
      cursor = b;
    }
    seg(cursor, L, y, height);
  }

  /** Floor slab split into tiles with random holes (adjacent tiles merged per row). */
  slab(x0, z0, w, d, y, thick, tile, holeChance, mat = 'concreteDark') {
    const nx = Math.max(1, Math.round(w / tile)), nz = Math.max(1, Math.round(d / tile));
    const tw = w / nx, td = d / nz;
    for (let j = 0; j < nz; j++) {
      let run = -1;
      for (let i = 0; i <= nx; i++) {
        const present = i < nx && rand() >= holeChance;
        if (present && run < 0) run = i;
        if (!present && run >= 0) {
          const cx = x0 + ((run + i) / 2) * tw;
          this.box(cx, y, z0 + (j + 0.5) * td, (i - run) * tw, thick, td, mat);
          run = -1;
        }
      }
    }
  }

  finish(scene) {
    for (const [name, list] of this.geoms) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, this.materials[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    this.geoms.clear();
  }
}

/**
 * Graffiti decals: candidates are probed with raycasts so a tag is only placed
 * where a flat, solid wall exists behind its whole footprint.
 */
function placeGraffiti(scene) {
  scene.updateMatrixWorld(true);
  const solids = scene.children.filter((o) => o.isMesh && !o.material.transparent);
  const ray = new THREE.Raycaster();
  const candidates = [];
  for (let i = 0; i < 260; i++) {
    const ry = Math.floor(rand() * 4) * (Math.PI / 2);
    candidates.push({ p: new THREE.Vector3(rr(-120, 120), rr(1.2, 4), rr(-120, 120)), ry });
  }
  let placed = 0;
  for (const c of candidates) {
    if (placed >= 26) break;
    const n = new THREE.Vector3(Math.sin(c.ry), 0, Math.cos(c.ry)); // decal faces +n
    const w = rr(2.4, 4), h = w * 0.5;
    const right = new THREE.Vector3(n.z, 0, -n.x);
    ray.set(c.p, n.clone().negate());
    ray.far = 30;
    const hit = ray.intersectObjects(solids, false)[0];
    if (!hit || hit.distance < 0.5) continue;
    const hn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (hn.dot(n) < 0.99) continue;
    const centre = hit.point.clone().addScaledVector(n, 0.4);
    let ok = true;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const o = centre.clone().addScaledVector(right, (sx * w) / 2).add(new THREE.Vector3(0, (sy * h) / 2, 0));
      ray.set(o, n.clone().negate());
      ray.far = 0.8;
      const hh = ray.intersectObjects(solids, false)[0];
      if (!hh || Math.abs(hh.distance - 0.4) > 0.02) { ok = false; break; }
    }
    if (!ok || hit.point.y - h / 2 < 0.2) continue;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: graffitiTexture(), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.position.copy(hit.point).addScaledVector(n, 0.02);
    m.rotation.y = c.ry;
    scene.add(m);
    placed++;
  }
}

function windows(L, count, width, bottom, height, margin = 1.5) {
  const out = [];
  const span = L - margin * 2;
  for (let i = 0; i < count; i++) out.push({ at: margin + (span * (i + 0.5)) / count, width, bottom, height });
  return out;
}

function rubble(b, cx, cz, radius, count, mat = 'concrete') {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
    const s = rr(0.25, 1.3) * (1 - r / radius * 0.5);
    b.box(cx + Math.cos(a) * r, -s * 0.25, cz + Math.sin(a) * r, s * rr(0.8, 2), s, s * rr(0.8, 1.6), mat, {
      rot: [rr(-0.5, 0.5), rand() * Math.PI, rr(-0.5, 0.5)],
    });
  }
}

function container(b, x, z, y, ry, mat) {
  b.box(x, y, z, 12.2, 2.6, 2.44, mat, { rot: [0, ry, 0], scale: 3 });
}

export function buildMap(scene, collision) {
  setSeed(20261028);
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture('#8d8a84'), roughness: 0.95 }),
    concreteDark: new THREE.MeshStandardMaterial({ map: concreteTexture('#6e6c68', false), roughness: 0.95 }),
    concreteLight: new THREE.MeshStandardMaterial({ map: concreteTexture('#a7a297'), roughness: 0.9 }),
    brick: new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.95 }),
    rust: new THREE.MeshStandardMaterial({ map: metalTexture('#6e4329'), roughness: 0.7, metalness: 0.4 }),
    contBlue: new THREE.MeshStandardMaterial({ map: metalTexture('#2c4b6e'), roughness: 0.7, metalness: 0.3 }),
    contRed: new THREE.MeshStandardMaterial({ map: metalTexture('#7a2a22'), roughness: 0.7, metalness: 0.3 }),
    contGreen: new THREE.MeshStandardMaterial({ map: metalTexture('#3d5a35'), roughness: 0.7, metalness: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.95 }),
  };
  const b = new Builder(materials, collision);

  // ── Ground ────────────────────────────────────────────────────────────────
  const groundTex = asphaltTexture();
  groundTex.repeat.set(50, 50);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grassTex = grassAlphaTexture();
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, depthWrite: false, roughness: 1 });
  for (let i = 0; i < 45; i++) {
    const s = rr(8, 30);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(s, s), grassMat);
    g.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
    g.position.set(rr(-140, 140), 0.02 + i * 0.001, rr(-140, 140));
    g.receiveShadow = true;
    scene.add(g);
  }

  // ── A: Concrete skeleton (5 floors, collapsing slabs) ────────────────────
  {
    const x0 = -55, z0 = -30, W = 30, D = 20, FH = 3.6, floors = 5;
    for (let f = 0; f <= floors; f++) {
      const y = f * FH;
      if (f > 0) b.slab(x0, z0, W, D, y - 0.3, 0.3, 3, f === floors ? 0.35 : 0.08 + f * 0.04);
      if (f === floors) break;
      for (let cx = 0; cx <= W; cx += 6)
        for (let cz = 0; cz <= D; cz += 5) {
          // some top-floor columns are broken off
          const h = f === floors - 1 && rand() < 0.3 ? rr(0.8, 2.5) : FH - 0.3;
          b.box(x0 + cx, y, z0 + cz, 0.5, h, 0.5, 'concrete');
        }
      // Partial facade on the first two floors (with gaps to fly through).
      if (f < 2) {
        b.wall(x0, z0, x0, z0 + D, y, FH - 0.3, 0.25, 'concrete', windows(D, 3, 2.4, 0.9, 1.6));
        b.wall(x0 + W, z0 + D, x0 + W, z0, y, FH - 0.3, 0.25, 'concrete', windows(D, 3, 2.4, 0.9, 1.6));
      }
    }
    // stair core
    b.wall(x0 + 24.5, z0 + 13, x0 + 29.5, z0 + 13, 0, FH * 3, 0.25, 'concreteLight', [{ at: 2.5, width: 1.2, bottom: 0, height: 2.2 }]);
    b.wall(x0 + 24.5, z0 + 13, x0 + 24.5, z0 + 19.5, 0, FH * 3, 0.25, 'concreteLight');
    // collapsed slab leaning against the building (ramp)
    b.box(x0 + 12, 0, z0 + D + 3.2, 7, 0.3, 8, 'concreteDark', { rot: [0.5, 0, 0] });
    rubble(b, x0 + 12, z0 + D + 6, 5, 30);
    rubble(b, x0 + 4, z0 + 4, 3, 15);
    // fallen column
    b.box(x0 + 33, 0, z0 + 8, 0.5, 0.5, 5, 'concrete', { rot: [0, 0.6, 0] });
  }

  // ── B: Brick warehouse with collapsed roof ───────────────────────────────
  {
    const x0 = 18, z0 = -36, W = 44, D = 22, H = 9, T = 0.5;
    const highWindows = windows(W, 8, 2.2, 5.2, 2.4);
    const lowWindows = windows(W, 5, 2.0, 1.2, 1.8, 4);
    b.wall(x0, z0, x0 + W, z0, 0, H, T, 'brick', [...highWindows, ...lowWindows.filter((_, i) => i % 2 === 0)]);
    b.wall(x0 + W, z0 + D, x0, z0 + D, 0, H, T, 'brick', [...highWindows, { at: 22, width: 4.5, bottom: 0, height: 4.5 }]);
    b.wall(x0, z0 + D, x0, z0, 0, H, T, 'brick', [{ at: 11, width: 6, bottom: 0, height: 6 }]);
    b.wall(x0 + W, z0, x0 + W, z0 + D, 0, H, T, 'brick', [{ at: 11, width: 6, bottom: 0, height: 6 }]);
    // gable parapets
    for (const x of [x0, x0 + W]) b.box(x, H, z0 + D / 2, T, 1.2, D, 'brick');
    // steel roof trusses + purlins
    for (let x = x0 + 5.5; x < x0 + W; x += 5.5) {
      b.box(x, H - 0.6, z0 + D / 2, 0.25, 0.4, D, 'rust');
      if (rand() < 0.3) continue;
      b.box(x, H - 0.2, z0 + D / 2, 0.15, 1.2, 0.15, 'rust');
    }
    for (let z = z0 + 3; z < z0 + D; z += 4) b.box(x0 + W / 2, H - 0.2, z, W, 0.15, 0.15, 'rust');
    // remaining roof panels (most of the roof is gone)
    for (let x = x0; x < x0 + W; x += 5.5)
      for (let z = z0; z < z0 + D; z += 5.5) if (rand() < 0.35) b.box(x + 2.75, H + 0.05, z + 2.75, 5.5, 0.08, 5.5, 'rust');
    // fallen roof panels inside
    b.box(x0 + 30, 0, z0 + 6, 5.5, 0.08, 5.5, 'rust', { rot: [0.9, 0.3, 0] });
    b.box(x0 + 9, 0, z0 + 16, 5.5, 0.08, 5.5, 'rust', { rot: [-0.7, 0, 0.3] });
    // racking
    for (let i = 0; i < 3; i++) {
      const rx = x0 + 8 + i * 12;
      for (const dz of [0, 2.2]) for (const dx of [0, 5]) b.box(rx + dx, 0, z0 + 4 + dz, 0.12, 5, 0.12, 'rust');
      for (const y of [1.5, 3, 4.5]) b.box(rx + 2.5, y, z0 + 5.1, 5.2, 0.08, 2.4, 'rust');
    }
    // crates & pallets
    for (let i = 0; i < 12; i++) b.box(rr(x0 + 3, x0 + W - 3), 0, rr(z0 + 12, z0 + D - 2), 1.2, rr(0.6, 1.4), 1.0, 'wood', { rot: [0, rand() * 3, 0] });
    rubble(b, x0 + 22, z0 + 12, 4, 20, 'brick');
    // gantry crane beam across the hall
    b.box(x0 + W / 2, 7, z0 + 1, W - 1, 0.6, 0.4, 'rust');
    b.box(x0 + W / 2, 7, z0 + D - 1, W - 1, 0.6, 0.4, 'rust');
    b.box(x0 + 26, 7.6, z0 + D / 2, 0.8, 0.6, D - 1.5, 'rust');
  }

  // ── C: Tall tower (9 floors, blown-out walls) + water tank ───────────────
  {
    const x0 = -11, z0 = -81, S = 12, FH = 3.4, floors = 9;
    for (let f = 0; f < floors; f++) {
      const y = f * FH;
      b.slab(x0, z0, S, S, y + FH - 0.3, 0.3, 3, f === floors - 1 ? 0 : 0.12);
      for (const [cx, cz] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) b.box(x0 + cx, y, z0 + cz, 0.6, FH - 0.3, 0.6, 'concrete');
      const sides = [
        [x0, z0, x0 + S, z0], [x0 + S, z0, x0 + S, z0 + S], [x0 + S, z0 + S, x0, z0 + S], [x0, z0 + S, x0, z0],
      ];
      sides.forEach(([a, c, d, e], si) => {
        if (rand() < 0.22) return; // wall blown out
        const big = f === 0 && si === 2;
        b.wall(a, c, d, e, y, FH - 0.3, 0.25, f % 3 === 0 ? 'concreteLight' : 'concrete', big ? [{ at: 6, width: 4, bottom: 0, height: 2.8 }] : windows(S, 3, 1.8, 0.9, 1.5));
      });
    }
    const top = floors * FH;
    for (const [dx, dz] of [[2.5, 2.5], [9.5, 2.5], [2.5, 9.5], [9.5, 9.5]]) b.box(x0 + dx, top, z0 + dz, 0.25, 4, 0.25, 'rust');
    b.cylinder(x0 + 6, top + 4, z0 + 6, 3.4, 3.4, 4, 'rust', { segs: 20 });
    b.cylinder(x0 + 6, top + 8, z0 + 6, 0.5, 3.5, 1.5, 'rust', { segs: 20, collide: false });
    rubble(b, x0 + 6, z0 + 16, 5, 25);
  }

  // ── D: Two-storey L block with collapsed corner ──────────────────────────
  {
    const FH = 4;
    for (let f = 0; f < 2; f++) {
      const y = f * FH;
      const w = windows(28, 6, 1.8, 1, 1.8);
      b.wall(28, 22, 56, 22, y, FH, 0.35, 'brick', f === 0 ? [...w.slice(0, 3), { at: 20, width: 3, bottom: 0, height: 2.8 }, w[5]] : w);
      b.wall(28, 34, 28, 22, y, FH, 0.35, 'brick', windows(12, 2, 1.8, 1, 1.8));
      b.wall(44, 34, 28, 34, y, FH, 0.35, 'brick', windows(16, 3, 1.8, 1, 1.8));
      b.wall(56, 22, 56, 48, y, FH, 0.35, 'brick', windows(26, 5, 1.8, 1, 1.8));
      if (f === 0) b.wall(44, 48, 44, 34, y, FH, 0.35, 'brick', windows(14, 3, 1.8, 1, 1.8));
      b.wall(56, 48, 44 + (f === 1 ? 6 : 0), 48, y, FH, 0.35, 'brick', f === 0 ? [{ at: 6, width: 3.5, bottom: 0, height: 3 }] : []);
    }
    b.slab(28, 22, 28, 12, FH - 0.25, 0.25, 4, 0.1);
    b.slab(28, 22, 20, 12, 2 * FH, 0.3, 4, 0.25);
    b.slab(44, 34, 12, 14, FH - 0.25, 0.25, 4, 0.15);
    // collapsed corner: roof slab sliding to the ground
    b.box(52, 0.5, 40, 8, 0.3, 9, 'concreteDark', { rot: [0, 0.2, 0.75] });
    rubble(b, 48, 44, 4, 30, 'brick');
    rubble(b, 38, 18, 3, 12, 'brick');
  }

  // ── Container yard ───────────────────────────────────────────────────────
  {
    const cm = ['contBlue', 'contRed', 'contGreen', 'rust'];
    const spots = [
      [-60, 28, 0, 0], [-60, 31, 0, 0], [-60, 28, 2.6, 0], [-44, 25, 0, Math.PI / 2], [-40, 25, 0, Math.PI / 2],
      [-40, 25, 2.6, Math.PI / 2 + 0.1], [-28, 40, 0, 0.3], [-58, 46, 0, -0.2], [-52, 52, 0, 1.2], [-30, 55, 0, 0],
      [-30, 55, 2.6, 0.05], [-30, 55, 5.2, -0.1],
    ];
    spots.forEach(([x, z, y, ry], i) => container(b, x, z, y, ry, cm[i % cm.length]));
    // one tipped over
    b.box(-70, 0, 40, 12.2, 2.44, 2.6, 'contRed', { rot: [0, 0.9, 0], scale: 3 });
  }

  // ── Smokestack + boiler house ────────────────────────────────────────────
  b.cylinder(75, 0, -75, 1.8, 2.8, 48, 'brick', { segs: 24, uvScale: 1 });
  b.wall(62, -88, 68, -88, 0, 7, 0.4, 'brick', [{ at: 3, width: 2, bottom: 2, height: 2 }]);
  b.wall(68, -88, 68, -64, 0, 7, 0.4, 'brick', windows(24, 4, 2, 2, 2.5));
  b.wall(62, -64, 62, -88, 0, 7, 0.4, 'brick', [{ at: 12, width: 4, bottom: 0, height: 4 }]);
  b.wall(68, -64, 62, -64, 0, 7, 0.4, 'brick');
  // pipe bridge from boiler to warehouse
  for (let z = -60; z <= -40; z += 5) {
    b.box(66, 0, z, 0.3, 6, 0.3, 'rust');
    b.box(66, 6, z, 0.3, 0.3, 3, 'rust');
  }
  b.cylinder(66, 6.3, -50, 0.5, 0.5, 0.01, 'rust', { collide: false });
  b.box(66, 6.3, -50, 0.9, 0.9, 22, 'rust');

  // ── Perimeter walls, broken ──────────────────────────────────────────────
  const R = 125;
  for (let s = -R; s < R; s += 6) {
    for (const [x, z, ry] of [[s + 3, -R, 0], [s + 3, R, 0], [-R, s + 3, Math.PI / 2], [R, s + 3, Math.PI / 2]]) {
      const roll = rand();
      if (roll < 0.15) continue;
      if (roll < 0.25) {
        b.box(x, 0, z, 5.8, 0.3, 2.8, 'concrete', { rot: [0, ry, 0.05] }); // fallen panel
        continue;
      }
      b.box(x, 0, z, 5.8, rr(2.5, 3.2), 0.3, 'concrete', { rot: [0, ry, 0] });
    }
  }

  // ── Scattered junk ───────────────────────────────────────────────────────
  for (let i = 0; i < 40; i++) {
    const x = rr(-110, 110), z = rr(-110, 110);
    if (Math.hypot(x, z - 60) < 12) continue; // keep spawn clear
    b.cylinder(x, 0, z, 0.3, 0.3, 0.9, i % 3 ? 'rust' : 'contBlue', { segs: 12 });
  }
  for (let i = 0; i < 10; i++) rubble(b, rr(-100, 100), rr(-100, 100), rr(1.5, 3.5), 10);
  // concrete jersey barriers
  for (let i = 0; i < 14; i++) b.box(rr(-20, 20), 0, rr(5, 30), 3, 0.9, 0.6, 'concreteLight', { rot: [0, rand() * Math.PI, 0] });
  // launch pad
  b.box(0, 0, 60, 4, 0.08, 4, 'concreteLight');

  // ── Power line (decorative wires) ────────────────────────────────────────
  const poles = [];
  for (let z = -110; z <= 110; z += 30) {
    const x = 95;
    b.box(x, 0, z, 0.3, 11, 0.3, 'wood');
    b.box(x, 10, z, 3, 0.2, 0.2, 'wood');
    poles.push(new THREE.Vector3(x, 10.2, z));
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x111111 });
  for (let i = 0; i < poles.length - 1; i++)
    for (const off of [-1.3, 0, 1.3]) {
      const a = poles[i].clone().setX(poles[i].x + off), c = poles[i + 1].clone().setX(poles[i + 1].x + off);
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const p = a.clone().lerp(c, t);
        p.y -= Math.sin(t * Math.PI) * 1.6;
        pts.push(p);
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }

  b.finish(scene);
  placeGraffiti(scene);

  return {
    spawn: { pos: new THREE.Vector3(0, 0.2, 60), yaw: 0 },
    materials,
  };
}
