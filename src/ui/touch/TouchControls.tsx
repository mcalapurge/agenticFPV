// On-screen controls for phones and tablets: two sticks, ARM / cut / turtle, and the quick actions.
// Left stick = throttle (relative, holds its position like a radio) + yaw; right stick = roll + pitch.
// Fingers are tracked per pointer, so both sticks and a button can be used at the same time.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { applyExpo, CentreDetent, stickVector, throttleFromDrag } from '../../engine/input/touch';
import type { Simulator } from '../../engine/Simulator';
import { useConfigStore } from '../../state/configStore';
import { useSim } from '../../state/engineStore';
import { useUiStore } from '../../state/uiStore';
import { useSimFrame, useTouchEnabled } from '../hooks';

const BASE_RADIUS = 58; // px, at size 1
const KNOB_SIZE = 0.66; // knob diameter as a fraction of the ring radius (see .tc-knob in styles.css)

export function TouchControls() {
  const sim = useSim();
  const screen = useUiStore((s) => s.screen);
  const menuOpen = useUiStore((s) => s.menuOpen);
  const enabled = useTouchEnabled();
  if (!sim || !enabled || screen !== 'playing' || menuOpen) return null;
  return <Controls sim={sim} />;
}

function Controls({ sim }: { sim: Simulator }) {
  const touch = sim.input.touch;
  const cfg = useConfigStore((s) => s.config.input.touch);
  const mode = useConfigStore((s) => s.config.flight.mode);
  const radius = BASE_RADIUS * cfg.size;

  const leftKnob = useRef<HTMLDivElement>(null);
  const rightKnob = useRef<HTMLDivElement>(null);
  const thrBar = useRef<HTMLDivElement>(null);
  const armBtn = useRef<HTMLButtonElement>(null);
  const turtleBtn = useRef<HTMLButtonElement>(null);

  // Whatever the way out (menu, main menu, unmount), let go of the sticks so the quad doesn't keep a stale command.
  useEffect(() => () => touch.reset(), [touch]);

  const buzz = (ms = 12) => {
    if (cfg.haptics) navigator.vibrate?.(ms);
  };

  // A short tick when a thumb returns to (or crosses) a stick's centre, so you can feel where you are.
  // (Android only: iPhone Safari has no web vibration.)
  const [detents] = useState(() => ({ yaw: new CentreDetent(), roll: new CentreDetent(), pitch: new CentreDetent() }));
  const tickIfCentred = (...hits: boolean[]) => {
    if (cfg.centreHaptics && hits.some(Boolean)) navigator.vibrate?.(10);
  };

  // The knob is 0.66 of the ring radius wide, so it travels (ring radius − knob radius) to stay inside the ring:
  // at zero throttle it must not hang below the ring into the bottom swipe band (where a thumb does nothing).
  const travel = radius * (1 - KNOB_SIZE / 2);
  const knob = (x: number, y: number) => `translate(${(x * travel).toFixed(1)}px, ${(y * travel).toFixed(1)}px)`;

  useSimFrame((s) => {
    if (leftKnob.current) leftKnob.current.style.transform = knob(touch.yaw, 1 - 2 * touch.throttle);
    if (rightKnob.current) rightKnob.current.style.transform = knob(touch.roll, -touch.pitch);
    if (thrBar.current) thrBar.current.style.height = `${(touch.throttle * 100).toFixed(0)}%`;
    const armed = s.state.armed;
    const wantArm = s.input.kbArm;
    if (armBtn.current) {
      armBtn.current.classList.toggle('on', wantArm);
      armBtn.current.setAttribute('aria-pressed', String(wantArm));
      armBtn.current.textContent = armed ? 'ARMED' : wantArm ? 'ARMING…' : 'ARM';
    }
    turtleBtn.current?.classList.toggle('on', s.input.kbTurtle);
    turtleBtn.current?.setAttribute('aria-pressed', String(s.input.kbTurtle));
  });

  const tap = (fn: () => void) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    buzz();
    fn();
  };
  const ui = useUiStore.getState();

  return (
    <div id="touch" data-testid="touch-controls" style={{ ['--tc-r' as string]: `${radius}px` }}>
      <Pad
        side="left"
        radius={radius}
        onMove={(v, dragUp, start) => {
          touch.setLeft(applyExpo(v.x, cfg.expo), throttleFromDrag(start, dragUp, radius * 2));
          tickIfCentred(detents.yaw.update(v.x, performance.now()));
        }}
        onStart={() => {
          detents.yaw.reset();
          return touch.throttle;
        }}
        onEnd={() => touch.setLeft(0, cfg.throttleHold ? touch.throttle : 0)}
      />
      <Pad
        side="right"
        radius={radius}
        onMove={(v) => {
          touch.setRight(applyExpo(v.x, cfg.expo), applyExpo(-v.y, cfg.expo));
          const now = performance.now();
          tickIfCentred(detents.roll.update(v.x, now), detents.pitch.update(-v.y, now));
        }}
        onStart={() => {
          detents.roll.reset();
          detents.pitch.reset();
          return 0;
        }}
        onEnd={() => touch.setRight(0, 0)}
      />

      <div className={`tc-ring left ${cfg.leftHeight}`} aria-hidden>
        <div className="tc-thr">
          <div ref={thrBar} className="tc-thr-fill" />
        </div>
        <div ref={leftKnob} className="tc-knob" style={{ transform: knob(touch.yaw, 1 - 2 * touch.throttle) }} />
      </div>
      <div className={`tc-ring right ${cfg.rightHeight}`} aria-hidden>
        <div ref={rightKnob} className="tc-knob" style={{ transform: knob(touch.roll, -touch.pitch) }} />
      </div>

      <button className="tc-btn tc-menu" aria-label="Menu" onPointerDown={tap(() => ui.openMenu())}>
        ☰
      </button>
      <div className="tc-top-right">
        <button className="tc-btn" aria-label="Reset" onPointerDown={tap(() => sim.input.trigger('reset'))}>
          ↺
        </button>
        <button className="tc-btn" aria-label="Camera" onPointerDown={tap(() => sim.input.trigger('camera'))}>
          CAM
        </button>
        <button className="tc-btn" aria-label="Flight mode" onPointerDown={tap(() => sim.input.trigger('mode'))}>
          {mode === 'angle' ? 'ANGL' : 'ACRO'}
        </button>
      </div>
      <div className="tc-bottom">
        <button className="tc-btn small" aria-label="Cut throttle" onPointerDown={tap(() => touch.cutThrottle())}>
          CUT
        </button>
        <button
          ref={armBtn}
          className="tc-btn arm"
          aria-label="Arm"
          aria-pressed="false"
          onPointerDown={tap(() => sim.input.toggleArm())}
        >
          ARM
        </button>
        <button
          ref={turtleBtn}
          className="tc-btn small"
          aria-label="Turtle mode"
          aria-pressed="false"
          onPointerDown={tap(() => sim.input.toggleTurtle())}
        >
          TURTLE
        </button>
      </div>
      <div className="tc-rotate">Rotate your phone to landscape for the best control</div>
    </div>
  );
}

interface PadProps {
  side: 'left' | 'right';
  radius: number;
  /** v: stick vector (x right, y down, -1…1); dragUp: finger travel upward (px); start: value from onStart. */
  onMove: (v: { x: number; y: number }, dragUp: number, start: number) => void;
  /** Called when a finger lands; returns the value to start relative movement from (the throttle). */
  onStart: () => number;
  onEnd: () => void;
}

/** A touch zone. The stick works relative to where the finger lands; the ring above just shows its state. */
function Pad({ side, radius, onMove, onStart, onEnd }: PadProps) {
  const grab = useRef<{ id: number; x: number; y: number; start: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (grab.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: onStart() };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    onMove(stickVector(dx, dy, radius), -dy, g.start);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (grab.current?.id !== e.pointerId) return;
    grab.current = null;
    onEnd();
  };

  return (
    <div
      className={`tc-zone ${side}`}
      data-testid={`touch-pad-${side}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
