// Title menu: shown over the live autopilot flight (the sim keeps flying behind it).

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useConfigStore } from '../../state/configStore';
import { useSim } from '../../state/engineStore';
import { useUiStore } from '../../state/uiStore';
import { useFrameTick, useTouchDetected, useTouchEnabled } from '../hooks';

export function TitleScreen() {
  const screen = useUiStore((s) => s.screen);
  const menuOpen = useUiStore((s) => s.menuOpen);
  const loading = useUiStore((s) => s.loading);
  const nav = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  // Start on "Fly", and come back to it when the settings close.
  useEffect(() => {
    if (screen !== 'title' || loading !== null) return;
    if (menuOpen) wasOpen.current = true;
    else if (wasOpen.current || document.activeElement === document.body) {
      wasOpen.current = false;
      nav.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [screen, menuOpen, loading]);

  const touch = useTouchEnabled();
  if (screen !== 'title') return null;

  const { setScreen, openMenu } = useUiStore.getState();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(nav.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    e.preventDefault();
  };

  return (
    <div id="title" role="dialog" aria-label="Main menu" data-testid="title">
      <div className="title-card">
        <h1 className="title-logo">
          agentic<span>FPV</span>
        </h1>
        <p className="title-tag">Browser FPV drone simulator</p>
        <nav ref={nav} className="title-nav" onKeyDown={onKeyDown}>
          <button className="primary" onClick={() => setScreen('playing')}>
            Fly {!touch && <kbd>↵</kbd>}
          </button>
          <button onClick={() => setScreen('demo')}>Watch demo</button>
          <button onClick={() => openMenu('race')}>Race &amp; tracks</button>
          <button onClick={() => openMenu('quad')}>Quad &amp; tuning</button>
          <button onClick={() => openMenu('controller')}>Controller</button>
          <button onClick={() => openMenu('help')}>How to play</button>
        </nav>
        <TouchSwitch />
        <PadStatus />
      </div>
    </div>
  );
}

function PadStatus() {
  const sim = useSim();
  const touch = useTouchEnabled();
  useFrameTick(2);
  const pad = sim?.input.getGamepad();
  let text = '⌨ Keyboard mode · plug in a radio (USB joystick) or gamepad to fly with it';
  if (pad) text = `🎮 ${pad.id}`;
  else if (touch) text = '👆 Touch controls on · or plug in a gamepad';
  return (
    <p className="title-pad" data-testid="title-pad">
      {text}
    </p>
  );
}

/**
 * Touch controls on/off. Device detection is a best guess, so this is a plain switch that always wins:
 * flipping it sets the setting explicitly, and "auto" puts detection back in charge.
 */
function TouchSwitch() {
  const enabled = useTouchEnabled();
  const detected = useTouchDetected();
  const mode = useConfigStore((s) => s.config.input.touch.mode);
  const setMode = (m: 'auto' | 'on' | 'off') => useConfigStore.getState().setPath('input.touch.mode', m);
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .then(() =>
          (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'),
        )
        .catch(() => undefined);
  };
  return (
    <div className="title-switch">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Touch controls"
        className={`switch${enabled ? ' on' : ''}`}
        data-testid="touch-switch"
        onClick={() => setMode(enabled ? 'off' : 'on')}
      >
        <span className="knob" />
      </button>
      <span className="title-switch-label">
        Touch controls
        <small data-testid="touch-switch-note">
          {mode === 'auto' ? (
            `auto: ${detected ? 'phone or tablet detected' : 'desktop detected'}`
          ) : (
            <>
              set by you ·{' '}
              <button type="button" className="link" onClick={() => setMode('auto')}>
                use auto-detect
              </button>
            </>
          )}
        </small>
      </span>
      {canFullscreen && enabled && (
        <button type="button" className="title-fs" onClick={fullscreen}>
          Fullscreen
        </button>
      )}
    </div>
  );
}
