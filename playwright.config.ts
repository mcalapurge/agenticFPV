import { defineConfig, devices } from '@playwright/test';

// Force SwiftShader so runs are identical on GPU-less CI machines and dev laptops.
const softwareGL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  // Screenshots are deterministic per platform (SwiftShader, stopped render loop): allow only a few pixels.
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixels: 20 } },
  // Software WebGL is CPU-heavy: one browser at a time keeps timings sane.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: softwareGL },
    // The app's service worker is off for ordinary tests (no cache surprises); e2e/pwa.spec.ts turns it on.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'e2e',
      testIgnore: /(visual|mobile|safe-area)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      // A phone in landscape: touch input, mobile user agent and viewport (the app auto-enables touch controls).
      name: 'mobile',
      testMatch: /(mobile|safe-area)\.spec\.ts/,
      use: { ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
