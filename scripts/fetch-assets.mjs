#!/usr/bin/env node
// Downloads CC0 PBR textures from Poly Haven (https://polyhaven.com, all assets CC0) into
// public/textures/ and writes a manifest the game picks up automatically at load time.
//
//   npm run fetch-assets            # 1k textures (default)
//   npm run fetch-assets -- --res 2k
//
// Without this the game uses its built-in procedural PBR textures.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.POLYHAVEN_API || 'https://api.polyhaven.com';
const RES = process.argv.includes('--res') ? process.argv[process.argv.indexOf('--res') + 1] : '1k';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures');
const UA = { 'User-Agent': 'agenticFPV-asset-fetch/1.0' };

// slot → preferred Poly Haven ids (first that exists wins), then keyword fallback.
const SLOTS = {
  concrete: { ids: ['concrete_wall_008', 'concrete_wall_006', 'concrete_wall_004', 'concrete_wall_003'], keyword: 'concrete' },
  brick: { ids: ['red_brick_03', 'red_brick', 'brick_wall_001', 'red_brick_plaster_patch_02'], keyword: 'brick' },
  asphalt: { ids: ['asphalt_02', 'asphalt_track', 'asphalt_01', 'asphalt_04'], keyword: 'asphalt' },
  rust: { ids: ['rusty_metal_02', 'rusty_metal_03', 'rust_coarse_01', 'rusty_metal'], keyword: 'rust' },
  corrugated: { ids: ['corrugated_iron_02', 'corrugated_iron', 'corrugated_iron_03'], keyword: 'corrugated' },
  wood: { ids: ['weathered_planks', 'wood_planks_grey', 'old_planks_02', 'wood_planks'], keyword: 'plank' },
};

// game material → slot (+ optional tint multiplied into the albedo)
const MATERIALS = {
  concrete: { slot: 'concrete' },
  concreteDark: { slot: 'concrete', tint: '#8a8a8a' },
  concreteLight: { slot: 'concrete', tint: '#f2efe8' },
  brick: { slot: 'brick' },
  asphalt: { slot: 'asphalt' },
  rust: { slot: 'rust' },
  contBlue: { slot: 'corrugated', tint: '#6f93c4' },
  contRed: { slot: 'corrugated', tint: '#d0776c' },
  contGreen: { slot: 'corrugated', tint: '#8fb486' },
  wood: { slot: 'wood' },
};

async function json(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, path) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

function pickFile(files, pattern) {
  const key = Object.keys(files).find((k) => pattern.test(k));
  const byRes = key && files[key];
  const entry = byRes && (byRes[RES] || byRes['1k'] || Object.values(byRes)[0]);
  return entry?.jpg?.url || entry?.png?.url || null;
}

async function main() {
  console.log(`Fetching texture list from ${API} …`);
  const all = await json(`${API}/assets?t=textures`);
  const manifest = {};
  const credits = [];
  const slotFiles = {};

  for (const [slot, { ids, keyword }] of Object.entries(SLOTS)) {
    let id = ids.find((i) => all[i]);
    if (!id) {
      id = Object.entries(all)
        .filter(([k]) => k.includes(keyword))
        .sort((a, b) => (b[1].download_count || 0) - (a[1].download_count || 0))[0]?.[0];
    }
    if (!id) {
      console.warn(`  ✗ ${slot}: no matching texture found, keeping procedural`);
      continue;
    }
    const files = await json(`${API}/files/${id}`);
    const urls = {
      map: pickFile(files, /^diff/i),
      normal: pickFile(files, /^nor_gl/i),
      roughness: pickFile(files, /^rough/i),
    };
    if (!urls.map) {
      console.warn(`  ✗ ${slot}: ${id} has no diffuse map, skipping`);
      continue;
    }
    const entry = {};
    for (const [kind, url] of Object.entries(urls)) {
      if (!url) continue;
      const ext = url.split('.').pop().split('?')[0];
      const rel = `${slot}/${kind}.${ext}`;
      process.stdout.write(`  ↓ ${slot} ${kind} (${id}) … `);
      await download(url, join(OUT, rel));
      console.log('ok');
      entry[kind] = rel;
    }
    slotFiles[slot] = entry;
    credits.push(`- **${all[id]?.name || id}** (\`${id}\`) — https://polyhaven.com/a/${id} — CC0`);
  }

  for (const [mat, { slot, tint }] of Object.entries(MATERIALS)) {
    if (slotFiles[slot]) manifest[mat] = { ...slotFiles[slot], ...(tint ? { tint } : {}) };
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(OUT, 'CREDITS.md'), `# Texture credits\n\nAll textures from [Poly Haven](https://polyhaven.com), licensed CC0.\n\n${credits.join('\n')}\n`);
  console.log(`\nWrote ${Object.keys(manifest).length} materials to public/textures/manifest.json — restart \`npm run dev\` and reload.`);
}

main().catch((err) => {
  console.error(`\nAsset fetch failed: ${err.message}\nThe game still works with its procedural textures.`);
  process.exit(1);
});
