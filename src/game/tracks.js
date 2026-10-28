// Race tracks: built-in layouts on the Abandoned Works map + user tracks from the editor.
// Gate: { p: [x, y, z], yaw: deg (0 = fly north / -Z, 90 = fly west / -X), pitch: deg (-90 = dive), size: inner m }

const STORAGE_KEY = 'agenticfpv.tracks.v1';

export const BUILTIN_TRACKS = [
  {
    id: 'works',
    name: 'Works Circuit',
    description: 'Full-map lap: warehouse run, pipe bridge, smokestack, tower-top drop, skeleton floor 2, container yard.',
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

export function loadUserTracks() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveUserTracks(tracks) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    /* ignore */
  }
}

export function allTracks() {
  return [...BUILTIN_TRACKS, ...loadUserTracks().map((t) => ({ ...t, user: true }))];
}

export function findTrack(id) {
  return allTracks().find((t) => t.id === id) || BUILTIN_TRACKS[0];
}

// ── Records / leaderboards ────────────────────────────────────────────────
const REC_KEY = 'agenticfpv.records.v1';

export function loadRecords() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(REC_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveRecords(r) {
  try {
    globalThis.localStorage?.setItem(REC_KEY, JSON.stringify(r));
  } catch {
    /* quota: drop ghosts first */
    for (const t of Object.values(r)) for (const q of Object.values(t)) delete q.ghost;
    try { globalThis.localStorage?.setItem(REC_KEY, JSON.stringify(r)); } catch { /* give up */ }
  }
}

export function getRecord(trackId, quadId) {
  return loadRecords()?.[trackId]?.[quadId] || null;
}

/** Store a lap (and its ghost if it's a PB). Returns true if it was a personal best. */
export function submitLap(trackId, quadId, lapTime, ghost) {
  const r = loadRecords();
  r[trackId] ??= {};
  const rec = (r[trackId][quadId] ??= { bestLap: null, races: [] });
  const pb = rec.bestLap === null || lapTime < rec.bestLap;
  if (pb) {
    rec.bestLap = lapTime;
    if (ghost) rec.ghost = ghost;
  }
  saveRecords(r);
  return pb;
}

export function submitRace(trackId, quadId, laps, total, best) {
  const r = loadRecords();
  r[trackId] ??= {};
  const rec = (r[trackId][quadId] ??= { bestLap: null, races: [] });
  rec.races.push({ date: new Date().toISOString(), laps, total, best });
  rec.races.sort((a, b) => a.laps === b.laps ? a.total - b.total : b.laps - a.laps);
  rec.races = rec.races.slice(0, 10);
  saveRecords(r);
  return rec.races.findIndex((x) => x.total === total) + 1;
}
