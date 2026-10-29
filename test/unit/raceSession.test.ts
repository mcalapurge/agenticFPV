import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { gateFrame } from '../../src/engine/game/gates';
import { RaceSession, type RecordsApi, type SessionOptions } from '../../src/engine/game/raceSession';
import type { GhostData, TrackRecord } from '../../src/engine/game/tracks';

// Three gates in a line along -Z (yaw 0 = fly north through -Z).
const GATES = [0, -20, -40].map((z) => gateFrame({ p: [0, 2, z], yaw: 0 }));
const ARMED = { armSwitch: true, throttle: 0 };
const Q = new Quaternion();

/** In-memory records with the same semantics as the localStorage version. */
function memoryRecords(): RecordsApi & { rec: TrackRecord | null } {
  const api = {
    rec: null as TrackRecord | null,
    getRecord: () => api.rec,
    submitLap(_t: string, _q: string, lap: number, ghost?: GhostData) {
      api.rec ??= { bestLap: null, races: [] };
      const pb = api.rec.bestLap === null || lap < api.rec.bestLap;
      if (pb) {
        api.rec.bestLap = lap;
        if (ghost) api.rec.ghost = ghost;
      }
      return pb;
    },
    submitRace(_t: string, _q: string, laps: number, total: number, best: number) {
      api.rec ??= { bestLap: null, races: [] };
      api.rec.races.push({ date: '2026-01-01', laps, total, best });
      api.rec.races.sort((a, b) => a.total - b.total);
      return api.rec.races.findIndex((r) => r.total === total) + 1;
    },
  };
  return api;
}

function session(opts: Partial<SessionOptions> = {}) {
  const records = memoryRecords();
  const s = new RaceSession({ mode: 'practice', gates: GATES, laps: 2, trackId: 't', quadId: 'q', records, ...opts });
  return { s, records };
}

/** Fly the quad along z from `from` to `to` at `speed` m/s, ticking at 100 Hz. */
function fly(s: RaceSession, from: number, to: number, speed = 20, x = 0, rc = ARMED) {
  const dt = 0.01;
  const dir = Math.sign(to - from);
  const pos = new Vector3(x, 2, from);
  const prev = pos.clone();
  while ((to - pos.z) * dir > 0) {
    prev.copy(pos);
    pos.z += dir * speed * dt;
    s.update(dt, pos, prev, Q, speed * 3.6, rc);
  }
}

/** One lap: start gate → 2 → 3 → loop back behind the start gate. */
function lap(s: RaceSession, speed = 20) {
  fly(s, 5, -45, speed);
  s.update(0, new Vector3(0, 2, 5), new Vector3(0, 2, 5), Q, 0, ARMED); // teleport back (no crossing)
}

describe('RaceSession — practice', () => {
  it('times laps from the start gate', () => {
    const onLap = vi.fn();
    const { s } = session({ onLap });
    expect(s.timed).toBe(true);
    expect(s.osdText('')).toContain('PRACTICE');
    lap(s);
    expect(s.lapStart).not.toBeNull();
    expect(s.next).toBe(0);
    lap(s, 10);
    expect(s.lapTimes).toHaveLength(1);
    expect(s.lapTimes[0]).toBeGreaterThan(2);
    expect(onLap).toHaveBeenCalledWith(s.lapTimes[0], true);
    expect(s.pb).toBe(s.lapTimes[0]);
  });

  it('records a ghost for PB laps and plays it back', () => {
    const { s, records } = session();
    lap(s);
    lap(s);
    expect(records.rec?.ghost?.samples.length).toBeGreaterThan(8 * 10);
    expect(s.ghost).not.toBeNull();
    // Next lap: ghost pose interpolates along the recorded line.
    fly(s, 5, -10);
    const pos = new Vector3();
    const quat = new Quaternion();
    expect(s.ghostPose(pos, quat)).toBe(true);
    expect(pos.x).toBeCloseTo(0, 1);
    expect(pos.z).toBeLessThan(0);
    expect(pos.z).toBeGreaterThan(-45);
  });

  it('flags a missed gate', () => {
    const { s } = session();
    fly(s, 5, -5); // through gate 1
    // Skip gate 2 by flying around it, then through gate 3.
    s.update(0.01, new Vector3(0, 2, -35), new Vector3(0, 2, -35), Q, 0, ARMED);
    fly(s, -35, -45);
    expect(s.next).toBe(1);
    expect(s.activeMessage).toBe('MISSED GATE 2');
  });

  it('ignores crossings outside the gate opening and in reverse', () => {
    const { s } = session();
    fly(s, 5, -5, 20, 5); // 5 m to the side
    expect(s.lapStart).toBeNull();
    fly(s, -5, 5); // backwards through gate 1
    expect(s.lapStart).toBeNull();
  });

  it('does not time free flight', () => {
    const { s } = session({ mode: 'free' });
    expect(s.timed).toBe(false);
    lap(s);
    expect(s.lapStart).toBeNull();
  });
});

describe('RaceSession — race', () => {
  it('holds arming until the countdown ends, then times holeshot, laps and finish', () => {
    const onFinish = vi.fn();
    const { s } = session({ mode: 'race', onFinish });
    expect(s.phase).toBe('waiting');
    expect(s.allowArm).toBe(false);
    expect(s.osdText('')).toBe('RACE · ARM TO START');

    s.update(0.01, new Vector3(0, 2, 5), new Vector3(0, 2, 5), Q, 0, ARMED);
    expect(s.phase).toBe('countdown');
    expect(s.osdText('')).toBe('3');
    for (let i = 0; i < 310; i++) s.update(0.01, new Vector3(0, 2, 5), new Vector3(0, 2, 5), Q, 0, ARMED);
    expect(s.phase).toBe('running');
    expect(s.allowArm).toBe(true);

    lap(s);
    expect(s.holeshot).toBeGreaterThan(0);
    lap(s);
    lap(s);
    expect(s.phase).toBe('finished');
    expect(onFinish).toHaveBeenCalledOnce();
    const summary = onFinish.mock.calls[0][0];
    expect(summary.laps).toHaveLength(2);
    expect(summary.rank).toBe(1);
    expect(summary.topSpeedKmh).toBeCloseTo(72, 0);
    expect(summary.total).toBeGreaterThan(summary.laps[0] + summary.laps[1]);
  });

  it('aborts the countdown when disarmed', () => {
    const { s } = session({ mode: 'race' });
    s.update(0.01, new Vector3(), new Vector3(), Q, 0, ARMED);
    s.update(0.01, new Vector3(), new Vector3(), Q, 0, { armSwitch: false, throttle: 0 });
    expect(s.phase).toBe('waiting');
  });

  it('will not start the countdown with throttle up', () => {
    const { s } = session({ mode: 'race' });
    s.update(0.01, new Vector3(), new Vector3(), Q, 0, { armSwitch: true, throttle: 0.5 });
    expect(s.phase).toBe('waiting');
  });

  it('shows splits against the PB', () => {
    const { s } = session();
    lap(s);
    lap(s); // PB with splits
    fly(s, 5, -25, 40); // faster through gate 2
    expect(s.activeMessage).toMatch(/^−\d+\.\d\d$/);
  });
});
