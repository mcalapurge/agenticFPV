// Shared Playwright fixtures: boot the sim, fail on console errors, and drive the engine through window.__fpv.

import { test as base, expect, type Page } from '@playwright/test';

type Vec3 = [number, number, number];

/** Messages that are expected in headless software-GL runs. */
const IGNORED = [/GPU stall due to ReadPixels/, /AudioContext was not allowed to start/, /WebGL: INVALID_OPERATION/];

export const test = base.extend<{ app: Page; errors: string[] }>({
  errors: async ({}, use) => {
    await use([]);
  },
  app: async ({ page, errors }, use) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
    await expect(page.getByTestId('loading')).toBeHidden();
    await use(page);
    expect(errors, 'no console errors').toEqual([]);
  },
});

export { expect };

export async function openMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

export async function closeMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Fly ▶' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
}

/** Wait until the simulator has rendered `n` more frames. */
export function frames(page: Page, n = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const off = window.__fpv!.sim.onFrame(() => {
          if (--left <= 0) {
            off();
            resolve();
          }
        });
      }),
    n,
  );
}

/**
 * Teleport the quad through a sequence of points, one per rendered frame (velocity zeroed),
 * so the real frame loop sees each segment — used to "fly" through gates deterministically.
 */
export function teleport(page: Page, points: Vec3[]): Promise<void> {
  return page.evaluate(
    (pts) =>
      new Promise<void>((resolve) => {
        const { sim } = window.__fpv!;
        let i = 0;
        const off = sim.onFrame(() => {
          if (i >= pts.length) {
            off();
            resolve();
            return;
          }
          const [x, y, z] = pts[i++];
          sim.quad.pos.set(x, y, z);
          sim.quad.vel.set(0, 0, 0);
          sim.quad.omega.set(0, 0, 0);
        });
      }),
    points,
  );
}

/** Approach/exit points (±1.5 m along the gate's flight direction) for every gate of the current track, then gate 1 again. */
export function lapPath(page: Page, laps = 1): Promise<Vec3[]> {
  return page.evaluate((n) => {
    const { sim } = window.__fpv!;
    const gates = sim.game.gates;
    const out: Vec3[] = [];
    const toWorld = (g: (typeof gates)[number], z: number): Vec3 => {
      const p = sim.quad.pos.clone().set(0, 0, z).applyQuaternion(g.q).add(g.c);
      return [p.x, p.y, p.z];
    };
    for (let l = 0; l < n; l++) for (const g of gates) out.push(toWorld(g, 1.5), toWorld(g, -1.5));
    out.push(toWorld(gates[0], 1.5), toWorld(gates[0], -1.5));
    return out;
  }, laps);
}
