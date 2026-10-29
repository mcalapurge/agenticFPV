// Single source of truth for every tunable in the sim.
// The Zod schema provides: the TypeScript `Config` type, the defaults (`DEFAULT_CONFIG`),
// and forgiving validation for stored/imported settings: bad or missing values fall back to
// defaults, out-of-range numbers are clamped, unknown keys are dropped.

import { z } from 'zod';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Number leaf: falls back to `def` when invalid, clamps into [min, max]. */
const num = (def: number, min = -Infinity, max = Infinity) =>
  z
    .number()
    .catch(def)
    .transform((v) => clamp(v, min, max));
const bool = (def: boolean) => z.boolean().catch(def);
const choice = <const T extends readonly [string, ...string[]]>(values: T, def: T[number]) => z.enum(values).catch(def);
const str = (def: string) => z.string().catch(def);

/** Object section: a missing or broken section is rebuilt from its defaults. */
function section<S extends z.ZodRawShape>(shape: S) {
  const o = z.object(shape);
  return o.prefault({} as z.input<typeof o>).catch(() => o.parse({}));
}

const pidAxis = (p: number, i: number, d: number, f: number) =>
  section({ p: num(p, 0, 250), i: num(i, 0, 250), d: num(d, 0, 250), f: num(f, 0, 2000) });
const rateAxis = () => section({ rcRate: num(70, 0, 2550), rate: num(670, 0, 2550), expo: num(0.54, 0, 1) });
const channel = (axis: number) =>
  section({ axis: num(axis, 0, 31), invert: bool(false), min: num(-1), center: num(0), max: num(1) });

export const SWITCH_TYPES = ['none', 'axis', 'button'] as const;
const switchCfg = (type: (typeof SWITCH_TYPES)[number], index: number, threshold = 0.3) =>
  section({
    type: choice(SWITCH_TYPES, type),
    index: num(index, -1, 63),
    threshold: num(threshold, -1, 1),
    invert: bool(false),
    toggle: bool(false),
  });

export const GAME_MODES = ['free', 'practice', 'race', 'editor'] as const;
export const CAMERA_MODES = ['fpv', 'chase', 'los', 'orbit'] as const;
export const VIDEO_SYSTEMS = ['analog', 'digital', 'clean'] as const;
export const TIMES_OF_DAY = ['day', 'golden', 'overcast', 'dusk', 'night'] as const;
export const RATE_TYPES = ['actual', 'betaflight'] as const;
export const FLIGHT_MODES = ['acro', 'angle'] as const;
export const VTX_POWERS = [25, 200, 600, 1000] as const;

export const ConfigSchema = section({
  quad: section({ preset: str('freestyle5') }),
  // Betaflight-style PID profile. Scaling matches Betaflight, so P/I/D/FF numbers are interchangeable.
  pid: section({
    roll: pidAxis(45, 80, 40, 120),
    pitch: pidAxis(47, 84, 46, 125),
    yaw: pidAxis(45, 80, 0, 120),
    iTermLimit: num(400, 0, 1000),
    itermRelax: bool(true),
    itermRelaxCutoff: num(40, 1, 500), // deg/s of setpoint change where I accumulation stops
    pidSumLimit: num(500, 50, 2000),
    pidSumLimitYaw: num(400, 50, 2000),
    tpaRate: num(0.65, 0, 1),
    tpaBreakpoint: num(0.35, 0, 1),
    airmode: bool(true),
    angleStrength: num(50, 0, 300),
    angleLimit: num(55, 5, 90),
  }),
  rates: section({
    type: choice(RATE_TYPES, 'actual'),
    // actual: rcRate = centre sensitivity (deg/s), rate = max rate (deg/s)
    // betaflight: rcRate / rate = RC rate / super rate in hundredths
    roll: rateAxis(),
    pitch: rateAxis(),
    yaw: rateAxis(),
    throttleMid: num(0.5, 0, 1),
    throttleExpo: num(0, 0, 1),
    throttleLimit: num(1, 0.1, 1),
  }),
  filters: section({
    gyroLpfHz: num(250, 0, 1000),
    dtermLpfHz: num(100, 0, 1000),
    rcSmoothingHz: num(40, 1, 500),
    gyroNoise: num(1, 0, 10),
  }),
  flight: section({
    mode: choice(FLIGHT_MODES, 'acro'),
    motorIdle: num(0.055, 0, 0.3),
  }),
  physics: section({
    massG: num(650, 5, 5000),
    motorThrustG: num(1450, 1, 10000),
    armLengthMm: num(112, 10, 500),
    inertiaRoll: num(0.0022, 1e-7, 1),
    inertiaPitch: num(0.0028, 1e-7, 1),
    inertiaYaw: num(0.0045, 1e-7, 1),
    motorSpinUpMs: num(22, 1, 1000),
    motorSpinDownMs: num(38, 1, 1000),
    yawTorqueCoef: num(0.018, 0, 1),
    rotorInertia: num(2e-6, 0, 1e-3),
    maxRpm: num(30000, 1000, 200000),
    propPitchSpeed: num(55, 1, 500),
    inflowGain: num(0.6, 0, 5),
    dragFront: num(0.012, 0, 1),
    dragSide: num(0.016, 0, 1),
    dragTop: num(0.045, 0, 1),
    rotorDrag: num(0.1, 0, 10),
    angularDrag: num(0.0004, 0, 1),
    propwash: num(1, 0, 10),
    propInches: num(5.1, 0.5, 30),
    reverseThrust: num(0.45, 0, 1),
    turtlePower: num(0.85, 0, 1),
    windSpeed: num(0, 0, 100),
    windDir: num(45, 0, 360),
    windGust: num(0.3, 0, 1),
    gravity: num(9.81, 0, 100),
    airDensity: num(1.225, 0, 10),
    restitution: num(0.3, 0, 1),
    friction: num(0.35, 0, 2),
    crashEnabled: bool(false),
    crashSpeed: num(12, 0.5, 200),
    battery: bool(true),
    cells: num(6, 1, 12),
    capacityMah: num(1300, 50, 50000),
    internalResistance: num(0.004, 0, 1),
    maxCurrentA: num(140, 1, 1000),
  }),
  camera: section({
    fov: num(120, 30, 179),
    tilt: num(25, -45, 90),
    mode: choice(CAMERA_MODES, 'fpv'),
    showSticks: bool(true),
    showOsd: bool(true),
    showPerf: bool(false),
  }),
  audio: section({
    enabled: bool(true),
    volume: num(0.6, 0, 1),
    motorVolume: num(1, 0, 3),
    windVolume: num(0.6, 0, 3),
  }),
  game: section({
    mode: choice(GAME_MODES, 'practice'),
    track: str('works'),
    laps: num(3, 1, 50),
    ghost: bool(true),
    gatesInFree: bool(false),
  }),
  video: section({
    system: choice(VIDEO_SYSTEMS, 'analog'),
    vtxPower: num(200, 1, 5000),
    fisheye: num(0.35, 0, 2),
    chroma: num(0.5, 0, 4),
    vignette: num(0.55, 0, 1),
    staticAmount: num(1, 0, 4),
    scanlines: num(0.6, 0, 1),
  }),
  graphics: section({
    timeOfDay: choice(TIMES_OF_DAY, 'golden'),
    ibl: bool(true),
    effects: bool(true),
    shadows: bool(true),
    pixelRatio: num(1, 0.25, 4),
    fog: bool(true),
    antialias: bool(true),
  }),
  input: section({
    gamepadIndex: num(0, 0, 16),
    channels: section({ throttle: channel(2), yaw: channel(3), pitch: channel(1), roll: channel(0) }),
    deadband: num(0.01, 0, 0.5),
    arm: switchCfg('axis', 4),
    reset: switchCfg('button', -1, 0.5),
    turtle: switchCfg('none', 6),
    mode: switchCfg('none', 5),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type PidAxisConfig = Config['pid']['roll'];
export type RateAxisConfig = Config['rates']['roll'];
export type ChannelConfig = Config['input']['channels']['roll'];
export type SwitchConfig = Config['input']['arm'];
export type PhysicsConfig = Config['physics'];
export type ChannelName = keyof Config['input']['channels'];
export type Axis = 'roll' | 'pitch' | 'yaw';
export type GameMode = (typeof GAME_MODES)[number];
export type CameraMode = (typeof CAMERA_MODES)[number];
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Validate anything (stored JSON, imported file, partial object) into a complete Config. */
export function parseConfig(input: unknown): Config {
  return ConfigSchema.parse(input);
}

export const DEFAULT_CONFIG: Config = Object.freeze(parseConfig({})) as Config;

// ── Typed dot-paths ────────────────────────────────────────────────────────
type Leaf = string | number | boolean;
export type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`> | `${P}${K}`;
}[keyof T & string];
export type LeafPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : LeafPaths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type ConfigPath = Paths<Config>;
export type ConfigLeafPath = LeafPaths<Config>;
export type PathValue<T, P extends string> = P extends `${infer K}.${infer R}`
  ? K extends keyof T
    ? PathValue<T[K], R>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export function getPath<P extends ConfigPath>(obj: Config, path: P): PathValue<Config, P> {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj) as PathValue<Config, P>;
}

export function setPath<P extends ConfigPath>(obj: Config, path: P, value: PathValue<Config, P>): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as never);
  parent[last] = value;
}
