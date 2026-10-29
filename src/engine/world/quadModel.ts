// High-detail procedural quad models (no external assets). Built in metres from the physics config,
// so the visual matches the simulated airframe (arm length, prop size, blade count).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PhysicsConfig } from '../../state/configSchema';
import { MOTOR_LAYOUT } from '../sim/flightController';
import type { QuadPreset } from '../sim/presets';

type V3 = [number, number, number];

interface PropAnim {
  prop: THREE.Group;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  dir: number;
  angle: number;
}

/** A quad model whose props spin/blur from motor speeds. */
export class QuadModel extends THREE.Group {
  props: PropAnim[] = [];
  animated = true;

  update(motorSpeeds: readonly number[], dt: number): void {
    if (!this.animated) return;
    this.props.forEach((p, i) => {
      const s = Math.abs(motorSpeeds[i] ?? 0);
      // Visible blades fade into a blurred disc as rpm rises; spin rate is capped so it reads as motion.
      p.angle += -p.dir * Math.sign(motorSpeeds[i] || 1) * Math.min(s * 400, 32) * dt;
      p.prop.rotation.y = p.angle;
      const blur = Math.min(1, Math.max(0, (s - 0.04) / 0.2));
      p.disc.material.opacity = blur * 0.55;
      p.prop.visible = blur < 0.98;
      for (const c of p.prop.children) {
        const m = (c as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.opacity = 0.88 * (1 - blur * 0.85);
      }
    });
  }
}

let carbonTex: THREE.CanvasTexture | null = null;
function carbonTexture(): THREE.CanvasTexture {
  if (carbonTex) return carbonTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121212';
  g.fillRect(0, 0, 64, 64);
  // 2x2 twill weave
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const on = (x + y) % 4 < 2;
      const grad = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8);
      grad.addColorStop(0, on ? '#2b2b2b' : '#1a1a1a');
      grad.addColorStop(1, on ? '#1c1c1c' : '#262626');
      g.fillStyle = grad;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  carbonTex = new THREE.CanvasTexture(c);
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(60, 60);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  return carbonTex;
}

function labelTexture(text: [string, string], color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#151515';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 18);
  g.fillRect(0, 110, 256, 18);
  g.fillStyle = '#fff';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.fillText(text[0], 128, 62);
  g.font = '26px sans-serif';
  g.fillStyle = '#bbb';
  g.fillText(text[1], 128, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let blurTex: THREE.CanvasTexture | null = null;
function propBlurTexture(): THREE.CanvasTexture {
  if (blurTex) return blurTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.97, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blurTex = new THREE.CanvasTexture(c);
  return blurTex;
}

/**
 * Twisted, tapered airfoil blade. Spans +X from hubR to tipR, rotating about +Y.
 */
function bladeGeometry(
  hubR: number,
  tipR: number,
  pitchM: number,
  maxChord: number,
  thickness: number,
  mirror: boolean,
): THREE.BufferGeometry {
  const spanSeg = 16, foilPts = 12;
  const pos = [];
  const idx = [];
  // Simple cambered airfoil around the chord line (x along chord, y thickness).
  const foil = [];
  for (let i = 0; i < foilPts; i++) {
    const a = (i / foilPts) * Math.PI * 2;
    const cx = Math.cos(a) * 0.5;
    const thick = Math.sin(a) * (a < Math.PI ? 1 : 0.35); // flatter underside
    foil.push([cx, thick * 0.5 + 0.12 * (1 - 4 * cx * cx) * 0.4]);
  }
  for (let s = 0; s <= spanSeg; s++) {
    const t = s / spanSeg;
    const r = hubR + (tipR - hubR) * t;
    // chord: wide near 35% span, rounded tip
    const chord = maxChord * (0.55 + 0.75 * Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.85)) * (t > 0.85 ? Math.sqrt(Math.max(0.05, (1 - t) / 0.15)) : 1);
    const twist = Math.atan(pitchM / (2 * Math.PI * r));
    const ct = Math.cos(twist), st = Math.sin(twist);
    const sweep = t * t * maxChord * 0.35; // swept-back tip
    for (const [fx, fy] of foil) {
      const lx = fx * chord + sweep; // along rotation direction (−Z)
      const ly = fy * thickness * (1 - t * 0.5);
      // rotate (lx, ly) by twist about the span axis: leading edge up
      const z = -(lx * ct - ly * st);
      const y = lx * st + ly * ct;
      pos.push(r, y, mirror ? -z : z);
    }
  }
  for (let s = 0; s < spanSeg; s++)
    for (let i = 0; i < foilPts; i++) {
      const a = s * foilPts + i, b = s * foilPts + ((i + 1) % foilPts);
      const c = a + foilPts, d = b + foilPts;
      if (mirror) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  // tip cap
  const base = spanSeg * foilPts;
  for (let i = 1; i < foilPts - 1; i++) mirror ? idx.push(base, base + i, base + i + 1) : idx.push(base, base + i + 1, base + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function propAssembly(propR: number, blades: number, dir: number, mat: THREE.Material, pitchScale: number): THREE.Group {
  const g = new THREE.Group();
  const hubR = Math.max(0.0035, propR * 0.12);
  const pitch = propR * 2 * pitchScale;
  const bg = bladeGeometry(hubR * 0.8, propR, pitch, propR * 0.24 * (blades > 3 ? 0.8 : 1), propR * 0.045, dir < 0);
  for (let b = 0; b < blades; b++) {
    const m = new THREE.Mesh(bg, mat);
    m.rotation.y = (b / blades) * Math.PI * 2;
    m.castShadow = true;
    g.add(m);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.1, propR * 0.12, 20), mat);
  g.add(hub);
  return g;
}

function ductGeometry(innerR: number, height: number): THREE.LatheGeometry {
  // Lathe profile: inner wall + rounded lip on top, flared outer skirt.
  const pts = [];
  const wall = Math.max(0.0012, innerR * 0.05);
  const n = 10;
  pts.push(new THREE.Vector2(innerR, -height * 0.5));
  pts.push(new THREE.Vector2(innerR, height * 0.35));
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    pts.push(new THREE.Vector2(innerR + wall * 1.5 + Math.cos(a) * wall * 1.5, height * 0.35 + Math.sin(a) * wall * 2));
  }
  pts.push(new THREE.Vector2(innerR + wall * 2.4, -height * 0.5));
  pts.push(new THREE.Vector2(innerR, -height * 0.5));
  return new THREE.LatheGeometry(pts, 48);
}

function motorAssembly(r: number, h: number, bellMat: THREE.Material, darkMat: THREE.Material, metalMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, h * 0.25, 24), darkMat);
  base.position.y = h * 0.125;
  g.add(base);
  // Bell: lathe with chamfered top
  const prof = [
    new THREE.Vector2(0.0001, h),
    new THREE.Vector2(r * 0.55, h),
    new THREE.Vector2(r * 0.85, h * 0.97),
    new THREE.Vector2(r, h * 0.85),
    new THREE.Vector2(r, h * 0.3),
    new THREE.Vector2(r * 0.97, h * 0.25),
  ];
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), bellMat);
  g.add(bell);
  // Exposed windings band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.985, r * 0.985, h * 0.12, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#b5651d', metalness: 0.6, roughness: 0.4 }));
  band.position.y = h * 0.22;
  g.add(band);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, h * 0.5, 10), metalMat);
  shaft.position.y = h * 1.15;
  g.add(shaft);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, h * 0.25, 6), metalMat);
  nut.position.y = h * 1.45;
  g.add(nut);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

function tube(points: V3[], radius: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 8, false), mat);
}

/** Build the model for a preset, sized from the physics config (arm length, prop size). */
export function buildQuadModel(
  preset: QuadPreset,
  physics: Pick<PhysicsConfig, 'armLengthMm' | 'propInches' | 'cells' | 'capacityMah'>,
  { cameraTilt = 25 } = {},
): QuadModel {
  const style = preset.model;
  const root = new QuadModel();
  const armDiag = physics.armLengthMm / 1000;
  const propR = (physics.propInches * 0.0254) / 2;
  const sc = armDiag / 0.112; // body components scale relative to a 5"
  const ducted = !!style.ducted;
  const whoop = style.style === 'whoop';

  const carbon = new THREE.MeshPhysicalMaterial({ map: carbonTexture(), color: style.frameColor === '#1b1c1f' ? '#ffffff' : style.frameColor, roughness: 0.45, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const plastic = new THREE.MeshStandardMaterial({ color: style.frameColor, roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.55 });
  const tpu = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 0.5, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: '#a8a8a8', roughness: 0.25, metalness: 0.9 });
  const bellMat = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.35, metalness: 0.7 });
  const propMat = new THREE.MeshPhysicalMaterial({ color: style.propColor, roughness: 0.35, transparent: true, opacity: 0.88, side: THREE.DoubleSide, clearcoat: 0.6 });
  const pcb = new THREE.MeshStandardMaterial({ color: '#1f3b24', roughness: 0.6 });

  const thick = whoop ? 0.0015 : Math.max(0.0025, 0.005 * sc);
  const motorR = whoop ? 0.0035 : Math.max(0.006, propR * 0.2);
  const motorH = motorR * 1.15;
  const motors = MOTOR_LAYOUT.map((m) => new THREE.Vector3(m.x, 0, m.z).normalize().multiplyScalar(armDiag));

  // ── Frame ────────────────────────────────────────────────────────────────
  if (!whoop) {
    const ARM_WIDTH: Record<string, number> = { freestyle: 0.016, race: 0.012, toothpick: 0.0075, cinewhoop: 0.012, longrange: 0.018 };
    const armW = (ARM_WIDTH[style.style] ?? 0.014) * Math.max(0.7, sc);
    for (const mp of motors) {
      const L = armDiag;
      const sh = new THREE.Shape();
      sh.moveTo(0, -armW / 2);
      sh.lineTo(L, -armW / 2);
      sh.absarc(L, 0, armW / 2, -Math.PI / 2, Math.PI / 2, false);
      sh.lineTo(0, armW / 2);
      sh.lineTo(0, -armW / 2);
      if (armW > 0.009) {
        const slot = new THREE.Path();
        const s0 = L * 0.35, s1 = L * 0.7, sw = armW * 0.18;
        slot.moveTo(s0, -sw);
        slot.lineTo(s1, -sw);
        slot.absarc(s1, 0, sw, -Math.PI / 2, Math.PI / 2, false);
        slot.lineTo(s0, sw);
        slot.absarc(s0, 0, sw, Math.PI / 2, Math.PI * 1.5, false);
        sh.holes.push(slot);
      }
      // motor screw holes
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const hp = new THREE.Path();
        hp.absarc(L + Math.cos(a) * motorR * 0.6, Math.sin(a) * motorR * 0.6, motorR * 0.08, 0, Math.PI * 2, true);
        sh.holes.push(hp);
      }
      const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 16 });
      geo.rotateX(-Math.PI / 2); // extrude upward, shape in XZ (shape y → -z)
      const arm = new THREE.Mesh(geo, carbon);
      arm.rotation.y = Math.atan2(-mp.z, mp.x);
      arm.castShadow = true;
      root.add(arm);
    }
    // centre plates
    const plateW = 0.034 * sc, plateL = 0.09 * sc;
    const plate = (y: number, t: number) => {
      const g = new RoundedBoxGeometry(plateW * 1.4, t, plateL, 2, Math.min(t / 2, 0.002));
      const m = new THREE.Mesh(g, carbon);
      m.position.y = y + t / 2;
      m.castShadow = true;
      root.add(m);
    };
    plate(0, thick);
    const standoffH = (style.style === 'race' ? 0.022 : 0.03) * Math.max(0.6, sc);
    plate(thick + standoffH, thick * 0.4);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.0025 * sc, 0.0025 * sc, standoffH, 8), accent);
      so.position.set(x * plateW * 0.6, thick + standoffH / 2, z * plateL * 0.42);
      root.add(so);
    }
    // FC/ESC stack
    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03 * sc, 0.0016, 0.03 * sc), k ? pcb : dark);
      b.position.y = thick + 0.006 * sc + k * 0.009 * sc;
      root.add(b);
      for (let c = 0; c < 6; c++) {
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.004 * sc, 0.0012, 0.004 * sc), dark);
        chip.position.set(((c % 3) - 1) * 0.008 * sc, b.position.y + 0.0012, (Math.floor(c / 3) - 0.5) * 0.01 * sc);
        root.add(chip);
      }
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005 * sc, 0.005 * sc, 0.02 * sc, 14), dark);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, thick + 0.006 * sc, 0.06 * sc);
    root.add(cap);
  } else {
    // Tiny whoop: one-piece moulded frame
    const ring = new THREE.Mesh(new THREE.TorusGeometry(armDiag * 0.55, 0.0018, 8, 32), plastic);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    root.add(ring);
    for (const mp of motors) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(armDiag, 0.002, 0.003), plastic);
      beam.position.copy(mp).multiplyScalar(0.5).setY(0.002);
      beam.rotation.y = Math.atan2(-mp.z, mp.x);
      root.add(beam);
    }
    const pod = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.006, 0.026, 2, 0.002), plastic);
    pod.position.y = 0.004;
    root.add(pod);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    canopy.scale.set(1, 0.9, 1.3);
    canopy.position.y = 0.007;
    root.add(canopy);
  }

  // ── Motors, props, ducts ────────────────────────────────────────────────
  const propGroups: PropAnim[] = [];
  const blurMat = new THREE.MeshBasicMaterial({ map: propBlurTexture(), color: style.propColor, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  MOTOR_LAYOUT.forEach((m, i) => {
    const mp = motors[i];
    const motor = motorAssembly(motorR, motorH, bellMat, dark, metal);
    motor.position.copy(mp).setY(whoop ? 0.002 : thick);
    root.add(motor);
    const prop = propAssembly(propR, style.blades, m.dir, propMat, style.style === 'longrange' ? 0.55 : 0.85);
    const propY = (whoop ? 0.002 : thick) + motorH * 1.25;
    prop.position.copy(mp).setY(propY);
    root.add(prop);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(propR, 40), blurMat.clone());
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(prop.position).setY(propY + 0.001);
    root.add(disc);
    propGroups.push({ prop, disc, dir: m.dir, angle: Math.random() * 6 });
    if (ducted) {
      const duct = new THREE.Mesh(ductGeometry(propR * 1.04, Math.max(0.006, propR * 0.45)), plastic);
      duct.position.copy(mp).setY(propY - propR * 0.08);
      duct.castShadow = true;
      root.add(duct);
    }
    // motor wires along the arm
    if (!whoop) {
      const w = tube([[mp.x * 0.85, thick + 0.002, mp.z * 0.85], [mp.x * 0.5, thick + 0.003, mp.z * 0.5], [mp.x * 0.2, thick + 0.006 * sc, mp.z * 0.2]], 0.0012 * sc, dark);
      root.add(w);
    }
  });

  // ── Camera ──────────────────────────────────────────────────────────────
  const camGroup = new THREE.Group();
  const camSize = whoop ? 0.008 : 0.019 * Math.max(0.65, Math.min(1, sc));
  const body = new THREE.Mesh(new RoundedBoxGeometry(camSize, camSize, camSize, 2, camSize * 0.12), dark);
  camGroup.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(camSize * 0.32, camSize * 0.36, camSize * 0.5, 24), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -camSize * 0.65;
  camGroup.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(camSize * 0.26, 24), new THREE.MeshPhysicalMaterial({ color: '#112244', roughness: 0.05, metalness: 0.2, clearcoat: 1 }));
  glass.position.z = -camSize * 0.91;
  glass.rotation.y = Math.PI;
  camGroup.add(glass);
  camGroup.rotation.x = (cameraTilt * Math.PI) / 180;
  camGroup.position.set(0, whoop ? 0.008 : thick + camSize * 0.75, whoop ? -0.012 : -0.045 * sc);
  root.add(camGroup);
  if (!whoop) {
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new RoundedBoxGeometry(0.003, camSize * 1.25, camSize * 1.4, 2, 0.001), tpu);
      side.position.set(s * (camSize / 2 + 0.002), camGroup.position.y, camGroup.position.z + camSize * 0.1);
      root.add(side);
    }
  }

  // ── Battery + strap + lead ──────────────────────────────────────────────
  if (!whoop) {
    const bw = 0.035 * sc, bh = 0.034 * sc, bl = 0.075 * sc;
    const cells = physics.cells;
    const label = labelTexture([`${cells}S ${physics.capacityMah}mAh`, 'LiPo 120C'], style.accent);
    const battMat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.55 });
    const batt = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, bl, 3, 0.004 * sc), battMat);
    const top = thick + (style.style === 'race' ? 0.022 : 0.03) * Math.max(0.6, sc) + thick * 0.4;
    batt.position.y = top + bh / 2;
    batt.castShadow = true;
    root.add(batt);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.002, bh + 0.002, 0.014 * sc), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 }));
    strap.position.copy(batt.position);
    root.add(strap);
    const red = new THREE.MeshStandardMaterial({ color: '#c01818', roughness: 0.5 });
    const blk = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 });
    const yel = new THREE.MeshStandardMaterial({ color: '#e8c300', roughness: 0.5 });
    root.add(tube([[0.004, top + bh * 0.3, bl / 2], [0.006, top + bh * 0.2, bl / 2 + 0.012 * sc], [0.004, top - 0.004, bl / 2 + 0.02 * sc]], 0.0016 * sc, red));
    root.add(tube([[-0.004, top + bh * 0.3, bl / 2], [-0.006, top + bh * 0.2, bl / 2 + 0.012 * sc], [-0.004, top - 0.004, bl / 2 + 0.02 * sc]], 0.0016 * sc, blk));
    const xt = new THREE.Mesh(new THREE.BoxGeometry(0.016 * sc, 0.008 * sc, 0.01 * sc), yel);
    xt.position.set(0, top - 0.006, bl / 2 + 0.024 * sc);
    root.add(xt);

    // VTX antenna
    const ant = tube([[0, thick + 0.01 * sc, 0.045 * sc], [0, thick + 0.03 * sc, 0.06 * sc], [0, thick + 0.05 * sc, 0.07 * sc]], 0.0012 * sc, dark);
    root.add(ant);
    const lolli = new THREE.Mesh(new THREE.SphereGeometry(0.006 * sc, 16, 10), new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.4 }));
    lolli.scale.y = 0.6;
    lolli.position.set(0, thick + 0.054 * sc, 0.072 * sc);
    root.add(lolli);
    if (style.gps) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 8), dark);
      mast.position.set(0, top + bh + 0.015, -0.01);
      root.add(mast);
      const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 24), new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.4 }));
      gps.position.set(0, top + bh + 0.032, -0.01);
      root.add(gps);
    }
  } else {
    const batt = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.006, 0.03, 2, 0.002), new THREE.MeshStandardMaterial({ color: '#3a6fd8', roughness: 0.5 }));
    batt.position.y = -0.003;
    root.add(batt);
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.props = propGroups;
  return root;
}

/** Turn a model into a translucent "ghost" (shares geometry, overrides materials). */
export function ghostify(model: QuadModel, color = '#7fd8ff'): QuadModel {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = mat;
      o.castShadow = false;
    }
  });
  model.animated = false;
  return model;
}
