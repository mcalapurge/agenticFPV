// Build-time helpers for the service worker template (src/pwa/sw.js). Pure, so they can be unit-tested.

import { createHash } from 'node:crypto';

/** A short version string that changes whenever the file list or any public file's bytes change. */
export function precacheVersion(files: readonly string[], publicContents: readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256');
  for (const f of files) hash.update(f);
  for (const c of publicContents) hash.update(c);
  return hash.digest('hex').slice(0, 12);
}

/** Fill in the template's version and precache list. Throws if a placeholder is left behind. */
export function stampServiceWorker(template: string, version: string, files: readonly string[]): string {
  const source = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(files));
  if (/__(VERSION|PRECACHE)__/.test(source)) throw new Error('src/pwa/sw.js: a placeholder was not replaced');
  return source;
}
