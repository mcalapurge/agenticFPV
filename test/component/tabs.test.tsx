import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getPreset } from '../../src/engine/sim/presets';
import { useConfigStore } from '../../src/state/configStore';
import { useUiStore } from '../../src/state/uiStore';
import { PidsTab } from '../../src/ui/menu/tabs/PidsTab';
import { QuadTab } from '../../src/ui/menu/tabs/QuadTab';
import { RatesTab } from '../../src/ui/menu/tabs/RatesTab';

const config = () => useConfigStore.getState().config;
const lastToast = () => useUiStore.getState().toasts.at(-1)?.message;

describe('PIDs tab', () => {
  it('edits gains in the PID table', () => {
    render(<PidsTab />);
    fireEvent.change(screen.getByLabelText('pitch d'), { target: { value: '38' } });
    expect(config().pid.pitch.d).toBe(38);
  });

  it('imports a Betaflight CLI diff', async () => {
    render(<PidsTab />);
    await userEvent.click(screen.getByRole('button', { name: /Import from Betaflight CLI/ }));
    const text =
      'profile 0\nset p_roll = 52\nset i_roll = 95\nrateprofile 0\nset rates_type = ACTUAL\nset roll_srate = 85';
    fireEvent.change(screen.getByLabelText('Betaflight CLI'), { target: { value: text } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(config().pid.roll).toMatchObject({ p: 52, i: 95 });
    expect(config().rates.roll.rate).toBe(850);
    expect(lastToast()).toMatch(/^Imported \d+ settings from Betaflight$/);
    expect(screen.queryByTestId('cli-import')).not.toBeInTheDocument();
  });

  it('explains when nothing was recognised', async () => {
    render(<PidsTab />);
    await userEvent.click(screen.getByRole('button', { name: /Import from Betaflight CLI/ }));
    fireEvent.change(screen.getByLabelText('Betaflight CLI'), { target: { value: 'hello' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText(/Nothing recognised/)).toBeInTheDocument();
    expect(screen.getByTestId('cli-import')).toBeInTheDocument();
  });

  it('simplified tuning scales gains from the opening values', () => {
    render(<PidsTab />);
    fireEvent.change(screen.getByLabelText('P & D gain'), { target: { value: '1.2' } });
    expect(config().pid.roll).toEqual({ p: 54, i: 80, d: 48, f: 120 });
    fireEvent.change(screen.getByLabelText('P & D gain'), { target: { value: '1' } });
    expect(config().pid.roll).toEqual({ p: 45, i: 80, d: 40, f: 120 });
  });
});

describe('Rates tab', () => {
  it('shows max rate per axis and updates live', () => {
    render(<RatesTab />);
    expect(screen.getByTestId('max-roll')).toHaveTextContent('670°/s');
    fireEvent.change(screen.getByLabelText('roll rate'), { target: { value: '800' } });
    expect(screen.getByTestId('max-roll')).toHaveTextContent('800°/s');
  });

  it('switching rate type loads that type’s defaults', async () => {
    render(<RatesTab />);
    await userEvent.selectOptions(screen.getByLabelText('Rates type'), 'betaflight');
    expect(config().rates.type).toBe('betaflight');
    expect(config().rates.yaw).toEqual({ rcRate: 100, rate: 70, expo: 0 });
    expect(screen.getByTestId('max-pitch')).toHaveTextContent('667°/s');
    expect(screen.getByRole('columnheader', { name: 'Super rate' })).toBeInTheDocument();
  });
});

describe('Quad tab', () => {
  it('selecting a class applies its physics and tune but keeps rates', async () => {
    useConfigStore.getState().setPath('rates.roll.rate', 900);
    render(<QuadTab />);
    expect(screen.getByTestId('preset-freestyle5')).toHaveClass('active');
    await userEvent.click(screen.getByTestId('preset-whoop65'));
    const p = getPreset('whoop65');
    expect(config().quad.preset).toBe('whoop65');
    expect(config().physics).toMatchObject(p.physics);
    expect(config().pid.roll).toEqual(p.pid.roll);
    expect(config().rates.roll.rate).toBe(900);
    expect(screen.getByTestId('preset-whoop65')).toHaveClass('active');
    expect(lastToast()).toBe(`${p.name} selected`);
  });
});
