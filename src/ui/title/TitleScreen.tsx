// Title menu: shown over the live autopilot flight (the sim keeps flying behind it).

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useSim } from '../../state/engineStore';
import { useUiStore } from '../../state/uiStore';
import { useFrameTick } from '../hooks';

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
            Fly <kbd>↵</kbd>
          </button>
          <button onClick={() => setScreen('demo')}>Watch demo</button>
          <button onClick={() => openMenu('race')}>Race &amp; tracks</button>
          <button onClick={() => openMenu('quad')}>Quad &amp; tuning</button>
          <button onClick={() => openMenu('controller')}>Controller</button>
          <button onClick={() => openMenu('help')}>How to play</button>
        </nav>
        <PadStatus />
      </div>
    </div>
  );
}

function PadStatus() {
  const sim = useSim();
  useFrameTick(2);
  const pad = sim?.input.getGamepad();
  return (
    <p className="title-pad" data-testid="title-pad">
      {pad ? `🎮 ${pad.id}` : '⌨ Keyboard mode · plug in a radio (USB joystick) or gamepad to fly with it'}
    </p>
  );
}
