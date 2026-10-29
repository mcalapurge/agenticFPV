// The simulator: renderer, world, 1 kHz physics/PID loop, cameras, game modes, replay, audio, effects.
// UI lives in React; it talks to the engine through the stores and `onFrame` subscriptions.

import * as THREE from 'three';
import { CAMERA_MODES, type Config, type GameMode } from '../state/configSchema';
import { getConfig, useConfigStore } from '../state/configStore';
import { useUiStore, type GpuInfo } from '../state/uiStore';
import { MotorAudio } from './audio/motorAudio';
import { Game } from './game/game';
import { Replay } from './game/replay';
import { InputManager, type InputState } from './input/input';
import { Environment } from './render/environment';
import { detectGpu } from './render/gpuInfo';
import { computeVideoFx, PostFX, signalQuality } from './render/postfx';
import { PropWashEffects } from './render/propwash';
import { CollisionWorld } from './sim/collision';
import { FlightController } from './sim/flightController';
import { getPreset } from './sim/presets';
import { Quad, type QuadView } from './sim/quad';
import { buildMap, type MapInfo } from './world/map';
import { buildQuadModel, type QuadModel } from './world/quadModel';

export const DT = 1 / 1000; // physics + PID loop: 1 kHz
const MAX_STEPS_PER_FRAME = 120;

export interface SimState {
  armed: boolean;
  crashed: boolean;
  turtle: boolean;
  flightTime: number;
  warning: string;
  signal: number;
  occluders: number;
  simTime: number;
}

export interface PerfStats {
  frameMs: number;
  physMs: number;
  renderMs: number;
  steps: number;
}

/** What the HUD needs each frame. */
export interface Hud {
  lap: string;
  bigCountdown: boolean;
  warning: string;
}

export type FrameListener = (sim: Simulator) => void;

const ema = (prev: number, v: number, k = 0.1) => (prev === 0 ? v : prev + (v - prev) * k);

export class Simulator {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera = new THREE.PerspectiveCamera(90, 1, 0.02, 2000);
  readonly collision: CollisionWorld;
  readonly gpu: GpuInfo;
  readonly env: Environment;
  readonly post: PostFX;
  readonly map: MapInfo;
  readonly effects: PropWashEffects;
  readonly fc: FlightController;
  readonly quad: Quad;
  readonly input: InputManager;
  readonly audio: MotorAudio;
  readonly replay = new Replay(90, 60);
  readonly game: Game;
  readonly state: SimState = {
    armed: false,
    crashed: false,
    turtle: false,
    flightTime: 0,
    warning: '',
    signal: 1,
    occluders: 0,
    simTime: 0,
  };
  readonly perf: PerfStats = { frameMs: 0, physMs: 0, renderMs: 0, steps: 0 };
  readonly hud: Hud = { lap: '', bigCountdown: false, warning: '' };
  quadModel!: QuadModel;
  rc: InputState;

  private readonly pilotPos: THREE.Vector3;
  private readonly prevPos = new THREE.Vector3();
  private readonly chasePos = new THREE.Vector3();
  private readonly listeners = new Set<FrameListener>();
  private readonly cleanups: (() => void)[] = [];
  private lastTime = performance.now();
  private accumulator = 0;
  private signalTimer = 0;
  private raf = 0;
  private readonly tiltQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  /** Build the world (async: textures, HDRIs) and return a ready, not-yet-running simulator. */
  static async create(canvas: HTMLCanvasElement): Promise<Simulator> {
    const ui = useUiStore.getState();
    const config = getConfig();
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: config.graphics.antialias,
      powerPreference: 'high-performance',
    });
    const scene = new THREE.Scene();
    const collision = new CollisionWorld();
    const map = await buildMap(scene, collision, (msg) => ui.setLoading(msg));
    const sim = new Simulator(renderer, scene, collision, map);
    await sim.applyEnvironment();
    return sim;
  }

  private constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, collision: CollisionWorld, map: MapInfo) {
    const config = getConfig();
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = scene;
    this.collision = collision;
    this.map = map;
    this.gpu = detectGpu(renderer);
    console.info(
      `[agenticFPV] GPU: ${this.gpu.name} (${this.gpu.vendor}) — ${this.gpu.software ? 'SOFTWARE' : 'hardware'} rendering`,
    );
    useUiStore.getState().setGpu(this.gpu);

    this.env = new Environment(renderer, scene);
    this.env.setLamps(map.lamps.positions, map.lamps.meshes);
    this.post = new PostFX(renderer);
    this.effects = new PropWashEffects(scene, collision, map.grassPatches);
    this.pilotPos = map.spawn.pos.clone().add(new THREE.Vector3(0, 1.7, 4));

    this.fc = new FlightController(config, DT);
    this.quad = new Quad(config);
    this.input = new InputManager(config);
    this.rc = this.input.state;
    this.audio = new MotorAudio(config);
    this.game = new Game({
      scene,
      getConfig,
      updateConfig: (recipe) => useConfigStore.getState().update(recipe),
      toast: (msg, ms) => useUiStore.getState().toast(msg, ms),
      onRaceFinished: (r) => useUiStore.getState().setResults(r),
    });
    this.rebuildQuadModel();
    this.bindInput();
    this.resetQuad();
    this.applyConfig(config, null);

    // React to config edits (settings UI, imports, key toggles).
    this.cleanups.push(
      useConfigStore.subscribe(
        (s) => s.config,
        (cfg, prev) => this.applyConfig(cfg, prev),
      ),
    );
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));
    this.resize();
  }

  get config(): Config {
    return getConfig();
  }

  /** The thing we look at / listen to: the live quad or the replay proxy. */
  get subject(): QuadView {
    return this.replay.active ? this.replay.view : this.quad;
  }

  get paused(): boolean {
    return useUiStore.getState().menuOpen || this.replay.active;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── Config ──────────────────────────────────────────────────────────────────
  private applyConfig(cfg: Config, prev: Config | null): void {
    this.fc.applyConfig(cfg);
    this.quad.applyConfig(cfg);
    this.input.config = cfg;
    this.audio.config = cfg;
    const changed = <K extends keyof Config>(k: K) => !prev || prev[k] !== cfg[k];
    if (changed('graphics')) {
      this.renderer.shadowMap.enabled = cfg.graphics.shadows;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * cfg.graphics.pixelRatio);
      if (prev && prev.graphics.shadows !== cfg.graphics.shadows) {
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) m.needsUpdate = true;
        });
      }
      if (prev) void this.applyEnvironment();
      this.resize();
    }
    if (!prev) return;
    const modelChanged =
      prev.quad.preset !== cfg.quad.preset ||
      prev.physics.armLengthMm !== cfg.physics.armLengthMm ||
      prev.physics.propInches !== cfg.physics.propInches ||
      prev.physics.cells !== cfg.physics.cells ||
      prev.camera.tilt !== cfg.camera.tilt;
    if (modelChanged) this.rebuildQuadModel();
    if (
      prev.quad.preset !== cfg.quad.preset ||
      prev.game.laps !== cfg.game.laps ||
      prev.game.gatesInFree !== cfg.game.gatesInFree
    ) {
      if (prev.game.gatesInFree !== cfg.game.gatesInFree) this.game.rebuildGates();
      this.resetQuad();
    }
  }

  applyEnvironment(): Promise<void> {
    const g = this.config.graphics;
    return this.env.apply(g.timeOfDay, { fog: g.fog, shadows: g.shadows, ibl: g.ibl });
  }

  rebuildQuadModel(): void {
    if (this.quadModel) this.scene.remove(this.quadModel);
    const cfg = this.config;
    this.quadModel = buildQuadModel(getPreset(cfg.quad.preset), cfg.physics, { cameraTilt: cfg.camera.tilt });
    this.scene.add(this.quadModel);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Actions (keyboard, UI) ──────────────────────────────────────────────────
  resetQuad(): void {
    this.quad.reset(this.map.spawn.pos, this.map.spawn.yaw);
    this.fc.reset();
    Object.assign(this.state, { armed: false, crashed: false, turtle: false, flightTime: 0 });
    this.fc.armed = false;
    this.prevPos.copy(this.quad.pos);
    this.chasePos.copy(this.quad.pos).add(new THREE.Vector3(0, 1, 3));
    this.game.reset();
    useUiStore.getState().setResults(null);
    if (this.replay.active) this.replay.exit();
  }

  setGameMode(mode: GameMode): void {
    this.game.setMode(mode);
    this.resetQuad();
  }

  loadTrack(id: string): void {
    this.game.loadTrack(id);
    this.resetQuad();
  }

  cycleCamera(): void {
    const mode = this.config.camera.mode;
    const next = CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
    useConfigStore.getState().setPath('camera.mode', next);
    useUiStore.getState().toast(`Camera: ${next.toUpperCase()}`, 1200);
  }

  toggleFlightMode(): void {
    const next = this.config.flight.mode === 'acro' ? 'angle' : 'acro';
    useConfigStore.getState().setPath('flight.mode', next);
    useUiStore.getState().toast(`Flight mode: ${next.toUpperCase()}`, 1200);
  }

  toggleReplay(): void {
    const ui = useUiStore.getState();
    if (this.replay.active) {
      this.replay.exit();
      ui.toast('Replay closed', 1000);
    } else if (this.replay.enter()) {
      ui.setResults(null);
      ui.toast('Replay', 1000);
    }
  }

  private bindInput(): void {
    const ui = () => useUiStore.getState();
    const i = this.input;
    this.cleanups.push(
      i.on('menu', () => ui().toggleMenu()),
      i.on('reset', () => this.resetQuad()),
      i.on('camera', () => this.cycleCamera()),
      i.on('mode', () => this.toggleFlightMode()),
      i.on('help', () => ui().openMenu('help')),
      i.on('gamepads', () => {
        const pad = i.getGamepad();
        ui().toast(pad ? `Controller connected: ${pad.id}` : 'Controller disconnected — keyboard fallback', 3000);
      }),
    );
    i.keyHook = (k, e) => {
      if (ui().menuOpen) return false;
      const r = this.replay;
      if (k === 'p' && !e.repeat) {
        this.toggleReplay();
        return true;
      }
      if (r.active) {
        if (k === ' ') r.playing = !r.playing;
        else if (k === 'arrowleft') r.seek(-5);
        else if (k === 'arrowright') r.seek(5);
        else if (k === 'arrowup') r.setSpeed(r.speed * 2);
        else if (k === 'arrowdown') r.setSpeed(r.speed / 2);
        else if (k === 'c') return false;
        else return k !== 'escape' && k !== 'r';
        return true;
      }
      if (this.game.mode === 'editor') {
        if (k === 'g' && !e.repeat) {
          this.game.placeGate(this.quad);
          return true;
        }
        if (k === 'backspace') {
          this.game.removeLastGate();
          return true;
        }
      }
      if (k === 'b' && !e.repeat) {
        ui().toggleBlackbox();
        return true;
      }
      if (k === 'f' && !e.repeat) {
        useConfigStore.getState().setPath('camera.showPerf', !this.config.camera.showPerf);
        return true;
      }
      return false;
    };
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  private collide = (q: Quad) => {
    const p = this.config.physics;
    this.collision.resolveQuad(q, p);
    if (this.game.mode !== 'editor') this.game.gateWorld.resolveQuad(q, p);
  };

  private updateArming(rc: InputState): void {
    const s = this.state;
    const cfg = this.config;
    const wantArm = rc.armSwitch && !s.crashed && this.game.allowArm;
    if (!wantArm) {
      s.armed = false;
    } else if (!s.armed && rc.throttle < 0.05) {
      s.armed = true;
      s.turtle = rc.turtleSwitch; // latched at arming, like Betaflight
    }
    if (!s.armed) s.turtle = false;
    this.fc.armed = s.armed;
    this.fc.turtle = s.turtle;
    if (s.crashed) s.warning = 'CRASHED · PRESS R';
    else if (s.turtle) s.warning = 'TURTLE';
    else if (rc.armSwitch && !s.armed && this.game.allowArm) s.warning = 'THROTTLE HIGH';
    else s.warning = cfg.physics.battery && this.quad.battery.voltage / cfg.physics.cells < 3.4 ? 'LOW BATTERY' : '';
  }

  private updateSignal(dt: number, subject: QuadView): void {
    this.signalTimer -= dt;
    if (this.signalTimer <= 0) {
      this.signalTimer = 0.1;
      this.state.occluders = this.collision.countOccluders(this.pilotPos, subject.pos, 6);
    }
    const q = signalQuality(this.pilotPos.distanceTo(subject.pos), this.state.occluders, this.config.video);
    this.state.signal += (q - this.state.signal) * Math.min(1, dt * 6);
  }

  private updateCamera(frameDt: number, subject: QuadView): void {
    const cfg = this.config;
    const cam = this.camera;
    const mode = cfg.camera.mode;
    const size = Math.max(0.3, cfg.physics.armLengthMm / 112);
    if (mode === 'fpv') {
      const hfov = THREE.MathUtils.degToRad(cfg.camera.fov);
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / cam.aspect));
      this.tiltQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(cfg.camera.tilt));
      cam.quaternion.copy(subject.quat).multiply(this.tiltQ);
      const s = cfg.physics.armLengthMm / 112;
      cam.position.copy(subject.pos).add(this.tmpV.set(0, 0.03 * s, -0.06 * s).applyQuaternion(subject.quat));
    } else if (mode === 'chase') {
      cam.fov = 75;
      const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(subject.quat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const desired = subject.pos
        .clone()
        .addScaledVector(fwd, -2.4 * size)
        .add(new THREE.Vector3(0, 0.9 * size, 0));
      this.chasePos.lerp(desired, 1 - Math.exp(-frameDt * 8));
      cam.position.copy(this.chasePos);
      cam.lookAt(subject.pos);
    } else if (mode === 'orbit') {
      const t = performance.now() / 4000;
      cam.fov = 45;
      cam.position.set(
        subject.pos.x + Math.cos(t) * 0.6 * size,
        subject.pos.y + 0.22 * size,
        subject.pos.z + Math.sin(t) * 0.6 * size,
      );
      cam.lookAt(subject.pos);
    } else {
      cam.position.copy(this.pilotPos);
      cam.fov = Math.max(8, Math.min(60, 600 / Math.max(5, cam.position.distanceTo(subject.pos))));
      cam.lookAt(subject.pos);
    }
    this.quadModel.visible = mode !== 'fpv';
    cam.updateProjectionMatrix();
  }

  private frame(now: number): void {
    const cfg = this.config;
    const frameStart = this.lastTime;
    const frameDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const rc = (this.rc = this.input.poll(frameDt));
    if (rc.angleSwitch !== null) {
      const mode = rc.angleSwitch ? 'angle' : 'acro';
      if (mode !== cfg.flight.mode) useConfigStore.getState().setPath('flight.mode', mode);
    }
    const menuOpen = useUiStore.getState().menuOpen;
    const replay = this.replay;
    const paused = menuOpen || replay.active;
    const s = this.state;

    if (!paused) {
      this.updateArming(rc);
      this.accumulator += frameDt;
      let steps = 0;
      const physStart = performance.now();
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.quad.step(DT, this.fc.update(rc, this.quad.gyro, this.quad.attitude), this.collide);
        this.accumulator -= DT;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.perf.physMs = ema(this.perf.physMs, performance.now() - physStart);
      this.perf.steps = steps;
      s.simTime += frameDt;
      if (s.armed) s.flightTime += frameDt;
      const impact = this.quad.lastImpact;
      if (cfg.physics.crashEnabled && impact > cfg.physics.crashSpeed) {
        s.crashed = true;
        s.armed = false;
        this.fc.armed = false;
      }
      if (impact > 0.8) this.audio.impact(impact);
      if (impact > 2.5) this.effects.impact(this.quad.pos, impact);
      this.quad.lastImpact = 0;
      this.game.update(frameDt, this.quad, this.prevPos, rc);
      this.prevPos.copy(this.quad.pos);
      replay.record(s.simTime, this.quad);
    }
    replay.update(frameDt);

    const subject = this.subject;
    const replayRate = replay.active ? replay.speed * (replay.playing ? 1 : 0) : 1;
    this.quadModel.position.copy(subject.pos);
    this.quadModel.quaternion.copy(subject.quat);
    this.quadModel.update(subject.motorSpeed, frameDt * replayRate);
    this.updateCamera(frameDt, subject);
    this.env.update(subject.pos, this.camera.position);
    this.updateSignal(frameDt, subject);
    this.effects.enabled = cfg.graphics.effects;
    this.effects.update(
      menuOpen && !replay.active ? 0 : frameDt * replayRate,
      subject,
      cfg.physics,
      this.camera,
      this.env.fxLight,
      this.quad.wind,
    );
    const listenerDist = cfg.camera.mode === 'fpv' ? 0 : this.camera.position.distanceTo(subject.pos);
    this.audio.update(
      subject,
      listenerDist,
      menuOpen || (replay.active && !replay.playing),
      getPreset(cfg.quad.preset).model.blades,
    );

    this.hud.lap = replay.active ? replay.label() : this.game.osdText(this.camera);
    this.hud.bigCountdown = !replay.active && this.game.session.phase === 'countdown';
    this.hud.warning = replay.active ? '' : s.warning;
    this.listeners.forEach((fn) => fn(this));

    const renderStart = performance.now();
    this.post.render(
      this.scene,
      this.camera,
      computeVideoFx(cfg.video, cfg.camera.mode, s.signal, now / 1000),
      now / 1000,
    );
    this.perf.renderMs = ema(this.perf.renderMs, performance.now() - renderStart);
    this.perf.frameMs = ema(this.perf.frameMs, now - frameStart || frameDt * 1000);
  }
}
