import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';
import { useConfigStore } from '../../src/state/configStore';
import { useUiStore } from '../../src/state/uiStore';
import { Menu } from '../../src/ui/menu/Menu';

vi.mock('../../src/ui/menu/io', () => ({ downloadJson: vi.fn(), pickJsonFile: vi.fn() }));
const io = await import('../../src/ui/menu/io');

const config = () => useConfigStore.getState().config;
const open = (tab: Parameters<ReturnType<typeof useUiStore.getState>['openMenu']>[0]) =>
  useUiStore.getState().openMenu(tab);

describe('settings menu', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<Menu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('switches tabs', async () => {
    open('quad');
    render(<Menu />);
    expect(screen.getByRole('tab', { name: 'Quad' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Physics' }));
    expect(useUiStore.getState().tab).toBe('physics');
    expect(screen.getByTestId('thrust-to-weight')).toHaveTextContent(/Thrust-to-weight: \d+\.\d : 1/);
    await userEvent.click(screen.getByRole('tab', { name: 'Filters' }));
    expect(within(screen.getByRole('tabpanel')).getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('every tab renders without a simulator', async () => {
    open('race');
    render(<Menu />);
    for (const tab of screen.getAllByRole('tab')) {
      await userEvent.click(tab);
      expect(tab).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('"Reset tab" restores only that tab’s sections', async () => {
    useConfigStore.getState().update((d) => {
      d.pid.roll.p = 80;
      d.flight.mode = 'angle';
      d.physics.windSpeed = 9;
    });
    open('pids');
    render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset tab to defaults' }));
    expect(config().pid).toEqual(DEFAULT_CONFIG.pid);
    expect(config().flight.mode).toBe(DEFAULT_CONFIG.flight.mode);
    expect(config().physics.windSpeed).toBe(9);
  });

  it('reset is disabled on tabs without settings', () => {
    open('help');
    render(<Menu />);
    expect(screen.getByRole('button', { name: 'Reset tab to defaults' })).toBeDisabled();
  });

  it('exports and imports JSON', async () => {
    open('pids');
    render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(io.downloadJson).toHaveBeenCalledWith('agenticfpv-config.json', config());

    vi.mocked(io.pickJsonFile).mockResolvedValueOnce({ pid: { roll: { p: 77 } } });
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(config().pid.roll.p).toBe(77);
    expect(config().rates).toEqual(DEFAULT_CONFIG.rates);
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe('Config imported ✔');
  });

  it('reports a failed import', async () => {
    open('pids');
    render(<Menu />);
    vi.mocked(io.pickJsonFile).mockRejectedValueOnce(new SyntaxError('Unexpected token'));
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe('Import failed: Unexpected token');
  });

  it('"Fly" closes the menu', async () => {
    open('pids');
    render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: /Fly/ }));
    expect(useUiStore.getState().menuOpen).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
