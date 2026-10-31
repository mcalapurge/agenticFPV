// The demo autopilot flying the real flight controller + physics headlessly (no renderer).

import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DemoPilot, type PilotCommand, type Waypoint } from '../../src/engine/demo/demoPilot';
import { DEMO_ROUTE } from '../../src/engine/demo/demoRoute';
import { CollisionWorld } from '../../src/engine/sim/collision';
import { DEFAULT_CONFIG } from '../../src/state/configSchema';
import { DT, makeSim, upY } from './helpers/sim';

const PAD = new Vector3(0, 0.2, 60);

interface Flight {
  pilot: DemoPilot;
  samples: { t: number; pos: Vector3; speed: number; up: number; cmd: PilotCommand }[];
  impacts: { t: number; v: number }[];
}

/** Fly `seconds` of demo from the pad; returns what happened. */
function fly(seconds: number, route: readonly Waypoint[] = DEMO_ROUTE, world = new CollisionWorld()): Flight {
  const sim = makeSim((c) => {
    // The same stock tune the app uses for demo flights.
    c.physics = { ...DEFAULT_CONFIG.physics, battery: false, crashEnabled: false };
  });
  sim.collide = (q) => void world.resolveQuad(q, sim.cfg.physics);
  sim.quad.reset(PAD, 0);
  sim.fc.armed = false;
  const pilot = new DemoPilot({ route, probe: (o, d, m) => world.raycast(o, d, m)?.t ?? null });
  const samples: Flight['samples'] = [];
  const impacts: Flight['impacts'] = [];
  const frame = 0.016;
  const perFrame = Math.round(frame / DT);
  for (let t = 0; t < seconds; t += frame) {
    const cmd = pilot.update(frame, { pos: sim.quad.pos, vel: sim.quad.vel, quat: sim.quad.quat, gyro: sim.quad.gyro });
    sim.fc.modeOverride = cmd.mode;
    sim.fc.armed = cmd.armSwitch && (sim.fc.armed || cmd.throttle < 0.05);
    for (let i = 0; i < perFrame; i++) {
      sim.quad.step(DT, sim.fc.update(cmd, sim.quad.gyro, sim.quad.attitude), sim.collide);
      if (sim.quad.lastImpact > 0.8) impacts.push({ t, v: sim.quad.lastImpact });
      sim.quad.lastImpact = 0;
    }
    samples.push({ t, pos: sim.quad.pos.clone(), speed: sim.quad.vel.length(), up: upY(sim), cmd });
  }
  return { pilot, samples, impacts };
}

describe('demo route', () => {
  it('is well formed and stays inside the perimeter', () => {
    expect(DEMO_ROUTE.length).toBeGreaterThan(8);
    for (const wp of DEMO_ROUTE) {
      expect(Math.abs(wp.p[0])).toBeLessThan(120);
      expect(Math.abs(wp.p[2])).toBeLessThan(120);
      expect(wp.p[1]).toBeGreaterThan(5); // well clear of the ground
    }
  });

  it('shows off every trick', () => {
    const tricks = new Set(DEMO_ROUTE.map((w) => w.trick).filter(Boolean));
    expect([...tricks].sort()).toEqual(['backflip', 'flip', 'powerloop', 'roll', 'spin', 'tumble']);
  });

  it('needs at least two waypoints', () => {
    expect(() => new DemoPilot({ route: [DEMO_ROUTE[0]] })).toThrow();
  });
});

describe('autopilot flight', () => {
  const flight = fly(120);

  it('arms, takes off and flies laps without touching anything after launch', () => {
    expect(flight.pilot.stats.laps).toBeGreaterThanOrEqual(1);
    expect(flight.impacts.filter((i) => i.t > 3)).toEqual([]);
    const after = flight.samples.filter((s) => s.t > 6);
    expect(Math.min(...after.map((s) => s.pos.y))).toBeGreaterThan(3);
  });

  it('keeps a believable speed (fast, but a 5" quad’s, not a missile)', () => {
    const top = Math.max(...flight.samples.map((s) => s.speed));
    expect(top).toBeGreaterThan(12);
    expect(top).toBeLessThan(25);
  });

  it('performs every trick type at least once and none are skipped on open ground', () => {
    expect(Object.keys(flight.pilot.stats.tricks).sort()).toEqual([
      'backflip',
      'flip',
      'powerloop',
      'roll',
      'spin',
      'tumble',
    ]);
    expect(flight.pilot.stats.skippedTricks).toBe(0);
  });

  it('switches to acro for the flips and back to angle to recover', () => {
    const modes = new Set(flight.samples.map((s) => s.cmd.mode));
    expect(modes).toEqual(new Set(['acro', 'angle']));
    // After each trick the quad is the right way up again within a second.
    let prevMode = 'angle';
    for (let i = 0; i < flight.samples.length; i++) {
      const m = flight.samples[i].cmd.mode;
      if (prevMode === 'acro' && m === 'angle') {
        const later = flight.samples[Math.min(flight.samples.length - 1, i + 60)];
        expect(later.up).toBeGreaterThan(0.6);
      }
      prevMode = m;
    }
  });

  it('calls tricks out for the HUD', () => {
    const captions = new Set(flight.samples.map((s) => s.cmd.caption).filter(Boolean));
    expect(captions).toContain('POWER LOOP');
    expect(captions).toContain('FRONT FLIP');
  });

  it('directs the camera: chase, orbit and the pilot view, with an orbit close-up for tricks', () => {
    const cams = new Set(flight.samples.map((s) => s.cmd.camera));
    expect(cams).toEqual(new Set(['chase', 'orbit', 'fpv']));
    const trickFrames = flight.samples.filter((s) => s.cmd.caption);
    expect(trickFrames.every((s) => s.cmd.camera === 'orbit')).toBe(true);
  });

  it('is deterministic for a given seed (apart from sensor noise in the physics)', () => {
    const cams = (seed: number) => {
      const p = new DemoPilot({ route: DEMO_ROUTE, seed });
      const out: string[] = [];
      const view = { pos: PAD.clone(), vel: new Vector3(), quat: new Quaternion(), gyro: [0, 0, 0] };
      for (let t = 0; t < 40; t += 0.1) out.push(p.update(0.1, view).camera);
      return out.join();
    };
    expect(cams(3)).toBe(cams(3));
  });
});

describe('safety', () => {
  it('climbs over a wall in its path instead of hitting it', () => {
    const world = new CollisionWorld();
    // A 22 m wall right across the climb-out.
    world.addBox(new Vector3(0, 11, 30), new Vector3(40, 11, 1));
    const flight = fly(60, DEMO_ROUTE, world);
    expect(flight.pilot.stats.evades).toBeGreaterThan(0);
    expect(flight.impacts.filter((i) => i.t > 3)).toEqual([]);
  });

  it('skips a trick when there is not enough room below', () => {
    const world = new CollisionWorld();
    world.addBox(new Vector3(0, 0, 0), new Vector3(400, 21, 400)); // a roof 21 m up: only 9 m below us at 30 m
    const route: Waypoint[] = [
      { p: [0, 30, 46], speed: 8 },
      { p: [0, 30, 0], speed: 15, trick: 'flip' },
      { p: [0, 30, -60], speed: 15 },
    ];
    const pilot = new DemoPilot({ route, probe: (o, d, m) => world.raycast(o, d, m)?.t ?? null });
    const view = { pos: new Vector3(0, 30, 44), vel: new Vector3(0, 0, -12), quat: new Quaternion(), gyro: [0, 0, 0] };
    pilot.update(1, view); // arming
    pilot.update(0.016, view); // reaches the take-off waypoint
    expect(pilot.index).toBe(1);
    view.pos.set(0, 30, 3);
    pilot.update(0.016, view); // reaches the trick waypoint
    expect(pilot.stats.skippedTricks).toBe(1);
    expect(pilot.stats.tricks.flip).toBeUndefined();
    expect(pilot.phase).toBe('cruise');
    expect(pilot.index).toBe(2);
  });

  it('does the same trick when the room is there', () => {
    const route: Waypoint[] = [
      { p: [0, 30, 46], speed: 8 },
      { p: [0, 30, 0], speed: 15, trick: 'flip' },
      { p: [0, 30, -60], speed: 15 },
    ];
    const pilot = new DemoPilot({ route, probe: () => null });
    const view = { pos: new Vector3(0, 30, 44), vel: new Vector3(0, 0, -12), quat: new Quaternion(), gyro: [0, 0, 0] };
    pilot.update(1, view);
    pilot.update(0.016, view);
    view.pos.set(0, 30, 3);
    const cmd = pilot.update(0.016, view);
    expect(pilot.phase).toBe('trick');
    expect(pilot.stats.tricks.flip).toBe(1);
    expect(cmd.camera).toBe('orbit');
  });
});
