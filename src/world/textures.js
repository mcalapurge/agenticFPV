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

function blotches(ctx, size, count, color, rMin, rMax, aMax) {
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size, r = rr(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', (rand() * aMax).toFixed(3)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    // draw wrapped so the texture tiles
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
  }
}

function cracks(ctx, size, count, color = 'rgba(20,20,20,0.6)') {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    let x = rand() * size, y = rand() * size;
    let a = rand() * Math.PI * 2;
    ctx.lineWidth = rr(0.6, 1.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 6 + rand() * 14;
    for (let k = 0; k < n; k++) {
      a += rr(-0.7, 0.7);
      x += Math.cos(a) * rr(4, 14);
      y += Math.sin(a) * rr(4, 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function streaks(ctx, size, count) {
  // Water stains running down walls.
  for (let i = 0; i < count; i++) {
    const x = rand() * size, w = rr(4, 30), h = rr(size * 0.2, size * 0.9);
    const y = rand() * size * 0.3;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(40,35,30,${rr(0.15, 0.4).toFixed(2)})`);
    g.addColorStop(1, 'rgba(40,35,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function concreteTexture(base = '#8d8a84', stains = true) {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, 60, 'rgba(60,58,52,A)', 20, 120, 0.25);
  blotches(ctx, S, 40, 'rgba(200,198,190,A)', 20, 90, 0.15);
  blotches(ctx, S, 12, 'rgba(70,80,40,A)', 20, 70, 0.2); // moss
  if (stains) streaks(ctx, S, 25);
  cracks(ctx, S, 10);
  // formwork lines
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= S; y += S / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
  }
  noise(ctx, S, 38);
  return toTexture(c);
}

export function brickTexture() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#5a4c42';
  ctx.fillRect(0, 0, S, S);
  const bw = 64, bh = 24;
  for (let row = 0; row < S / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < S / bw + 1; col++) {
      const r = 105 + rand() * 40, g = 62 + rand() * 22, b = 50 + rand() * 18;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  blotches(ctx, S, 40, 'rgba(30,25,20,A)', 30, 120, 0.35);
  streaks(ctx, S, 20);
  noise(ctx, S, 30);
  return toTexture(c);
}

export function asphaltTexture() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#3d3d3b';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, 120, 'rgba(20,20,20,A)', 20, 160, 0.3);
  blotches(ctx, S, 80, 'rgba(110,105,95,A)', 20, 120, 0.2);
  blotches(ctx, S, 40, 'rgba(60,75,35,A)', 10, 60, 0.35); // weeds
  cracks(ctx, S, 60, 'rgba(10,10,10,0.7)');
  noise(ctx, S, 50);
  return toTexture(c);
}

export function metalTexture(base = '#7a4a2a') {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // corrugation
  for (let x = 0; x < S; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, S);
  }
  blotches(ctx, S, 40, 'rgba(120,60,20,A)', 6, 50, 0.6); // rust
  blotches(ctx, S, 20, 'rgba(40,20,10,A)', 6, 40, 0.5);
  noise(ctx, S, 30);
  return toTexture(c);
}

export function woodTexture() {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#6b5236';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 3) {
    ctx.fillStyle = `rgba(40,25,10,${rr(0, 0.25).toFixed(2)})`;
    ctx.fillRect(0, y, S, 1 + rand() * 2);
  }
  blotches(ctx, S, 15, 'rgba(30,30,30,A)', 10, 50, 0.4);
  noise(ctx, S, 25);
  return toTexture(c);
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
