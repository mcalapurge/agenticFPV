// Betaflight rate curves. stick ∈ [-1, 1] → deg/s.

import type { RateAxisConfig } from '../../state/configSchema';

export type RateType = 'actual' | 'betaflight';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Betaflight "Actual" rates.
 * rcRate = centre sensitivity (deg/s), rate = max rate (deg/s), expo 0..1.
 */
export function actualRate(stick: number, r: RateAxisConfig): number {
  const x = clamp(stick, -1, 1);
  const ax = Math.abs(x);
  const expof = ax * (Math.pow(x, 5) * r.expo + x * (1 - r.expo));
  const center = r.rcRate;
  const stickMovement = Math.max(0, r.rate - center);
  return x * center + stickMovement * expof;
}

/** Classic Betaflight rates. rcRate / superRate in BF units (e.g. 100 = 1.00), expo 0..1. */
export function betaflightRate(stick: number, r: RateAxisConfig): number {
  let x = clamp(stick, -1, 1);
  const ax = Math.abs(x);
  if (r.expo) x = x * ax * ax * ax * r.expo + x * (1 - r.expo);
  let rcRate = r.rcRate / 100;
  if (rcRate > 2) rcRate += 14.54 * (rcRate - 2);
  let angleRate = 200 * rcRate * x;
  const superRate = r.rate / 100;
  if (superRate) angleRate *= 1 / clamp(1 - ax * superRate, 0.01, 1);
  return clamp(angleRate, -1998, 1998);
}

export function applyRate(type: RateType, stick: number, r: RateAxisConfig): number {
  return type === 'betaflight' ? betaflightRate(stick, r) : actualRate(stick, r);
}

/** Betaflight throttle curve (thr_mid / thr_expo). t ∈ [0, 1]. */
export function throttleCurve(t: number, mid: number, expo: number): number {
  t = clamp(t, 0, 1);
  const tmp = t - mid;
  const y = tmp > 0 ? 1 - mid : mid;
  const norm = y === 0 ? 0 : tmp / y;
  return clamp(mid + tmp * (1 - expo + expo * norm * norm), 0, 1);
}
