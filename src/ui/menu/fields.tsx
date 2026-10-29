// Generic settings fields bound to the config store by (type-checked) path.

import { useId, type ReactNode } from 'react';
import type { BooleanPath, NumberPath, StringPath } from '../../state/configSchema';
import { setConfigValue, useConfigValue } from '../hooks';

interface Common {
  label: string;
  unit?: string;
  help?: string;
}

export type FieldSpec =
  | (Common & { kind: 'number'; path: NumberPath; min: number; max: number; step: number })
  | (Common & { kind: 'bool'; path: BooleanPath })
  | (Common & { kind: 'select'; path: StringPath; options: Record<string, string>; numeric?: false })
  | (Common & { kind: 'select'; path: NumberPath; options: Record<string, string>; numeric: true });

export interface SectionSpec {
  title: string;
  fields: FieldSpec[];
}

function Label({ id, label, unit, help }: Common & { id: string }) {
  return (
    <label htmlFor={id}>
      {label}
      {unit ? ` (${unit})` : ''}
      {help && <small>{help}</small>}
    </label>
  );
}

export function NumberField(spec: Extract<FieldSpec, { kind: 'number' }>) {
  const id = useId();
  const value = useConfigValue(spec.path);
  const set = (raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) setConfigValue(spec.path, n);
  };
  return (
    <div className="row">
      <Label id={id} {...spec} />
      <input
        type="range"
        aria-label={`${spec.label} slider`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      <input
        id={id}
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
}

export function BoolField(spec: Extract<FieldSpec, { kind: 'bool' }>) {
  const id = useId();
  const value = useConfigValue(spec.path);
  return (
    <div className="row">
      <Label id={id} {...spec} />
      <input id={id} type="checkbox" checked={value} onChange={(e) => setConfigValue(spec.path, e.target.checked)} />
      <span />
    </div>
  );
}

export function SelectField(spec: Extract<FieldSpec, { kind: 'select' }>) {
  const id = useId();
  const value = useConfigValue(spec.path);
  return (
    <div className="row">
      <Label id={id} {...spec} />
      <select
        id={id}
        style={{ gridColumn: '2 / 4' }}
        value={String(value)}
        onChange={(e) => {
          if (spec.numeric) setConfigValue(spec.path, Number(e.target.value));
          else setConfigValue(spec.path, e.target.value);
        }}
      >
        {Object.entries(spec.options).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Field(spec: FieldSpec) {
  if (spec.kind === 'bool') return <BoolField {...spec} />;
  if (spec.kind === 'select') return <SelectField {...spec} />;
  return <NumberField {...spec} />;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function SchemaSections({ sections }: { sections: SectionSpec[] }) {
  return (
    <>
      {sections.map((s) => (
        <Section key={s.title} title={s.title}>
          <div className="grid2">
            {s.fields.map((f) => (
              <Field key={f.path} {...f} />
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}
