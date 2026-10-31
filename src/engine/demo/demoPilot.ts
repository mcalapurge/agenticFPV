// Demo autopilot: flies a waypoint route in angle mode and breaks out acro tricks (flips, rolls,
// power loops…) at marked waypoints. It only produces stick positions, exactly like a pilot, so the
// real flight controller and physics do the flying. Pure logic (three.js math only): unit-testable.

import { Quaternion, Vector3 } from 'three';
import { DEFAULT_CONFIG, type CameraMode, type RateAxisConfig } from '../../state/configSchema';
import type { FlightMode, Sticks } from '../sim/flightController';
import { applyRate } from '../sim/rates';

const G = 9.81;
const RAD = Math.PI / 180;

export type TrickName = 'roll' | 'rollLeft' | 'flip' | 'backflip' | 'powerloop' | 'spin' | 'tumble';

export interface Waypoint {
  p: readonly [number, number, number];
  /** Cruise speed on the way to this waypoint (m/s). */
  speed?: number;
  /** Trick performed on arrival. */
  trick?: TrickName;
  /** Arrival radius (m). */
  radius?: number;
}

/** What the pilot needs to know about the quad. */
export interface PilotView {
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  /** Pilot-convention rates, deg/s: roll right, nose down, yaw right. */
  gyro: readonly number[];
}

/** Distance to the first obstacle along a ray, or null. */
export type Probe = (origin: Vector3, dir: Vector3, maxDist: number) => number | null;

export interface PilotCommand extends Sticks {
  armSwitch: boolean;
  mode: FlightMode;
  camera: CameraMode;
  /** Short callout for the HUD ("POWER LOOP"), empty most of the time. */
  caption: string;
}

export interface PilotOptions {
  route: readonly Waypoint[];
  /** Rates the flight controller uses (to turn a wanted deg/s into a stick position). */
  rates?: RateAxisConfig;
  /** Angle-mode tilt limit (deg). */
  angleLimit?: number;
  /** Throttle stick that roughly hovers. */
  hoverThrottle?: number;
  probe?: Probe;
  seed?: number;
}

interface Stage {
  axis: 'roll' | 'pitch';
  dir: 1 | -1;
  stick: number;
  deg: number;
  throttle: number;
}

interface TrickDef {
  caption: string;
  /** Minimum height above whatever is below (m). */
  clearance: number;
  stages?: Stage[];
  /** Yaw-only trick flown in angle mode. */
  yawSpin?: boolean;
}

const TRICKS: Record<TrickName, TrickDef> = {
  roll: { caption: 'ROLL', clearance: 9, stages: [{ axis: 'roll', dir: 1, stick: 1, deg: 360, throttle: 0.5 }] },
  rollLeft: { caption: 'ROLL', clearance: 9, stages: [{ axis: 'roll', dir: -1, stick: 1, deg: 360, throttle: 0.5 }] },
  flip: {
    caption: 'FRONT FLIP',
    clearance: 11,
    stages: [{ axis: 'pitch', dir: 1, stick: 1, deg: 360, throttle: 0.55 }],
  },
  backflip: {
    caption: 'BACKFLIP',
    clearance: 11,
    stages: [{ axis: 'pitch', dir: -1, stick: 1, deg: 360, throttle: 0.55 }],
  },
  powerloop: {
    caption: 'POWER LOOP',
    clearance: 16,
    stages: [{ axis: 'pitch', dir: -1, stick: 0.85, deg: 360, throttle: 0.75 }],
  },
  tumble: {
    caption: 'TUMBLE',
    clearance: 14,
    stages: [
      { axis: 'pitch', dir: 1, stick: 1, deg: 360, throttle: 0.55 },
      { axis: 'roll', dir: 1, stick: 1, deg: 360, throttle: 0.5 },
    ],
  },
  spin: { caption: 'YAW SPIN', clearance: 5, yawSpin: true },
};

type Phase = 'arm' | 'cruise' | 'trick' | 'recover';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Camera cuts, cycled: close chase, orbit, then the pilot's own view. */
const CAMERA_CYCLE: readonly CameraMode[] = ['chase', 'orbit', 'fpv', 'chase', 'orbit', 'fpv'];

export interface PilotStats {
  tricks: Partial<Record<TrickName, number>>;
  skippedTricks: number;
  laps: number;
  evades: number;
}

export class DemoPilot {
  phase: Phase = 'arm';
  index = 0;
  readonly stats: PilotStats = { tricks: {}, skippedTricks: 0, laps: 0, evades: 0 };

  private readonly route: readonly Waypoint[];
  private readonly rates: RateAxisConfig;
  private readonly angleLimit: number;
  private hover: number;
  private speedScale = 1;
  private readonly probe: Probe | null;
  private readonly rng: () => number;

  private clock = 0;
  private phaseTime = 0;
  private liftoff = true;
  private thrI = 0;
  private altBias = 0;
  private evadeUntil = 0;
  private nextProbe = 0;
  private trick: TrickDef | null = null;
  private stage = 0;
  private accum = 0;
  private yawAccum = 0;
  private captionUntil = 0;
  private caption = '';
  private camIndex = 0;
  private camUntil = 0;
  private camHold = 0;
  camera: CameraMode = 'chase';

  private readonly _fwd = new Vector3();
  private readonly _up = new Vector3();
  private readonly _to = new Vector3();
  private readonly _vStar = new Vector3();
  private readonly _a = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _target = new Vector3();

  constructor(opts: PilotOptions) {
    if (opts.route.length < 2) throw new Error('A demo route needs at least two waypoints');
    this.route = opts.route;
    this.rates = opts.rates ?? DEFAULT_CONFIG.rates.yaw;
    this.angleLimit = opts.angleLimit ?? DEFAULT_CONFIG.pid.angleLimit;
    this.hover = opts.hoverThrottle ?? 0.34;
    this.probe = opts.probe ?? null;
    this.rng = mulberry32(opts.seed ?? 1);
  }

  /** Fit the pilot to the airframe being flown (hover throttle, cruise-speed scale). */
  setVehicle(v: { hoverThrottle: number; speedScale: number }): void {
    this.hover = v.hoverThrottle;
    this.speedScale = v.speedScale;
  }

  /** Back to the pad: re-arm and start the route over. */
  reset(): void {
    this.phase = 'arm';
    this.index = 0;
    this.clock = 0;
    this.phaseTime = 0;
    this.liftoff = true;
    this.thrI = 0;
    this.altBias = 0;
    this.evadeUntil = 0;
    this.trick = null;
    this.caption = '';
    this.captionUntil = 0;
    this.camIndex = 0;
    this.camUntil = 0;
    this.camHold = 0;
    this.camera = 'chase';
  }

  get waypoint(): Waypoint {
    return this.route[this.index];
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  /** Stick position for a wanted body rate (deg/s), via the inverse of the rate curve. */
  private stickForRate(rate: number): number {
    const want = Math.abs(rate);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (applyRate('actual', mid, this.rates) < want) lo = mid;
      else hi = mid;
    }
    return Math.sign(rate) * hi;
  }

  update(dt: number, v: PilotView): PilotCommand {
    this.clock += dt;
    this.phaseTime += dt;
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(v.quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(v.quat);

    let cmd: Sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    let mode: FlightMode = 'angle';

    switch (this.phase) {
      case 'arm':
        // Throttle low with the switch on arms the quad; then punch out.
        if (this.phaseTime > 0.6) this.enter('cruise');
        break;

      case 'cruise': {
        this.checkObstacle(v);
        const wp = this.waypoint;
        const target = this._target.set(wp.p[0], Math.max(3, wp.p[1] + this.altBias), wp.p[2]);
        const evading = this.clock < this.evadeUntil;
        cmd = this.guide(v, fwd, up, target, wp.speed ?? 14, evading);
        if (!evading && this.arrived(v, wp)) this.arrive(v, wp);
        break;
      }

      case 'trick': {
        const out = this.flyTrick(dt, v, fwd, up);
        cmd = out.sticks;
        mode = out.mode;
        break;
      }

      case 'recover': {
        // Level out in angle mode and arrest any sink before carrying on.
        const wp = this.waypoint;
        const target = this._target.set(wp.p[0], v.pos.y + 4, wp.p[2]);
        cmd = this.guide(v, fwd, up, target, wp.speed ?? 12, false);
        if (this.phaseTime > 0.7) this.enter('cruise');
        break;
      }
    }

    this.directCamera();
    return {
      ...cmd,
      armSwitch: true,
      mode,
      camera: this.camera,
      caption: this.clock < this.captionUntil ? this.caption : '',
    };
  }

  // ── Route following ─────────────────────────────────────────────────────────

  private arrived(v: PilotView, wp: Waypoint): boolean {
    const d = this._to.set(wp.p[0], wp.p[1] + this.altBias, wp.p[2]).sub(v.pos);
    return d.length() < (wp.radius ?? 7);
  }

  private advance(): void {
    this.index++;
    if (this.index >= this.route.length) {
      this.index = 1; // the first waypoint is the take-off climb
      this.stats.laps++;
    }
  }

  private arrive(v: PilotView, wp: Waypoint): void {
    this.liftoff = false;
    this.altBias = Math.max(0, this.altBias - 4);
    const doTrick = wp.trick && this.canTrick(v, TRICKS[wp.trick]);
    if (wp.trick && !doTrick) this.stats.skippedTricks++;
    this.advance(); // from here on we're already heading for the next waypoint
    if (doTrick && wp.trick) this.startTrick(wp.trick);
  }

  /** Is there enough room (below and ahead) to throw a trick? */
  private canTrick(v: PilotView, def: TrickDef): boolean {
    if (v.pos.y < def.clearance) return false;
    if (!this.probe) return true;
    const down = this._dir.set(0, -1, 0);
    const floor = this.probe(v.pos, down, def.clearance + 4);
    if (floor !== null && floor < def.clearance) return false;
    const speed = v.vel.length();
    if (speed > 1) {
      const ahead = this._dir.copy(v.vel).normalize();
      const wall = this.probe(v.pos, ahead, 22 + speed);
      if (wall !== null) return false;
    }
    return true;
  }

  /** Look ahead along the velocity; if something is in the way, brake and climb over it. */
  private checkObstacle(v: PilotView): void {
    if (!this.probe || this.clock < this.nextProbe || this.liftoff) return;
    this.nextProbe = this.clock + 0.08;
    const speed = v.vel.length();
    if (speed < 2) return;
    const dir = this._dir.copy(v.vel).divideScalar(speed);
    const reach = speed * 1.0 + (speed * speed) / 18 + 3;
    let hit = this.probe(v.pos, dir, reach);
    // The ground only matters when it is close: dives are meant to end near it.
    if (hit !== null && v.pos.y + dir.y * hit < 0.5 && hit > speed * 0.45 + 2.5) hit = null;
    if (hit !== null && this.clock >= this.evadeUntil) {
      this.evadeUntil = this.clock + 1.4;
      this.altBias = Math.min(40, this.altBias + 9);
      this.stats.evades++;
    }
  }

  /**
   * Angle-mode guidance: pick a velocity toward the target, turn the velocity error into a wanted
   * acceleration, and convert that into tilt (roll/pitch sticks), yaw rate and throttle.
   */
  private guide(v: PilotView, fwd: Vector3, up: Vector3, target: Vector3, speed: number, brake: boolean): Sticks {
    const to = this._to.copy(target).sub(v.pos);
    const dist = to.length();
    const vStar = this._vStar;
    if (brake) {
      vStar.set(0, 7, 0); // stop and climb
    } else {
      vStar.copy(to).divideScalar(Math.max(dist, 1e-3));
      // Slow for sharp turns so we don't overshoot the corner.
      const hd = Math.hypot(vStar.x, vStar.z);
      const heading = Math.atan2(-vStar.x, -vStar.z);
      const err = Math.abs(wrapRad(heading - Math.atan2(-fwd.x, -fwd.z)));
      const turnScale = hd < 0.2 ? 1 : clamp(1 - err / Math.PI, 0.45, 1);
      vStar.multiplyScalar(speed * this.speedScale * turnScale);
      vStar.y = clamp(vStar.y, -9, 10);
    }

    // Wanted acceleration (world), with the horizontal part rotated into the heading frame.
    const a = this._a.copy(vStar).sub(v.vel);
    const ah = Math.hypot(a.x, a.z);
    const horizK = 1.8;
    const ahMax = 11;
    const scale = ah * horizK > ahMax ? ahMax / (ah * horizK) : horizK;
    const ax = a.x * scale;
    const az = a.z * scale;
    const azV = clamp(a.y * 3, -8, 9);

    const heading = Math.atan2(-fwd.x, -fwd.z);
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const aF = ax * -sin + az * -cos; // along the nose
    const aR = ax * cos + az * -sin; // to the right

    const climbing = this.liftoff && v.pos.y < 3;
    const tiltF = climbing ? 0 : Math.atan2(aF, G);
    const tiltR = climbing ? 0 : Math.atan2(aR, G);
    const lim = this.angleLimit * RAD;

    // Yaw to face where we're going (the velocity target), unless braking or lifting off.
    let yaw = 0;
    if (!brake && !climbing && Math.hypot(vStar.x, vStar.z) > 1) {
      const wanted = Math.atan2(-vStar.x, -vStar.z);
      const err = wrapRad(wanted - heading); // + = target is to the left
      yaw = this.stickForRate(clamp((-err / RAD) * 3.2, -320, 320));
    }

    // Throttle: hover feed-forward scaled for tilt and wanted vertical acceleration, plus an integrator.
    const cosTilt = clamp(up.y, 0.35, 1);
    const wantedG = clamp((G + azV) / (G * cosTilt), 0.2, 2.6);
    const vzErr = vStar.y - v.vel.y;
    this.thrI = clamp(this.thrI + vzErr * 0.02 * 0.016, -0.12, 0.12);
    const throttle = clamp(this.hover * Math.sqrt(wantedG) + this.thrI, 0, 1);

    return {
      throttle,
      roll: clamp(tiltR / lim, -1, 1),
      pitch: clamp(tiltF / lim, -1, 1),
      yaw: clamp(yaw, -1, 1),
    };
  }

  // ── Tricks ──────────────────────────────────────────────────────────────────

  private startTrick(name: TrickName): void {
    const def = TRICKS[name];
    this.trick = def;
    this.stage = 0;
    this.accum = 0;
    this.yawAccum = 0;
    this.stats.tricks[name] = (this.stats.tricks[name] ?? 0) + 1;
    this.caption = def.caption;
    this.captionUntil = this.clock + 2.6;
    this.camera = 'orbit'; // get in close for the trick
    this.camHold = this.clock + 3.2;
    this.enter('trick');
  }

  private flyTrick(dt: number, v: PilotView, fwd: Vector3, up: Vector3): { sticks: Sticks; mode: FlightMode } {
    const def = this.trick!;
    const hold = this.waypoint;

    if (def.yawSpin) {
      const target = this._target.set(hold.p[0], hold.p[1], hold.p[2]);
      const sticks = this.guide(v, fwd, up, target, hold.speed ?? 12, false);
      sticks.yaw = 1;
      this.yawAccum += Math.abs(v.gyro[2]) * dt;
      if (this.yawAccum >= 330 || this.phaseTime > 1.6) this.finishTrick();
      return { sticks, mode: 'angle' };
    }

    const stage = def.stages![this.stage];
    const idx = stage.axis === 'roll' ? 0 : 1;
    const rate = v.gyro[idx] * stage.dir;
    this.accum += rate * dt;
    // Stop pushing a little early: the quad keeps rotating while the rate decays.
    const lead = clamp(Math.abs(rate) * 0.09, 0, 70);
    const sticks: Sticks = { throttle: stage.throttle, roll: 0, pitch: 0, yaw: 0 };
    sticks[stage.axis] = stage.dir * stage.stick;

    if (this.accum + lead >= stage.deg || this.phaseTime > 2.2) {
      if (this.stage + 1 < def.stages!.length) {
        this.stage++;
        this.accum = 0;
        this.phaseTime = 0;
      } else {
        this.finishTrick();
      }
    }
    return { sticks, mode: 'acro' };
  }

  private finishTrick(): void {
    this.trick = null;
    this.enter('recover');
  }

  // ── Camera director ─────────────────────────────────────────────────────────

  private directCamera(): void {
    if (this.clock < this.camHold || this.clock < this.camUntil) return;
    this.camera = CAMERA_CYCLE[this.camIndex++ % CAMERA_CYCLE.length];
    this.camUntil = this.clock + 6 + this.rng() * 4;
  }
}
