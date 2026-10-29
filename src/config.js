// Central configuration: defaults, persistence and helpers.
// Every tunable in the sim lives here so the settings UI can bind to it generically.

const STORAGE_KEY = 'agenticfpv.config.v1';

export const DEFAULT_CONFIG = {
  quad: { preset: 'freestyle5' },
  // Betaflight-style PID profile. Units/scaling match Betaflight (P/I/D/FF numbers are interchangeable).
  pid: {
    roll: { p: 45, i: 80, d: 40, f: 120 },
    pitch: { p: 47, i: 84, d: 46, f: 125 },
    yaw: { p: 45, i: 80, d: 0, f: 120 },
    iTermLimit: 400, // max |I| contribution (BF units)
    itermRelax: true,
    itermRelaxCutoff: 40, // deg/s of setpoint change where I accumulation stops
    pidSumLimit: 500, // roll/pitch pidsum limit
    pidSumLimitYaw: 400,
    tpaRate: 0.65, // fraction PID attenuation at full throttle
    tpaBreakpoint: 0.35, // throttle where TPA begins (0..1)
    airmode: true,
    angleStrength: 50, // angle-mode level gain
    angleLimit: 55, // deg
  },
  rates: {
    type: 'actual', // 'actual' | 'betaflight'
    roll: { rcRate: 70, rate: 670, expo: 0.54 }, // actual: center sens (deg/s), max (deg/s), expo
    pitch: { rcRate: 70, rate: 670, expo: 0.54 },
    yaw: { rcRate: 70, rate: 670, expo: 0.54 },
    // When type === 'betaflight' the same fields mean: rcRate (x0.01), superRate (x0.01), expo
    throttleMid: 0.5,
    throttleExpo: 0.0,
    throttleLimit: 1.0,
  },
  filters: {
    gyroLpfHz: 250,
    dtermLpfHz: 100,
    rcSmoothingHz: 40,
    gyroNoise: 1.0, // multiplier on simulated motor vibration seen by gyro
  },
  flight: {
    mode: 'acro', // 'acro' | 'angle'
    motorIdle: 0.055,
  },
  physics: {
    massG: 650, // all-up weight including battery
    motorThrustG: 1450, // max static thrust per motor (grams-force)
    armLengthMm: 112, // centre to motor (diagonal)
    inertiaRoll: 0.0022, // kg·m²
    inertiaPitch: 0.0028,
    inertiaYaw: 0.0045,
    motorSpinUpMs: 22, // first-order time constant
    motorSpinDownMs: 38,
    yawTorqueCoef: 0.018, // reaction torque per unit thrust (m)
    rotorInertia: 2.0e-6, // motor bell + prop (kg·m²)
    maxRpm: 30000,
    propPitchSpeed: 55, // m/s at full rpm (inflow → thrust loss)
    inflowGain: 0.6,
    dragFront: 0.012, // Cd·A (m²) along each body axis
    dragSide: 0.016,
    dragTop: 0.045,
    rotorDrag: 0.10, // linear "H-force" drag (N per m/s), scaled by thrust
    angularDrag: 0.0004,
    propwash: 1.0,
    propInches: 5.1,
    reverseThrust: 0.45, // reversed-prop thrust efficiency (turtle mode)
    turtlePower: 0.85,
    windSpeed: 0, // m/s
    windDir: 45, // deg, direction the wind blows from
    windGust: 0.3, // 0..1 turbulence
    gravity: 9.81,
    airDensity: 1.225,
    restitution: 0.3,
    friction: 0.35,
    crashEnabled: false,
    crashSpeed: 12,
    battery: true,
    cells: 6,
    capacityMah: 1300,
    internalResistance: 0.004, // ohm per cell
    maxCurrentA: 140, // total current at full throttle (all motors)
  },
  camera: {
    fov: 120, // horizontal FOV (deg)
    tilt: 25, // uptilt (deg)
    mode: 'fpv', // 'fpv' | 'chase' | 'los'
    showSticks: true,
    showOsd: true,
    showPerf: false, // FPS / frame-time / GPU readout (F)
  },
  audio: {
    enabled: true,
    volume: 0.6,
    motorVolume: 1.0,
    windVolume: 0.6,
  },
  game: {
    mode: 'practice', // 'free' | 'practice' | 'race' | 'editor'
    track: 'works',
    laps: 3,
    ghost: true,
    gatesInFree: false,
  },
  video: {
    system: 'analog', // 'analog' | 'digital' | 'clean'
    vtxPower: 200, // mW → range
    fisheye: 0.35,
    chroma: 0.5,
    vignette: 0.55,
    staticAmount: 1.0,
    scanlines: 0.6,
  },
  graphics: {
    timeOfDay: 'golden',
    ibl: true,
    effects: true, // prop-wash dust, crash debris, grass reacting to wash
    shadows: true,
    pixelRatio: 1,
    fog: true,
    antialias: true,
  },
  input: {
    // Channel mapping. axis = gamepad axis index. min/center/max = raw calibration values.
    gamepadIndex: 0,
    channels: {
      throttle: { axis: 2, invert: false, min: -1, center: 0, max: 1 },
      yaw: { axis: 3, invert: false, min: -1, center: 0, max: 1 },
      pitch: { axis: 1, invert: false, min: -1, center: 0, max: 1 },
      roll: { axis: 0, invert: false, min: -1, center: 0, max: 1 },
    },
    deadband: 0.01,
    // Arm switch: { type: 'axis'|'button'|'none', index, threshold, invert }
    arm: { type: 'axis', index: 4, threshold: 0.3, invert: false, toggle: false },
    reset: { type: 'button', index: -1 },
    turtle: { type: 'none', index: 6, threshold: 0.3, invert: false, toggle: false }, // crash-flip switch
    mode: { type: 'none', index: 5, threshold: 0.3, invert: false, toggle: false }, // angle-mode switch
  },
};

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Recursively fills missing keys in `target` from `defaults` (keeps user values). */
export function deepMerge(defaults, target) {
  const out = Array.isArray(defaults) ? [] : {};
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    const t = target?.[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = deepMerge(d, t ?? {});
    else out[k] = t !== undefined && typeof t === typeof d ? t : d;
  }
  return out;
}

export function loadConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return deepClone(DEFAULT_CONFIG);
}

export function saveConfig(cfg) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
}
