// Procedural canvas textures (no external assets needed).
import * as THREE from 'three';

let seed = 1337;
export function rand() {
  // mulberry32 — deterministic so the map looks the same every load.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function setSeed(s) {
  seed = s;
}
export const rr = (a, b) => a + rand() * (b - a);

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function noise(ctx, size, amount, alpha = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = d[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function grassAlphaTexture() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.8 * rand();
    const y = S / 2 + (rand() - 0.5) * S * 0.8 * rand();
    const r = rr(10, 60);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rand() < 0.5 ? '70,85,40' : '95,90,50';
    g.addColorStop(0, `rgba(${col},0.5)`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  noise(ctx, S, 40);
  const t = toTexture(c, false);
  return t;
}

const TAGS = ['FPV', 'RIP', 'KREW', 'NOX', 'ZERO', '404', 'VOID', 'DRIFT', 'SEND IT', 'LOST'];
export function graffitiTexture() {
  const [c, ctx] = canvas(512);
  ctx.clearRect(0, 0, 512, 256);
  const hue = Math.floor(rand() * 360);
  const text = TAGS[Math.floor(rand() * TAGS.length)];
  ctx.translate(256, 256);
  ctx.rotate(rr(-0.15, 0.15));
  ctx.font = `bold ${Math.floor(rr(110, 160))}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18;
  ctx.strokeStyle = `hsla(${(hue + 180) % 360},70%,20%,0.9)`;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = `hsla(${hue},85%,55%,0.92)`;
  ctx.fillText(text, 0, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.strokeText(text, 0, 0);
  // drips
  ctx.fillStyle = `hsla(${hue},85%,45%,0.8)`;
  for (let i = 0; i < 8; i++) ctx.fillRect(rr(-200, 200), rr(20, 50), 3, rr(20, 80));
  const t = toTexture(c, false);
  return t;
}

/** Weed tuft billboard (alpha-tested blades). */
export function weedsTexture() {
  const [c, ctx] = canvas(256);
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const x = 20 + rand() * 216;
    const h = rr(60, 230);
    const bend = rr(-40, 40);
    const g = 70 + rand() * 60;
    ctx.strokeStyle = `rgb(${(g * 0.75) | 0},${g | 0},${(g * 0.35) | 0})`;
    if (rand() < 0.25) ctx.strokeStyle = `rgb(${(130 + rand() * 40) | 0},${(115 + rand() * 30) | 0},60)`; // dry blades
    ctx.lineWidth = rr(1.5, 4);
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.quadraticCurveTo(x + bend * 0.3, 256 - h * 0.6, x + bend, 256 - h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Galvanised chain-link mesh (tileable, alpha-tested). */
export function chainLinkTexture() {
  const [c, ctx] = canvas(128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#b9bcbf';
  ctx.lineWidth = 3;
  for (let k = -128; k <= 256; k += 32) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 128, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k, 128); ctx.lineTo(k + 128, 0); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(4, 4);
  return t;
}
