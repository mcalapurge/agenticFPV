import { expect, frames, test } from './fixtures';

test('DVR replay: enter, change speed, pause, exit', async ({ app }) => {
  await app.keyboard.press('Space');
  await app.keyboard.down('w');
  await app.waitForFunction(() => window.__fpv!.sim.replay.duration > 2, null, { timeout: 60_000 });
  await app.keyboard.up('w');

  await app.keyboard.press('p');
  await expect(app.getByTestId('osd-lap')).toContainText('▶ REPLAY');
  expect(await app.evaluate(() => window.__fpv!.sim.paused)).toBe(true);

  await app.keyboard.press('ArrowUp');
  await expect(app.getByTestId('osd-lap')).toContainText('×2');
  await app.keyboard.press('Space');
  await expect(app.getByTestId('osd-lap')).toContainText('❚❚');
  const cursor = await app.evaluate(() => window.__fpv!.sim.replay.cursor);
  await frames(app, 3);
  expect(await app.evaluate(() => window.__fpv!.sim.replay.cursor)).toBe(cursor);
  await app.keyboard.press('ArrowLeft');
  expect(await app.evaluate(() => window.__fpv!.sim.replay.cursor)).toBeLessThanOrEqual(cursor);

  await app.keyboard.press('p');
  await expect(app.getByTestId('osd-lap')).not.toContainText('REPLAY');
  expect(await app.evaluate(() => window.__fpv!.sim.paused)).toBe(false);
});
