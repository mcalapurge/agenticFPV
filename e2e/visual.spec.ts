// Screenshot comparisons of the title menu and every settings tab. Baselines are per platform
// (fonts differ); create/refresh them with `npm run test:visual:update`.

import { devices } from '@playwright/test';
import { expect, openMenu, test } from './fixtures';

const TABS = ['Race', 'Quad', 'Controller', 'Rates', 'PIDs', 'Filters', 'Physics', 'Video, Env & Audio', 'Help'];

// Hide everything that isn't the UI under test: the live 3D view, GPU banner and toasts.
const HIDE_SCENE = '#view, #gpuwarn, #toast, #osd, #sticks { visibility: hidden !important; }';

test('title menu', async ({ titleApp: app }) => {
  await app.evaluate(() => window.__fpv!.sim.stop());
  await app.addStyleTag({ content: HIDE_SCENE });
  await expect(app.locator('#title')).toHaveScreenshot('title-menu.png', { animations: 'disabled' });
});

test.describe('settings tabs', () => {
  test.beforeEach(async ({ app }) => {
    // Stop the render loop so the (hidden) scene can't change under the screenshot.
    await app.evaluate(() => window.__fpv!.sim.stop());
    await app.addStyleTag({ content: HIDE_SCENE });
    await openMenu(app);
  });

  for (const tab of TABS) {
    test(`settings: ${tab}`, async ({ app }) => {
      await app.getByRole('tab', { name: tab }).click();
      const panel = app.locator('#menu .panel');
      await expect(panel).toHaveScreenshot(`settings-${tab.split(/[ ,]/)[0].toLowerCase()}.png`, {
        animations: 'disabled',
      });
    });
  }
});

// A phone in landscape: the title and the touch HUD (everything except the live 3D view).
test.describe('phone', () => {
  const { defaultBrowserType: _browser, ...phone } = devices['Pixel 7 landscape'];
  test.use({ ...phone, deviceScaleFactor: 1 });

  test('title menu on a phone', async ({ titleApp: app }) => {
    await app.evaluate(() => window.__fpv!.sim.stop());
    await app.addStyleTag({ content: HIDE_SCENE });
    await expect(app.locator('#title')).toHaveScreenshot('title-menu-phone.png', { animations: 'disabled' });
  });

  test('touch controls HUD', async ({ app }) => {
    await app.evaluate(() => window.__fpv!.sim.stop());
    await app.addStyleTag({ content: HIDE_SCENE });
    await expect(app.locator('#touch')).toHaveScreenshot('touch-controls.png', { animations: 'disabled' });
  });
});
