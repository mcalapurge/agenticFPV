import { useState } from 'react';
import { CalibrationWizard, CHANNELS, INPUT_PRESETS, type WizardOutcome } from '../../../engine/input/input';
import { SWITCH_TYPES, type ChannelConfig, type Config, type SwitchConfig } from '../../../state/configSchema';
import { useConfigStore } from '../../../state/configStore';
import { useSim } from '../../../state/engineStore';
import { toast } from '../../../state/uiStore';
import { useFrameTick, useSimFrame } from '../../hooks';
import { Field, Section } from '../fields';

function Bar({
  name,
  value,
  centered = true,
  danger = false,
}: {
  name: string;
  value: number;
  centered?: boolean;
  danger?: boolean;
}) {
  // centered: value -1..1 drawn from the middle; otherwise 0..1 from the left.
  const x = centered ? (value + 1) / 2 : value;
  const style = centered
    ? { left: `${Math.min(x, 0.5) * 100}%`, width: `${Math.abs(x - 0.5) * 100}%` }
    : { left: '0%', width: `${x * 100}%`, background: danger ? 'var(--bad)' : undefined };
  return (
    <div className="bar" data-testid={`bar-${name}`}>
      <span>{name}</span>
      <div className="track">
        <div className="mid" />
        <div className="fill" style={style} />
      </div>
      <span>{centered ? value.toFixed(2) : `${(value * 100).toFixed(0)}%`}</span>
    </div>
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const sim = useSim();
  const update = useConfigStore((s) => s.update);
  // The wizard is a mutable state machine; keep one instance for the component's lifetime.
  const [w] = useState(() => new CalibrationWizard());
  const [outcome, setOutcome] = useState<WizardOutcome>(() => ({ kind: 'step', step: w.step, index: 0 }));
  useSimFrame((s) => w.track(s.input.getGamepad()));
  if (!sim || outcome.kind === 'done') return null;
  const next = (skip = false) => {
    const o = w.next(sim.input.getGamepad(), skip);
    if (o.kind === 'done') {
      update((d) => {
        Object.assign(d.input.channels, o.result.channels);
        if (o.result.arm) d.input.arm = o.result.arm;
      });
      toast('Calibration saved ✔');
      onClose();
    }
    setOutcome(o);
  };
  return (
    <div className="wizard" data-testid="wizard">
      <p>
        <b>
          Step {Math.min(outcome.index + 1, w.total)}/{w.total}:{' '}
        </b>
        {outcome.step.text}
        {outcome.warning && <span> ⚠ {outcome.warning}</span>}
      </p>
      <button className="btn primary" onClick={() => next()}>
        {outcome.index + 1 >= w.total ? 'Finish' : 'Next'}
      </button>{' '}
      {outcome.step.arm && (
        <button className="btn" onClick={() => next(true)}>
          Skip
        </button>
      )}{' '}
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function SwitchEditor({ which, title }: { which: 'arm' | 'mode' | 'turtle'; title: string }) {
  const sw = useConfigStore((s) => s.config.input[which]);
  const update = useConfigStore((s) => s.update);
  const set = (patch: Partial<SwitchConfig>) => update((d) => void Object.assign(d.input[which], patch));
  return (
    <table className="pid">
      <thead>
        <tr>
          <th>{title}</th>
          <th>Source</th>
          <th>Index</th>
          <th>Threshold</th>
          <th>Invert</th>
          <th>Btn toggles</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td />
          <td>
            <select
              aria-label={`${title} source`}
              value={sw.type}
              onChange={(e) => set({ type: e.target.value as SwitchConfig['type'] })}
            >
              {SWITCH_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </td>
          <td>
            <input
              type="number"
              min={0}
              max={31}
              step={1}
              value={sw.index}
              onChange={(e) => set({ index: +e.target.value })}
            />
          </td>
          <td>
            <input
              type="number"
              step={0.05}
              value={sw.threshold}
              onChange={(e) => set({ threshold: +e.target.value })}
            />
          </td>
          <td>
            <input type="checkbox" checked={sw.invert} onChange={(e) => set({ invert: e.target.checked })} />
          </td>
          <td>
            <input type="checkbox" checked={sw.toggle} onChange={(e) => set({ toggle: e.target.checked })} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function ControllerTab() {
  const sim = useSim();
  const input = useConfigStore((s) => s.config.input);
  const update = useConfigStore((s) => s.update);
  const [wizardOpen, setWizardOpen] = useState(false);
  useFrameTick(20);
  if (!sim) return null;
  const pads = sim.input.listGamepads();
  const pad = sim.input.getGamepad();
  const st = sim.rc;
  const setChannel = (ch: keyof Config['input']['channels'], patch: Partial<ChannelConfig>) =>
    update((d) => void Object.assign(d.input.channels[ch], patch));

  return (
    <>
      <Section title="Device">
        <div className="grid2">
          <div className="row">
            <label htmlFor="pad">Controller</label>
            <select
              id="pad"
              value={input.gamepadIndex}
              onChange={(e) => update((d) => void (d.input.gamepadIndex = +e.target.value))}
            >
              {pads.length ? (
                pads.map((p) => (
                  <option key={p.index} value={p.index}>
                    #{p.index} {p.id}
                  </option>
                ))
              ) : (
                <option>No controller detected — move a stick or press a button</option>
              )}
            </select>
            <span />
          </div>
          <div className="row">
            <label htmlFor="preset">Preset</label>
            <select
              id="preset"
              value=""
              onChange={(e) => {
                const p = INPUT_PRESETS[e.target.value];
                if (p) update((d) => void Object.assign(d.input, structuredClone(p)));
              }}
            >
              <option value="">Apply a preset…</option>
              {Object.keys(INPUT_PRESETS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <span />
          </div>
        </div>
        <p className="hint">
          Radio transmitters: enable USB Joystick (HID) mode, plug in, then press any stick/button so the browser
          exposes it. Run the wizard to map and calibrate.
        </p>
        <button className="btn primary" onClick={() => setWizardOpen(true)}>
          Run calibration wizard
        </button>
        {wizardOpen && <Wizard onClose={() => setWizardOpen(false)} />}
      </Section>
      <div className="grid2">
        <Section title="Mapped channels">
          <div className="bars">
            <Bar name="THROTTLE" value={st.throttle} centered={false} />
            <Bar name="YAW" value={st.yaw} />
            <Bar name="PITCH" value={st.pitch} />
            <Bar name="ROLL" value={st.roll} />
            <Bar name="ARM" value={st.armSwitch ? 1 : 0} centered={false} danger={st.armSwitch} />
          </div>
        </Section>
        <Section title="Raw axes">
          <div className="bars">
            {pad ? (
              pad.axes.map((v, i) => <Bar key={i} name={`Axis ${i}`} value={v} />)
            ) : (
              <span className="hint">No gamepad axes. Keyboard fallback active.</span>
            )}
          </div>
        </Section>
      </div>
      <Section title="Channel mapping & calibration">
        <table className="pid">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Axis</th>
              <th>Invert</th>
              <th>Min</th>
              <th>Center</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((ch) => {
              const c = input.channels[ch];
              return (
                <tr key={ch}>
                  <td>{ch}</td>
                  <td>
                    <select
                      aria-label={`${ch} axis`}
                      value={c.axis}
                      onChange={(e) => setChannel(ch, { axis: +e.target.value })}
                    >
                      {Array.from({ length: 8 }, (_, i) => (
                        <option key={i} value={i}>
                          Axis {i}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`${ch} invert`}
                      type="checkbox"
                      checked={c.invert}
                      onChange={(e) => setChannel(ch, { invert: e.target.checked })}
                    />
                  </td>
                  {(['min', 'center', 'max'] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        step={0.01}
                        value={+c[k].toFixed(3)}
                        onChange={(e) => setChannel(ch, { [k]: parseFloat(e.target.value) })}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field kind="number" path="input.deadband" label="Deadband" min={0} max={0.2} step={0.005} />
      </Section>
      <Section title="Switches">
        <SwitchEditor which="arm" title="Arm" />
        <br />
        <SwitchEditor which="mode" title="Angle mode" />
        <br />
        <SwitchEditor which="turtle" title="Turtle" />
        <p className="hint">
          Arming requires throttle low (BF-style). With no switch mapped, Space/Enter toggles arm. Turtle mode (crash
          flip) is latched when you arm with the turtle switch on (keyboard: T), then push the sticks toward the side
          you want to flip.
        </p>
      </Section>
    </>
  );
}
