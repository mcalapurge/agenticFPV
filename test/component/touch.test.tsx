import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../src/engine/input/input';
import type { Simulator } from '../../src/engine/Simulator';
import { parseConfig } from '../../src/state/configSchema';
import { useConfigStore } from '../../src/state/configStore';
import { useEngineStore } from '../../src/state/engineStore';
import { useUiStore } from '../../src/state/uiStore';
import { Osd } from '../../src/ui/hud/Osd';
import { StickOverlay } from '../../src/ui/hud/StickOverlay';
import { ControllerTab } from '../../src/ui/menu/tabs/ControllerTab';
import { DemoOverlay } from '../../src/ui/title/DemoOverlay';
import { TitleScreen } from '../../src/ui/title/TitleScreen';
import { TouchControls } from '../../src/ui/touch/TouchControls';

const cfg = () => useConfigStore.getState().config;
const ui = () => useUiStore.getState();

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

/** Pretend to be a phone / a desktop for device detection. */
function device(kind: 'phone' | 'desktop') {
  vi.stubGlobal(
    'navigator',
    kind === 'phone'
      ? { maxTouchPoints: 5, userAgent: MOBILE_UA, platform: 'Linux armv8l', vibrate: vi.fn(), getGamepads: () => [] }
      : { maxTouchPoints: 0, userAgent: DESKTOP_UA, platform: 'Linux x86_64', getGamepads: () => [] },
  );
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: kind === 'phone' ? q === '(pointer: coarse)' : q === '(hover: hover)',
  }));
}

/** A simulator with just what the touch UI uses: a real InputManager, frame callbacks and arm state. */
function fakeSim(input: InputManager) {
  const frames = new Set<(s: Simulator) => void>();
  const sim = {
    input,
    state: { armed: false },
    onFrame: (fn: (s: Simulator) => void) => {
      frames.add(fn);
      return () => void frames.delete(fn);
    },
  } as unknown as Simulator;
  return { sim, runFrame: () => act(() => frames.forEach((f) => f(sim))) };
}

/** Pointer events with coordinates (jsdom's fireEvent drops them otherwise). */
const pointer = (el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, id = 1) =>
  fireEvent[type](el, { pointerId: id, clientX: x, clientY: y });

let input: InputManager;
let frameSim: ReturnType<typeof fakeSim>;

function setup({ phone = true, screenName = 'playing' as 'title' | 'demo' | 'playing' } = {}) {
  device(phone ? 'phone' : 'desktop');
  ui().setScreen(screenName);
  input = new InputManager(structuredClone(cfg()));
  frameSim = fakeSim(input);
  useEngineStore.getState().setSim(frameSim.sim);
}

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  input?.dispose();
  vi.unstubAllGlobals();
});

describe('touch controls visibility', () => {
  it('show on a detected phone while flying', () => {
    setup();
    render(<TouchControls />);
    expect(screen.getByTestId('touch-controls')).toBeInTheDocument();
    for (const name of ['Menu', 'Reset', 'Camera', 'Flight mode', 'Cut throttle', 'Arm', 'Turtle mode']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('stay hidden on a desktop (auto), on the title/demo screens, and while the settings are open', () => {
    setup({ phone: false });
    const { unmount } = render(<TouchControls />);
    expect(screen.queryByTestId('touch-controls')).not.toBeInTheDocument();
    unmount();

    setup({ screenName: 'title' });
    const t = render(<TouchControls />);
    expect(screen.queryByTestId('touch-controls')).not.toBeInTheDocument();
    t.unmount();

    setup();
    render(<TouchControls />);
    expect(screen.getByTestId('touch-controls')).toBeInTheDocument();
    act(() => ui().openMenu());
    expect(screen.queryByTestId('touch-controls')).not.toBeInTheDocument();
  });

  it('can be forced on for a desktop, or off for a phone', () => {
    setup({ phone: false });
    act(() => useConfigStore.getState().setPath('input.touch.mode', 'on'));
    const { unmount } = render(<TouchControls />);
    expect(screen.getByTestId('touch-controls')).toBeInTheDocument();
    unmount();
    setup();
    act(() => useConfigStore.getState().setPath('input.touch.mode', 'off'));
    render(<TouchControls />);
    expect(screen.queryByTestId('touch-controls')).not.toBeInTheDocument();
  });

  it('take over the HUD: the OSD moves clear of the sticks and the desktop stick overlay hides', () => {
    setup();
    render(
      <>
        <Osd />
        <StickOverlay />
      </>,
    );
    expect(screen.getByTestId('osd')).toHaveClass('touch');
    expect(document.getElementById('sticks')!.style.display).toBe('none');
  });
});

describe('left stick: throttle + yaw', () => {
  const R = 58; // default stick radius in px

  it('dragging up raises the throttle, relative to where it was, and it holds on release', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-left');
    pointer(pad, 'pointerDown', 100, 300);
    expect(input.touch.throttle).toBe(0); // landing never jumps the throttle
    pointer(pad, 'pointerMove', 100, 300 - R); // half the travel (2R) up
    expect(input.touch.throttle).toBeCloseTo(0.5, 5);
    pointer(pad, 'pointerMove', 100, 300 - 3 * R);
    expect(input.touch.throttle).toBe(1);
    pointer(pad, 'pointerUp', 100, 300 - 3 * R);
    expect(input.touch.throttle).toBe(1); // holds, like a real radio

    // A second touch continues from there.
    pointer(pad, 'pointerDown', 80, 200);
    pointer(pad, 'pointerMove', 80, 200 + R); // pull down half the travel
    expect(input.touch.throttle).toBeCloseTo(0.5, 5);
  });

  it('moving sideways yaws (right = positive), with expo, and centres on release', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-left');
    pointer(pad, 'pointerDown', 100, 300);
    pointer(pad, 'pointerMove', 100 + R, 300);
    expect(input.touch.yaw).toBeCloseTo(1, 5);
    pointer(pad, 'pointerMove', 100 - R / 2, 300);
    expect(input.touch.yaw).toBeLessThan(0);
    expect(input.touch.yaw).toBeGreaterThan(-0.5); // expo softens the middle
    pointer(pad, 'pointerUp', 100, 300);
    expect(input.touch.yaw).toBe(0);
  });

  it('throttle springs to zero on release when "throttle holds position" is off', () => {
    setup();
    act(() => useConfigStore.getState().setPath('input.touch.throttleHold', false));
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-left');
    pointer(pad, 'pointerDown', 100, 300);
    pointer(pad, 'pointerMove', 100, 300 - 2 * R);
    expect(input.touch.throttle).toBe(1);
    pointer(pad, 'pointerUp', 100, 300 - 2 * R);
    expect(input.touch.throttle).toBe(0);
  });

  it('stick size changes how far you have to drag', () => {
    setup();
    act(() => useConfigStore.getState().setPath('input.touch.size', 1.6));
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-left');
    pointer(pad, 'pointerDown', 100, 300);
    pointer(pad, 'pointerMove', 100, 300 - R); // R px is now only 1/(2·1.6) of the travel
    expect(input.touch.throttle).toBeCloseTo(1 / 3.2, 3);
  });
});

describe('right stick: roll + pitch', () => {
  const R = 58;

  it('up = nose down (forward), right = roll right, and it centres on release', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R, 300 - R);
    expect(input.touch.roll).toBeGreaterThan(0.5);
    expect(input.touch.pitch).toBeGreaterThan(0.5);
    pointer(pad, 'pointerMove', 700 - R, 300 + R);
    expect(input.touch.roll).toBeLessThan(-0.5);
    expect(input.touch.pitch).toBeLessThan(-0.5);
    pointer(pad, 'pointerUp', 700 - R, 300 + R);
    expect(input.touch.roll).toBe(0);
    expect(input.touch.pitch).toBe(0);
  });

  it('both sticks work at the same time, each following only its own finger', () => {
    setup();
    render(<TouchControls />);
    const left = screen.getByTestId('touch-pad-left');
    const right = screen.getByTestId('touch-pad-right');
    pointer(left, 'pointerDown', 100, 300, 1);
    pointer(right, 'pointerDown', 700, 300, 2);
    pointer(left, 'pointerMove', 100, 300 - 2 * R, 1);
    pointer(right, 'pointerMove', 700 + R, 300, 2);
    expect(input.touch.throttle).toBe(1);
    expect(input.touch.roll).toBeCloseTo(1, 5);
    // A stray finger (a different pointer id) on a pad that is already held changes nothing.
    pointer(left, 'pointerMove', 100 + R, 300, 99);
    expect(input.touch.yaw).toBe(0);
    pointer(right, 'pointerUp', 700 + R, 300, 2);
    expect(input.touch.roll).toBe(0);
    expect(input.touch.throttle).toBe(1); // the left finger is still down
  });
});

describe('buttons', () => {
  it('ARM toggles the arm switch and its label follows the quad', async () => {
    setup();
    render(<TouchControls />);
    const arm = screen.getByRole('button', { name: 'Arm' });
    expect(arm).toHaveAttribute('aria-pressed', 'false');
    pointer(arm, 'pointerDown', 0, 0);
    expect(input.kbArm).toBe(true);
    frameSim.runFrame();
    expect(arm).toHaveAttribute('aria-pressed', 'true');
    expect(arm).toHaveTextContent('ARMING…');
    (frameSim.sim.state as { armed: boolean }).armed = true;
    frameSim.runFrame();
    expect(arm).toHaveTextContent('ARMED');
    pointer(arm, 'pointerDown', 0, 0);
    expect(input.kbArm).toBe(false);
  });

  it('turtle, cut-throttle, reset, camera and flight-mode buttons do their jobs', () => {
    setup();
    render(<TouchControls />);
    const seen: string[] = [];
    for (const e of ['reset', 'camera', 'mode'] as const) input.on(e, () => seen.push(e));
    pointer(screen.getByRole('button', { name: 'Turtle mode' }), 'pointerDown', 0, 0);
    expect(input.kbTurtle).toBe(true);
    input.touch.setLeft(0, 0.8);
    pointer(screen.getByRole('button', { name: 'Cut throttle' }), 'pointerDown', 0, 0);
    expect(input.touch.throttle).toBe(0);
    pointer(screen.getByRole('button', { name: 'Reset' }), 'pointerDown', 0, 0);
    pointer(screen.getByRole('button', { name: 'Camera' }), 'pointerDown', 0, 0);
    pointer(screen.getByRole('button', { name: 'Flight mode' }), 'pointerDown', 0, 0);
    expect(seen).toEqual(['reset', 'camera', 'mode']);
  });

  it('the mode button shows the current flight mode', () => {
    setup();
    render(<TouchControls />);
    expect(screen.getByRole('button', { name: 'Flight mode' })).toHaveTextContent('ACRO');
    act(() => useConfigStore.getState().setPath('flight.mode', 'angle'));
    expect(screen.getByRole('button', { name: 'Flight mode' })).toHaveTextContent('ANGL');
  });

  it('the menu button opens the settings, hides the sticks and lets go of the throttle', () => {
    setup();
    render(<TouchControls />);
    input.touch.setLeft(0.3, 0.9);
    pointer(screen.getByRole('button', { name: 'Menu' }), 'pointerDown', 0, 0);
    expect(ui().menuOpen).toBe(true);
    expect(screen.queryByTestId('touch-controls')).not.toBeInTheDocument();
    expect(input.touch).toMatchObject({ throttle: 0, yaw: 0 });
  });

  it('buttons vibrate when haptics are on, and stay quiet when off', () => {
    setup();
    const vibrate = navigator.vibrate as unknown as ReturnType<typeof vi.fn>;
    const { unmount } = render(<TouchControls />);
    pointer(screen.getByRole('button', { name: 'Reset' }), 'pointerDown', 0, 0);
    expect(vibrate).toHaveBeenCalledTimes(1);
    unmount();
    act(() => useConfigStore.getState().setPath('input.touch.haptics', false));
    render(<TouchControls />);
    pointer(screen.getByRole('button', { name: 'Reset' }), 'pointerDown', 0, 0);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('the knobs are in the right place from the very first render (throttle 0 = bottom)', () => {
    setup();
    const { container } = render(<TouchControls />);
    const knobs = container.querySelectorAll<HTMLElement>('.tc-knob');
    expect(knobs[0].style.transform).toBe('translate(0.0px, 38.9px)');
    expect(knobs[1].style.transform).toBe('translate(0.0px, 0.0px)');
  });

  it('the knobs and throttle bar follow the stick state each frame', () => {
    setup();
    const { container } = render(<TouchControls />);
    input.touch.setLeft(1, 1);
    input.touch.setRight(-1, 0);
    frameSim.runFrame();
    const knobs = container.querySelectorAll<HTMLElement>('.tc-knob');
    expect(knobs[0].style.transform).toBe('translate(38.9px, -38.9px)'); // yaw right, throttle full
    expect(knobs[1].style.transform).toContain('-38.9px');
    expect(container.querySelector<HTMLElement>('.tc-thr-fill')!.style.height).toBe('100%');
  });
});

describe('title screen touch switch', () => {
  it('shows the auto-detected state on a phone and switches it off', async () => {
    device('phone');
    ui().setLoading(null);
    render(<TitleScreen />);
    const sw = screen.getByRole('switch', { name: 'Touch controls' });
    expect(sw).toBeChecked();
    expect(screen.getByTestId('touch-switch-note')).toHaveTextContent('auto: phone or tablet detected');
    expect(screen.getByTestId('title-pad')).toHaveTextContent('Touch controls on');
    await userEvent.click(sw);
    expect(cfg().input.touch.mode).toBe('off');
    expect(sw).not.toBeChecked();
    expect(screen.getByTestId('touch-switch-note')).toHaveTextContent('set by you');
  });

  it('shows desktop as off and switches on, with a way back to auto-detect', async () => {
    device('desktop');
    ui().setLoading(null);
    render(<TitleScreen />);
    const sw = screen.getByRole('switch', { name: 'Touch controls' });
    expect(sw).not.toBeChecked();
    expect(screen.getByTestId('touch-switch-note')).toHaveTextContent('auto: desktop detected');
    await userEvent.click(sw);
    expect(cfg().input.touch.mode).toBe('on');
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'use auto-detect' }));
    expect(cfg().input.touch.mode).toBe('auto');
    expect(sw).not.toBeChecked();
  });

  it('hides the keyboard hint on the Fly button when touch is on', () => {
    device('phone');
    ui().setLoading(null);
    render(<TitleScreen />);
    expect(screen.getByRole('button', { name: 'Fly' })).toBeInTheDocument(); // no "↵" badge
  });

  it('offers fullscreen only when touch is on and the browser supports it', () => {
    device('phone');
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    ui().setLoading(null);
    const { unmount } = render(<TitleScreen />);
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
    unmount();
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    render(<TitleScreen />);
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();
  });
});

describe('demo and controller tab on touch', () => {
  it('the demo tells you to tap', () => {
    device('phone');
    ui().setScreen('demo');
    render(<DemoOverlay />);
    expect(screen.getByTestId('demo-hint')).toHaveTextContent('tap anywhere');
  });

  it('the Controller tab has the touch options', async () => {
    device('desktop');
    useEngineStore.getState().setSim({
      input: { listGamepads: () => [], getGamepad: () => null },
      rc: { throttle: 0, yaw: 0, pitch: 0, roll: 0, armSwitch: false },
      onFrame: () => () => {},
    } as unknown as Simulator);
    render(<ControllerTab />);
    expect(screen.getByRole('heading', { name: /Touch controls/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('On-screen sticks'), 'on');
    expect(cfg().input.touch.mode).toBe('on');
    await userEvent.click(screen.getByLabelText('Vibrate on button press'));
    expect(cfg().input.touch.haptics).toBe(false);
    fireEvent.change(screen.getByLabelText('Stick size'), { target: { value: '1.3' } });
    expect(cfg().input.touch.size).toBe(1.3);
  });
});

describe('centre ticks (haptics when a thumb crosses a stick centre)', () => {
  const R = 58;
  const vibrate = () => navigator.vibrate as unknown as ReturnType<typeof vi.fn>;

  // The detector rate-limits by wall-clock time; give it a clock that moves 100 ms per reading so the tests
  // do not depend on how fast the machine is.
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100));
  });
  afterEach(() => vi.restoreAllMocks());

  it('right stick: silent while pushing out, one tick when the thumb returns to centre', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R / 2, 300);
    pointer(pad, 'pointerMove', 700 + R, 300);
    expect(vibrate()).not.toHaveBeenCalled();
    pointer(pad, 'pointerMove', 700 + R / 2, 300);
    expect(vibrate()).not.toHaveBeenCalled();
    pointer(pad, 'pointerMove', 700, 300); // back home
    expect(vibrate()).toHaveBeenCalledTimes(1);
    expect(vibrate()).toHaveBeenCalledWith(10);
  });

  it('pitch counts too, and roll + pitch crossing together is a single pulse, not two', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700, 300 - R); // forward only
    pointer(pad, 'pointerMove', 700, 300);
    expect(vibrate()).toHaveBeenCalledTimes(1);
    pointer(pad, 'pointerMove', 700 + R, 300 - R); // diagonal out
    pointer(pad, 'pointerMove', 700, 300); // both axes back to centre at once
    expect(vibrate()).toHaveBeenCalledTimes(2);
  });

  it('flicking straight across centre ticks once', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R, 300);
    pointer(pad, 'pointerMove', 700 - R, 300);
    expect(vibrate()).toHaveBeenCalledTimes(1);
  });

  it('left stick: yaw ticks; throttle (up/down) never does', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-left');
    pointer(pad, 'pointerDown', 100, 300);
    pointer(pad, 'pointerMove', 100, 300 - 2 * R); // full throttle
    pointer(pad, 'pointerMove', 100, 300 + R); // and back down
    expect(vibrate()).not.toHaveBeenCalled();
    pointer(pad, 'pointerMove', 100 + R, 300);
    pointer(pad, 'pointerMove', 100, 300); // yaw back to centre
    expect(vibrate()).toHaveBeenCalledTimes(1);
  });

  it('a new finger starts centred: landing never ticks', () => {
    setup();
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R, 300);
    pointer(pad, 'pointerUp', 700 + R, 300);
    pointer(pad, 'pointerDown', 650, 250);
    expect(vibrate()).not.toHaveBeenCalled();
  });

  it('can be switched off, independently of the button vibration', () => {
    setup();
    act(() => useConfigStore.getState().setPath('input.touch.centreHaptics', false));
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R, 300);
    pointer(pad, 'pointerMove', 700, 300);
    expect(vibrate()).not.toHaveBeenCalled();
    pointer(screen.getByRole('button', { name: 'Reset' }), 'pointerDown', 0, 0); // buttons still buzz
    expect(vibrate()).toHaveBeenCalledTimes(1);
  });

  it('is harmless where the browser cannot vibrate (iPhone Safari)', () => {
    setup();
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    render(<TouchControls />);
    const pad = screen.getByTestId('touch-pad-right');
    pointer(pad, 'pointerDown', 700, 300);
    pointer(pad, 'pointerMove', 700 + R, 300);
    expect(() => pointer(pad, 'pointerMove', 700, 300)).not.toThrow();
    expect(input.touch.roll).toBe(0);
  });

  it('the Controller tab offers the option and explains the iPhone limit', async () => {
    device('desktop');
    useEngineStore.getState().setSim({
      input: { listGamepads: () => [], getGamepad: () => null },
      rc: { throttle: 0, yaw: 0, pitch: 0, roll: 0, armSwitch: false },
      onFrame: () => () => {},
    } as unknown as Simulator);
    render(<ControllerTab />);
    await userEvent.click(screen.getByLabelText('Tick when a stick crosses centre'));
    expect(cfg().input.touch.centreHaptics).toBe(false);
    expect(screen.getByText(/iPhone Safari does not allow web pages to vibrate/)).toBeInTheDocument();
  });

  describe('stick position (bottom / middle of each side)', () => {
    const ring = (side: 'left' | 'right') => document.querySelector(`.tc-ring.${side}`)!;

    it('defaults to the bottom on both sides', () => {
      setup();
      render(<TouchControls />);
      expect(ring('left')).toHaveClass('bottom');
      expect(ring('right')).toHaveClass('bottom');
    });

    it('moves each side independently', () => {
      setup();
      act(() => useConfigStore.getState().setPath('input.touch.rightHeight', 'middle'));
      render(<TouchControls />);
      expect(ring('left')).toHaveClass('bottom');
      expect(ring('right')).toHaveClass('middle');
    });

    it('the Controller tab offers a position for each stick', async () => {
      device('desktop');
      useEngineStore.getState().setSim({
        input: { listGamepads: () => [], getGamepad: () => null },
        rc: { throttle: 0, yaw: 0, pitch: 0, roll: 0, armSwitch: false },
        onFrame: () => () => {},
      } as unknown as Simulator);
      render(<ControllerTab />);
      await userEvent.selectOptions(screen.getByLabelText('Left stick position'), 'middle');
      await userEvent.selectOptions(screen.getByLabelText('Right stick position'), 'middle');
      expect(cfg().input.touch.leftHeight).toBe('middle');
      expect(cfg().input.touch.rightHeight).toBe('middle');
    });

    it('a bad stored value falls back to the bottom', () => {
      expect(parseConfig({ input: { touch: { leftHeight: 'top' } } }).input.touch.leftHeight).toBe('bottom');
    });
  });
});
