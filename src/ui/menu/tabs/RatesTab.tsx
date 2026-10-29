import { useEffect, useRef } from 'react';
import { applyRate, type RateType } from '../../../engine/sim/rates';
import { AXES, drawRateCurves } from '../rateGraph';
import type { Config } from '../../../state/configSchema';
import { useConfigStore } from '../../../state/configStore';
import { useSim } from '../../../state/engineStore';
import { useSimFrame } from '../../hooks';
import { Field, Section } from '../fields';

const TYPE_DEFAULTS: Record<RateType, Config['rates']['roll']> = {
  actual: { rcRate: 70, rate: 670, expo: 0.54 },
  betaflight: { rcRate: 100, rate: 70, expo: 0 },
};

export function RatesTab() {
  const sim = useSim();
  const rates = useConfigStore((s) => s.config.rates);
  const update = useConfigStore((s) => s.update);
  const canvas = useRef<HTMLCanvasElement>(null);
  const actual = rates.type === 'actual';
  const draw = () => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawRateCurves(ctx, rates, sim?.rc);
  };
  useEffect(draw);
  useSimFrame(draw);

  return (
    <>
      <Section title="Rates">
        <div className="row">
          <label htmlFor="rates-type">Rates type</label>
          <select
            id="rates-type"
            value={rates.type}
            onChange={(e) => {
              const type = e.target.value as RateType;
              update((d) => {
                d.rates.type = type;
                for (const ax of AXES) d.rates[ax] = { ...TYPE_DEFAULTS[type] };
              });
            }}
          >
            <option value="actual">Actual (BF 4.3+ default)</option>
            <option value="betaflight">Betaflight (classic)</option>
          </select>
          <span />
        </div>
        <table className="pid">
          <thead>
            <tr>
              <th />
              {(actual ? ['Center sens.', 'Max rate', 'Expo'] : ['RC rate', 'Super rate', 'RC expo']).map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>Max °/s</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((ax) => (
              <tr key={ax}>
                <td>{ax.toUpperCase()}</td>
                {(
                  [
                    ['rcRate', 1],
                    ['rate', actual ? 10 : 1],
                    ['expo', 0.01],
                  ] as const
                ).map(([k, step]) => (
                  <td key={k}>
                    <input
                      aria-label={`${ax} ${k}`}
                      type="number"
                      step={step}
                      value={rates[ax][k]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v)) update((d) => void (d.rates[ax][k] = v));
                      }}
                    />
                  </td>
                ))}
                <td className="derived" data-testid={`max-${ax}`}>
                  {applyRate(rates.type, 1, rates[ax]).toFixed(0)}°/s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Rate curves">
        <canvas ref={canvas} className="graph" width={520} height={300} />
      </Section>
      <Section title="Throttle">
        <div className="grid2">
          <Field kind="number" path="rates.throttleMid" label="Throttle mid" min={0} max={1} step={0.01} />
          <Field kind="number" path="rates.throttleExpo" label="Throttle expo" min={0} max={1} step={0.01} />
          <Field kind="number" path="rates.throttleLimit" label="Throttle limit" min={0.2} max={1} step={0.01} />
          <Field kind="number" path="flight.motorIdle" label="Motor idle" min={0} max={0.15} step={0.005} />
        </div>
      </Section>
    </>
  );
}
