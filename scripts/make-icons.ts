#!/usr/bin/env node
// Renders the app icon SVGs in public/icons/ to the PNG sizes phones need (home-screen icons).
//
//   npm run make-icons
//
// The PNGs are committed, so you only need this after changing an SVG. Uses the Chromium that
// Playwright already installs. Runs directly on Node ≥ 22.18 (native TypeScript type stripping).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const OUTPUTS: { svg: string; png: string; size: number }[] = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
  // iOS draws its own rounded corners, so it gets the full-bleed artwork (and ignores transparency).
  { svg: 'icon-maskable.svg', png: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { svg, png, size } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const markup = await readFile(join(DIR, svg), 'utf8');
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
    );
    await writeFile(join(DIR, png), await page.screenshot({ omitBackground: true, type: 'png' }));
    await page.close();
    console.log(`  ${png} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
