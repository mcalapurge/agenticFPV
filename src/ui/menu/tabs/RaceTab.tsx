import { useReducer, useState } from 'react';
import { fmtTime } from '../../../engine/format';
import { getPreset } from '../../../engine/sim/presets';
import { allTracks, getRecord, importTrack, loadUserTracks, saveUserTracks, type Track } from '../../../engine/game/tracks';
import type { GameMode } from '../../../state/configSchema';
import { useConfigStore } from '../../../state/configStore';
import { useSim } from '../../../state/engineStore';
import { toast } from '../../../state/uiStore';
import { Field, Section } from '../fields';
import { downloadJson, pickJsonFile } from '../io';

const MODES: [GameMode, string, string][] = [
  ['free', 'Free fly', 'No gates, no timer — freestyle'],
  ['practice', 'Practice', 'Endless laps, PB ghost, split deltas'],
  ['race', 'Race', 'Countdown, N laps, results & leaderboard'],
  ['editor', 'Track editor', 'Fly around and drop gates with G'],
];

export function RaceTab() {
  const sim = useSim();
  const mode = useConfigStore((s) => s.config.game.mode);
  const quadId = useConfigStore((s) => s.config.quad.preset);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [name, setName] = useState(() => sim?.game.track.name ?? '');
  if (!sim) return null;
  const game = sim.game;
  const current = game.track;

  const selectTrack = (t: Track) => {
    sim.loadTrack(t.id);
    if (mode === 'free') sim.setGameMode('practice');
    else if (mode === 'editor') sim.setGameMode('editor');
    setName(sim.game.track.name);
    refresh();
  };

  const rec = getRecord(current.id, quadId);

  return (
    <>
      <Section title="Mode">
        <div className="cards">
          {MODES.map(([id, label, desc]) => (
            <button
              key={id}
              className={`card${mode === id ? ' active' : ''}`}
              onClick={() => {
                sim.setGameMode(id);
                setName(sim.game.track.name);
                refresh();
              }}
            >
              <b>{label}</b>
              <span>{desc}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Options">
        <div className="grid2">
          <Field kind="number" path="game.laps" label="Race laps" min={1} max={10} step={1} />
          <Field kind="bool" path="game.ghost" label="Show PB ghost" />
          <Field kind="bool" path="game.gatesInFree" label="Gates in free fly" />
        </div>
      </Section>
      {mode === 'editor' && (
        <Section title="Track editor">
          <p className="hint">
            Fly to where you want a gate, point the quad through it and press G (dive gates: point the nose straight
            down). Backspace removes the last gate. Gate 1 is start/finish.
          </p>
          <div className="row">
            <label htmlFor="track-name">Track name</label>
            <input id="track-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            <span />
          </div>
          <button
            className="btn primary"
            onClick={() => {
              game.saveTrack(name.trim() || 'My track');
              refresh();
            }}
          >
            Save track
          </button>{' '}
          <button
            className="btn"
            onClick={() => {
              game.clearGates();
              refresh();
            }}
          >
            Clear gates
          </button>{' '}
          <span className="hint">{current.gates.length} gates</span>
        </Section>
      )}
      <Section title="Tracks">
        <div className="tracklist">
          {allTracks().map((t) => {
            const r = getRecord(t.id, quadId);
            return (
              <div key={t.id} className={`trackrow${t.id === current.id ? ' active' : ''}`} data-testid={`track-${t.id}`}>
                <div>
                  <b>
                    {t.name}
                    {t.user ? ' (custom)' : ''}
                  </b>
                  <small>
                    {t.gates.length} gates · {t.description ?? ''}
                  </small>
                  <small>{r?.bestLap != null ? `PB with this quad: ${fmtTime(r.bestLap)}` : 'No lap set with this quad yet'}</small>
                </div>
                <div className="actions">
                  <button className="btn" onClick={() => selectTrack(t)}>
                    {t.id === current.id ? 'Selected' : 'Select'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => downloadJson(`${t.id}.track.json`, { name: t.name, description: t.description, gates: t.gates })}
                  >
                    Export
                  </button>
                  {t.user && (
                    <button
                      className="btn"
                      onClick={() => {
                        saveUserTracks(loadUserTracks().filter((x) => x.id !== t.id));
                        if (current.id === t.id) sim.loadTrack('works');
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p>
          <button
            className="btn"
            onClick={async () => {
              try {
                const json = await pickJsonFile();
                if (json === undefined) return;
                const t = importTrack(json);
                sim.loadTrack(t.id);
                toast('Track imported ✔');
                refresh();
              } catch (err) {
                toast(`Import failed: ${(err as Error).message}`);
              }
            }}
          >
            Import track JSON
          </button>
        </p>
      </Section>
      <Section title={`Leaderboard · ${current.name} · ${getPreset(quadId).name}`}>
        {rec?.races.length ? (
          <table className="pid">
            <thead>
              <tr>
                <th>#</th>
                <th>Laps</th>
                <th>Total</th>
                <th>Best lap</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rec.races.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.laps}</td>
                  <td>{fmtTime(r.total)}</td>
                  <td>{fmtTime(r.best)}</td>
                  <td>{new Date(r.date).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">No races yet. Switch to Race mode and set a time!</p>
        )}
      </Section>
    </>
  );
}
