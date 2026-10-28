import * as THREE from 'three';
import { loadConfig } from './config.js';
import { FlightController } from './sim/flightController.js';
import { Quad } from './sim/quad.js';
import { CollisionWorld } from './sim/collision.js';
import { QUAD_PRESETS } from './sim/presets.js';
import { buildMap } from './world/map.js';
import { buildQuadModel } from './world/quadModel.js';
import { InputManager } from './input/input.js';
import { SettingsMenu } from './ui/settings.js';
import { OSD } from './ui/osd.js';
import { MotorAudio } from './audio/motorAudio.js';
import { Environment } from './render/environment.js';
import { PostFX } from './render/postfx.js';
import { Game } from './game/game.js';
import { Replay } from './game/replay.js';

const DT = 1 / 1000; // physics + PID loop: 1 kHz
const MAX_STEPS_PER_FRAME = 120;
const VTX_RANGE = { 25: 250, 200: 650, 600: 1100, 1000: 1600 }; // metres of clean video, roughly

const config = loadConfig();

// ── Renderer & scene ──────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: config.graphics.antialias, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const env = new Environment(renderer, scene);
const post = new PostFX(renderer);

// ── World ─────────────────────────────────────────────────────────────────
const collision = new CollisionWorld();
const loadingEl = document.getElementById('loading');
const map = await buildMap(scene, collision, renderer, (msg) => (loadingEl.textContent = msg));
const spawn = map.spawn;
if (map.lamps) env.setLamps(map.lamps.positions, map.lamps.meshes);

// ── Quad model ───────────────────────────────────────────────────────────
let quadModel = null;
function rebuildQuadModel() {
  if (quadModel) scene.remove(quadModel);
  const preset = QUAD_PRESETS[config.quad.preset] || QUAD_PRESETS.freestyle5;
  quadModel = buildQuadModel(preset, config.physics, { cameraTilt: config.camera.tilt });
  scene.add(quadModel);
}
rebuildQuadModel();

// ── Sim ───────────────────────────────────────────────────────────────────
const fc = new FlightController(config, DT);
const quad = new Quad(config);
quad.noiseScale = config.filters.gyroNoise;
const input = new InputManager(config);
const osd = new OSD(document.getElementById('osd'), document.getElementById('sticks'), document.getElementById('blackbox'));
const audio = new MotorAudio(config);
const replay = new Replay(90, 60);
const camera = new THREE.PerspectiveCamera(90, 1, 0.02, 2000);
const chasePos = new THREE.Vector3();
const pilotPos = spawn.pos.clone().add(new THREE.Vector3(0, 1.7, 4));

// ── UI helpers ────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg, ms = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

const game = new Game({ scene, config, spawn, toast, resultsEl: document.getElementById('results') });

const state = { armed: false, crashed: false, turtle: false, flightTime: 0, warning: '', signal: 1, occluders: 0, simTime: 0 };
const prevPos = new THREE.Vector3();

function resetQuad() {
  quad.reset(spawn.pos, spawn.yaw);
  fc.reset();
  state.armed = false;
  fc.armed = false;
  state.crashed = false;
  state.turtle = false;
  state.flightTime = 0;
  prevPos.copy(quad.pos);
  chasePos.copy(quad.pos).add(new THREE.Vector3(0, 1, 3));
  game.reset();
  if (replay.active) replay.exit();
}
resetQuad();

function applyConfig() {
  fc.applyConfig(config);
  quad.applyConfig(config);
  quad.noiseScale = config.filters.gyroNoise;
  renderer.shadowMap.enabled = config.graphics.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * config.graphics.pixelRatio);
  onResize();
}
function applyEnvironment() {
  return env.apply(config.graphics.timeOfDay, { fog: config.graphics.fog, shadows: config.graphics.shadows, ibl: config.graphics.ibl });
}

const menu = new SettingsMenu(document.getElementById('menu'), config, {
  input,
  game,
  onChange: (path) => {
    applyConfig();
    if (path === 'graphics.shadows') scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    if (path.startsWith('graphics') || path === 'all') applyEnvironment();
    if (path === 'quad.preset' || path === 'all' || path.startsWith('physics.armLength') || path.startsWith('physics.prop') || path === 'camera.tilt') rebuildQuadModel();
    if (path === 'quad.preset' || path.startsWith('game.')) resetQuad();
  },
  onClose: () => { lastTime = performance.now(); },
});
menu.onToast = toast;

// ── Input bindings ────────────────────────────────────────────────────────
const CAMERA_MODES = ['fpv', 'chase', 'los', 'orbit'];
input.on('menu', () => menu.toggle());
input.on('reset', () => resetQuad());
input.on('camera', () => {
  config.camera.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(config.camera.mode) + 1) % CAMERA_MODES.length];
  toast(`Camera: ${config.camera.mode.toUpperCase()}`, 1200);
});
input.on('mode', () => {
  config.flight.mode = config.flight.mode === 'acro' ? 'angle' : 'acro';
  toast(`Flight mode: ${config.flight.mode.toUpperCase()}`, 1200);
});
input.on('help', () => menu.open('help'));
input.onChange = () => {
  const pad = input.getGamepad();
  toast(pad ? `Controller connected: ${pad.id}` : 'Controller disconnected — keyboard fallback', 3000);
  if (menu.isOpen) menu.render();
};
input.keyHook = (k, e) => {
  if (menu.isOpen) return false;
  if (k === 'p' && !e.repeat) {
    if (replay.active) {
      replay.exit();
      toast('Replay closed', 1000);
    } else if (replay.enter()) {
      game.resultsEl.classList.add('hidden');
      toast('Replay', 1000);
    }
    return true;
  }
  if (replay.active) {
    if (k === ' ') replay.playing = !replay.playing;
    else if (k === 'arrowleft') replay.seek(-5);
    else if (k === 'arrowright') replay.seek(5);
    else if (k === 'arrowup') replay.speed = Math.min(4, replay.speed * 2);
    else if (k === 'arrowdown') replay.speed = Math.max(0.125, replay.speed / 2);
    else if (k === 'c') return false;
    else return k !== 'escape' && k !== 'r';
    return true;
  }
  if (game.mode === 'editor') {
    if (k === 'g' && !e.repeat) { game.placeGate(quad); return true; }
    if (k === 'backspace') { game.removeLastGate(); return true; }
  }
  if (k === 'b' && !e.repeat) { osd.toggleBlackbox(); return true; }
  return false;
};

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
applyConfig();
await applyEnvironment();

// ── Per-frame logic ───────────────────────────────────────────────────────
const collide = (q) => {
  collision.resolveQuad(q, config.physics);
  if (game.mode !== 'editor') game.gateWorld.resolveQuad(q, config.physics);
};
const tiltQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpV = new THREE.Vector3();
let lastTime = performance.now();
let accumulator = 0;
let signalTimer = 0;

function updateArming(rc) {
  const wantArm = rc.armSwitch && !state.crashed && game.allowArm;
  if (!wantArm) {
    state.armed = false;
  } else if (!state.armed && rc.throttle < 0.05) {
    state.armed = true;
    state.turtle = !!rc.turtleSwitch; // latched at arming, like Betaflight
  }
  if (!state.armed) state.turtle = false;
  fc.armed = state.armed;
  fc.turtle = state.turtle;
  if (state.crashed) state.warning = 'CRASHED · PRESS R';
  else if (state.turtle) state.warning = 'TURTLE';
  else if (rc.armSwitch && !state.armed && game.allowArm) state.warning = 'THROTTLE HIGH';
  else state.warning = quad.battery.voltage / config.physics.cells < 3.4 && config.physics.battery ? 'LOW BATTERY' : '';
}

function updateSignal(dt, subject) {
  signalTimer -= dt;
  if (signalTimer <= 0) {
    signalTimer = 0.1;
    state.occluders = collision.countOccluders(pilotPos, subject.pos, 6);
  }
  const v = config.video;
  const range = VTX_RANGE[v.vtxPower] ?? 650;
  const d = pilotPos.distanceTo(subject.pos);
  const perWall = v.system === 'digital' ? 0.13 : 0.17;
  const q = 1 - Math.pow(d / range, 2) - state.occluders * perWall;
  state.signal += (Math.max(0, Math.min(1, q)) - state.signal) * Math.min(1, dt * 6);
}

function videoFx(t) {
  const v = config.video;
  const fpv = config.camera.mode === 'fpv';
  if (!fpv || v.system === 'clean') {
    return { enabled: fpv && (v.fisheye > 0 || v.vignette > 0), fisheye: v.fisheye, chroma: v.chroma * 0.5, vignette: v.vignette, digital: 1 };
  }
  const s = state.signal;
  if (v.system === 'digital') {
    const bad = Math.max(0, (0.3 - s) / 0.3);
    const lost = s < 0.06;
    return {
      enabled: true, fisheye: v.fisheye, chroma: v.chroma * 0.4, vignette: v.vignette, digital: 1,
      pixelate: bad > 0 ? 1 + bad * 22 : 0, freeze: lost || (bad > 0.5 && Math.sin(t * 9) > 0.2),
    };
  }
  const noise = Math.pow(1 - s, 2.2) * v.staticAmount;
  return {
    enabled: true, fisheye: v.fisheye, chroma: v.chroma, vignette: v.vignette, digital: 0, scanlines: v.scanlines,
    staticAmt: Math.min(1, 0.04 * v.staticAmount + noise), breakup: s < 0.35 ? ((0.35 - s) / 0.35) * v.staticAmount : 0,
  };
}

function updateCamera(frameDt, subject) {
  const mode = config.camera.mode;
  const size = Math.max(0.3, config.physics.armLengthMm / 112);
  if (mode === 'fpv') {
    const hfov = THREE.MathUtils.degToRad(config.camera.fov);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect));
    tiltQ.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(config.camera.tilt));
    camera.quaternion.copy(subject.quat).multiply(tiltQ);
    const s = config.physics.armLengthMm / 112;
    camera.position.copy(subject.pos).add(tmpV.set(0, 0.03 * s, -0.06 * s).applyQuaternion(subject.quat));
    quadModel.visible = false;
  } else if (mode === 'chase') {
    camera.fov = 75;
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(subject.quat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const desired = subject.pos.clone().addScaledVector(fwd, -2.4 * size).add(new THREE.Vector3(0, 0.9 * size, 0));
    chasePos.lerp(desired, 1 - Math.exp(-frameDt * 8));
    camera.position.copy(chasePos);
    camera.lookAt(subject.pos);
    quadModel.visible = true;
  } else if (mode === 'orbit') {
    const t = performance.now() / 4000;
    camera.fov = 45;
    camera.position.set(subject.pos.x + Math.cos(t) * 0.6 * size, subject.pos.y + 0.22 * size, subject.pos.z + Math.sin(t) * 0.6 * size);
    camera.lookAt(subject.pos);
    quadModel.visible = true;
  } else {
    camera.position.copy(pilotPos);
    camera.fov = Math.max(8, Math.min(60, 600 / Math.max(5, camera.position.distanceTo(subject.pos))));
    camera.lookAt(subject.pos);
    quadModel.visible = true;
  }
  camera.updateProjectionMatrix();
}

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const rc = input.poll(frameDt);
  if (rc.angleSwitch !== null) config.flight.mode = rc.angleSwitch ? 'angle' : 'acro';
  const paused = menu.isOpen || replay.active;

  if (!paused) {
    updateArming(rc);
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
      quad.step(DT, fc.update(rc, quad.gyro, quad.attitude), collide);
      accumulator -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
    state.simTime += frameDt;
    if (state.armed) state.flightTime += frameDt;
    if (config.physics.crashEnabled && quad.lastImpact > config.physics.crashSpeed) {
      state.crashed = true;
      state.armed = false;
      fc.armed = false;
    }
    if (quad.lastImpact > 0.8) audio.impact(quad.lastImpact);
    quad.lastImpact = 0;
    game.update(frameDt, quad, prevPos, rc);
    prevPos.copy(quad.pos);
    replay.record(state.simTime, quad);
  }
  replay.update(frameDt);
  menu.update();

  // The thing we look at / listen to: live quad, or the replay proxy.
  const subject = replay.active ? replay.view : quad;
  quadModel.position.copy(subject.pos);
  quadModel.quaternion.copy(subject.quat);
  quadModel.userData.update(subject.motorSpeed, replay.active ? frameDt * replay.speed * (replay.playing ? 1 : 0) : frameDt);
  updateCamera(frameDt, subject);
  env.update(subject.pos, camera.position);
  updateSignal(frameDt, subject);
  const preset = QUAD_PRESETS[config.quad.preset] || QUAD_PRESETS.freestyle5;
  audio.update(subject, config.camera.mode === 'fpv' ? 0 : camera.position.distanceTo(subject.pos), menu.isOpen || (replay.active && !replay.playing), preset.model.blades);

  const lapText = replay.active ? replay.label() : game.osdText(camera);
  osd.update({
    config, quad, fc, rc, armed: state.armed, flightTime: state.flightTime, warning: replay.active ? '' : state.warning,
    lap: lapText, signal: state.signal, big: game.mode === 'race' && game.phase === 'countdown' && !replay.active,
  });
  post.render(scene, camera, videoFx(now / 1000), now / 1000);
}

loadingEl.classList.add('done');
toast('Esc = settings · Space = arm (keyboard) · R = reset · C = camera · P = replay · H = help', 6000);
requestAnimationFrame(frame);

// Expose for debugging / automated smoke tests.
window.__fpv = {
  audio, config, quad, fc, state, input, menu, collision, scene, camera, game, replay, env, rebuildQuadModel, applyConfig, applyEnvironment, resetQuad, textureSource: map.textureSource,
  get quadModel() { return quadModel; },
};
