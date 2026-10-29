import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toast, useUiStore, type RaceResults } from '../../src/state/uiStore';
import { GpuWarning, Loading, Results, Toasts } from '../../src/ui/hud/Overlays';

const RESULTS: RaceResults = {
  trackName: 'Works Circuit',
  quadName: '5" Freestyle (6S)',
  total: 75.5,
  holeshot: 1.23,
  laps: [25.1, 24.2, 26.2],
  topSpeedKmh: 131.4,
  rank: 2,
  board: [
    { total: 74.9, best: 24.0, date: '2026-10-01T10:00:00Z' },
    { total: 75.5, best: 24.2, date: '2026-10-29T10:00:00Z' },
  ],
};

describe('race results', () => {
  it('renders nothing without results', () => {
    const { container } = render(<Results />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows total, holeshot, laps (best highlighted), top speed and leaderboard', () => {
    useUiStore.getState().setResults(RESULTS);
    render(<Results />);
    const card = screen.getByTestId('results');
    expect(card).toHaveTextContent('Works Circuit · 5" Freestyle (6S)');
    expect(card).toHaveTextContent('01:15.50');
    expect(card).toHaveTextContent('Holeshot1.23s');
    expect(screen.getAllByText('00:24.20')[0].closest('tr')).toHaveClass('best');
    expect(card).toHaveTextContent('131 km/h');
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(7);
  });
});

describe('GPU warning', () => {
  const gpu = { name: 'SwiftShader', vendor: 'Google', label: 'SwiftShader', webgl2: true };

  it('shows only for software renderers and can be dismissed', async () => {
    useUiStore.getState().setGpu({ ...gpu, software: false });
    const { rerender } = render(<GpuWarning />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => useUiStore.getState().setGpu({ ...gpu, software: true }));
    rerender(<GpuWarning />);
    expect(screen.getByRole('alert')).toHaveTextContent('Hardware acceleration is off');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('toasts and loading', () => {
  it('show the newest toast and expire', () => {
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => {
      toast('first', 1000);
      toast('second', 3000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('second');
    expect(screen.getByRole('status')).toHaveClass('show');
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('loading screen follows the store', () => {
    render(<Loading />);
    expect(screen.getByTestId('loading')).toHaveTextContent('Loading…');
    act(() => useUiStore.getState().setLoading(null));
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
  });
});
