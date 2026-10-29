import { expect, frames, openMenu, test } from './fixtures';

test.beforeEach(async ({ app }) => {
  await openMenu(app);
});

test('PID edits reach the flight controller and persist across reloads', async ({ app }) => {
  await app.getByRole('tab', { name: 'PIDs' }).click();
  await app.getByLabel('roll p').fill('58');
  expect(await app.evaluate(() => window.__fpv!.sim.fc.config.pid.roll.p)).toBe(58);
  await app.reload();
  await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
  expect(await app.evaluate(() => window.__fpv!.sim.fc.config.pid.roll.p)).toBe(58);
});

test('Betaflight CLI import', async ({ app }) => {
  await app.getByRole('tab', { name: 'PIDs' }).click();
  await app.getByRole('button', { name: /Import from Betaflight CLI/ }).click();
  await app
    .getByLabel('Betaflight CLI')
    .fill('profile 0\nset p_pitch = 61\nset d_pitch = 50\nset gyro_lpf1_static_hz = 250');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Imported');
  await expect(app.getByLabel('pitch p')).toHaveValue('61');
  expect(await app.evaluate(() => window.__fpv!.config().filters.gyroLpfHz)).toBe(250);
});

test('quad class rebuilds the model and physics', async ({ app }) => {
  await app.getByRole('tab', { name: 'Quad' }).click();
  const before = await app.evaluate(() => window.__fpv!.sim.quad.mass);
  await app.getByTestId('preset-cinewhoop3').click();
  await expect(app.getByTestId('preset-cinewhoop3')).toHaveClass(/active/);
  await frames(app, 1);
  expect(await app.evaluate(() => window.__fpv!.sim.quad.mass)).toBeLessThan(before);
  expect(await app.evaluate(() => window.__fpv!.config().quad.preset)).toBe('cinewhoop3');
});

test('rates tab updates the max rate and keeps the graph live', async ({ app }) => {
  await app.getByRole('tab', { name: 'Rates' }).click();
  await app.getByLabel('pitch rate').fill('900');
  await expect(app.getByTestId('max-pitch')).toHaveText('900°/s');
  await expect(app.locator('canvas.graph')).toBeVisible();
  await app.getByLabel('Rates type').selectOption('betaflight');
  await expect(app.getByTestId('max-pitch')).toHaveText('667°/s');
});

test('reset tab restores defaults for that tab only', async ({ app }) => {
  await app.getByRole('tab', { name: 'Physics' }).click();
  await app.getByRole('spinbutton', { name: 'All-up weight (g)' }).fill('900');
  await app.getByRole('tab', { name: 'PIDs' }).click();
  await app.getByLabel('yaw p').fill('70');
  await app.getByRole('button', { name: 'Reset tab to defaults' }).click();
  await expect(app.getByLabel('yaw p')).toHaveValue('45');
  expect(await app.evaluate(() => window.__fpv!.config().physics.massG)).toBe(900);
});

test('environment changes apply to the scene', async ({ app }) => {
  await app.getByRole('tab', { name: 'Video, Env & Audio' }).click();
  const before = await app.evaluate(() => window.__fpv!.sim.renderer.toneMappingExposure);
  await app.getByLabel('Time of day').selectOption('night');
  await app.waitForFunction((b) => window.__fpv!.sim.renderer.toneMappingExposure !== b, before);
});
