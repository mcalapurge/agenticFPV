// Pure helpers from the render/audio layers.

import { describe, expect, it } from 'vitest';
import { motorFrequencies } from '../../src/engine/audio/motorAudio';
import { gpuLabel, isSoftwareRenderer } from '../../src/engine/render/gpuInfo';
import { computeVideoFx, signalQuality, VTX_RANGE } from '../../src/engine/render/postfx';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';

const video = (patch: Partial<typeof DEFAULT_CONFIG.video> = {}) => ({ ...DEFAULT_CONFIG.video, ...patch });

describe('signalQuality', () => {
  it('is perfect up close and falls off with distance and walls', () => {
    const v = video({ vtxPower: 200, system: 'analog' });
    expect(signalQuality(0, 0, v)).toBe(1);
    expect(signalQuality(VTX_RANGE[200] / 2, 0, v)).toBeCloseTo(0.75, 9);
    expect(signalQuality(VTX_RANGE[200], 0, v)).toBe(0);
    expect(signalQuality(0, 2, v)).toBeCloseTo(1 - 2 * 0.17, 9);
  });

  it('gets more range from more power and digital punches through walls', () => {
    expect(signalQuality(500, 0, video({ vtxPower: 600 }))).toBeGreaterThan(
      signalQuality(500, 0, video({ vtxPower: 25 })),
    );
    expect(signalQuality(0, 3, video({ system: 'digital' }))).toBeGreaterThan(
      signalQuality(0, 3, video({ system: 'analog' })),
    );
  });
});

describe('computeVideoFx', () => {
  it('analog breaks up and adds static as signal drops', () => {
    const good = computeVideoFx(video({ system: 'analog' }), 'fpv', 1, 0);
    const bad = computeVideoFx(video({ system: 'analog' }), 'fpv', 0.1, 0);
    expect(good).toMatchObject({ enabled: true, digital: 0, breakup: 0 });
    expect(bad.breakup).toBeGreaterThan(0);
    expect(bad.staticAmt).toBeGreaterThan(good.staticAmt!);
  });

  it('digital pixelates and freezes instead', () => {
    expect(computeVideoFx(video({ system: 'digital' }), 'fpv', 1, 0)).toMatchObject({
      digital: 1,
      pixelate: 0,
      freeze: false,
    });
    const lost = computeVideoFx(video({ system: 'digital' }), 'fpv', 0.02, 0);
    expect(lost.pixelate).toBeGreaterThan(1);
    expect(lost.freeze).toBe(true);
  });

  it('third-person cameras get no link artefacts', () => {
    const fx = computeVideoFx(video({ system: 'analog' }), 'chase', 0, 0);
    expect(fx.enabled).toBe(false);
    expect(fx.staticAmt).toBeUndefined();
  });
});

describe('GPU detection', () => {
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', true],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', true],
    ['Microsoft Basic Render Driver', true],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', false],
    ['Apple M3 Pro', false],
  ])('%s → software %s', (name, software) => {
    expect(isSoftwareRenderer(name)).toBe(software);
  });

  it('labels strip ANGLE noise', () => {
    expect(gpuLabel('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(
      'NVIDIA GeForce RTX 4070',
    );
    expect(gpuLabel('Apple M3 Pro')).toBe('Apple M3 Pro');
  });
});

describe('motorFrequencies', () => {
  it('derives electrical and blade-pass frequencies from rpm', () => {
    const f = motorFrequencies(0.5, 30000, 3);
    expect(f.electrical).toBeCloseTo((15000 / 60) * 7, 9);
    expect(f.bladePass).toBeCloseTo((15000 / 60) * 3, 9);
  });

  it('keeps an idle floor and handles reversed (turtle) motors', () => {
    expect(motorFrequencies(0, 30000, 3).bladePass).toBeCloseTo((300 / 60) * 3, 9);
    expect(motorFrequencies(-0.5, 30000, 2)).toEqual(motorFrequencies(0.5, 30000, 2));
  });
});
