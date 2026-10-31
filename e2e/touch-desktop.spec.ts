// Touch controls on a desktop browser: off by default, one switch turns them on, and a mouse can drag the sticks.

import { expect, test } from './fixtures';

test('desktop: off by default; the title switch turns them on; the mouse drives the sticks', async ({
  titleApp: app,
}) => {
  const sw = app.getByRole('switch', { name: 'Touch controls' });
  await expect(sw).not.toBeChecked();
  await expect(app.getByTestId('touch-switch-note')).toHaveText('auto: desktop detected');
  await expect(app.getByTestId('title-pad')).toContainText('Keyboard mode');

  await sw.click();
  await expect(sw).toBeChecked();
  await expect(app.getByTestId('title-pad')).toContainText('Touch controls on');
  await app.getByRole('button', { name: 'Fly', exact: true }).click();
  await expect(app.getByTestId('touch-controls')).toBeVisible();

  await app.getByRole('button', { name: 'Arm' }).click();
  await app.waitForFunction(() => window.__fpv!.sim.state.armed, null, { timeout: 60_000 });

  // Drag the left stick up with the mouse, then the right stick up-right.
  await app.mouse.move(200, 600);
  await app.mouse.down();
  await app.mouse.move(200, 520, { steps: 4 });
  await app.mouse.move(200, 440, { steps: 4 });
  await app.waitForFunction(() => window.__fpv!.sim.rc.throttle > 0.5, null, { timeout: 60_000 });
  await app.mouse.up();
  expect(await app.evaluate(() => window.__fpv!.sim.rc.throttle)).toBeGreaterThan(0.5); // holds

  await app.mouse.move(1000, 600);
  await app.mouse.down();
  await app.mouse.move(1050, 560, { steps: 4 });
  await app.waitForFunction(() => window.__fpv!.sim.rc.pitch > 0.3 && window.__fpv!.sim.rc.roll > 0.3, null, {
    timeout: 60_000,
  });
  await app.mouse.up();
  await app.waitForFunction(() => window.__fpv!.sim.rc.pitch === 0 && window.__fpv!.sim.rc.roll === 0);
});

test('desktop: the keyboard still works when touch controls are on only if they are off', async ({ app }) => {
  // Default desktop: keyboard flying, no touch UI.
  await expect(app.getByTestId('touch-controls')).toBeHidden();
  await app.keyboard.press('Space');
  await app.waitForFunction(() => window.__fpv!.sim.state.armed);
});

test('Settings → Controller: choose Always on / Off', async ({ app }) => {
  await app.keyboard.press('Escape');
  await app.getByRole('tab', { name: 'Controller' }).click();
  await app.getByLabel('On-screen sticks').selectOption('on');
  await app.getByRole('button', { name: 'Fly ▶' }).click();
  await expect(app.getByTestId('touch-controls')).toBeVisible();
  await app.getByRole('button', { name: 'Menu' }).click();
  await app.getByLabel('On-screen sticks').selectOption('off');
  await app.getByRole('button', { name: 'Fly ▶' }).click();
  await expect(app.getByTestId('touch-controls')).toBeHidden();
});
