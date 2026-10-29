import { closeMenu, expect, lapPath, openMenu, teleport, test } from './fixtures';

test('race: countdown, holeshot, lap, results and leaderboard', async ({ app }) => {
  await app.evaluate(() => window.__fpv!.update((c) => void (c.game.laps = 1)));
  await openMenu(app);
  await app.getByRole('button', { name: /^Race Countdown/ }).click();
  await closeMenu(app);
  await expect(app.getByTestId('osd-lap')).toHaveText('RACE · ARM TO START');

  await app.keyboard.press('Space');
  await expect(app.getByTestId('osd-lap')).toHaveClass(/big/);
  await app.waitForFunction(() => window.__fpv!.sim.game.session.phase === 'running', null, { timeout: 60_000 });
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);

  await teleport(app, await lapPath(app));

  const results = app.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results).toContainText('Race complete');
  await expect(results).toContainText('Works Circuit');
  await expect(results).toContainText('Holeshot');
  await expect(results).toContainText('Lap 1');
  const stored = await app.evaluate(() => JSON.parse(localStorage.getItem('agenticfpv.records.v1') ?? '{}'));
  expect(stored.works.freestyle5.races).toHaveLength(1);
  expect(stored.works.freestyle5.bestLap).toBeGreaterThan(0);

  await app.keyboard.press('r');
  await expect(results).toBeHidden();
});

test('practice: lap timing, PB and ghost', async ({ app }) => {
  await openMenu(app);
  await app.getByRole('button', { name: /^Practice/ }).click();
  await closeMenu(app);
  await expect(app.getByTestId('osd-lap')).toContainText('PRACTICE · FLY THROUGH START');
  await app.keyboard.press('Space');
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);

  await teleport(app, await lapPath(app));
  await expect(app.getByTestId('osd-lap')).toContainText(/LAST \d\d:\d\d\.\d\d/);
  await expect(app.getByTestId('osd-lap')).toContainText(/PB \d\d:\d\d\.\d\d/);
  expect(await app.evaluate(() => window.__fpv!.sim.game.session.ghost?.length)).toBeGreaterThan(8);

  await app.keyboard.press('Escape');
  await expect(app.getByTestId('track-works')).toContainText(/PB with this quad: \d\d:\d\d\.\d\d/);
});

test('switching tracks moves the gates', async ({ app }) => {
  await openMenu(app);
  const gatePositions = () => app.evaluate(() => window.__fpv!.sim.game.gates.map((g) => g.c.toArray()));
  const before = await gatePositions();
  await app.getByTestId('track-warehouse').getByRole('button', { name: 'Select' }).click();
  await expect(app.getByTestId('track-warehouse')).toHaveClass(/active/);
  expect(await app.evaluate(() => window.__fpv!.sim.game.track.id)).toBe('warehouse');
  expect(await gatePositions()).not.toEqual(before);
  expect(await app.evaluate(() => window.__fpv!.config().game.mode)).toBe('practice');
});
