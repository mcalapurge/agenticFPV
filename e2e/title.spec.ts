import { closeMenu, expect, frames, openMenu, test } from './fixtures';

const TRICKS = ['backflip', 'flip', 'powerloop', 'roll', 'spin', 'tumble'];

test.describe('title menu', () => {
  test('opens on the title with the autopilot flying behind it', async ({ titleApp: app }) => {
    await expect(app.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
    await expect(app.getByRole('button', { name: /^Fly/ })).toBeFocused();
    for (const name of ['Watch demo', /Race/, /Quad/, 'Controller', 'How to play']) {
      await expect(app.getByRole('button', { name })).toBeVisible();
    }
    // The player's HUD is hidden; the sim is flying itself.
    await expect(app.getByTestId('osd')).toBeHidden();
    expect(await app.evaluate(() => window.__fpv!.sim.demoActive)).toBe(true);
    await app.evaluate(() => window.__fpv!.sim.advance(12));
    const flying = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      return { armed: sim.state.armed, y: sim.quad.pos.y, mode: sim.fc.mode };
    });
    expect(flying.armed).toBe(true);
    expect(flying.y).toBeGreaterThan(5);
  });

  test('the software-rendering banner sits at the bottom, clear of the logo', async ({ titleApp: app }) => {
    const alert = app.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveClass(/at-bottom/);
    const box = (await alert.boundingBox())!;
    expect(box.y).toBeGreaterThan(400);
  });

  test('Enter starts flying; the keyboard then belongs to the player', async ({ titleApp: app }) => {
    await app.keyboard.press('Enter');
    // The hint toast appears once, when flying starts (it only lasts a few seconds).
    await expect(app.getByRole('status')).toContainText('Esc = settings');
    await expect(app.getByTestId('title')).toBeHidden();
    await expect(app.getByTestId('osd')).toBeVisible();
    const s = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      return { demo: sim.demoActive, override: sim.fc.modeOverride, onPad: sim.quad.pos.distanceTo(sim.map.spawn.pos) };
    });
    expect(s.demo).toBe(false);
    expect(s.override).toBeNull();
    expect(s.onPad).toBeLessThan(0.5);
    await expect(app.getByTestId('osd-tc')).toHaveText('DISARMED');
    await app.keyboard.press('Space');
    await app.waitForFunction(() => window.__fpv!.sim.state.armed);
  });

  test('starting to fly leaves no trace of the demo (replay, record, settings)', async ({ titleApp: app }) => {
    const before = await app.evaluate(() => JSON.stringify(window.__fpv!.config()));
    // Hand over and read in the same instant: once you are flying, the replay rightly starts recording YOUR
    // flight, and on a fast machine a few frames pass between a click and a later read.
    const r = await app.evaluate(() => {
      const { sim, ui } = window.__fpv!;
      sim.advance(30); // the demo has been recording
      const demoFootage = sim.replay.count;
      ui.getState().setScreen('playing');
      return { demoFootage, replay: sim.replay.count, records: localStorage.getItem('agenticfpv.records.v1') };
    });
    expect(r.demoFootage, 'the demo itself does not record either').toBe(0);
    expect(r.replay).toBe(0);
    expect(r.records).toBeNull();
    expect(await app.evaluate(() => JSON.stringify(window.__fpv!.config()))).toBe(before);
    await expect(app.getByTestId('title')).toBeHidden();
  });

  test('handing over drops the pilot’s stick positions at once', async ({ titleApp: app }) => {
    const rc = await app.evaluate(() => {
      const { sim, ui } = window.__fpv!;
      sim.advance(10); // the pilot is flying, switch armed, throttle up
      const during = { arm: sim.rc.armSwitch, throttle: sim.rc.throttle };
      ui.getState().setScreen('playing'); // synchronous: no frame runs in between
      return { during, after: { arm: sim.rc.armSwitch, throttle: sim.rc.throttle } };
    });
    expect(rc.during.arm).toBe(true);
    expect(rc.during.throttle).toBeGreaterThan(0.1);
    expect(rc.after).toEqual({ arm: false, throttle: 0 });
  });

  test('the demo flies the class you chose, on its stock tune, ignoring your personal edits', async ({
    titleApp: app,
  }) => {
    await app.evaluate(() =>
      window.__fpv!.update((c) => {
        c.quad.preset = 'race5';
        c.pid.roll.p = 0;
        c.pid.pitch.p = 0;
        c.physics.massG = 1200;
      }),
    );
    const demo = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      sim.advance(40);
      return { p: sim.fc.config.pid.roll.p, mass: sim.quad.mass, y: sim.quad.pos.y };
    });
    expect(demo.p).toBe(48); // the race class's own stock tune, not the broken 0
    expect(demo.mass).toBeCloseTo(0.52, 3); // the 5" race class, not the 1200 g edit
    expect(demo.y).toBeGreaterThan(5);
    // …and flying yourself uses exactly what you configured.
    await app.getByRole('button', { name: /^Fly/ }).click();
    const mine = await app.evaluate(() => ({
      p: window.__fpv!.sim.fc.config.pid.roll.p,
      mass: window.__fpv!.sim.quad.mass,
    }));
    expect(mine.p).toBe(0);
    expect(mine.mass).toBeCloseTo(1.2, 3);
  });

  test('choosing a quad class on the title screen changes the model, and the demo flies it', async ({
    titleApp: app,
  }) => {
    await app.getByRole('button', { name: /Quad/ }).click();
    const classes = [
      ['race5', 0.52],
      ['whoop65', 0.022],
      ['longrange7', 0.98],
      ['cinewhoop3', 0.33],
    ] as const;
    for (const [id, mass] of classes) {
      const before = await app.evaluate(() => {
        const w = window as unknown as { __model?: unknown };
        w.__model = window.__fpv!.sim.quadModel;
        return true;
      });
      expect(before).toBe(true);
      await app.getByTestId(`preset-${id}`).click();
      const after = await app.evaluate(() => {
        const { sim } = window.__fpv!;
        const w = window as unknown as { __model?: unknown };
        return {
          swapped: sim.quadModel !== w.__model,
          mass: sim.quad.mass,
          inScene: sim.scene.children.includes(sim.quadModel),
        };
      });
      expect(after.swapped, `${id}: model replaced`).toBe(true);
      expect(after.inScene, `${id}: new model is in the scene`).toBe(true);
      expect(after.mass).toBeCloseTo(mass, 3);
    }
    // The last class (65 mm whoop… then cinewhoop) keeps flying the demo without a scratch.
    await app.getByRole('button', { name: 'Back' }).click();
    const flown = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      sim.advance(8);
      const base = sim.stats.count;
      sim.advance(60);
      return { impacts: sim.stats.count - base, y: sim.quad.pos.y };
    });
    expect(flown.impacts).toBe(0);
    expect(flown.y).toBeGreaterThan(3);
  });
});

test.describe('settings from the title', () => {
  test('open on the right tab, Back returns to the title, Esc only closes', async ({ titleApp: app }) => {
    await app.getByRole('button', { name: /Quad/ }).click();
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(app.getByRole('tab', { name: 'Quad' })).toHaveAttribute('aria-selected', 'true');
    await expect(app.getByRole('button', { name: 'Main menu' })).toBeHidden();
    await app.getByTestId('preset-race5').click();
    await app.getByRole('button', { name: 'Back' }).click();
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await expect(app.getByTestId('title')).toBeVisible();
    expect(await app.evaluate(() => window.__fpv!.config().quad.preset)).toBe('race5');

    await app.keyboard.press('Escape'); // nothing to close: the settings do not open from the title
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await app.getByRole('button', { name: 'How to play' }).click();
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await expect(app.getByTestId('title')).toBeVisible();
  });

  test('"Main menu" in flight goes back to the title and the demo takes over', async ({ app }) => {
    await openMenu(app);
    await app.getByRole('button', { name: 'Main menu' }).click();
    await expect(app.getByTestId('title')).toBeVisible();
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    expect(await app.evaluate(() => window.__fpv!.sim.demoActive)).toBe(true);
    await expect(app.getByTestId('osd')).toBeHidden();
    // And back again.
    await app.getByRole('button', { name: /^Fly/ }).click();
    await closeMenuIfOpen(app);
    await app.keyboard.press('Space');
    await app.waitForFunction(() => window.__fpv!.sim.state.armed && !window.__fpv!.sim.demoActive);
  });
});

async function closeMenuIfOpen(app: import('@playwright/test').Page) {
  if (await app.getByRole('dialog', { name: 'Settings' }).isVisible()) await closeMenu(app);
}

test.describe('demo', () => {
  test('Watch demo: full-screen autopilot with OSD, trick call-outs and any-key exit', async ({ titleApp: app }) => {
    await app.getByRole('button', { name: 'Watch demo' }).click();
    await expect(app.getByTestId('title')).toBeHidden();
    await expect(app.getByTestId('demo-hint')).toBeVisible();
    await expect(app.getByTestId('osd')).toBeVisible();
    await expect(app.getByRole('alert')).toBeHidden(); // nothing covers the call-outs

    // Jump ahead to the first trick and let the render loop show it.
    await app.evaluate(() => {
      const { sim } = window.__fpv!;
      for (let i = 0; i < 2000 && sim.pilot.phase !== 'trick'; i++) sim.advance(0.05);
    });
    await expect(app.getByTestId('osd-lap')).toHaveText(/ROLL|FLIP|LOOP|SPIN|TUMBLE/);
    expect(await app.evaluate(() => window.__fpv!.sim.cameraMode)).toBe('orbit');
    await frames(app, 2);

    await app.keyboard.press('x');
    await expect(app.getByTestId('title')).toBeVisible();
    await expect(app.getByTestId('demo-hint')).toBeHidden();
  });

  test('a click also exits the demo', async ({ titleApp: app }) => {
    await app.getByRole('button', { name: 'Watch demo' }).click();
    await expect(app.getByTestId('demo-hint')).toBeVisible();
    await app.mouse.click(640, 360);
    await expect(app.getByTestId('title')).toBeVisible();
  });

  test('soak: ten minutes of demo flight on the real map — no crashes, every trick, laps completed', async ({
    titleApp: app,
  }) => {
    const r = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      sim.stop();
      sim.advance(6); // lift-off
      const base = sim.stats.count;
      let minY = Infinity;
      let top = 0;
      for (let t = 0; t < 600; t++) {
        sim.advance(1);
        minY = Math.min(minY, sim.quad.pos.y);
        top = Math.max(top, sim.quad.vel.length());
      }
      return { impacts: sim.stats.count - base, minY, top, pilot: sim.pilot.stats, crashed: sim.state.crashed };
    });
    expect(r.impacts).toBe(0);
    expect(r.crashed).toBe(false);
    expect(r.minY).toBeGreaterThan(3);
    expect(r.top).toBeLessThan(25);
    expect(r.pilot.laps).toBeGreaterThanOrEqual(5);
    expect(Object.keys(r.pilot.tricks).sort()).toEqual(TRICKS);
    expect(r.pilot.skippedTricks).toBeLessThanOrEqual(2);
    expect(r.pilot.evades).toBeLessThanOrEqual(5);
  });

  test('the director really cuts between cameras without touching the player’s setting', async ({ titleApp: app }) => {
    const cams = await app.evaluate(() => {
      const { sim } = window.__fpv!;
      sim.stop();
      const seen = new Set<string>();
      for (let t = 0; t < 120; t += 0.5) {
        sim.advance(0.5);
        seen.add(sim.cameraMode);
      }
      return { seen: [...seen].sort(), setting: window.__fpv!.config().camera.mode };
    });
    expect(cams.seen).toEqual(['chase', 'fpv', 'orbit']);
    expect(cams.setting).toBe('fpv');
  });
});
