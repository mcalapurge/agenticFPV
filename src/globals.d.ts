// Build-time constants (see `define` in vite.config.ts and vitest.config.ts).

export {};

declare global {
  /** True when public/textures/manifest.json existed at build time (photo textures from `npm run fetch-assets`). */
  const __PHOTO_TEXTURES__: boolean;
}
