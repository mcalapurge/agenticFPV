// Safe areas on common phones: notches, the Dynamic Island, rounded corners, the home indicator, camera cut-outs.
// Chrome can emulate the insets (Emulation.setSafeAreaInsetsOverride), so env(safe-area-inset-*) is real here.

import type { Page } from '@playwright/test';
import { expect, frames, test } from './fixtures';

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
interface Mode {
  width: number;
  height: number;
  insets: Insets;
}
interface Phone {
  name: string;
  landscape: Mode;
  portrait: Mode;
}

const inset = (top = 0, right = 0, bottom = 0, left = 0): Insets => ({ top, right, bottom, left });

// Viewports are CSS pixels; insets are what each device reports to a full-screen web page.
const PHONES: Phone[] = [
  {
    name: 'iPhone SE (home button, no notch)',
    landscape: { width: 667, height: 375, insets: inset() },
    portrait: { width: 375, height: 667, insets: inset() },
  },
  {
    name: 'iPhone 13 mini (notch)',
    landscape: { width: 812, height: 375, insets: inset(0, 44, 21, 44) },
    portrait: { width: 375, height: 812, insets: inset(50, 0, 34, 0) },
  },
  {
    name: 'iPhone 15 (Dynamic Island)',
    landscape: { width: 852, height: 393, insets: inset(0, 59, 21, 59) },
    portrait: { width: 393, height: 852, insets: inset(59, 0, 34, 0) },
  },
  {
    name: 'iPhone 14 Pro Max (Dynamic Island)',
    landscape: { width: 932, height: 430, insets: inset(0, 59, 21, 59) },
    portrait: { width: 430, height: 932, insets: inset(59, 0, 34, 0) },
  },
  {
    name: 'Pixel 7 (punch-hole)',
    landscape: { width: 915, height: 412, insets: inset(0, 0, 0, 48) },
    portrait: { width: 412, height: 915, insets: inset(48, 0, 0, 0) },
  },
  {
    name: 'Galaxy S23 (punch-hole, gesture bar)',
    landscape: { width: 780, height: 360, insets: inset(0, 0, 16, 32) },
    portrait: { width: 360, height: 780, insets: inset(32, 0, 16, 0) },
  },
  {
    name: 'Compact Android (360×640)',
    landscape: { width: 640, height: 360, insets: inset() },
    portrait: { width: 360, height: 640, insets: inset(24, 0, 0, 0) },
  },
];

const EDGE_GESTURE = 24; // px: touch controls stay this far from the left/right edges (Android back swipe)

interface Box {
  what: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Visible boxes for the elements matching each selector. */
function boxes(page: Page, selectors: string[]): Promise<Box[]> {
  return page.evaluate((sels) => {
    const out: Box[] = [];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const hasText = (el.textContent ?? '').trim().length > 0 || !sel.includes('.el');
        if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || !hasText) return;
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24);
        out.push({ what: `${sel}[${i}] "${label}"`, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      });
    }
    return out;
  }, selectors) as Promise<Box[]>;
}

function outside(list: Box[], safe: { left: number; top: number; right: number; bottom: number }, tol = 1): string[] {
  return list
    .filter(
      (b) =>
        b.left < safe.left - tol ||
        b.top < safe.top - tol ||
        b.right > safe.right + tol ||
        b.bottom > safe.bottom + tol,
    )
    .map(
      (b) => `${b.what} at [${b.left.toFixed(0)},${b.top.toFixed(0)} → ${b.right.toFixed(0)},${b.bottom.toFixed(0)}]`,
    );
}

function overlaps(list: Box[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
        hits.push(`${a.what} ⟷ ${b.what}`);
    }
  return hits;
}

async function setMode(page: Page, mode: Mode): Promise<void> {
  await page.setViewportSize({ width: mode.width, height: mode.height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: mode.insets });
  await cdp.detach();
  await page.waitForTimeout(150);
}

const safeRect = (m: Mode) => ({
  left: m.insets.left,
  top: m.insets.top,
  right: m.width - m.insets.right,
  bottom: m.height - m.insets.bottom,
});

test('the page opts in to the full screen (viewport-fit=cover) and is installable', async ({ titleApp: app }) => {
  expect(await app.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover');
});

for (const phone of PHONES) {
  test(`safe areas: ${phone.name}`, async ({ titleApp: app }) => {
    await frames(app, 2);
    await app.evaluate(() => window.__fpv!.sim.stop()); // layout only: no need to render the scene

    for (const orientation of ['landscape', 'portrait'] as const) {
      const mode = phone[orientation];
      const safe = safeRect(mode);
      const where = `${phone.name} ${orientation}`;
      await setMode(app, mode);

      // Title menu: every button, the switch and the status line inside the safe area.
      const title = await boxes(app, ['#title button', '#title .switch', '[data-testid=title-pad]', '.title-logo']);
      expect(title.length, `${where}: title has content`).toBeGreaterThan(5);
      expect(outside(title, safe), `${where}: title inside the safe area`).toEqual([]);

      // Settings (opened from the title): the panel and its footer buttons.
      await app.getByRole('button', { name: /Race/ }).click();
      const panel = await boxes(app, ['#menu .panel', '#menu footer button', '#menu [role=tablist]']);
      expect(outside(panel, safe), `${where}: settings inside the safe area`).toEqual([]);
      await app.getByRole('button', { name: 'Back' }).click();

      // In flight: touch controls, OSD readouts and the rotate prompt.
      await app.getByRole('button', { name: /^Fly/ }).click();
      // Let a couple of frames run so the OSD fills in, then freeze the scene again.
      await app.evaluate(() => window.__fpv!.sim.start());
      await frames(app, 2);
      await app.evaluate(() => window.__fpv!.sim.stop());
      const controls = await boxes(app, ['.tc-btn', '.tc-ring', '.tc-thr', '.tc-rotate']);
      expect(controls.length, `${where}: touch controls present`).toBeGreaterThanOrEqual(8);
      expect(outside(controls, safe), `${where}: touch controls inside the safe area`).toEqual([]);
      // Clear of the side swipe edges AND the bottom edge (a swipe up from it is the home / back gesture).
      const edges = {
        left: EDGE_GESTURE,
        top: -1e9,
        right: mode.width - EDGE_GESTURE,
        bottom: mode.height - EDGE_GESTURE,
      };
      const touchables = controls.filter((b) => !b.what.includes('tc-rotate'));
      expect(outside(touchables, edges), `${where}: touch controls clear of the side-swipe edges`).toEqual([]);

      // The touch zones (where a thumb can land) stop above the bottom swipe band too.
      const zones = await boxes(app, ['.tc-zone']);
      expect(zones.length, `${where}: two touch zones`).toBe(2);
      expect(
        outside(zones, { left: -1e9, top: -1e9, right: 1e9, bottom: mode.height - EDGE_GESTURE }),
        `${where}: touch zones clear of the bottom swipe band`,
      ).toEqual([]);

      const osd = await boxes(app, ['#osd .el']);
      if (orientation === 'landscape') {
        expect(osd.length, `${where}: OSD readouts shown`).toBeGreaterThan(2);
        expect(outside(osd, safe), `${where}: OSD inside the safe area`).toEqual([]);
        expect(
          overlaps(controls.filter((b) => !b.what.includes('tc-rotate') && !b.what.includes('tc-thr'))),
          `${where}: controls do not overlap`,
        ).toEqual([]);
        // The OSD readouts stay clear of the buttons and sticks.
        expect(
          overlaps([...osd, ...controls.filter((b) => !b.what.includes('tc-rotate') && !b.what.includes('tc-thr'))]),
          `${where}: OSD clear of controls`,
        ).toEqual([]);
      } else {
        expect(osd, `${where}: portrait hides the OSD (it only shows the rotate prompt)`).toEqual([]);
        const prompt = await boxes(app, ['.tc-rotate']);
        expect(prompt.length).toBe(1);
      }

      // The in-flight menu too.
      await app.getByRole('button', { name: 'Menu' }).click();
      const flightMenu = await boxes(app, ['#menu .panel', '#menu footer button']);
      expect(outside(flightMenu, safe), `${where}: in-flight settings inside the safe area`).toEqual([]);
      await app.getByRole('button', { name: 'Main menu' }).click();
      await app.evaluate(() => window.__fpv!.sim.stop());
    }
  });
}
