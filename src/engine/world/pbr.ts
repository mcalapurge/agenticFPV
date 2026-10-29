// Map materials. Uses real photo textures when present (public/textures/manifest.json, e.g. fetched
// from Poly Haven with `npm run fetch-assets`), otherwise generates procedural PBR maps.

import * as THREE from 'three';
import { z } from 'zod';
import { generatePixels, MATERIAL_DEFS, type MaterialName } from './pbrRecipes';

const ManifestEntry = z.object({
  map: z.string(),
  normal: z.string().optional(),
  roughness: z.string().optional(),
  tint: z.string().optional(),
});
const Manifest = z.record(z.string(), ManifestEntry);

export type TextureSource = 'procedural' | 'photo';

function canvasTexture(N: number, pixels: Uint8ClampedArray, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  img.data.set(pixels);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

async function loadManifest(): Promise<z.infer<typeof Manifest> | null> {
  try {
    const res = await fetch('textures/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const parsed = Manifest.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // missing file (or the dev server's HTML fallback)
  }
}

async function loadTex(loader: THREE.TextureLoader, url: string, srgb: boolean): Promise<THREE.Texture> {
  const t = await loader.loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export type MapMaterials = Record<MaterialName, THREE.MeshStandardMaterial>;

/** Build every map material (photo textures if available, else procedural). */
export async function buildMaterials(progress: (msg: string) => void = () => {}): Promise<{
  materials: MapMaterials;
  source: Record<MaterialName, TextureSource>;
}> {
  const manifest = await loadManifest();
  const loader = new THREE.TextureLoader();
  const materials = {} as MapMaterials;
  const source = {} as Record<MaterialName, TextureSource>;
  for (const [name, def] of Object.entries(MATERIAL_DEFS) as [MaterialName, (typeof MATERIAL_DEFS)[MaterialName]][]) {
    let params: THREE.MeshStandardMaterialParameters | null = null;
    const m = manifest?.[name];
    if (m) {
      try {
        params = {
          map: await loadTex(loader, `textures/${m.map}`, true),
          normalMap: m.normal ? await loadTex(loader, `textures/${m.normal}`, false) : null,
          roughnessMap: m.roughness ? await loadTex(loader, `textures/${m.roughness}`, false) : null,
          ...(m.tint ? { color: new THREE.Color(m.tint) } : {}),
        };
        source[name] = 'photo';
      } catch {
        params = null;
      }
    }
    if (!params) {
      progress(`Generating ${name} textures…`);
      await new Promise((r) => setTimeout(r, 0)); // let the loading text paint
      const px = generatePixels(def.N, def.seed, def.normal, def.recipe());
      params = {
        map: canvasTexture(px.N, px.albedo, true),
        normalMap: canvasTexture(px.N, px.normal, false),
        roughnessMap: canvasTexture(px.N, px.roughness, false),
      };
      source[name] = 'procedural';
    }
    materials[name] = new THREE.MeshStandardMaterial({
      ...params,
      roughness: 1,
      metalness: 'metalness' in def ? def.metalness : 0,
      normalScale: new THREE.Vector2(1, 1),
    });
  }
  return { materials, source };
}
