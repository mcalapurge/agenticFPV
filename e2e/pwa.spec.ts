// Installable web app: manifest + icons, the service worker, and playing with no network.

import { expect, test } from './fixtures';

test.use({ serviceWorkers: 'allow' });

test('the manifest is linked, valid, and every icon loads at its declared size', async ({ titleApp: app }) => {
  expect(await app.locator('link[rel=manifest]').getAttribute('href')).toBe('./manifest.webmanifest');
  const result = await app.evaluate(async () => {
    const res = await fetch('./manifest.webmanifest');
    const manifest = await res.json();
    const icons = await Promise.all(
      (manifest.icons as { src: string; sizes: string }[]).map(
        (i) =>
          new Promise<{ src: string; declared: string; actual: string }>((resolve) => {
            const img = new Image();
            img.onload = () =>
              resolve({ src: i.src, declared: i.sizes, actual: `${img.naturalWidth}x${img.naturalHeight}` });
            img.onerror = () => resolve({ src: i.src, declared: i.sizes, actual: 'failed' });
            img.src = new URL(i.src, document.baseURI).href;
          }),
      ),
    );
    const apple = await fetch(document.querySelector<HTMLLinkElement>('link[rel=apple-touch-icon]')!.href);
    return {
      type: res.headers.get('content-type'),
      manifest,
      icons,
      appleOk: apple.ok,
      appleType: apple.headers.get('content-type'),
    };
  });
  expect(result.manifest).toMatchObject({ display: 'fullscreen', orientation: 'landscape', start_url: './' });
  expect(result.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of result.icons) expect(icon.actual, icon.src).toBe(icon.declared);
  expect(result.appleOk).toBe(true);
  expect(result.appleType).toBe('image/png');
});

test('the service worker installs, takes control, and has cached the whole build', async ({ titleApp: app }) => {
  await app.evaluate(() => navigator.serviceWorker.ready);
  await app.reload();
  await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
  expect(await app.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const { listed, cached, cacheNames } = await app.evaluate(async () => {
    const src = await (await fetch('./sw.js')).text();
    const files: string[] = JSON.parse(/const FILES = (\[.*\]);/.exec(src)![1]);
    const version = /const VERSION = '([0-9a-f]+)'/.exec(src)![1];
    const cache = await caches.open(`agenticfpv-${version}`);
    return {
      listed: files.map((f) => new URL(f, document.baseURI).pathname),
      cached: (await cache.keys()).map((r) => new URL(r.url).pathname),
      cacheNames: await caches.keys(),
    };
  });
  expect(listed.length).toBeGreaterThan(8);
  expect(cached.sort()).toEqual(listed.sort()); // every file of the build, nothing missing
  expect(cacheNames).toHaveLength(1); // and only this build's cache
});

test('Chrome considers it installable', async ({ titleApp: app }) => {
  await app.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await app.context().newCDPSession(app);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('offline play: with the network off, reload still opens the game, which flies and loads a new sky', async ({
  titleApp: app,
  context,
}) => {
  await app.evaluate(() => navigator.serviceWorker.ready);
  await app.reload(); // now controlled by the worker
  await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });

  await context.setOffline(true);
  await app.reload();
  await app.waitForFunction(() => !!window.__fpv, null, { timeout: 150_000 });
  await expect(app.getByTestId('title')).toBeVisible();

  // The simulation runs, and the night-sky chunk (not loaded yet) comes out of the cache.
  const before = await app.evaluate(() => window.__fpv!.sim.renderer.toneMappingExposure);
  await app.evaluate(() => window.__fpv!.update((c) => void (c.graphics.timeOfDay = 'night')));
  await app.waitForFunction((b) => window.__fpv!.sim.renderer.toneMappingExposure !== b, before, { timeout: 60_000 });
  const flown = await app.evaluate(() => {
    const { sim } = window.__fpv!;
    sim.advance(10);
    return sim.quad.pos.y;
  });
  expect(flown).toBeGreaterThan(3);

  await context.setOffline(false);
});
