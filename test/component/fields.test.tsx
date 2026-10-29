import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field, SchemaSections } from '../../src/ui/menu/fields';
import { useConfigStore } from '../../src/state/configStore';

const config = () => useConfigStore.getState().config;

describe('settings fields', () => {
  it('number field shows the stored value and writes edits back', () => {
    render(<Field kind="number" path="physics.windSpeed" label="Wind" unit="m/s" min={0} max={20} step={0.5} />);
    const input = screen.getByLabelText('Wind (m/s)');
    expect(input).toHaveValue(config().physics.windSpeed);
    fireEvent.change(input, { target: { value: '7.5' } });
    expect(config().physics.windSpeed).toBe(7.5);
    expect(screen.getByLabelText('Wind slider')).toHaveValue('7.5');
  });

  it('number field ignores non-numeric input', () => {
    render(<Field kind="number" path="physics.windSpeed" label="Wind" min={0} max={20} step={0.5} />);
    const before = config().physics.windSpeed;
    fireEvent.change(screen.getByLabelText('Wind'), { target: { value: '' } });
    expect(config().physics.windSpeed).toBe(before);
  });

  it('slider writes to the store', () => {
    render(<Field kind="number" path="pid.angleLimit" label="Angle limit" min={10} max={85} step={1} />);
    fireEvent.change(screen.getByLabelText('Angle limit slider'), { target: { value: '70' } });
    expect(config().pid.angleLimit).toBe(70);
  });

  it('bool field toggles', async () => {
    render(<Field kind="bool" path="pid.airmode" label="Airmode" />);
    const box = screen.getByLabelText('Airmode');
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(config().pid.airmode).toBe(false);
  });

  it('select fields write strings or numbers', async () => {
    render(
      <>
        <Field kind="select" path="flight.mode" label="Mode" options={{ acro: 'Acro', angle: 'Angle' }} />
        <Field kind="select" path="video.vtxPower" label="VTX" numeric options={{ 25: '25 mW', 600: '600 mW' }} />
      </>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'angle');
    await userEvent.selectOptions(screen.getByLabelText('VTX'), '600');
    expect(config().flight.mode).toBe('angle');
    expect(config().video.vtxPower).toBe(600);
  });

  it('re-renders when the store changes elsewhere', () => {
    render(<Field kind="number" path="pid.roll.p" label="Roll P" min={0} max={250} step={1} />);
    act(() => useConfigStore.getState().setPath('pid.roll.p', 99));
    expect(screen.getByLabelText('Roll P')).toHaveValue(99);
  });

  it('schema sections render titled groups', () => {
    render(
      <SchemaSections
        sections={[{ title: 'Wind', fields: [{ kind: 'number', path: 'physics.windGust', label: 'Gusts', min: 0, max: 1, step: 0.1 }] }]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Wind' })).toBeInTheDocument();
    expect(screen.getByLabelText('Gusts')).toBeInTheDocument();
  });
});
