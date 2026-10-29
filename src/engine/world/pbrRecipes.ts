// Pure (DOM-free) procedural PBR generation: tileable fBm heightfields → albedo, normal, roughness pixels.

// ── Tileable value noise ──────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TileNoise {
  private readonly lat = new Float32Array(256 * 256);

  constructor(seed: number) {
    const rnd = makeRng(seed);
    for (let i = 0; i < this.lat.length; i++) this.lat[i] = rnd();
  }

  /** Value noise at (x, y) ∈ [0,1)², period `p` lattice cells (power of two ≤ 256). Tiles at x/y = 1. */
  v(x: number, y: number, p: number): number {
    const fx = x * p;
    const fy = y * p;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let tx = fx - ix;
    let ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const m = p - 1;
    const x0 = ix & m;
    const x1 = (ix + 1) & m;
    const y0 = (iy & m) * 256;
    const y1 = ((iy + 1) & m) * 256;
    const L = this.lat;
    const a = L[y0 + x0];
    const b = L[y0 + x1];
    const c = L[y1 + x0];
    const d = L[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  fbm(x: number, y: number, base = 4, oct = 5, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let p = base;
    for (let o = 0; o < oct && p <= 256; o++) {
      sum += this.v(x, y, p) * amp;
      norm += amp;
      amp *= gain;
      p *= 2;
    }
    return sum / norm;
  }
}

/** [height, r, g, b, roughness], all 0..1. */
export type Sample = [number, number, number, number, number];
export type Recipe = (u: number, v: number, n: TileNoise) => Sample;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
/** Ridged noise → crack lines. */
const crack = (n: TileNoise, u: number, v: number, p: number, w: number) =>
  smooth(1 - w, 1, 1 - Math.abs(n.fbm(u, v, p, 3) * 2 - 1));

export const RECIPES = {
  concrete:
    (base = '#8f8b84'): Recipe =>
    (u, v, n) => {
      const c = hex(base);
      const large = n.fbm(u, v, 2, 4);
      const fine = n.fbm(u + 0.37, v + 0.11, 32, 4);
      const pits = smooth(0.78, 0.86, n.v(u, v, 128)) * 0.6;
      const cr = crack(n, u + 0.5, v + 0.2, 4, 0.04);
      const stain = smooth(0.45, 0.8, n.fbm(u, v * 0.25 + 0.3, 4, 3)) * (0.5 + v * 0.5); // drips run down (+v)
      const moss = smooth(0.62, 0.78, n.fbm(u + 0.7, v + 0.9, 4, 4));
      const h = fine * 0.5 + large * 0.3 - pits - cr * 0.6;
      const k = 0.82 + large * 0.3 + (fine - 0.5) * 0.25 - stain * 0.35 - cr * 0.4 - pits * 0.3;
      return [
        h,
        mix(c[0] * k, 0.3, moss * 0.5),
        mix(c[1] * k, 0.36, moss * 0.5),
        mix(c[2] * k, 0.2, moss * 0.5),
        clamp01(0.82 + fine * 0.15 - stain * 0.1),
      ];
    },
  brick: (): Recipe => (u, v, n) => {
    const rows = 16;
    const cols = 8;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2 ? 0.5 : 0);
    const col = Math.floor(uu);
    const fx = uu - col;
    const fy = v * rows - row;
    const mortarW = 0.06;
    const edge = Math.min(fx, 1 - fx) * 2.4;
    const edgeY = Math.min(fy, 1 - fy);
    const mortar = 1 - smooth(mortarW * 0.6, mortarW * 1.4, Math.min(edge * 0.42, edgeY));
    const id = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const tint = ((id % 1000) / 1000) * 0.35;
    const chip = smooth(0.7, 0.8, n.v(u, v, 64)) * (1 - smooth(0.1, 0.25, Math.min(edge * 0.42, edgeY)));
    const grime = n.fbm(u, v, 4, 4);
    const fine = n.fbm(u + 0.3, v, 64, 3);
    const h = (1 - mortar) * (0.75 + fine * 0.25) - chip * 0.4;
    const k = 0.75 + grime * 0.45 + (fine - 0.5) * 0.2;
    return [
      h,
      mix(0.46 + tint * 0.4, 0.55, mortar) * k,
      mix(0.22 + tint * 0.15, 0.52, mortar) * k,
      mix(0.16 + tint * 0.1, 0.48, mortar) * k,
      mix(0.82, 0.95, mortar),
    ];
  },
  asphalt: (): Recipe => (u, v, n) => {
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
    const k = 0.2 + large * 0.12 + stone * 0.12 + (fine - 0.5) * 0.08 - cr * 0.09 + patch * 0.05;
    return [
      h,
      mix(k, 0.22, weeds),
      mix(k, 0.3, weeds),
      mix(k * 0.97, 0.12, weeds),
      clamp01(0.88 + fine * 0.1 - stone * 0.15),
    ];
  },
  metal:
    (paint = '#6e4329', rusty = 0.6): Recipe =>
    (u, v, n) => {
      const c = hex(paint);
      const corr = Math.sin(u * Math.PI * 2 * 12) * 0.5 + 0.5; // corrugation
      const rust =
        smooth(1 - rusty * 0.55, 1 - rusty * 0.3, n.fbm(u, v, 4, 5)) +
        smooth(0.75, 0.9, n.fbm(u + 0.4, v * 0.3, 8, 3)) * 0.6;
      const pit = n.fbm(u, v, 128, 2);
      const h = corr * 0.8 + pit * 0.1 * rust;
      const rr = clamp01(rust);
      const rc = [0.38 + pit * 0.15, 0.17 + pit * 0.06, 0.07];
      const k = 0.85 + corr * 0.2;
      return [h, mix(c[0] * k, rc[0], rr), mix(c[1] * k, rc[1], rr), mix(c[2] * k, rc[2], rr), mix(0.45, 0.9, rr)];
    },
  wood: (): Recipe => (u, v, n) => {
    const plank = Math.floor(u * 4);
    const grain = Math.sin((v * 40 + n.fbm(u, v, 4, 4) * 6 + plank * 3) * Math.PI) * 0.5 + 0.5;
    const gap = smooth(0.02, 0.0, Math.min((u * 4) % 1, 1 - ((u * 4) % 1)));
    const weather = n.fbm(u, v, 8, 4);
    const h = grain * 0.3 - gap;
    const k = 0.6 + grain * 0.2 + weather * 0.3 - gap * 0.5;
    return [h, 0.42 * k, 0.33 * k, 0.24 * k, 0.88];
  },
};

export interface MaterialDef {
  recipe: () => Recipe;
  N: number;
  seed: number;
  normal: number;
  metalness?: number;
}

export const MATERIAL_DEFS = {
  concrete: { recipe: () => RECIPES.concrete('#928e86'), N: 512, seed: 11, normal: 5 },
  concreteDark: { recipe: () => RECIPES.concrete('#706d68'), N: 512, seed: 12, normal: 5 },
  concreteLight: { recipe: () => RECIPES.concrete('#aea99e'), N: 512, seed: 13, normal: 4 },
  brick: { recipe: () => RECIPES.brick(), N: 512, seed: 21, normal: 8 },
  asphalt: { recipe: () => RECIPES.asphalt(), N: 1024, seed: 31, normal: 6 },
  rust: { recipe: () => RECIPES.metal('#6e4329', 0.85), N: 256, seed: 41, normal: 3, metalness: 0.45 },
  contBlue: { recipe: () => RECIPES.metal('#2c4b6e', 0.45), N: 256, seed: 42, normal: 3, metalness: 0.35 },
  contRed: { recipe: () => RECIPES.metal('#7a2a22', 0.45), N: 256, seed: 43, normal: 3, metalness: 0.35 },
  contGreen: { recipe: () => RECIPES.metal('#3d5a35', 0.45), N: 256, seed: 44, normal: 3, metalness: 0.35 },
  wood: { recipe: () => RECIPES.wood(), N: 256, seed: 51, normal: 3 },
} satisfies Record<string, MaterialDef>;

export type MaterialName = keyof typeof MATERIAL_DEFS;

export interface PixelMaps {
  N: number;
  height: Float32Array;
  albedo: Uint8ClampedArray; // RGBA
  roughness: Uint8ClampedArray; // RGBA (grey)
  normal: Uint8ClampedArray; // RGBA, OpenGL convention
}

export function normalFromHeight(H: Float32Array, N: number, strength: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N;
      const xr = (x + 1) % N;
      const yu = (y - 1 + N) % N;
      const yd = (y + 1) % N;
      const dx = (H[y * N + xr] - H[y * N + xl]) * strength;
      const dy = (H[yd * N + x] - H[yu * N + x]) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255; // +Y up in texture space
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  return d;
}

/** Run a recipe over an N×N grid. */
export function generatePixels(N: number, seed: number, normalStrength: number, recipe: Recipe): PixelMaps {
  const n = new TileNoise(seed);
  const height = new Float32Array(N * N);
  const albedo = new Uint8ClampedArray(N * N * 4);
  const roughness = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [h, r, g, b, ro] = recipe(x / N, y / N, n);
      const i = y * N + x;
      height[i] = h;
      albedo[i * 4] = r * 255;
      albedo[i * 4 + 1] = g * 255;
      albedo[i * 4 + 2] = b * 255;
      albedo[i * 4 + 3] = 255;
      roughness[i * 4] = roughness[i * 4 + 1] = roughness[i * 4 + 2] = ro * 255;
      roughness[i * 4 + 3] = 255;
    }
  return { N, height, albedo, roughness, normal: normalFromHeight(height, N, normalStrength) };
}
