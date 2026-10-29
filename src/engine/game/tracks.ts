// Race tracks: built-in layouts on the Abandoned Works map + user tracks from the editor.
// Gate: { p: [x, y, z], yaw: deg (0 = fly north / -Z, 90 = fly west / -X), pitch: deg (-90 = dive), size: inner m }

import { z } from 'zod';

const STORAGE_KEY = 'agenticfpv.tracks.v1';
const REC_KEY = 'agenticfpv.records.v1';

export const GateSchema = z.object({
  p: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number().default(0),
  pitch: z.number().optional(),
  size: z.number().positive().optional(),
});

export const TrackSchema = z.object({
  id: z.string().optional(),
  name: z.string().default('Imported track'),
  description: z.string().default(''),
  gates: z.array(GateSchema).min(1),
});

export type Gate = z.infer<typeof GateSchema>;

export interface Track {
  id: string;
  name: string;
  description?: string;
  gates: Gate[];
  user?: boolean;
}

export const BUILTIN_TRACKS: readonly Track[] = [
  {
    id: 'works',
    name: 'Works Circuit',
    description:
      'Full-map lap: warehouse run, pipe bridge, smokestack, tower-top drop, skeleton floor 2, container yard.',
    gates: [
      { p: [0, 1.8, 38], yaw: 0 },
      { p: [10, 3, -25], yaw: -90 },
      { p: [40, 3.5, -25], yaw: -90 },
      { p: [75, 12, -48], yaw: 0 },
      { p: [30, 8, -78], yaw: 90 },
      { p: [-5, 34, -66], yaw: 180 },
      { p: [-40, 5.2, -20], yaw: 180 },
      { p: [-44, 3.6, 34], yaw: 180 },
      { p: [-15, 2, 52], yaw: -90 },
    ],
  },
  {
    id: 'warehouse',
    name: 'Warehouse Sprint',
    description: 'Short and technical: in the west door, slalom between the racking, out east, over the pipe bridge.',
    gates: [
      { p: [0, 2, 40], yaw: 0 },
      { p: [10, 3, -25], yaw: -90 },
      { p: [25, 3.3, -20], yaw: -90 },
      { p: [35, 3.3, -30], yaw: -90 },
      { p: [48, 3.3, -20], yaw: -90 },
      { p: [72, 3, -25], yaw: -90 },
      { p: [66, 9.5, -50], yaw: 0 },
      { p: [52, 4, -80], yaw: 90 },
      { p: [15, 3, -5], yaw: 180 },
    ],
  },
  {
    id: 'tower',
    name: 'Tower Dive',
    description: 'Climb the tower, drop through the dive gate down its east face, thread skeleton floor 3.',
    gates: [
      { p: [0, 3, 30], yaw: 0 },
      { p: [6, 14, -45], yaw: 0, pitch: 25 },
      { p: [7, 34, -75], yaw: 0, pitch: -90 },
      { p: [8, 4, -55], yaw: 180 },
      { p: [-40, 9, -22.5], yaw: 90 },
      { p: [-44, 3.6, 34], yaw: 180 },
      { p: [-15, 2, 52], yaw: -90 },
    ],
  },
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadUserTracks(): Track[] {
  const list = readJson<unknown[]>(STORAGE_KEY, []);
  return list.flatMap((t) => {
    const r = TrackSchema.safeParse(t);
    return r.success && r.data.id ? [{ ...r.data, id: r.data.id }] : [];
  });
}

export function saveUserTracks(tracks: Track[]): void {
  writeJson(
    STORAGE_KEY,
    tracks.map(({ user: _user, ...t }) => t),
  );
}

/** Validate an imported track file and store it as a new user track. Throws on invalid input. */
export function importTrack(json: unknown): Track {
  const t = TrackSchema.parse(json);
  const track: Track = { ...t, id: `user-${Date.now().toString(36)}`, user: true };
  saveUserTracks([...loadUserTracks(), track]);
  return track;
}

export function allTracks(): Track[] {
  return [...BUILTIN_TRACKS, ...loadUserTracks().map((t) => ({ ...t, user: true }))];
}

export function findTrack(id: string): Track {
  return allTracks().find((t) => t.id === id) ?? BUILTIN_TRACKS[0];
}

// ── Records / leaderboards ────────────────────────────────────────────────

export interface GhostData {
  samples: number[]; // [t, px, py, pz, qx, qy, qz, qw] × n
  splits: number[];
}

export interface RaceRecord {
  date: string;
  laps: number;
  total: number;
  best: number;
}

export interface TrackRecord {
  bestLap: number | null;
  races: RaceRecord[];
  ghost?: GhostData;
}

type Records = Record<string, Record<string, TrackRecord>>;

export function loadRecords(): Records {
  return readJson<Records>(REC_KEY, {});
}

function saveRecords(r: Records): void {
  if (writeJson(REC_KEY, r)) return;
  // Quota exceeded: drop ghosts first.
  for (const t of Object.values(r)) for (const q of Object.values(t)) delete q.ghost;
  writeJson(REC_KEY, r);
}

export function getRecord(trackId: string, quadId: string): TrackRecord | null {
  return loadRecords()[trackId]?.[quadId] ?? null;
}

function recordFor(r: Records, trackId: string, quadId: string): TrackRecord {
  r[trackId] ??= {};
  return (r[trackId][quadId] ??= { bestLap: null, races: [] });
}

/** Store a lap (and its ghost if it's a PB). Returns true if it was a personal best. */
export function submitLap(trackId: string, quadId: string, lapTime: number, ghost?: GhostData): boolean {
  const r = loadRecords();
  const rec = recordFor(r, trackId, quadId);
  const pb = rec.bestLap === null || lapTime < rec.bestLap;
  if (pb) {
    rec.bestLap = lapTime;
    if (ghost) rec.ghost = ghost;
  }
  saveRecords(r);
  return pb;
}

/** Store a finished race; returns its 1-based rank among the stored top 10 (0 if it didn't place). */
export function submitRace(trackId: string, quadId: string, laps: number, total: number, best: number): number {
  const r = loadRecords();
  const rec = recordFor(r, trackId, quadId);
  rec.races.push({ date: new Date().toISOString(), laps, total, best });
  rec.races.sort((a, b) => (a.laps === b.laps ? a.total - b.total : b.laps - a.laps));
  rec.races = rec.races.slice(0, 10);
  saveRecords(r);
  return rec.races.findIndex((x) => x.total === total) + 1;
}
