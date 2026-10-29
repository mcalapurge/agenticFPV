import { closeMenu, expect, frames, openMenu, test } from './fixtures';

test('keyboard: arm, take off, reset', async ({ app }) => {
  await app.keyboard.press('Space');
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);
  await expect(app.getByTestId('osd-tc')).toHaveText('');
  await app.keyboard.down('w');
  await app.waitForFunction(() => window.__fpv!.sim.fc.throttle > 0.45, null, { timeout: 60_000 });
  await app.keyboard.up('w');
  await app.waitForFunction(() => window.__fpv!.sim.quad.pos.y > 2, null, { timeout: 60_000 });
  expect(await app.evaluate(() => window.__fpv!.sim.state.flightTime)).toBeGreaterThan(0);

  await app.keyboard.press('x'); // throttle cut
  await app.keyboard.press('r');
  // Back on the pad; the arm switch is still on with throttle low, so it re-arms like a switch-armed quad.
  await app.waitForFunction(() => {
    const { sim } = window.__fpv!;
    return sim.quad.pos.distanceTo(sim.map.spawn.pos) < 0.5 && sim.state.flightTime < 1;
  });
  await app.keyboard.press('Space');
  await expect(app.getByTestId('osd-tc')).toHaveText('DISARMED');
});

test('refuses to arm with throttle up', async ({ app }) => {
  await app.keyboard.down('w');
  await app.waitForFunction(() => window.__fpv!.sim.rc.throttle > 0.2, null, { timeout: 60_000 });
  await app.keyboard.up('w');
  await app.keyboard.press('Space');
  await expect(app.getByTestId('osd-warn')).toHaveText('THROTTLE HIGH');
  expect(await app.evaluate(() => window.__fpv!.sim.state.armed)).toBe(false);
  await app.keyboard.press('x');
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);
});

test('the settings menu pauses the simulation', async ({ app }) => {
  await openMenu(app);
  const t0 = await app.evaluate(() => window.__fpv!.sim.state.simTime);
  await frames(app, 3);
  expect(await app.evaluate(() => window.__fpv!.sim.state.simTime)).toBe(t0);
  await closeMenu(app);
  await frames(app, 3);
  expect(await app.evaluate(() => window.__fpv!.sim.state.simTime)).toBeGreaterThan(t0);
});

test('hotkeys: camera, flight mode, perf readout, blackbox, help', async ({ app }) => {
  const cfg = () => app.evaluate(() => window.__fpv!.config());
  await app.keyboard.press('c');
  expect((await cfg()).camera.mode).toBe('chase');
  await app.keyboard.press('m');
  expect((await cfg()).flight.mode).toBe('angle');
  await expect(app.getByTestId('osd-tr')).toContainText('ANGL'); // Betaflight's 4-char OSD flag

  await app.keyboard.press('f');
  await expect(app.getByTestId('osd-perf')).toContainText(/\d+ FPS/);
  await expect(app.getByTestId('osd-perf')).toContainText('SOFTWARE GL');
  await app.keyboard.press('f');
  await expect(app.getByTestId('osd-perf')).toBeHidden();

  await app.keyboard.press('b');
  await expect(app.locator('#blackbox')).toHaveClass('show');

  await app.keyboard.press('h');
  await expect(app.getByRole('tab', { name: 'Help' })).toHaveAttribute('aria-selected', 'true');
});

test('crashing into a wall disarms (when crash detection is on)', async ({ app }) => {
  await app.evaluate(() => window.__fpv!.update((c) => void (c.physics.crashEnabled = true)));
  await app.keyboard.press('Space');
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);
  // Fire the quad at the nearest wall at 30 m/s.
  await app.evaluate(() => {
    const { sim } = window.__fpv!;
    const b = sim.collision.boxes.find((x) => x.half.y > 2 && x.half.x > 2)!;
    const target = b.center.clone();
    target.y = Math.min(target.y, 2);
    const start = target.clone().add(
      sim.quad.pos
        .clone()
        .set(0, 0, b.half.z + 4)
        .applyQuaternion(b.quat),
    );
    sim.quad.pos.copy(start);
    sim.quad.vel.copy(target.sub(start).normalize().multiplyScalar(30));
  });
  await app.waitForFunction(() => window.__fpv!.sim.state.crashed, null, { timeout: 30_000 });
  await expect(app.getByTestId('osd-warn')).toHaveText('CRASHED · PRESS R');
  await app.keyboard.press('r');
  await app.waitForFunction(() => !window.__fpv!.sim.state.crashed);
});
