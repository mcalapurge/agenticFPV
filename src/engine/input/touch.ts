// On-screen stick state and the maths behind it. Pure and DOM-free: the React layer feeds it finger
// positions, the InputManager reads it like another controller.

export interface TouchAxes {
  throttle: number; // 0..1
  yaw: number; // -1..1
  pitch: number;
  roll: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shared by the UI (writes) and the InputManager (reads). */
export class TouchInput implements TouchAxes {
  /** Touch controls are on: the sticks drive the quad when no gamepad is connected. */
  enabled = false;
  throttle = 0;
  yaw = 0;
  pitch = 0;
  roll = 0;

  /** Let go of everything (menu opened, screen changed). */
  reset(): void {
    this.throttle = this.yaw = this.pitch = this.roll = 0;
  }

  /** Left stick: yaw, and throttle (0…1). */
  setLeft(yaw: number, throttle: number): void {
    this.yaw = clamp(yaw, -1, 1);
    this.throttle = clamp(throttle, 0, 1);
  }

  /** Right stick: roll and pitch (stick up = positive pitch = nose down = forward). */
  setRight(roll: number, pitch: number): void {
    this.roll = clamp(roll, -1, 1);
    this.pitch = clamp(pitch, -1, 1);
  }

  cutThrottle(): void {
    this.throttle = 0;
  }
}

/** Soft centre for a stick: v·(1−expo) + v³·expo. */
export function applyExpo(v: number, expo: number): number {
  const e = clamp(expo, 0, 1);
  return v * (1 - e) + v * v * v * e;
}

/**
 * Finger offset from the stick's origin → stick position in [-1, 1]². The offset is limited to the
 * stick radius, with a small dead zone that is rescaled away (no jump when leaving it).
 */
export function stickVector(dx: number, dy: number, radius: number, deadzone = 0.06): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6 || radius <= 0) return { x: 0, y: 0 };
  const mag = Math.min(1, dist / radius);
  if (mag < deadzone) return { x: 0, y: 0 };
  const scaled = (mag - deadzone) / (1 - deadzone);
  return { x: (dx / dist) * scaled, y: (dy / dist) * scaled };
}

/**
 * Throttle is relative: dragging up/down moves it from where it was when the finger landed, so
 * touching down never makes it jump. `travel` is the finger distance (px) for the full 0→1 range.
 */
export function throttleFromDrag(startThrottle: number, dragUp: number, travel: number): number {
  return clamp(startThrottle + dragUp / Math.max(1, travel), 0, 1);
}
