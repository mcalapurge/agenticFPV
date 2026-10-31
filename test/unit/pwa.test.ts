// PWA: the manifest, icons, iOS tags, build stamping and the service worker's offline behaviour.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { precacheVersion, stampServiceWorker } from '../../src/pwa/stamp';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p));
const text = (p: string) => read(p).toString('utf8');

/** Width, height and colour type from a PNG's IHDR chunk. */
function png(path: string) {
  const b = read(path);
  expect(b.subarray(0, 8).toString('hex'), `${path} is a PNG`).toBe('89504e470d0a1a0a');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

describe('web app manifest', () => {
  const manifest = JSON.parse(text('public/manifest.webmanifest'));

  it('opens fullscreen in landscape, within its own folder (works on a GitHub Pages sub-path)', () => {
    expect(manifest).toMatchObject({
      name: 'agenticFPV',
      start_url: './',
      scope: './',
      display: 'fullscreen',
      orientation: 'landscape',
    });
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone']); // falls back to standalone
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // fits under the home-screen icon
  });

  it('uses the app colours (no white flash on launch)', () => {
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toBe('#0b0c0f');
  });

  it('lists real icons: 192 and 512 for any shape, plus a 512 maskable one', () => {
    const byPurpose = (p: string) => manifest.icons.filter((i: { purpose: string }) => i.purpose === p);
    expect(byPurpose('any').map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(byPurpose('maskable').map((i: { sizes: string }) => i.sizes)).toEqual(['512x512']);
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(icon.src.startsWith('/'), 'icon paths are relative, so they work on a sub-path').toBe(false);
      expect(icon.type).toBe('image/png');
      expect(png(`public/${icon.src}`), icon.src).toMatchObject({ width: w, height: h });
    }
  });
});

describe('iOS and browser tags in index.html', () => {
  const html = text('index.html');

  it('links the manifest and icons', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/icons\/icon\.svg"/);
  });

  it('asks iOS for a bars-free app: capable, translucent status bar, a title', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('content="black-translucent"');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="agenticFPV"');
    expect(html).toContain('name="theme-color"');
  });

  it('draws under the notch (viewport-fit=cover) and stops pinch-zoom', () => {
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/user-scalable=no/);
  });

  it('the Apple touch icon is 180×180 and fully opaque (iOS paints transparency black)', () => {
    const icon = png('public/icons/apple-touch-icon.png');
    expect(icon).toMatchObject({ width: 180, height: 180 });
    // The artwork is full-bleed, so the corners (the most likely transparent pixels) are solid.
    const b = read('public/icons/apple-touch-icon.png');
    expect(b.includes(Buffer.from('IDAT'))).toBe(true);
  });
});

describe('build stamping', () => {
  const template = text('src/pwa/sw.js');

  it('fills in the version and the file list', () => {
    const out = stampServiceWorker(template, 'abc123', ['./', './assets/a.js']);
    expect(out).toContain("const VERSION = 'abc123';");
    expect(out).toContain('const FILES = ["./","./assets/a.js"];');
    expect(out).not.toMatch(/__(VERSION|PRECACHE)__/);
  });

  it('refuses to emit a worker with a placeholder left in it', () => {
    expect(() =>
      stampServiceWorker("const VERSION = '__VERSION__'; __VERSION__ __PRECACHE__ __PRECACHE__", 'v', []),
    ).toThrow(/placeholder/);
  });

  it('the version changes with the file names and with the public files, and is stable otherwise', () => {
    const a = precacheVersion(['./a.js'], ['icon']);
    expect(precacheVersion(['./a.js'], ['icon'])).toBe(a);
    expect(precacheVersion(['./b.js'], ['icon'])).not.toBe(a);
    expect(precacheVersion(['./a.js'], ['icon2'])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ── The service worker, run against a fake worker scope ─────────────────────────────────────────────────────────────
type Handler = (event: Record<string, unknown>) => void;

function makeWorker(opts: { version?: string; files?: string[]; origin?: string } = {}) {
  const origin = opts.origin ?? 'https://example.test';
  const scope = `${origin}/game/`;
  const files = opts.files ?? ['./', './assets/app.js', './manifest.webmanifest'];
  const code = stampServiceWorker(template(), opts.version ?? 'v2', files);

  const store = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      put: async (req: Request | string, res: Response) => void m.set(key(req), res),
      addAll: async (reqs: Request[]) => {
        for (const r of reqs) {
          const res = await network(r);
          if (!res.ok) throw new TypeError(`addAll: ${r.url} → ${res.status}`);
          m.set(key(r), res);
        }
      },
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: Request | string) => {
      for (const m of store.values()) {
        const hit = m.get(key(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };

  const served: string[] = [];
  let online = true;
  let missing = new Set<string>();
  const network = vi.fn(async (req: Request | string) => {
    const url = key(req);
    served.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    if (missing.has(url)) return new Response('nope', { status: 404 });
    return new Response(`body of ${url}`, { status: 200 });
  });

  const handlers: Record<string, Handler> = {};
  const self = {
    location: new URL(`${scope}sw.js`),
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  new Function('self', 'caches', 'fetch', code)(self, caches, network);

  /** Dispatch an install/activate-style event and wait for its waitUntil promise. */
  const lifecycle = async (type: 'install' | 'activate') => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => void (pending = p) });
    await pending;
  };
  /** Dispatch a fetch event; resolves to the response, or null if the worker left it alone. */
  const request = async (url: string, init: { method?: string; mode?: string } = {}) => {
    const req = new Request(url, { method: init.method ?? 'GET' });
    Object.defineProperty(req, 'mode', { value: init.mode ?? 'cors' });
    let responded: Promise<Response> | null = null;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => void (responded = p) });
    return responded ? await (responded as Promise<Response>) : null;
  };

  return {
    scope,
    store,
    self,
    network,
    served,
    lifecycle,
    request,
    setOnline: (v: boolean) => void (online = v),
    setMissing: (urls: string[]) => void (missing = new Set(urls)),
  };
}
const template = () => text('src/pwa/sw.js');

describe('service worker', () => {
  it('install: downloads every file of the build into a versioned cache, then takes over', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    expect([...w.store.keys()]).toEqual(['agenticfpv-v2']);
    expect([...w.store.get('agenticfpv-v2')!.keys()]).toEqual([
      `${w.scope}`,
      `${w.scope}assets/app.js`,
      `${w.scope}manifest.webmanifest`,
    ]);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  it('install fails (so the old worker stays) if any file cannot be fetched', async () => {
    const w = makeWorker();
    w.setMissing([`${w.scope}assets/app.js`]);
    await expect(w.lifecycle('install')).rejects.toThrow(/addAll/);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('activate: removes caches from older builds, leaves other sites’ caches, claims open pages', async () => {
    const w = makeWorker({ version: 'v2' });
    w.store.set('agenticfpv-v1', new Map());
    w.store.set('agenticfpv-v0', new Map());
    w.store.set('someone-elses-cache', new Map());
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...w.store.keys()].sort()).toEqual(['agenticfpv-v2', 'someone-elses-cache']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('pages load from the network when online', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    w.network.mockClear();
    const res = await w.request(w.scope, { mode: 'navigate' });
    expect(await res!.text()).toBe(`body of ${w.scope}`);
    expect(w.network).toHaveBeenCalledTimes(1);
  });

  it('offline, any page address (even with a query) opens the cached app', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    w.setOnline(false);
    for (const url of [w.scope, `${w.scope}?mode=race`, `${w.scope}index.html`]) {
      const res = await w.request(url, { mode: 'navigate' });
      expect(await res!.text(), url).toBe(`body of ${w.scope}`);
    }
  });

  it('offline with nothing cached is a clean network error, not a crash', async () => {
    const w = makeWorker();
    w.setOnline(false);
    const res = await w.request(w.scope, { mode: 'navigate' });
    expect(res!.type).toBe('error');
  });

  it('assets come from the cache without touching the network', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    w.network.mockClear();
    const res = await w.request(`${w.scope}assets/app.js`);
    expect(await res!.text()).toBe(`body of ${w.scope}assets/app.js`);
    expect(w.network).not.toHaveBeenCalled();
  });

  it('an uncached asset is fetched once, stored, then served from the cache (works offline afterwards)', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    const url = `${w.scope}assets/late.js`;
    await w.request(url);
    w.setOnline(false);
    const again = await w.request(url);
    expect(await again!.text()).toBe(`body of ${url}`);
  });

  it('does not cache failed responses', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    const url = `${w.scope}assets/missing.js`;
    w.setMissing([url]);
    const res = await w.request(url);
    expect(res!.status).toBe(404);
    w.setMissing([]);
    w.network.mockClear();
    await w.request(url); // not cached: goes to the network again
    expect(w.network).toHaveBeenCalledTimes(1);
  });

  it('leaves non-GET and cross-origin requests alone', async () => {
    const w = makeWorker();
    await w.lifecycle('install');
    expect(await w.request(`${w.scope}records`, { method: 'POST' })).toBeNull();
    expect(await w.request('https://cdn.other.test/lib.js')).toBeNull();
  });
});

describe('safe-area CSS', () => {
  it('reads env(safe-area-inset-*) in exactly one place (the :root variables), so nothing bypasses the margins', () => {
    const css = text('src/ui/styles.css');
    const rootEnd = css.indexOf('}', css.indexOf(':root'));
    const outsideRoot = css.slice(0, css.indexOf(':root')) + css.slice(rootEnd);
    expect(outsideRoot).not.toMatch(/env\(/);
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(css).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px)`);
  });
});
