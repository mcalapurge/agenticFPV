// Race-gate geometry: the crossing frame used by lap timing, colliders, and the padded gate mesh.

import * as THREE from 'three';
import type { Gate } from './tracks';

export const GATE_BAR = 0.16;
export const DEFAULT_GATE_SIZE = 2.2;
const DEG = Math.PI / 180;

/** Pose + size of a gate's opening, as used for crossing detection. */
export interface GateFrame {
  c: THREE.Vector3;
  q: THREE.Quaternion;
  qi: THREE.Quaternion;
  size: number;
}

export function gateQuat(g: Gate): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler((g.pitch ?? 0) * DEG, (g.yaw ?? 0) * DEG, 0, 'YXZ'));
}

export function gateFrame(g: Gate): GateFrame {
  const q = gateQuat(g);
  return { c: new THREE.Vector3(...g.p), q, qi: q.clone().invert(), size: g.size ?? DEFAULT_GATE_SIZE };
}

/** The four frame bars as oriented boxes (centre, half extents) in world space. */
export function gateColliderBoxes(g: Gate): { center: THREE.Vector3; half: THREE.Vector3; quat: THREE.Quaternion }[] {
  const { c, q, size: s } = gateFrame(g);
  const half = s / 2 + GATE_BAR / 2;
  const bars: [number, number, number, number][] = [
    [0, half, s + GATE_BAR * 2, GATE_BAR],
    [0, -half, s + GATE_BAR * 2, GATE_BAR],
    [half, 0, GATE_BAR, s],
    [-half, 0, GATE_BAR, s],
  ];
  return bars.map(([x, y, w, h]) => ({
    center: new THREE.Vector3(x, y, 0).applyQuaternion(q).add(c),
    half: new THREE.Vector3(w / 2, h / 2, GATE_BAR / 2),
    quat: q,
  }));
}

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(15,15,18,0.9)';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#fff';
  g.font = 'bold 76px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Padded race gate: rounded-square tube with striped vertex colours, number board and legs. */
export function buildGateMesh(g: Gate, index: number, count: number): THREE.Group {
  const s = g.size ?? DEFAULT_GATE_SIZE;
  const grp = new THREE.Group();
  const half = s / 2 + GATE_BAR / 2;
  const r = 0.28;
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = [
    [-half + r, -half],
    [half - r, -half],
    [half, -half + r],
    [half, half - r],
    [half - r, half],
    [-half + r, half],
    [-half, half - r],
    [-half, -half + r],
  ];
  const corners = [
    [half - r, -half + r],
    [half - r, half - r],
    [-half + r, half - r],
    [-half + r, -half + r],
  ];
  for (let k = 0; k < 4; k++) {
    const a = pts[k * 2];
    const b = pts[k * 2 + 1];
    path.add(new THREE.LineCurve3(new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0)));
    const c = corners[k];
    const start = -Math.PI / 2 + (k * Math.PI) / 2;
    const arc = new THREE.EllipseCurve(c[0], c[1], r, r, start, start + Math.PI / 2, false);
    path.add(new THREE.CatmullRomCurve3(arc.getPoints(6).map((p) => new THREE.Vector3(p.x, p.y, 0))));
  }
  const tubSeg = 160;
  const radSeg = 12;
  const geo = new THREE.TubeGeometry(path, tubSeg, GATE_BAR / 2, radSeg, true);
  const isStart = index === 0;
  const colA = new THREE.Color(isStart ? '#ffffff' : index % 2 ? '#00b7ff' : '#ff6a00');
  const colB = new THREE.Color(isStart ? '#111111' : '#f2f2f2');
  const colors: number[] = [];
  for (let i = 0; i <= tubSeg; i++) {
    const c = Math.floor((i / tubSeg) * 24) % 2 === 0 ? colA : colB;
    for (let j = 0; j <= radSeg; j++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const frame = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: colA, emissiveIntensity: 0.18 }),
  );
  frame.castShadow = true;
  grp.add(frame);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshBasicMaterial({
      map: numberTexture(isStart ? 'START' : `${index + 1}/${count}`, `#${colA.getHexString()}`),
      side: THREE.DoubleSide,
    }),
  );
  label.position.set(0, half + 0.42, 0);
  grp.add(label);
  grp.position.set(...g.p);
  grp.quaternion.copy(gateQuat(g));
  // Legs for upright gates near the ground.
  const legH = g.p[1] - half;
  if (!g.pitch && legH > 0.05 && legH < 8) {
    const legMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, legH, 8), legMat);
      leg.position.set(sx * half, -half - legH / 2, 0);
      grp.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.7), legMat);
      foot.position.set(sx * half, -half - legH + 0.03, 0);
      grp.add(foot);
    }
  }
  return grp;
}
