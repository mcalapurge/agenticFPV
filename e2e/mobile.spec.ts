// A phone (Pixel 7, landscape): auto-detected touch controls, flown with real multi-touch.

import { expect, frames, test } from './fixtures';
import { Fingers } from './fingers';

const LEFT: [number, number] = [120, 300]; // inside the left stick's touch zone
const RIGHT: [number, number] = [740, 300];
const R = 58; // stick radius (px) at the default size

test.describe('detection and the title switch', () => {
  test('a phone is detected: touch controls on, with the switch showing why', async ({ titleApp: app }) => {
    const sw = app.getByRole('switch', { name: 'Touch controls' });
    await expect(sw).toBeChecked();
    await expect(app.getByTestId('touch-switch-note')).toHaveText('auto: phone or tablet detected');
    await expect(app.getByTestId('title-pad')).toContainText('Touch controls on');
    await expect(app.getByRole('button', { name: 'Fly', exact: true })).toBeVisible();
  });

  test('Fly (tap) shows the controls, with a touch-specific hint', async ({ titleApp: app }) => {
    await app.getByRole('button', { name: 'Fly', exact: true }).tap();
    await expect(app.getByRole('status')).toContainText('Tap ARM');
    await expect(app.getByTestId('touch-controls')).toBeVisible();
    for (const name of ['Menu', 'Reset', 'Camera', 'Flight mode', 'Cut throttle', 'Arm', 'Turtle mode']) {
      await expect(app.getByRole('button', { name })).toBeVisible();
    }
    await expect(app.getByTestId('osd')).toHaveClass(/touch/);
    expect(await app.locator('#sticks').evaluate((el) => getComputedStyle(el).display)).toBe('none');
  });

  test('the switch turns the controls off, and "use auto-detect" brings detection back', async ({ titleApp: app }) => {
    const sw = app.getByRole('switch', { name: 'Touch controls' });
    await sw.tap();
    await expect(sw).not.toBeChecked();
    await expect(app.getByTestId('touch-switch-note')).toContainText('set by you');
    expect(await app.evaluate(() => window.__fpv!.config().input.touch.mode)).toBe('off');
    await app.getByRole('button', { name: /^Fly/ }).tap(); // (with touch off the button shows the ↵ hint again)
    await expect(app.getByTestId('title')).toBeHidden();
    await expect(app.getByTestId('touch-controls')).toBeHidden(); // off means off, even on a phone

    // The choice survives a reload; auto-detect is one tap away.
    await app.reload();
    await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
    await expect(app.getByRole('switch', { name: 'Touch controls' })).not.toBeChecked();
    await app.getByRole('button', { name: 'use auto-detect' }).tap();
    await expect(app.getByRole('switch', { name: 'Touch controls' })).toBeChecked();
    expect(await app.evaluate(() => window.__fpv!.config().input.touch.mode)).toBe('auto');
  });
});

test.describe('flying with two thumbs', () => {
  test('arm, climb with the left thumb, steer with the right, and the throttle holds', async ({ app }) => {
    await app.getByRole('button', { name: 'Arm' }).tap();
    await app.waitForFunction(() => window.__fpv!.sim.state.armed, null, { timeout: 60_000 });
    await expect(app.getByRole('button', { name: 'Arm' })).toHaveText('ARMED');

    const fingers = await Fingers.attach(app);
    await fingers.down(1, ...LEFT);
    await fingers.down(2, ...RIGHT);
    // Left thumb up (throttle), right thumb up and to the right (pitch forward, roll right) — at once.
    await fingers.drag(1, LEFT, [LEFT[0], LEFT[1] - R * 1.2]);
    await fingers.drag(2, RIGHT, [RIGHT[0] + R * 0.6, RIGHT[1] - R * 0.6]);
    await app.waitForFunction(
      () => {
        const { rc } = window.__fpv!.sim;
        return rc.throttle > 0.4 && rc.pitch > 0.2 && rc.roll > 0.2;
      },
      null,
      { timeout: 60_000 },
    );
    await app.waitForFunction(() => window.__fpv!.sim.quad.pos.y > 1.5, null, { timeout: 90_000 });

    // Lift the right thumb: the stick centres. The left thumb is still down, so throttle is unchanged.
    await fingers.up(2);
    await app.waitForFunction(() => window.__fpv!.sim.rc.pitch === 0 && window.__fpv!.sim.rc.roll === 0, null, {
      timeout: 60_000,
    });
    expect(await app.evaluate(() => window.__fpv!.sim.rc.throttle)).toBeGreaterThan(0.4);

    // Lift the left thumb: throttle holds where it was (like a real radio)…
    await fingers.up(1);
    await frames(app, 2);
    expect(await app.evaluate(() => window.__fpv!.sim.rc.throttle)).toBeGreaterThan(0.4);
    // …until you cut it.
    await app.getByRole('button', { name: 'Cut throttle' }).tap();
    await app.waitForFunction(() => window.__fpv!.sim.rc.throttle === 0, null, { timeout: 60_000 });
  });

  test('the quick buttons: reset, camera, flight mode, menu', async ({ app }) => {
    // Flight mode
    await expect(app.getByRole('button', { name: 'Flight mode' })).toHaveText('ACRO');
    await app.getByRole('button', { name: 'Flight mode' }).tap();
    await expect(app.getByRole('button', { name: 'Flight mode' })).toHaveText('ANGL');
    expect(await app.evaluate(() => window.__fpv!.config().flight.mode)).toBe('angle');

    // Camera
    const cam = () => app.evaluate(() => window.__fpv!.config().camera.mode);
    const before = await cam();
    await app.getByRole('button', { name: 'Camera' }).tap();
    expect(await cam()).not.toBe(before);

    // Reset puts the quad back on the pad
    await app.evaluate(() => window.__fpv!.sim.quad.pos.set(40, 20, 0));
    await app.getByRole('button', { name: 'Reset' }).tap();
    await app.waitForFunction(() => {
      const { sim } = window.__fpv!;
      return sim.quad.pos.distanceTo(sim.map.spawn.pos) < 0.5;
    });

    // Menu: opens the settings, hides the sticks and lets go of the throttle; "Fly" comes back
    await app.evaluate(() => window.__fpv!.sim.input.touch.setLeft(0, 0.9));
    await app.getByRole('button', { name: 'Menu' }).tap();
    await expect(app.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(app.getByTestId('touch-controls')).toBeHidden();
    expect(await app.evaluate(() => window.__fpv!.sim.input.touch.throttle)).toBe(0);
    await app.getByRole('button', { name: 'Fly ▶' }).tap();
    await expect(app.getByTestId('touch-controls')).toBeVisible();
  });

  test('turtle button arms turtle mode for the next arm', async ({ app }) => {
    const turtle = app.getByRole('button', { name: 'Turtle mode' });
    await turtle.tap();
    await expect(turtle).toHaveAttribute('aria-pressed', 'true');
    expect(await app.evaluate(() => window.__fpv!.sim.input.kbTurtle)).toBe(true);
    await turtle.tap();
    await expect(turtle).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('layout on a phone', () => {
  test('portrait shows a "rotate" hint, landscape does not', async ({ app }) => {
    const hint = app.getByText('Rotate your phone to landscape');
    await expect(hint).toBeHidden();
    await app.setViewportSize({ width: 390, height: 844 });
    await expect(hint).toBeVisible();
    await app.setViewportSize({ width: 863, height: 360 });
    await expect(hint).toBeHidden();
  });

  for (const size of [
    { width: 863, height: 360 },
    { width: 390, height: 844 },
  ]) {
    test(`title and every settings tab fit the screen (${size.width}×${size.height})`, async ({ titleApp: app }) => {
      await app.setViewportSize(size);
      const noOverflow = () =>
        app.evaluate(() => ({
          x: document.documentElement.scrollWidth <= window.innerWidth,
          y: document.documentElement.scrollHeight <= window.innerHeight,
        }));
      expect(await noOverflow()).toEqual({ x: true, y: true });
      const buttons = await app.getByTestId('title').getByRole('button').all();
      for (const b of buttons) {
        const box = (await b.boundingBox())!;
        expect(box.x + box.width, 'title button inside the screen').toBeLessThanOrEqual(size.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      }

      await app.getByRole('button', { name: /Race/ }).tap();
      for (const tab of await app.getByRole('tab').all()) {
        await tab.scrollIntoViewIfNeeded();
        await tab.tap();
        const panel = (await app.locator('#menu .panel').boundingBox())!;
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.y).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 1);
        expect(panel.y + panel.height).toBeLessThanOrEqual(size.height + 1);
        expect(await noOverflow(), 'page itself never scrolls sideways').toMatchObject({ x: true });
      }
      // The footer buttons stay reachable.
      await expect(app.getByRole('button', { name: 'Back' })).toBeInViewport();
    });
  }
});

test.describe('demo on a phone', () => {
  test('"tap anywhere" returns to the title', async ({ titleApp: app }) => {
    await app.getByRole('button', { name: 'Watch demo' }).tap();
    await expect(app.getByTestId('demo-hint')).toHaveText(/tap anywhere/);
    await app.touchscreen.tap(430, 180);
    await expect(app.getByTestId('title')).toBeVisible();
  });
});
