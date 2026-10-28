// Game modes: free fly, practice (laps + ghost), race (countdown, N laps, results), track editor.

import * as THREE from 'three';
import { CollisionWorld } from '../sim/collision.js';
import { findTrack, getRecord, submitLap, submitRace, loadUserTracks, saveUserTracks } from './tracks.js';
import { buildQuadModel, ghostify } from '../world/quadModel.js';
import { QUAD_PRESETS } from '../sim/presets.js';
import { fmtTime } from '../ui/osd.js';

const BAR = 0.16;
const DEG = Math.PI / 180;

function gateQuat(g) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler((g.pitch || 0) * DEG, (g.yaw || 0) * DEG, 0, 'YXZ'));
}

function numberTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
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
function buildGateMesh(g, index, count) {
  const s = g.size || 2.2;
  const grp = new THREE.Group();
  const half = s / 2 + BAR / 2;
  const r = 0.28;
  const path = new THREE.CurvePath();
  const pts = [
    [-half + r, -half], [half - r, -half], [half, -half + r], [half, half - r], [half - r, half], [-half + r, half], [-half, half - r], [-half, -half + r],
  ];
  const corners = [[half - r, -half + r], [half - r, half - r], [-half + r, half - r], [-half + r, -half + r]];
  for (let k = 0; k < 4; k++) {
    const a = pts[k * 2], b = pts[k * 2 + 1];
    path.add(new THREE.LineCurve3(new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0)));
    const c = corners[k];
    const start = -Math.PI / 2 + (k * Math.PI) / 2;
    const arc = new THREE.EllipseCurve(c[0], c[1], r, r, start, start + Math.PI / 2, false);
    const ap = arc.getPoints(6).map((p) => new THREE.Vector3(p.x, p.y, 0));
    path.add(new THREE.CatmullRomCurve3(ap));
  }
  const geo = new THREE.TubeGeometry(path, 160, BAR / 2, 12, true);
  const isStart = index === 0;
  const colA = new THREE.Color(isStart ? '#ffffff' : index % 2 ? '#00b7ff' : '#ff6a00');
  const colB = new THREE.Color(isStart ? '#111111' : '#f2f2f2');
  const colors = [];
  const tubSeg = 160, radSeg = 12;
  for (let i = 0; i <= tubSeg; i++) {
    const stripe = Math.floor((i / tubSeg) * 24) % 2 === 0;
    for (let j = 0; j <= radSeg; j++) {
      const c = stripe ? colA : colB;
      colors.push(c.r, c.g, c.b);
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const frame = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: colA, emissiveIntensity: 0.18 }));
  frame.castShadow = true;
  grp.add(frame);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshBasicMaterial({ map: numberTexture(isStart ? 'START' : `${index + 1}/${count}`, `#${colA.getHexString()}`), side: THREE.DoubleSide }),
  );
  label.position.set(0, half + 0.42, 0);
  grp.add(label);
  grp.position.set(...g.p);
  grp.quaternion.copy(gateQuat(g));
  // Legs for upright gates near the ground.
  if (!g.pitch && g.p[1] - half < 8) {
    const legMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const h = g.p[1] - half;
      if (h <= 0.05) continue;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 8), legMat);
      leg.position.set(sx * half, -half - h / 2, 0);
      grp.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.7), legMat);
      foot.position.set(sx * half, -half - h + 0.03, 0);
      grp.add(foot);
    }
  }
  return grp;
}

export class Game {
  constructor({ scene, config, spawn, toast, resultsEl }) {
    this.scene = scene;
    this.config = config;
    this.spawn = spawn;
    this.toast = toast;
    this.resultsEl = resultsEl;
    this.gateWorld = new CollisionWorld();
    this.gateWorld.ground = false;
    this.gateGroup = new THREE.Group();
    scene.add(this.gateGroup);
    this.highlight = this._buildHighlight('#39ff6a');
    this.highlight2 = this._buildHighlight('#ffd23f', 0.45);
    this.clock = 0;
    this.ghostModel = null;
    this.ghostPreset = null;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this.track = null;
    this.loadTrack(config.game.track);
    this.reset();
  }

  _buildHighlight(color, scale = 1) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 * scale, depthWrite: false });
    const s = 2.9, t = 0.06;
    for (const [x, y, w, hh] of [[0, s / 2, s, t], [0, -s / 2, s, t], [s / 2, 0, t, s], [-s / 2, 0, t, s]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, t), m);
      bar.position.set(x, y, 0);
      g.add(bar);
    }
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  get mode() {
    return this.config.game.mode;
  }

  // ── Track management ──────────────────────────────────────────────────────
  loadTrack(id) {
    const t = findTrack(id);
    this.track = JSON.parse(JSON.stringify(t));
    this.config.game.track = this.track.id;
    this.rebuildGates();
  }

  rebuildGates() {
    this.gateGroup.clear();
    this.gateWorld.clear();
    const gates = this.track.gates;
    this.gates = gates.map((g, i) => {
      const s = g.size || 2.2;
      const q = gateQuat(g);
      const c = new THREE.Vector3(...g.p);
      const visible = this.mode !== 'free' || this.config.game.gatesInFree;
      if (visible) {
        this.gateGroup.add(buildGateMesh(g, i, gates.length));
        if (this.mode !== 'editor') {
          const half = s / 2 + BAR / 2;
          for (const [x, y, w, h] of [[0, half, s + BAR * 2, BAR], [0, -half, s + BAR * 2, BAR], [half, 0, BAR, s], [-half, 0, BAR, s]]) {
            this.gateWorld.addBox(new THREE.Vector3(x, y, 0).applyQuaternion(q).add(c), new THREE.Vector3(w / 2, h / 2, BAR / 2), q);
          }
        }
      }
      return { c, q, qi: q.clone().invert(), size: s };
    });
  }

  setMode(mode) {
    this.config.game.mode = mode;
    if (mode === 'editor' && !this.track.user) {
      this.track = { id: `user-${Date.now().toString(36)}`, name: `${this.track.name} (copy)`, gates: JSON.parse(JSON.stringify(this.track.gates)), user: true };
    }
    this.rebuildGates();
    this.reset();
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  placeGate(quad) {
    if (this.mode !== 'editor') return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quad.quat);
    const yaw = Math.atan2(-fwd.x, -fwd.z) / DEG;
    const diving = fwd.y < -0.7;
    const p = quad.pos.clone().addScaledVector(fwd, 2);
    const g = { p: [+p.x.toFixed(2), +Math.max(1.4, p.y).toFixed(2), +p.z.toFixed(2)], yaw: Math.round(yaw) };
    if (diving) g.pitch = -90;
    this.track.gates.push(g);
    this.rebuildGates();
    this.toast(`Gate ${this.track.gates.length} placed${diving ? ' (dive)' : ''}`, 1200);
  }

  removeLastGate() {
    if (this.mode !== 'editor' || !this.track.gates.length) return;
    this.track.gates.pop();
    this.rebuildGates();
    this.toast(`Gate removed (${this.track.gates.length} left)`, 1200);
  }

  saveTrack(name) {
    if (!this.track.user) return;
    if (name) this.track.name = name;
    const list = loadUserTracks().filter((t) => t.id !== this.track.id);
    const { user, ...data } = this.track;
    list.push(data);
    saveUserTracks(list);
    this.config.game.track = this.track.id;
    this.toast(`Track “${this.track.name}” saved`, 2000);
  }

  // ── Session state ─────────────────────────────────────────────────────────
  reset() {
    this.next = 0;
    this.lapStart = null;
    this.lapTimes = [];
    this.splits = [];
    this.recording = [];
    this.lastRecord = -1;
    this.phase = this.mode === 'race' ? 'waiting' : 'running';
    this.countdown = 0;
    this.raceStart = null;
    this.holeshot = null;
    this.message = '';
    this.messageUntil = 0;
    this.topSpeed = 0;
    this.resultsEl.classList.add('hidden');
    this._loadGhost();
  }

  _quadId() {
    return this.config.quad.preset;
  }

  _loadGhost() {
    const rec = getRecord(this.track.id, this._quadId());
    this.pb = rec?.bestLap ?? null;
    this.pbSplits = rec?.ghost?.splits ?? null;
    this.ghost = rec?.ghost?.samples ?? null;
    const presetId = this._quadId();
    if (this.ghostModel && this.ghostPreset !== presetId) {
      this.scene.remove(this.ghostModel);
      this.ghostModel = null;
    }
    if (!this.ghostModel) {
      this.ghostModel = ghostify(buildQuadModel(QUAD_PRESETS[presetId] || QUAD_PRESETS.freestyle5, this.config.physics));
      this.ghostModel.scale.setScalar(1.15);
      this.ghostModel.visible = false;
      this.ghostPreset = presetId;
      this.scene.add(this.ghostModel);
    }
  }

  _flash(msg, secs = 2) {
    this.message = msg;
    this.messageUntil = this.clock + secs;
  }

  /** Whether the flight controller may arm right now (race countdown holds it). */
  get allowArm() {
    return !(this.mode === 'race' && (this.phase === 'waiting' || this.phase === 'countdown'));
  }

  /**
   * @param {number} dt frame time
   * @param {object} quad
   * @param {THREE.Vector3} prevPos position at previous frame
   * @param {{armSwitch:boolean, throttle:number}} rc
   */
  update(dt, quad, prevPos, rc) {
    this.clock += dt;
    const mode = this.mode;
    this.topSpeed = Math.max(this.topSpeed, quad.speedKmh);

    if (mode === 'race') {
      if (this.phase === 'waiting' && rc.armSwitch && rc.throttle < 0.05) {
        this.phase = 'countdown';
        this.countdown = 3;
      } else if (this.phase === 'countdown') {
        if (!rc.armSwitch) this.phase = 'waiting';
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.phase = 'running';
          this.raceStart = this.clock;
          this._flash('GO!', 1);
        }
      }
    }

    if (this.gates.length && mode !== 'free' && mode !== 'editor' && this.phase !== 'waiting' && this.phase !== 'countdown') {
      this._checkGates(quad, prevPos);
      this._recordGhost(quad);
    }
    this._updateGhost();
    this._updateHighlights(mode);
  }

  _crossed(i, prevPos, pos) {
    const g = this.gates[i];
    const a = this._a.copy(prevPos).sub(g.c).applyQuaternion(g.qi);
    const b = this._b.copy(pos).sub(g.c).applyQuaternion(g.qi);
    if (!(a.z > 0 && b.z <= 0)) return false;
    const t = a.z / (a.z - b.z);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const lim = g.size / 2 + 0.12;
    return Math.abs(x) < lim && Math.abs(y) < lim;
  }

  _checkGates(quad, prevPos) {
    const n = this.gates.length;
    if (this.phase === 'finished' && this.mode === 'race') return;
    if (this._crossed(this.next, prevPos, quad.pos)) {
      const i = this.next;
      const now = this.clock;
      if (i === 0) {
        if (this.lapStart !== null) this._completeLap(now - this.lapStart);
        else if (this.mode === 'race') {
          this.holeshot = now - this.raceStart;
          this._flash(`HOLESHOT ${this.holeshot.toFixed(2)}`, 2);
        }
        this.lapStart = now;
        this.splits = [0];
        this.recording = [];
        this.lastRecord = -1;
      } else if (this.lapStart !== null) {
        const split = now - this.lapStart;
        this.splits[i] = split;
        if (this.pbSplits?.[i] !== undefined) {
          const d = split - this.pbSplits[i];
          this._flash(`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`, 1.5);
          this.deltaColor = d >= 0 ? 'bad' : 'good';
        }
      }
      this.next = (i + 1) % n;
      return;
    }
    // Flew through a later gate → missed one.
    for (let k = 1; k < n; k++) {
      const j = (this.next + k) % n;
      if (this._crossed(j, prevPos, quad.pos)) {
        this._flash(`MISSED GATE ${this.next + 1}`, 1.5);
        break;
      }
    }
  }

  _completeLap(lap) {
    this.lapTimes.push(lap);
    const ghost = { samples: this.recording, splits: this.splits };
    const pb = submitLap(this.track.id, this._quadId(), lap, ghost);
    if (pb) {
      this.toast(`New personal best: ${fmtTime(lap)}`, 2500);
      this._loadGhost();
    }
    this._flash(`LAP ${this.lapTimes.length}  ${fmtTime(lap)}${pb ? '  PB!' : ''}`, 2.5);
    if (this.mode === 'race' && this.lapTimes.length >= this.config.game.laps) this._finishRace();
  }

  _finishRace() {
    this.phase = 'finished';
    const total = this.clock - this.raceStart;
    const best = Math.min(...this.lapTimes);
    const rank = submitRace(this.track.id, this._quadId(), this.lapTimes.length, total, best);
    const rec = getRecord(this.track.id, this._quadId());
    const rows = this.lapTimes.map((t, i) => `<tr${t === best ? ' class="best"' : ''}><td>Lap ${i + 1}</td><td>${fmtTime(t)}</td></tr>`).join('');
    const board = (rec?.races || []).map((r, i) => `<tr${i + 1 === rank ? ' class="best"' : ''}><td>#${i + 1}</td><td>${fmtTime(r.total)}</td><td>${fmtTime(r.best)}</td><td>${new Date(r.date).toLocaleDateString()}</td></tr>`).join('');
    this.resultsEl.innerHTML = `
      <div class="results-card">
        <h2>Race complete</h2>
        <p class="sub">${this.track.name} · ${QUAD_PRESETS[this._quadId()]?.name ?? ''}</p>
        <div class="big">${fmtTime(total)}</div>
        <table>${this.holeshot !== null ? `<tr><td>Holeshot</td><td>${this.holeshot.toFixed(2)}s</td></tr>` : ''}${rows}
        <tr><td>Top speed</td><td>${this.topSpeed.toFixed(0)} km/h</td></tr></table>
        <h3>Your best races</h3>
        <table class="board"><tr><th></th><th>Total</th><th>Best lap</th><th>Date</th></tr>${board}</table>
        <p class="sub">Press <kbd>R</kbd> to race again · <kbd>P</kbd> to watch the replay</p>
      </div>`;
    this.resultsEl.classList.remove('hidden');
  }

  _recordGhost(quad) {
    if (this.lapStart === null) return;
    const t = this.clock - this.lapStart;
    if (t - this.lastRecord < 1 / 30) return;
    this.lastRecord = t;
    const p = quad.pos, q = quad.quat;
    this.recording.push(+t.toFixed(3), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3));
  }

  _updateGhost() {
    const show = this.config.game.ghost && this.ghost && this.lapStart !== null && (this.mode === 'practice' || this.mode === 'race') && this.phase !== 'finished';
    if (!show) {
      if (this.ghostModel) this.ghostModel.visible = false;
      return;
    }
    const t = this.clock - this.lapStart;
    const g = this.ghost;
    const n = g.length / 8;
    if (t > g[(n - 1) * 8]) {
      this.ghostModel.visible = false;
      return;
    }
    // Binary search for the sample pair around t.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g[mid * 8] <= t) lo = mid;
      else hi = mid;
    }
    const a = lo * 8, b = hi * 8;
    const f = Math.min(1, Math.max(0, (t - g[a]) / Math.max(1e-6, g[b] - g[a])));
    this.ghostModel.visible = true;
    this.ghostModel.position.set(g[a + 1] + (g[b + 1] - g[a + 1]) * f, g[a + 2] + (g[b + 2] - g[a + 2]) * f, g[a + 3] + (g[b + 3] - g[a + 3]) * f);
    this._qa ??= new THREE.Quaternion();
    this._qb ??= new THREE.Quaternion();
    this._qa.set(g[a + 4], g[a + 5], g[a + 6], g[a + 7]).normalize();
    this._qb.set(g[b + 4], g[b + 5], g[b + 6], g[b + 7]).normalize();
    this.ghostModel.quaternion.slerpQuaternions(this._qa, this._qb, f);
  }

  _updateHighlights(mode) {
    const active = this.gates.length && (mode === 'practice' || mode === 'race') && this.phase !== 'finished';
    this.highlight.visible = !!active;
    this.highlight2.visible = !!active && this.gates.length > 2;
    if (!active) return;
    const g = this.gates[this.next];
    this.highlight.position.copy(g.c);
    this.highlight.quaternion.copy(g.q);
    const pulse = 0.55 + 0.35 * Math.sin(this.clock * 7);
    this.highlight.children.forEach((c) => (c.material.opacity = pulse));
    const g2 = this.gates[(this.next + 1) % this.gates.length];
    this.highlight2.position.copy(g2.c);
    this.highlight2.quaternion.copy(g2.q);
  }

  /** Arrow + distance toward the next gate, relative to the camera. */
  pointer(camera) {
    if (!this.highlight.visible) return '';
    const g = this.gates[this.next];
    const v = this._a.copy(g.c).project(camera);
    const behind = v.z > 1;
    const onScreen = !behind && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85;
    const d = camera.position.distanceTo(g.c);
    if (onScreen) return `${d.toFixed(0)}m`;
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const arrow = Math.abs(x) > Math.abs(y) ? (x > 0 ? '▶' : '◀') : y > 0 ? '▲' : '▼';
    return `${arrow} ${d.toFixed(0)}m`;
  }

  /** Text block for the OSD. */
  osdText(camera) {
    const mode = this.mode;
    const lines = [];
    if (mode === 'free') return this._msg();
    if (mode === 'editor') {
      return `TRACK EDITOR · ${this.track.gates.length} GATES\nG place gate · BACKSPACE undo · save in menu (Race tab)`;
    }
    if (mode === 'race') {
      if (this.phase === 'waiting') return 'RACE · ARM TO START';
      if (this.phase === 'countdown') return `${Math.ceil(this.countdown)}`;
      const total = this.phase === 'finished' ? '' : `RACE ${fmtTime(this.clock - this.raceStart)}  `;
      lines.push(`${total}LAP ${Math.min(this.lapTimes.length + 1, this.config.game.laps)}/${this.config.game.laps}`);
    } else {
      lines.push(this.lapStart !== null ? `LAP ${fmtTime(this.clock - this.lapStart)}` : 'PRACTICE · FLY THROUGH START');
    }
    const parts = [`GATE ${this.next + 1}/${this.gates.length}`, this.pointer(camera)];
    if (this.lapTimes.length) parts.push(`LAST ${fmtTime(this.lapTimes[this.lapTimes.length - 1])}`);
    if (this.pb !== null) parts.push(`PB ${fmtTime(this.pb)}`);
    lines.push(parts.filter(Boolean).join('  '));
    const m = this._msg();
    if (m) lines.push(m);
    return lines.join('\n');
  }

  _msg() {
    return this.clock < this.messageUntil ? this.message : '';
  }
}
