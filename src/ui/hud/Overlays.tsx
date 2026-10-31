// Toasts, loading screen, GPU warning and race results.

import { fmtTime } from '../../engine/format';
import { useUiStore } from '../../state/uiStore';
import { useTouchEnabled } from '../hooks';

export function Toasts() {
  const toast = useUiStore((s) => s.toasts.at(-1));
  const touch = useTouchEnabled();
  return (
    // With touch controls the top corners hold buttons and readouts, so the toast sits lower.
    <div
      id="toast"
      role="status"
      aria-live="polite"
      className={`${toast ? 'show' : ''}${touch ? ' touch' : ''}`.trim()}
    >
      {toast?.message}
    </div>
  );
}

export function Loading() {
  const loading = useUiStore((s) => s.loading);
  if (loading === null) return null;
  return (
    <div id="loading" data-testid="loading">
      {loading}
    </div>
  );
}

export function GpuWarning() {
  const gpu = useUiStore((s) => s.gpu);
  const dismissed = useUiStore((s) => s.gpuWarningDismissed);
  const dismiss = useUiStore((s) => s.dismissGpuWarning);
  const screen = useUiStore((s) => s.screen);
  const onTitle = screen === 'title';
  if (!gpu?.software || dismissed || screen === 'demo') return null;
  return (
    <div id="gpuwarn" role="alert" className={onTitle ? 'at-bottom' : undefined}>
      <b>Hardware acceleration is off.</b> Your browser is rendering with <code>{gpu.name}</code> (software), so the sim
      will be slow. Enable it in Chrome/Edge: <i>Settings → System → Use graphics acceleration when available</i>, then
      restart. Check <code>chrome://gpu</code> shows “WebGL: Hardware accelerated”. On laptops, set the browser to the
      high-performance GPU.
      <button className="btn" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function Results() {
  const r = useUiStore((s) => s.results);
  if (!r) return null;
  const best = Math.min(...r.laps);
  return (
    <div id="results" data-testid="results">
      <div className="results-card">
        <h2>Race complete</h2>
        <p className="sub">
          {r.trackName} · {r.quadName}
        </p>
        <div className="big">{fmtTime(r.total)}</div>
        <table>
          <tbody>
            {r.holeshot !== null && (
              <tr>
                <td>Holeshot</td>
                <td>{r.holeshot.toFixed(2)}s</td>
              </tr>
            )}
            {r.laps.map((t, i) => (
              <tr key={i} className={t === best ? 'best' : undefined}>
                <td>Lap {i + 1}</td>
                <td>{fmtTime(t)}</td>
              </tr>
            ))}
            <tr>
              <td>Top speed</td>
              <td>{r.topSpeedKmh.toFixed(0)} km/h</td>
            </tr>
          </tbody>
        </table>
        <h3>Your best races</h3>
        <table className="board">
          <thead>
            <tr>
              <th />
              <th>Total</th>
              <th>Best lap</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {r.board.map((row, i) => (
              <tr key={i} className={i + 1 === r.rank ? 'best' : undefined}>
                <td>#{i + 1}</td>
                <td>{fmtTime(row.total)}</td>
                <td>{fmtTime(row.best)}</td>
                <td>{new Date(row.date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub">
          Press <kbd>R</kbd> to race again · <kbd>P</kbd> to watch the replay
        </p>
      </div>
    </div>
  );
}
