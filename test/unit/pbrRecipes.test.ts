import { describe, expect, it } from 'vitest';
import { generatePixels, MATERIAL_DEFS, normalFromHeight, TileNoise } from '../../src/engine/world/pbrRecipes';

describe('TileNoise', () => {
  const n = new TileNoise(7);

  it('is deterministic per seed', () => {
    expect(new TileNoise(7).fbm(0.3, 0.6)).toBe(n.fbm(0.3, 0.6));
    expect(new TileNoise(8).fbm(0.3, 0.6)).not.toBe(n.fbm(0.3, 0.6));
  });

  it('tiles seamlessly at the unit square edges', () => {
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      expect(n.fbm(0, t)).toBeCloseTo(n.fbm(1, t), 6);
      expect(n.fbm(t, 0)).toBeCloseTo(n.fbm(t, 1), 6);
    }
  });

  it('stays within 0..1', () => {
    for (let i = 0; i < 500; i++) {
      const v = n.fbm(Math.random(), Math.random());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('normalFromHeight', () => {
  it('is straight up for a flat field', () => {
    const d = normalFromHeight(new Float32Array(16), 4, 5);
    expect([d[0], d[1], d[2], d[3]]).toEqual([128, 128, 255, 255]);
  });
});

describe.each(Object.entries(MATERIAL_DEFS))('material %s', (_name, def) => {
  const N = 64;
  const px = generatePixels(N, def.seed, def.normal, def.recipe());

  it('produces opaque maps of the right size', () => {
    expect(px.albedo).toHaveLength(N * N * 4);
    expect(px.normal).toHaveLength(N * N * 4);
    expect(px.roughness).toHaveLength(N * N * 4);
    for (let i = 3; i < px.albedo.length; i += 4 * 97) expect(px.albedo[i]).toBe(255);
  });

  it('has visible texture (not a flat colour)', () => {
    const lum = Array.from({ length: N * N }, (_, i) => px.albedo[i * 4] + px.albedo[i * 4 + 1] + px.albedo[i * 4 + 2]);
    expect(Math.max(...lum) - Math.min(...lum)).toBeGreaterThan(20);
  });

  it('tiles: opposite edges are close', () => {
    let diff = 0;
    for (let y = 0; y < N; y++) diff += Math.abs(px.height[y * N] - px.height[y * N + N - 1]);
    let interior = 0;
    for (let y = 0; y < N; y++) interior += Math.abs(px.height[y * N + N / 2] - px.height[y * N + N / 2 - 1]);
    // An edge seam behaves like any other neighbouring column.
    expect(diff).toBeLessThan(interior * 3 + 1);
  });
});
