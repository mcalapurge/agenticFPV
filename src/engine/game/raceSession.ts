// Lap timing / race state machine. Pure logic (three.js math only), so it is unit-testable.
// Handles: race countdown, holeshot, gate order, missed gates, splits vs PB, ghost recording,
// lap completion, finishing and record submission.

import { Quaternion, Vector3 } from 'three';
import type { GameMode } from '../../state/configSchema';
import { fmtTime } from '../format';
import type { GateFrame } from './gates';
import { getRecord, submitLap, submitRace, type GhostData, type TrackRecord } from './tracks';

export type RacePhase = 'waiting' | 'countdown' | 'running' | 'finished';

/** Persistence used by the session (swappable in tests). */
export interface RecordsApi {
  getRecord(trackId: string, quadId: string): TrackRecord | null;
  submitLap(trackId: string, quadId: string, lapTime: number, ghost?: GhostData): boolean;
  submitRace(trackId: string, quadId: string, laps: number, total: number, best: number): number;
}

export const localRecords: RecordsApi = { getRecord, submitLap, submitRace };

export interface RaceSummary {
  total: number;
  holeshot: number | null;
  laps: number[];
  topSpeedKmh: number;
  rank: number;
  board: { total: number; best: number; date: string }[];
}

export interface SessionOptions {
  mode: GameMode;
  gates: GateFrame[];
  laps: number;
  trackId: string;
  quadId: string;
  records?: RecordsApi;
  onLap?: (time: number, pb: boolean) => void;
  onFinish?: (summary: RaceSummary) => void;
}

export interface RcSwitches {
  armSwitch: boolean;
  throttle: number;
}

const GHOST_RATE = 30; // samples per second

export class RaceSession {
  readonly mode: GameMode;
  readonly gates: GateFrame[];
  readonly laps: number;
  clock = 0;
  phase: RacePhase;
  countdown = 0;
  next = 0;
  lapStart: number | null = null;
  lapTimes: number[] = [];
  splits: number[] = [];
  raceStart: number | null = null;
  holeshot: number | null = null;
  topSpeed = 0;
  pb: number | null = null;
  pbSplits: number[] | null = null;
  ghost: number[] | null = null;
  message = '';
  messageUntil = 0;

  private recording: number[] = [];
  private lastRecord = -1;
  private readonly opts: SessionOptions;
  private readonly records: RecordsApi;
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _qa = new Quaternion();
  private readonly _qb = new Quaternion();

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.mode = opts.mode;
    this.gates = opts.gates;
    this.laps = opts.laps;
    this.records = opts.records ?? localRecords;
    this.phase = opts.mode === 'race' ? 'waiting' : 'running';
    this.loadPb();
  }

  /** Lap timing only runs in practice and race modes. */
  get timed(): boolean {
    return (this.mode === 'practice' || this.mode === 'race') && this.gates.length > 0;
  }

  /** Whether the flight controller may arm right now (race countdown holds it). */
  get allowArm(): boolean {
    return !(this.mode === 'race' && (this.phase === 'waiting' || this.phase === 'countdown'));
  }

  loadPb(): void {
    const rec = this.records.getRecord(this.opts.trackId, this.opts.quadId);
    this.pb = rec?.bestLap ?? null;
    this.pbSplits = rec?.ghost?.splits ?? null;
    this.ghost = rec?.ghost?.samples?.length ? rec.ghost.samples : null;
  }

  flash(msg: string, secs = 2): void {
    this.message = msg;
    this.messageUntil = this.clock + secs;
  }

  get activeMessage(): string {
    return this.clock < this.messageUntil ? this.message : '';
  }

  update(dt: number, pos: Vector3, prevPos: Vector3, quat: Quaternion, speedKmh: number, rc: RcSwitches): void {
    this.clock += dt;
    this.topSpeed = Math.max(this.topSpeed, speedKmh);

    if (this.mode === 'race') {
      if (this.phase === 'waiting' && rc.armSwitch && rc.throttle < 0.05) {
        this.phase = 'countdown';
        this.countdown = 3;
      } else if (this.phase === 'countdown') {
        if (!rc.armSwitch) this.phase = 'waiting';
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.phase = 'running';
          this.raceStart = this.clock;
          this.flash('GO!', 1);
        }
      }
    }

    if (this.timed && this.phase === 'running') {
      this.checkGates(pos, prevPos);
      this.recordGhost(pos, quat);
    }
  }

  /** Did the segment prev→pos pass through gate i in its forward (-Z) direction? */
  crossed(i: number, prevPos: Vector3, pos: Vector3): boolean {
    const g = this.gates[i];
    const a = this._a.copy(prevPos).sub(g.c).applyQuaternion(g.qi);
    const b = this._b.copy(pos).sub(g.c).applyQuaternion(g.qi);
    if (!(a.z > 0 && b.z <= 0)) return false;
    const t = a.z / (a.z - b.z);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const lim = g.size / 2 + 0.12;
    return Math.abs(x) < lim && Math.abs(y) < lim;
  }

  private checkGates(pos: Vector3, prevPos: Vector3): void {
    const n = this.gates.length;
    if (this.crossed(this.next, prevPos, pos)) {
      const i = this.next;
      const now = this.clock;
      if (i === 0) {
        if (this.lapStart !== null) this.completeLap(now - this.lapStart);
        else if (this.mode === 'race' && this.raceStart !== null) {
          this.holeshot = now - this.raceStart;
          this.flash(`HOLESHOT ${this.holeshot.toFixed(2)}`, 2);
        }
        if (this.phase === 'finished') return;
        this.lapStart = now;
        this.splits = [0];
        this.recording = [];
        this.lastRecord = -1;
      } else if (this.lapStart !== null) {
        const split = now - this.lapStart;
        this.splits[i] = split;
        const pbSplit = this.pbSplits?.[i];
        if (pbSplit !== undefined && pbSplit !== null) {
          const d = split - pbSplit;
          this.flash(`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`, 1.5);
        }
      }
      this.next = (i + 1) % n;
      return;
    }
    // Flew through a later gate → missed one.
    for (let k = 1; k < n; k++) {
      if (this.crossed((this.next + k) % n, prevPos, pos)) {
        this.flash(`MISSED GATE ${this.next + 1}`, 1.5);
        break;
      }
    }
  }

  private completeLap(lap: number): void {
    this.lapTimes.push(lap);
    const pb = this.records.submitLap(this.opts.trackId, this.opts.quadId, lap, {
      samples: this.recording,
      splits: this.splits,
    });
    if (pb) this.loadPb();
    this.flash(`LAP ${this.lapTimes.length}  ${fmtTime(lap)}${pb ? '  PB!' : ''}`, 2.5);
    this.opts.onLap?.(lap, pb);
    if (this.mode === 'race' && this.lapTimes.length >= this.laps) this.finish();
  }

  private finish(): void {
    this.phase = 'finished';
    const total = this.clock - (this.raceStart ?? 0);
    const best = Math.min(...this.lapTimes);
    const rank = this.records.submitRace(this.opts.trackId, this.opts.quadId, this.lapTimes.length, total, best);
    const rec = this.records.getRecord(this.opts.trackId, this.opts.quadId);
    this.opts.onFinish?.({
      total,
      holeshot: this.holeshot,
      laps: [...this.lapTimes],
      topSpeedKmh: this.topSpeed,
      rank,
      board: (rec?.races ?? []).map((r) => ({ total: r.total, best: r.best, date: r.date })),
    });
  }

  private recordGhost(pos: Vector3, q: Quaternion): void {
    if (this.lapStart === null) return;
    const t = this.clock - this.lapStart;
    if (t - this.lastRecord < 1 / GHOST_RATE) return;
    this.lastRecord = t;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.recording.push(r3(t), r2(pos.x), r2(pos.y), r2(pos.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w));
  }

  /** Interpolated PB ghost pose at the current lap time; returns false when there is nothing to show. */
  ghostPose(outPos: Vector3, outQuat: Quaternion): boolean {
    const g = this.ghost;
    if (!g || this.lapStart === null || !this.timed || this.phase === 'finished') return false;
    const t = this.clock - this.lapStart;
    const n = g.length / 8;
    if (n < 2 || t > g[(n - 1) * 8]) return false;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g[mid * 8] <= t) lo = mid;
      else hi = mid;
    }
    const a = lo * 8;
    const b = hi * 8;
    const f = Math.min(1, Math.max(0, (t - g[a]) / Math.max(1e-6, g[b] - g[a])));
    outPos.set(g[a + 1] + (g[b + 1] - g[a + 1]) * f, g[a + 2] + (g[b + 2] - g[a + 2]) * f, g[a + 3] + (g[b + 3] - g[a + 3]) * f);
    this._qa.set(g[a + 4], g[a + 5], g[a + 6], g[a + 7]).normalize();
    this._qb.set(g[b + 4], g[b + 5], g[b + 6], g[b + 7]).normalize();
    outQuat.slerpQuaternions(this._qa, this._qb, f);
    return true;
  }

  /** OSD lines (lap clock, gate count, last/PB, transient message). */
  osdText(pointer: string): string {
    if (this.mode === 'free' || this.mode === 'editor') return this.activeMessage;
    const lines: string[] = [];
    if (this.mode === 'race') {
      if (this.phase === 'waiting') return 'RACE · ARM TO START';
      if (this.phase === 'countdown') return `${Math.ceil(this.countdown)}`;
      const clock = this.phase === 'finished' || this.raceStart === null ? '' : `RACE ${fmtTime(this.clock - this.raceStart)}  `;
      lines.push(`${clock}LAP ${Math.min(this.lapTimes.length + 1, this.laps)}/${this.laps}`);
    } else {
      lines.push(this.lapStart !== null ? `LAP ${fmtTime(this.clock - this.lapStart)}` : 'PRACTICE · FLY THROUGH START');
    }
    const parts = [`GATE ${this.next + 1}/${this.gates.length}`, pointer];
    if (this.lapTimes.length) parts.push(`LAST ${fmtTime(this.lapTimes[this.lapTimes.length - 1])}`);
    if (this.pb !== null) parts.push(`PB ${fmtTime(this.pb)}`);
    lines.push(parts.filter(Boolean).join('  '));
    const m = this.activeMessage;
    if (m) lines.push(m);
    return lines.join('\n');
  }
}
