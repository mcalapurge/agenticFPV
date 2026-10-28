import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
