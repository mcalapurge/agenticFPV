// Game modes: free fly, practice (laps + ghost), race (countdown, N laps, results), track editor.
// Owns the gate meshes/colliders, highlights and the PB ghost; lap logic lives in RaceSession.

import * as THREE from 'three';
import type { Config, GameMode } from '../../state/configSchema';
import { CollisionWorld } from '../sim/collision';
import { getPreset } from '../sim/presets';
import type { QuadView } from '../sim/quad';
import { buildQuadModel, ghostify } from '../world/quadModel';
import { buildGateMesh, gateColliderBoxes, gateFrame, type GateFrame } from './gates';
import { RaceSession, type RaceSummary, type RcSwitches, type RecordsApi } from './raceSession';
import { findTrack, loadUserTracks, saveUserTracks, type Gate, type Track } from './tracks';

const DEG = Math.PI / 180;

export interface GameDeps {
  scene: THREE.Scene;
  getConfig: () => Config;
  updateConfig: (recipe: (draft: Config) => void) => void;
  toast: (msg: string, ms?: number) => void;
  onRaceFinished: (summary: RaceSummary & { trackName: string; quadName: string }) => void;
  records?: RecordsApi;
}

export class Game {
  readonly gateWorld = new CollisionWorld();
  track: Track;
  gates: GateFrame[] = [];
  session!: RaceSession;

  private readonly deps: GameDeps;
  private readonly gateGroup = new THREE.Group();
  private readonly highlight: THREE.Group;
  private readonly highlight2: THREE.Group;
  private ghostModel: THREE.Group | null = null;
  private ghostPreset: string | null = null;
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.gateWorld.ground = false;
    deps.scene.add(this.gateGroup);
    this.highlight = this.buildHighlight('#39ff6a');
    this.highlight2 = this.buildHighlight('#ffd23f', 0.45);
    this.track = structuredClone(findTrack(deps.getConfig().game.track));
    this.rebuildGates();
    this.reset();
  }

  private get config(): Config {
    return this.deps.getConfig();
  }

  get mode(): GameMode {
    return this.config.game.mode;
  }

  get allowArm(): boolean {
    return this.session.allowArm;
  }

  private buildHighlight(color: string, scale = 1): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 * scale, depthWrite: false });
    const s = 2.9;
    const t = 0.06;
    for (const [x, y, w, hh] of [
      [0, s / 2, s, t],
      [0, -s / 2, s, t],
      [s / 2, 0, t, s],
      [-s / 2, 0, t, s],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, t), m);
      bar.position.set(x, y, 0);
      g.add(bar);
    }
    g.visible = false;
    this.deps.scene.add(g);
    return g;
  }

  // ── Track management ──────────────────────────────────────────────────────
  loadTrack(id: string): void {
    this.track = structuredClone(findTrack(id));
    this.deps.updateConfig((c) => void (c.game.track = this.track.id));
    this.rebuildGates();
    this.reset();
  }

  rebuildGates(): void {
    this.gateGroup.clear();
    this.gateWorld.clear();
    const gates = this.track.gates;
    const visible = this.mode !== 'free' || this.config.game.gatesInFree;
    gates.forEach((g, i) => {
      if (!visible) return;
      this.gateGroup.add(buildGateMesh(g, i, gates.length));
      if (this.mode !== 'editor') for (const b of gateColliderBoxes(g)) this.gateWorld.addBox(b.center, b.half, b.quat);
    });
    this.gates = gates.map(gateFrame);
  }

  setMode(mode: GameMode): void {
    this.deps.updateConfig((c) => void (c.game.mode = mode));
    if (mode === 'editor' && !this.track.user) {
      this.track = {
        id: `user-${Date.now().toString(36)}`,
        name: `${this.track.name} (copy)`,
        gates: structuredClone(this.track.gates),
        user: true,
      };
    }
    this.rebuildGates();
    this.reset();
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  placeGate(quad: Pick<QuadView, 'pos' | 'quat'>): void {
    if (this.mode !== 'editor') return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quad.quat);
    const diving = fwd.y < -0.7;
    const p = quad.pos.clone().addScaledVector(fwd, 2);
    const g: Gate = {
      p: [+p.x.toFixed(2), +Math.max(1.4, p.y).toFixed(2), +p.z.toFixed(2)],
      yaw: Math.round(Math.atan2(-fwd.x, -fwd.z) / DEG),
    };
    if (diving) g.pitch = -90;
    this.track.gates.push(g);
    this.rebuildGates();
    this.deps.toast(`Gate ${this.track.gates.length} placed${diving ? ' (dive)' : ''}`, 1200);
  }

  removeLastGate(): void {
    if (this.mode !== 'editor' || !this.track.gates.length) return;
    this.track.gates.pop();
    this.rebuildGates();
    this.deps.toast(`Gate removed (${this.track.gates.length} left)`, 1200);
  }

  clearGates(): void {
    this.track.gates = [];
    this.rebuildGates();
  }

  saveTrack(name?: string): void {
    if (!this.track.user) return;
    if (name) this.track.name = name;
    saveUserTracks([...loadUserTracks().filter((t) => t.id !== this.track.id), this.track]);
    this.deps.updateConfig((c) => void (c.game.track = this.track.id));
    this.deps.toast(`Track “${this.track.name}” saved`, 2000);
  }

  // ── Session ───────────────────────────────────────────────────────────────
  reset(): void {
    const cfg = this.config;
    const preset = getPreset(cfg.quad.preset);
    this.session = new RaceSession({
      mode: cfg.game.mode,
      gates: this.gates,
      laps: cfg.game.laps,
      trackId: this.track.id,
      quadId: cfg.quad.preset,
      records: this.deps.records,
      onLap: (lap, pb) => {
        if (pb) this.deps.toast(`New personal best: ${lap.toFixed(2)}s`, 2500);
      },
      onFinish: (summary) =>
        this.deps.onRaceFinished({ ...summary, trackName: this.track.name, quadName: preset.name }),
    });
    this.ensureGhostModel();
  }

  private ensureGhostModel(): void {
    const presetId = this.config.quad.preset;
    if (this.ghostModel && this.ghostPreset === presetId) return;
    if (this.ghostModel) this.deps.scene.remove(this.ghostModel);
    const ghost = ghostify(buildQuadModel(getPreset(presetId), this.config.physics));
    ghost.scale.setScalar(1.15);
    ghost.visible = false;
    this.ghostModel = ghost;
    this.ghostPreset = presetId;
    this.deps.scene.add(ghost);
  }

  update(dt: number, quad: QuadView, prevPos: THREE.Vector3, rc: RcSwitches): void {
    this.session.update(dt, quad.pos, prevPos, quad.quat, quad.speedKmh, rc);
    // PB ghost.
    const ghost = this.ghostModel;
    if (ghost) {
      ghost.visible = this.config.game.ghost && this.session.ghostPose(ghost.position, ghost.quaternion);
    }
    this.updateHighlights();
  }

  private updateHighlights(): void {
    const s = this.session;
    const active = s.timed && s.phase !== 'finished';
    this.highlight.visible = active;
    this.highlight2.visible = active && this.gates.length > 2;
    if (!active) return;
    const g = this.gates[s.next];
    this.highlight.position.copy(g.c);
    this.highlight.quaternion.copy(g.q);
    const pulse = 0.55 + 0.35 * Math.sin(s.clock * 7);
    for (const c of this.highlight.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = pulse;
    const g2 = this.gates[(s.next + 1) % this.gates.length];
    this.highlight2.position.copy(g2.c);
    this.highlight2.quaternion.copy(g2.q);
  }

  /** Arrow + distance toward the next gate, relative to the camera. */
  pointer(camera: THREE.Camera): string {
    if (!this.highlight.visible) return '';
    const g = this.gates[this.session.next];
    const v = this._v.copy(g.c).project(camera);
    const behind = v.z > 1;
    const d = camera.position.distanceTo(g.c);
    if (!behind && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85) return `${d.toFixed(0)}m`;
    const x = behind ? -v.x : v.x;
    const y = behind ? -v.y : v.y;
    const arrow = Math.abs(x) > Math.abs(y) ? (x > 0 ? '▶' : '◀') : y > 0 ? '▲' : '▼';
    return `${arrow} ${d.toFixed(0)}m`;
  }

  /** Text block for the OSD. */
  osdText(camera: THREE.Camera): string {
    if (this.mode === 'editor') {
      return `TRACK EDITOR · ${this.track.gates.length} GATES\nG place gate · BACKSPACE undo · save in menu (Race tab)`;
    }
    return this.session.osdText(this.pointer(camera));
  }

  /** Ghost pose helper for tests/debugging. */
  ghostVisible(): boolean {
    return !!this.ghostModel?.visible && this.session.ghostPose(this._v, this._q);
  }
}
