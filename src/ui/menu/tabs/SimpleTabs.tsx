// Schema-driven tabs (Filters, Physics, Video/Env/Audio) and Help.

import { useConfigStore } from '../../../state/configStore';
import { useUiStore } from '../../../state/uiStore';
import { SchemaSections, Section } from '../fields';
import { SCHEMA } from '../schema';

export function FiltersTab() {
  return <SchemaSections sections={SCHEMA.filters} />;
}

export function PhysicsTab() {
  const p = useConfigStore((s) => s.config.physics);
  const tw = (p.motorThrustG * 4) / p.massG;
  return (
    <>
      <div className="section">
        <div className="derived" data-testid="thrust-to-weight">
          Thrust-to-weight: {tw.toFixed(1)} : 1 · Approx. hover throttle: {(Math.sqrt(1 / tw) * 100).toFixed(0)}%
        </div>
      </div>
      <SchemaSections sections={SCHEMA.physics} />
    </>
  );
}

export function CameraTab() {
  const gpu = useUiStore((s) => s.gpu);
  return (
    <>
      {gpu && (
        <div className="section">
          <div className={gpu.software ? 'warnline' : 'derived'}>
            GPU: {gpu.label} · {gpu.webgl2 ? 'WebGL 2' : 'WebGL 1'}
            {gpu.software ? ' · SOFTWARE RENDERING — enable hardware acceleration in your browser' : ' · hardware accelerated'}
          </div>
        </div>
      )}
      <SchemaSections sections={SCHEMA.camera} />
    </>
  );
}

const Kbd = ({ children }: { children: string }) => <kbd>{children}</kbd>;

export function HelpTab() {
  return (
    <>
      <Section title="Getting started">
        <p>1. Plug in your radio in USB Joystick mode (or a gamepad) and run the calibration wizard in the Controller tab.</p>
        <p>2. Map your arm switch. Arming requires throttle at zero, like Betaflight.</p>
        <p>3. Fly! Acro mode is the default. Switch to Angle mode in the PIDs tab, or map a switch, if you are learning.</p>
        <p>
          Race tab: Free fly, Practice (endless laps + ghost of your PB), Race (countdown, laps, results, leaderboard) or
          the Track editor. The next gate glows green, the one after yellow; the OSD arrow points to it when off-screen.
        </p>
        <p>
          Quad tab: pick a class (5" freestyle/race, 3" toothpick, cinewhoop, 7" long range, tiny whoop). PIDs tab: tune,
          or paste a Betaflight CLI diff.
        </p>
        <p>
          Crashed upside-down? Disarm, turn on turtle mode (switch or T), arm, and push the stick toward the side to flip
          over. Then disarm, turtle off, re-arm.
        </p>
      </Section>
      <Section title="Keys">
        <p>
          <Kbd>F</Kbd> performance stats · <Kbd>Esc</Kbd> / <Kbd>Tab</Kbd> menu · <Kbd>R</Kbd> reset / restart race ·{' '}
          <Kbd>C</Kbd> camera (FPV, chase, LOS, orbit) · <Kbd>M</Kbd> acro/angle · <Kbd>T</Kbd> turtle mode ·{' '}
          <Kbd>B</Kbd> blackbox trace · <Kbd>H</Kbd> help
        </p>
        <p>
          <Kbd>P</Kbd> replay (last 90 s): <Kbd>←</Kbd>
          <Kbd>→</Kbd> seek · <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> speed · <Kbd>Space</Kbd> pause · <Kbd>C</Kbd> camera
        </p>
        <p>
          Track editor: <Kbd>G</Kbd> place gate ahead of the quad · <Kbd>Backspace</Kbd> remove last gate · save from the
          Race tab
        </p>
        <p>
          Keyboard flying: <Kbd>W</Kbd>
          <Kbd>S</Kbd> throttle · <Kbd>X</Kbd> cut throttle · <Kbd>A</Kbd>
          <Kbd>D</Kbd> yaw · arrows pitch/roll · <Kbd>Space</Kbd> arm/disarm
        </p>
      </Section>
    </>
  );
}
