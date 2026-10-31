// Is this a phone or tablet? Used to switch the on-screen touch controls on automatically.
// Detection is a best guess, so the player can always override it (title menu switch, Controller tab).

import type { TouchMode } from '../../state/configSchema';

export interface DeviceEnv {
  maxTouchPoints: number;
  userAgent: string;
  platform: string;
  /** The primary pointer is coarse (a finger). */
  coarsePointer: boolean;
  /** The primary input can hover (a mouse or trackpad). */
  canHover: boolean;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;

/**
 * Phones and tablets say so in the user agent. iPadOS pretends to be a Mac, so look for multi-touch.
 * Anything else counts only if a finger is the *primary* input: a touchscreen laptop still has a
 * mouse and trackpad, so it stays on keyboard controls. (Chrome's mobile emulation passes the first rule.)
 */
export function detectTouchDevice(env: DeviceEnv = readDeviceEnv()): boolean {
  const touch = env.maxTouchPoints > 0;
  if (MOBILE_UA.test(env.userAgent)) return touch || env.coarsePointer;
  if (env.platform === 'MacIntel' && env.maxTouchPoints > 1) return true;
  return touch && env.coarsePointer && !env.canHover;
}

export function readDeviceEnv(): DeviceEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const media = (query: string) => (typeof window !== 'undefined' && window.matchMedia?.(query).matches) || false;
  return {
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    coarsePointer: media('(pointer: coarse)'),
    canHover: media('(hover: hover)'),
  };
}

/** Whether touch controls are on, given the player's setting and what we detected. */
export function touchEnabled(mode: TouchMode, detected: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && detected);
}
