// Procedural PBR material generator: tileable fBm heightfields → albedo + normal + roughness maps.
// If real textures are present (public/textures/manifest.json, e.g. fetched from Poly Haven with
// `npm run fetch-assets`), those are used instead.

import * as THREE from 'three';

// ── Tileable value noise ──────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class TileNoise {
  constructor(seed) {
    const rnd = makeRng(seed);
    this.lat = new Float32Array(256 * 256);
    for (let i = 0; i < this.lat.length; i++) this.lat[i] = rnd();
  }
  /** value noise at (x, y) ∈ [0,1)², period `p` lattice cells (power of two ≤ 256) */
  v(x, y, p) {
    const fx = x * p, fy = y * p;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const m = p - 1;
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = (iy & m) * 256, y1 = ((iy + 1) & m) * 256;
    const L = this.lat;
    const a = L[y0 + x0], b = L[y0 + x1], c = L[y1 + x0], d = L[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  fbm(x, y, base = 4, oct = 5, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, p = base;
    for (let o = 0; o < oct && p <= 256; o++) {
      sum += this.v(x, y, p) * amp;
      norm += amp;
      amp *= gain;
      p *= 2;
    }
    return sum / norm;
  }
}

// ── Map builders ──────────────────────────────────────────────────────────
function canvasFrom(N, fill) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function normalFromHeight(H, N, strength) {
  return canvasFrom(N, (d) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const xl = (x - 1 + N) % N, xr = (x + 1) % N, yu = (y - 1 + N) % N, yd = (y + 1) % N;
        const dx = (H[y * N + xr] - H[y * N + xl]) * strength;
        const dy = (H[yd * N + x] - H[yu * N + x]) * strength;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const i = (y * N + x) * 4;
        d[i] = (-dx * inv * 0.5 + 0.5) * 255;
        d[i + 1] = (dy * inv * 0.5 + 0.5) * 255; // OpenGL convention (+Y up in texture space)
        d[i + 2] = (inv * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
  });
}

function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * Generic recipe runner. `sample(u, v, n)` returns [height, r, g, b, roughness] (0..1 floats).
 */
function generate(N, seed, normalStrength, sample) {
  const n = new TileNoise(seed);
  const H = new Float32Array(N * N);
  const A = new Uint8ClampedArray(N * N * 4);
  const R = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [h, r, g, b, ro] = sample(x / N, y / N, n);
      const i = y * N + x;
      H[i] = h;
      A[i * 4] = r * 255; A[i * 4 + 1] = g * 255; A[i * 4 + 2] = b * 255; A[i * 4 + 3] = 255;
      R[i * 4] = R[i * 4 + 1] = R[i * 4 + 2] = ro * 255; R[i * 4 + 3] = 255;
    }
  const albedo = canvasFrom(N, (d) => d.set(A));
  const rough = canvasFrom(N, (d) => d.set(R));
  return { map: tex(albedo, true), normalMap: tex(normalFromHeight(H, N, normalStrength), false), roughnessMap: tex(rough, false) };
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// Ridged noise → crack lines
const crack = (n, u, v, p, w) => smooth(1 - w, 1, 1 - Math.abs(n.fbm(u, v, p, 3) * 2 - 1));

export const RECIPES = {
  concrete: (base = '#8f8b84') => {
    const c = hex(base);
    return (u, v, n) => {
      const large = n.fbm(u, v, 2, 4);
      const fine = n.fbm(u + 0.37, v + 0.11, 32, 4);
      const pits = smooth(0.78, 0.86, n.v(u, v, 128)) * 0.6;
      const cr = crack(n, u + 0.5, v + 0.2, 4, 0.04);
      const stain = smooth(0.45, 0.8, n.fbm(u * 1, v * 0.25 + 0.3, 4, 3)) * (0.5 + v * 0.5); // drips run down (+v)
      const moss = smooth(0.62, 0.78, n.fbm(u + 0.7, v + 0.9, 4, 4));
      const h = fine * 0.5 + large * 0.3 - pits - cr * 0.6;
      let k = 0.82 + large * 0.3 + (fine - 0.5) * 0.25 - stain * 0.35 - cr * 0.4 - pits * 0.3;
      let r = c[0] * k, g = c[1] * k, b = c[2] * k;
      r = mix(r, 0.3, moss * 0.5); g = mix(g, 0.36, moss * 0.5); b = mix(b, 0.2, moss * 0.5);
      return [h, r, g, b, clamp01(0.82 + fine * 0.15 - stain * 0.1)];
    };
  },
  brick: () => (u, v, n) => {
    const rows = 16, cols = 8;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2 ? 0.5 : 0);
    const col = Math.floor(uu);
    const fx = uu - col, fy = v * rows - row;
    const mortarW = 0.06;
    const edge = Math.min(fx, 1 - fx) * 2.4, edgeY = Math.min(fy, 1 - fy);
    const mortar = 1 - smooth(mortarW * 0.6, mortarW * 1.4, Math.min(edge * 0.42, edgeY));
    const id = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const tint = ((id % 1000) / 1000) * 0.35;
    const chip = smooth(0.7, 0.8, n.v(u, v, 64)) * (1 - smooth(0.1, 0.25, Math.min(edge * 0.42, edgeY)));
    const grime = n.fbm(u, v, 4, 4);
    const fine = n.fbm(u + 0.3, v, 64, 3);
    const h = (1 - mortar) * (0.75 + fine * 0.25) - chip * 0.4;
    let r = mix(0.46 + tint * 0.4, 0.55, mortar), g = mix(0.22 + tint * 0.15, 0.52, mortar), b = mix(0.16 + tint * 0.1, 0.48, mortar);
    const k = 0.75 + grime * 0.45 + (fine - 0.5) * 0.2;
    r *= k; g *= k; b *= k;
    return [h, r, g, b, mix(0.82, 0.95, mortar)];
  },
  asphalt: () => (u, v, n) => {
    const agg = n.v(u, v, 256);
    const fine = n.fbm(u, v, 64, 3);
    const large = n.fbm(u, v, 2, 4);
    // Sparse cracks: ridged lines masked by a low-frequency field so most of the surface is intact.
    const mask = smooth(0.55, 0.7, n.fbm(u + 0.61, v + 0.29, 2, 3));
    const cr = (crack(n, u, v, 4, 0.018) + crack(n, u + 0.33, v + 0.77, 8, 0.014) * 0.6) * mask;
    const patch = smooth(0.6, 0.62, n.fbm(u + 0.2, v + 0.5, 2, 3));
    const weeds = smooth(0.7, 0.85, n.fbm(u + 0.9, v + 0.1, 8, 3)) * cr;
    const stone = smooth(0.8, 0.9, agg);
    const h = fine * 0.4 + stone * 0.4 - cr * 0.7;
    let k = 0.2 + large * 0.12 + stone * 0.12 + (fine - 0.5) * 0.08 - cr * 0.09 + patch * 0.05;
    let r = k, g = k, b = k * 0.97;
    r = mix(r, 0.22, weeds); g = mix(g, 0.3, weeds); b = mix(b, 0.12, weeds);
    return [h, r, g, b, clamp01(0.88 + fine * 0.1 - stone * 0.15)];
  },
  metal: (paint = '#6e4329', rusty = 0.6) => {
    const c = hex(paint);
    return (u, v, n) => {
      const corr = Math.sin(u * Math.PI * 2 * 12) * 0.5 + 0.5; // corrugation
      const rust = smooth(1 - rusty * 0.55, 1 - rusty * 0.3, n.fbm(u, v, 4, 5)) + smooth(0.75, 0.9, n.fbm(u + 0.4, v * 0.3, 8, 3)) * 0.6;
      const pit = n.fbm(u, v, 128, 2);
      const h = corr * 0.8 + pit * 0.1 * rust;
      const rr = clamp01(rust);
      const rc = [0.38 + pit * 0.15, 0.17 + pit * 0.06, 0.07];
      const k = 0.85 + corr * 0.2;
      return [h, mix(c[0] * k, rc[0], rr), mix(c[1] * k, rc[1], rr), mix(c[2] * k, rc[2], rr), mix(0.45, 0.9, rr)];
    };
  },
  wood: () => (u, v, n) => {
    const plank = Math.floor(u * 4);
    const grain = Math.sin((v * 40 + n.fbm(u, v, 4, 4) * 6 + plank * 3) * Math.PI) * 0.5 + 0.5;
    const gap = smooth(0.02, 0.0, Math.min((u * 4) % 1, 1 - ((u * 4) % 1)));
    const weather = n.fbm(u, v, 8, 4);
    const h = grain * 0.3 - gap;
    const k = 0.6 + grain * 0.2 + weather * 0.3 - gap * 0.5;
    return [h, 0.42 * k, 0.33 * k, 0.24 * k, 0.88];
  },
};

const DEFS = {
  concrete: { recipe: () => RECIPES.concrete('#928e86'), N: 512, seed: 11, normal: 5 },
  concreteDark: { recipe: () => RECIPES.concrete('#706d68'), N: 512, seed: 12, normal: 5 },
  concreteLight: { recipe: () => RECIPES.concrete('#aea99e'), N: 512, seed: 13, normal: 4 },
  brick: { recipe: () => RECIPES.brick(), N: 512, seed: 21, normal: 8 },
  asphalt: { recipe: () => RECIPES.asphalt(), N: 1024, seed: 31, normal: 6 },
  rust: { recipe: () => RECIPES.metal('#6e4329', 0.85), N: 256, seed: 41, normal: 3 },
  contBlue: { recipe: () => RECIPES.metal('#2c4b6e', 0.45), N: 256, seed: 42, normal: 3 },
  contRed: { recipe: () => RECIPES.metal('#7a2a22', 0.45), N: 256, seed: 43, normal: 3 },
  contGreen: { recipe: () => RECIPES.metal('#3d5a35', 0.45), N: 256, seed: 44, normal: 3 },
  wood: { recipe: () => RECIPES.wood(), N: 256, seed: 51, normal: 3 },
};

const PARAMS = {
  rust: { metalness: 0.45 }, contBlue: { metalness: 0.35 }, contRed: { metalness: 0.35 }, contGreen: { metalness: 0.35 },
};

async function loadManifest() {
  try {
    const res = await fetch('textures/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function loadTex(loader, url, srgb) {
  return new Promise((resolve, reject) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    resolve(t);
  }, undefined, reject));
}

/**
 * Build every map material. Returns { materials, source: { name: 'procedural' | 'photo' } }.
 * @param {(msg:string)=>void} progress
 */
export async function buildMaterials(progress = () => {}) {
  const manifest = await loadManifest();
  const loader = new THREE.TextureLoader();
  const materials = {};
  const source = {};
  for (const [name, def] of Object.entries(DEFS)) {
    let maps = null;
    const m = manifest?.[name];
    if (m) {
      try {
        maps = {
          map: await loadTex(loader, `textures/${m.map}`, true),
          normalMap: m.normal ? await loadTex(loader, `textures/${m.normal}`, false) : null,
          roughnessMap: m.roughness ? await loadTex(loader, `textures/${m.roughness}`, false) : null,
        };
        if (m.tint) maps.color = new THREE.Color(m.tint);
        source[name] = 'photo';
      } catch {
        maps = null;
      }
    }
    if (!maps) {
      progress(`Generating ${name} textures…`);
      await new Promise((r) => setTimeout(r, 0)); // let the loading text paint
      maps = generate(def.N, def.seed, def.normal, def.recipe());
      source[name] = 'procedural';
    }
    materials[name] = new THREE.MeshStandardMaterial({
      ...maps,
      roughness: 1,
      metalness: PARAMS[name]?.metalness ?? 0,
      normalScale: new THREE.Vector2(1, 1),
    });
  }
  return { materials, source };
}
