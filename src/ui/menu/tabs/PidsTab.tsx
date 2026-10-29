import { useState } from 'react';
import { applyBetaflightCli } from '../../../engine/sim/bfcli';
import type { Axis, Config } from '../../../state/configSchema';
import { useConfigStore } from '../../../state/configStore';
import { toast } from '../../../state/uiStore';
import { SchemaSections, Section } from '../fields';

const AXES: Axis[] = ['roll', 'pitch', 'yaw'];
const TERMS = ['p', 'i', 'd', 'f'] as const;

function CliImport({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const update = useConfigStore((s) => s.update);
  return (
    <div className="wizard" data-testid="cli-import">
      <p>
        Paste a Betaflight CLI diff to import PIDs, feedforward, TPA, filters, idle, airmode and rates (active profile
        and rate profile are used).
      </p>
      <textarea
        aria-label="Betaflight CLI"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the output of `diff all` (or `dump`) from the Betaflight CLI…"
        className="cli"
      />
      <p>
        <button
          className="btn primary"
          onClick={() => {
            let changes: string[] = [];
            update((d) => void (changes = applyBetaflightCli(d, text)));
            if (!changes.length) {
              setMsg('Nothing recognised — make sure you pasted `set …` lines.');
              return;
            }
            toast(`Imported ${changes.length - 1} settings from Betaflight`);
            onClose();
          }}
        >
          Import
        </button>{' '}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </p>
      {msg && <pre className="hint">{msg}</pre>}
    </div>
  );
}

/** Betaflight-style "simplified tuning" sliders: scale gains relative to the values when the tab opened. */
function MasterSliders() {
  const update = useConfigStore((s) => s.update);
  const [base] = useState(() => structuredClone(useConfigStore.getState().config.pid));
  const [mult, setMult] = useState<Record<string, number>>({});
  const sliders: [string, string, (typeof TERMS)[number][]][] = [
    ['master', 'Master multiplier', ['p', 'i', 'd', 'f']],
    ['pd', 'P & D gain', ['p', 'd']],
    ['ff', 'Feedforward', ['f']],
    ['i', 'I gain', ['i']],
  ];
  return (
    <div className="grid2">
      {sliders.map(([id, label, keys]) => {
        const m = mult[id] ?? 1;
        return (
          <div className="row" key={id}>
            <label htmlFor={`m-${id}`}>{label}</label>
            <input
              id={`m-${id}`}
              type="range"
              min={0.5}
              max={1.6}
              step={0.05}
              value={m}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setMult((s) => ({ ...s, [id]: v }));
                update((d) => {
                  for (const ax of AXES) for (const k of keys) d.pid[ax][k] = Math.round(base[ax][k] * v);
                });
              }}
            />
            <span>{m.toFixed(2)}×</span>
          </div>
        );
      })}
    </div>
  );
}

export function PidsTab() {
  const pid = useConfigStore((s) => s.config.pid);
  const update = useConfigStore((s) => s.update);
  const [cli, setCli] = useState(false);
  const setGain = (ax: Axis, k: keyof Config['pid']['roll'], v: number) => update((d) => void (d.pid[ax][k] = v));
  return (
    <>
      <Section title="Betaflight">
        <button className="btn" onClick={() => setCli(true)}>
          Import from Betaflight CLI…
        </button>
        {cli && <CliImport onClose={() => setCli(false)} />}
      </Section>
      <Section title="PID profile (Betaflight scaling)">
        <table className="pid">
          <thead>
            <tr>
              <th />
              {TERMS.map((t) => (
                <th key={t}>{t === 'f' ? 'FF' : t.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXES.map((ax) => (
              <tr key={ax}>
                <td>{ax.toUpperCase()}</td>
                {TERMS.map((k) => (
                  <td key={k}>
                    <input
                      aria-label={`${ax} ${k}`}
                      type="number"
                      min={0}
                      max={250}
                      step={1}
                      value={pid[ax][k]}
                      onChange={(e) => setGain(ax, k, parseFloat(e.target.value) || 0)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Numbers use Betaflight’s internal scaling, so a real tune is a good starting point. Press B in flight to show
          the setpoint-vs-gyro trace.
        </p>
      </Section>
      <Section title="Simplified tuning">
        <MasterSliders />
      </Section>
      <SchemaSections
        sections={[
          {
            title: 'Flight mode',
            fields: [
              {
                kind: 'select',
                path: 'flight.mode',
                label: 'Mode',
                options: { acro: 'Acro (rate)', angle: 'Angle (self-level)' },
              },
              { kind: 'number', path: 'pid.angleStrength', label: 'Angle strength', min: 10, max: 200, step: 1 },
              { kind: 'number', path: 'pid.angleLimit', label: 'Angle limit', unit: '°', min: 10, max: 85, step: 1 },
            ],
          },
          {
            title: 'PID controller settings',
            fields: [
              { kind: 'bool', path: 'pid.airmode', label: 'Airmode' },
              { kind: 'bool', path: 'pid.itermRelax', label: 'I-term relax' },
              {
                kind: 'number',
                path: 'pid.itermRelaxCutoff',
                label: 'I-term relax threshold',
                unit: '°/s',
                min: 5,
                max: 200,
                step: 1,
              },
              { kind: 'number', path: 'pid.iTermLimit', label: 'I-term limit', min: 50, max: 500, step: 5 },
              { kind: 'number', path: 'pid.pidSumLimit', label: 'PID sum limit', min: 100, max: 1000, step: 10 },
              { kind: 'number', path: 'pid.pidSumLimitYaw', label: 'PID sum limit yaw', min: 100, max: 1000, step: 10 },
              { kind: 'number', path: 'pid.tpaRate', label: 'TPA rate', min: 0, max: 1, step: 0.01 },
              { kind: 'number', path: 'pid.tpaBreakpoint', label: 'TPA breakpoint', min: 0, max: 1, step: 0.01 },
            ],
          },
        ]}
      />
    </>
  );
}
