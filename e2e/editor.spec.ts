import { closeMenu, expect, frames, openMenu, teleport, test } from './fixtures';

test('track editor: place, undo, save and reload a custom track', async ({ app }) => {
  await openMenu(app);
  await app.getByRole('button', { name: /^Track editor/ }).click();
  await app.getByRole('button', { name: 'Clear gates' }).click();
  await expect(app.getByText('0 gates', { exact: true })).toBeVisible();
  await closeMenu(app);

  for (const [x, z] of [
    [0, 30],
    [0, 10],
    [12, -5],
    [25, -5],
  ]) {
    await teleport(app, [[x, 3, z]]);
    await frames(app, 1);
    await app.keyboard.press('g');
  }
  await expect(app.getByRole('status')).toContainText('Gate 4 placed');
  await app.keyboard.press('Backspace');
  await expect(app.getByRole('status')).toContainText('Gate removed (3 left)');

  await app.keyboard.press('Escape');
  await expect(app.getByText('3 gates', { exact: true })).toBeVisible();
  await app.getByLabel('Track name').fill('E2E Loop');
  await app.getByRole('button', { name: 'Save track' }).click();
  await expect(app.getByRole('status')).toContainText('Track “E2E Loop” saved');
  await expect(app.locator('.trackrow', { hasText: 'E2E Loop (custom)' })).toHaveClass(/active/);

  await app.reload();
  await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
  const track = await app.evaluate(() => window.__fpv!.sim.game.track);
  expect(track.name).toBe('E2E Loop');
  expect(track.gates).toHaveLength(3);
  expect(track.gates[0].p[2]).toBeCloseTo(28, 0); // 2 m ahead of where the quad was (facing -Z)
});
