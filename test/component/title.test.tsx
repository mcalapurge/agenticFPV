import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Simulator } from '../../src/engine/Simulator';
import { useEngineStore } from '../../src/state/engineStore';
import { useUiStore } from '../../src/state/uiStore';
import { GpuWarning } from '../../src/ui/hud/Overlays';
import { Osd } from '../../src/ui/hud/Osd';
import { StickOverlay } from '../../src/ui/hud/StickOverlay';
import { Menu } from '../../src/ui/menu/Menu';
import { DemoOverlay } from '../../src/ui/title/DemoOverlay';
import { TitleScreen } from '../../src/ui/title/TitleScreen';

const ui = () => useUiStore.getState();

describe('title menu', () => {
  it('is the first screen and offers the main actions', () => {
    ui().setLoading(null);
    render(<TitleScreen />);
    expect(ui().screen).toBe('title');
    expect(screen.getByRole('dialog', { name: 'Main menu' })).toBeInTheDocument();
    for (const name of [/^Fly/, 'Watch demo', /Race/, /Quad/, 'Controller', 'How to play']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Fly starts the game', async () => {
    ui().setLoading(null);
    render(<TitleScreen />);
    await userEvent.click(screen.getByRole('button', { name: /^Fly/ }));
    expect(ui().screen).toBe('playing');
    expect(screen.queryByTestId('title')).not.toBeInTheDocument();
  });

  it('Watch demo starts the demo', async () => {
    ui().setLoading(null);
    render(<TitleScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Watch demo' }));
    expect(ui().screen).toBe('demo');
  });

  it.each([
    [/Race/, 'race'],
    [/Quad/, 'quad'],
    ['Controller', 'controller'],
    ['How to play', 'help'],
  ] as const)('%s opens the settings on the right tab, staying on the title', async (name, tab) => {
    ui().setLoading(null);
    render(
      <>
        <TitleScreen />
        <Menu />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name }));
    expect(ui().menuOpen).toBe(true);
    expect(ui().tab).toBe(tab);
    expect(ui().screen).toBe('title');
    // "Back" closes the settings and we are still on the title screen.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(ui().menuOpen).toBe(false);
    expect(screen.getByTestId('title')).toBeInTheDocument();
  });

  it('focuses Fly and moves between buttons with the arrow keys', async () => {
    ui().setLoading(null);
    render(<TitleScreen />);
    const fly = screen.getByRole('button', { name: /^Fly/ });
    expect(fly).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Watch demo' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('button', { name: 'How to play' })).toHaveFocus(); // wraps round
  });

  it('shows the detected controller, or says it is in keyboard mode', () => {
    ui().setLoading(null);
    const withPad = { input: { getGamepad: () => ({ id: 'RadioMaster Pocket' }) }, onFrame: () => () => {} };
    useEngineStore.getState().setSim(withPad as unknown as Simulator);
    const { unmount } = render(<TitleScreen />);
    expect(screen.getByTestId('title-pad')).toHaveTextContent('RadioMaster Pocket');
    unmount();
    useEngineStore
      .getState()
      .setSim({ input: { getGamepad: () => null }, onFrame: () => () => {} } as unknown as Simulator);
    render(<TitleScreen />);
    expect(screen.getByTestId('title-pad')).toHaveTextContent('Keyboard mode');
  });
});

describe('demo screen', () => {
  it('shows only while the demo runs, with a way out', () => {
    const { container } = render(<DemoOverlay />);
    expect(container).toBeEmptyDOMElement();
    act(() => ui().setScreen('demo'));
    expect(screen.getByTestId('demo-hint')).toHaveTextContent('press any key');
  });

  it.each([
    ['a key', () => fireEvent.keyDown(window, { key: 'x' })],
    ['a click', () => fireEvent.pointerDown(window)],
  ])('%s returns to the title', (_what, trigger) => {
    ui().setScreen('demo');
    render(<DemoOverlay />);
    act(() => void trigger());
    expect(ui().screen).toBe('title');
  });

  it('ignores key repeat and modifier keys (the Enter that started it may still be down)', () => {
    ui().setScreen('demo');
    render(<DemoOverlay />);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    fireEvent.keyDown(window, { key: 'Shift' });
    expect(ui().screen).toBe('demo');
  });
});

describe('menu footer and warnings per screen', () => {
  it('in flight the menu offers "Main menu" and "Fly ▶"', async () => {
    ui().setScreen('playing');
    ui().openMenu('pids');
    render(<Menu />);
    expect(screen.getByRole('button', { name: 'Fly ▶' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    expect(ui().screen).toBe('title');
    expect(ui().menuOpen).toBe(false);
  });

  it('on the title screen there is no "Main menu" button', () => {
    ui().openMenu('pids');
    render(<Menu />);
    expect(screen.queryByRole('button', { name: 'Main menu' })).not.toBeInTheDocument();
  });

  it('the software-rendering banner moves to the bottom on the title and hides during the demo', () => {
    ui().setGpu({ name: 'SwiftShader', vendor: 'Google', label: 'SwiftShader', software: true, webgl2: true });
    render(<GpuWarning />);
    expect(screen.getByRole('alert')).toHaveClass('at-bottom');
    act(() => ui().setScreen('playing'));
    expect(screen.getByRole('alert')).not.toHaveClass('at-bottom');
    act(() => ui().setScreen('demo'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('changing screen closes any open settings', () => {
    ui().openMenu('quad');
    ui().setScreen('demo');
    expect(ui().menuOpen).toBe(false);
  });
});

describe('HUD per screen', () => {
  it.each([
    ['title', false],
    ['demo', true],
    ['playing', true],
  ] as const)('OSD and sticks on the %s screen: visible = %s', (screenName, visible) => {
    ui().setScreen(screenName);
    render(
      <>
        <Osd />
        <StickOverlay />
      </>,
    );
    const hidden = (el: HTMLElement) => el.style.display === 'none';
    expect(hidden(screen.getByTestId('osd'))).toBe(!visible);
    expect(hidden(document.getElementById('sticks')!)).toBe(!visible);
  });
});
