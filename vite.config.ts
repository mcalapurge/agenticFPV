import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { precacheVersion, stampServiceWorker } from './src/pwa/stamp.ts';

/**
 * PWA service worker: stamps src/pwa/sw.js with a build version and the list of files to cache for offline
 * play (every emitted file plus the manifest and icons from public/), and emits it as dist/sw.js.
 */
function serviceWorker(): Plugin {
  return {
    name: 'agenticfpv-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      // Everything in public/ (manifest, icons, and photo textures if `npm run fetch-assets` was run).
      const publicFiles = readdirSync('public', { recursive: true, encoding: 'utf8' })
        .map((f) => f.split('\\').join('/'))
        .filter((f) => statSync(join('public', f)).isFile());
      const files = ['./', ...Object.keys(bundle), ...publicFiles].map((f) => (f === './' ? f : `./${f}`));
      // Hashed file names change with the code; public files are covered by their content.
      const version = precacheVersion(
        files,
        publicFiles.map((f) => readFileSync(join('public', f))),
      );
      const source = stampServiceWorker(readFileSync('src/pwa/sw.js', 'utf8'), version, files);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative base so the build works on GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  // Only look for photo textures if they were installed (avoids a 404 / offline error on every load).
  define: { __PHOTO_TEXTURES__: JSON.stringify(existsSync('public/textures/manifest.json')) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
