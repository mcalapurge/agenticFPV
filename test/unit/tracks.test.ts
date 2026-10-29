// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { gateColliderBoxes, gateFrame } from '../../src/engine/game/gates';
import {
  allTracks,
  BUILTIN_TRACKS,
  findTrack,
  getRecord,
  importTrack,
  loadUserTracks,
  submitLap,
  submitRace,
  TrackSchema,
} from '../../src/engine/game/tracks';

beforeEach(() => localStorage.clear());

describe('tracks', () => {
  it('built-in tracks are valid', () => {
    for (const t of BUILTIN_TRACKS) expect(TrackSchema.safeParse(t).success).toBe(true);
    expect(new Set(BUILTIN_TRACKS.map((t) => t.id)).size).toBe(BUILTIN_TRACKS.length);
  });

  it('imports a valid track as a user track', () => {
    const t = importTrack({ name: 'Mine', gates: [{ p: [0, 2, 0] }, { p: [0, 2, -10], yaw: 90 }] });
    expect(t.user).toBe(true);
    expect(t.id).toMatch(/^user-/);
    expect(t.gates[0].yaw).toBe(0);
    expect(loadUserTracks()).toHaveLength(1);
    expect(allTracks()).toHaveLength(BUILTIN_TRACKS.length + 1);
    expect(findTrack(t.id).name).toBe('Mine');
  });

  it.each([{}, { gates: [] }, { gates: [{ p: [0, 1] }] }, { gates: [{ p: [0, 2, 0], size: -1 }] }, 'x'])(
    'rejects invalid track %j',
    (bad) => {
      expect(() => importTrack(bad)).toThrow();
      expect(loadUserTracks()).toHaveLength(0);
    },
  );

  it('skips corrupt stored user tracks and falls back for unknown ids', () => {
    localStorage.setItem('agenticfpv.tracks.v1', JSON.stringify([{ id: 'u1', gates: [{ p: [0, 2, 0] }] }, { id: 'bad' }, 5]));
    expect(loadUserTracks().map((t) => t.id)).toEqual(['u1']);
    expect(findTrack('missing')).toBe(BUILTIN_TRACKS[0]);
  });
});

describe('records', () => {
  it('keeps the best lap and its ghost', () => {
    expect(submitLap('t', 'q', 20, { samples: [1], splits: [0] })).toBe(true);
    expect(submitLap('t', 'q', 25, { samples: [2], splits: [0] })).toBe(false);
    expect(submitLap('t', 'q', 18)).toBe(true);
    const r = getRecord('t', 'q');
    expect(r?.bestLap).toBe(18);
    expect(r?.ghost?.samples).toEqual([1]); // ghostless PB keeps the old ghost
    expect(getRecord('t', 'other')).toBeNull();
  });

  it('ranks races (more laps first, then faster) and keeps the top 10', () => {
    expect(submitRace('t', 'q', 3, 60, 19)).toBe(1);
    expect(submitRace('t', 'q', 3, 55, 18)).toBe(1);
    expect(submitRace('t', 'q', 2, 30, 14)).toBe(3);
    for (let i = 0; i < 12; i++) submitRace('t', 'q', 3, 70 + i, 20);
    expect(getRecord('t', 'q')?.races).toHaveLength(10);
    expect(getRecord('t', 'q')?.races[0].total).toBe(55);
  });
});

describe('gate geometry', () => {
  it('frames face along yaw and colliders surround the opening', () => {
    const g = { p: [10, 3, -5] as [number, number, number], yaw: 90, size: 2 };
    const f = gateFrame(g);
    expect(f.size).toBe(2);
    const boxes = gateColliderBoxes(g);
    expect(boxes).toHaveLength(4);
    for (const b of boxes) expect(b.center.distanceTo(f.c)).toBeGreaterThan(1);
    // The opening itself is clear.
    expect(boxes.every((b) => b.center.distanceTo(f.c) > 0.5)).toBe(true);
  });
});
