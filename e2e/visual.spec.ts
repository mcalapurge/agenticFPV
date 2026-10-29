// Screenshot comparisons of every settings tab. Baselines are per platform (fonts differ);
// create/refresh them with `npm run test:visual:update`.

import { expect, openMenu, test } from './fixtures';

const TABS = ['Race', 'Quad', 'Controller', 'Rates', 'PIDs', 'Filters', 'Physics', 'Video, Env & Audio', 'Help'];

test.beforeEach(async ({ app }) => {
  // Freeze everything that isn't the menu: stop the render loop and hide the 3D view, GPU banner and toasts.
  await app.evaluate(() => window.__fpv!.sim.stop());
  await app.addStyleTag({ content: '#view, #gpuwarn, #toast, #osd, #sticks { visibility: hidden !important; }' });
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
