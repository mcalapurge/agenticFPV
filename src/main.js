import * as THREE from 'three';
import { loadConfig } from './config.js';
import { FlightController } from './sim/flightController.js';
import { Quad } from './sim/quad.js';
import { CollisionWorld } from './sim/collision.js';
import { buildMap } from './world/map.js';
import { InputManager } from './input/input.js';
import { SettingsMenu } from './ui/settings.js';
import { OSD, fmtTime } from './ui/osd.js';

const DT = 1 / 1000; // physics + PID loop: 1 kHz
const MAX_STEPS_PER_FRAME = 120;

const config = loadConfig();

// ── Renderer & scene ──────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: config.graphics.antialias, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const HAZE = new THREE.Color('#b9b4a6');
scene.background = HAZE.clone();

// Sky dome (gradient + sun glow).
const sunDir = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDir: { value: sunDir }, horizon: { value: HAZE }, zenith: { value: new THREE.Color('#4f6f99') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.55));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.85,0.6) * (smoothstep(0.9993, 0.9996, s) * 1.5 + pow(s, 8.0) * 0.18);
      gl_FragColor = vec4(c, 1.0); }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

scene.add(new THREE.HemisphereLight('#c9d4e3', '#4a4236', 1.1));
const sun = new THREE.DirectionalLight('#ffe2bf', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -60;
sc.right = sc.top = 60;
sc.near = 1;
sc.far = 400;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// ── World ─────────────────────────────────────────────────────────────────
const collision = new CollisionWorld();
const { spawn, gates } = buildMap(scene, collision);

// ── Quad model ───────────────────────────────────────────────────────────
function buildQuadModel() {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.5, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: '#ff6a00', roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.8, roughness: 0.3 });
  const arm = 0.112;
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(arm * 2 + 0.03, 0.006, 0.022), carbon);
    bar.rotation.y = a;
    g.add(bar);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.11), carbon);
  plate.position.y = 0.018;
  g.add(plate);
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.075), accent);
  batt.position.y = 0.05;
  g.add(batt);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.02), metal);
  cam.position.set(0, 0.02, -0.06);
  g.add(cam);
  const props = [];
  const propMat = new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#ff8a3c', roughness: 0.6 });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const p = new THREE.Vector3(x, 0, z).multiplyScalar(arm / Math.SQRT2);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 12), metal);
    motor.position.copy(p).setY(0.01);
    g.add(motor);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.0635, 24), propMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(p).setY(0.022);
    g.add(disc);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.127, 0.002, 0.012), bladeMat);
    blade.position.copy(p).setY(0.022);
    g.add(blade);
    props.push({ disc, blade });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.props = props;
  return g;
}
const quadModel = buildQuadModel();
scene.add(quadModel);

// Next-gate highlight frame.
const gateHi = new THREE.Group();
{
  const m = new THREE.MeshBasicMaterial({ color: '#39ff6a', transparent: true, opacity: 0.85 });
  const s = 2.9, t = 0.07;
  for (const [x, y, w, hh] of [[0, s / 2, s, t], [0, -s / 2, s, t], [s / 2, 0, t, s], [-s / 2, 0, t, s]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, t), m);
    bar.position.set(x, y, 0);
    gateHi.add(bar);
  }
  scene.add(gateHi);
}

// ── Sim ───────────────────────────────────────────────────────────────────
const fc = new FlightController(config, DT);
const quad = new Quad(config);
quad.noiseScale = config.filters.gyroNoise;

const input = new InputManager(config);
const osd = new OSD(document.getElementById('osd'), document.getElementById('sticks'), document.getElementById('blackbox'));

const camera = new THREE.PerspectiveCamera(90, 1, 0.03, 2000);
const chasePos = new THREE.Vector3();

const state = {
  armed: false,
  crashed: false,
  flightTime: 0,
  warning: '',
  nextGate: 0,
  lapStart: null,
  lastLap: null,
  bestLap: null,
  laps: 0,
};

function resetQuad() {
  quad.reset(spawn.pos, spawn.yaw);
  fc.reset();
  state.armed = false;
  fc.armed = false;
  state.crashed = false;
  state.flightTime = 0;
  state.nextGate = 0;
  state.lapStart = null;
  prevPos.copy(quad.pos);
}
const prevPos = new THREE.Vector3();
resetQuad();

// ── UI ────────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg, ms = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function applyConfig() {
  fc.applyConfig(config);
  quad.applyConfig(config);
  quad.noiseScale = config.filters.gyroNoise;
  renderer.shadowMap.enabled = config.graphics.shadows;
  sun.castShadow = config.graphics.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * config.graphics.pixelRatio);
  scene.fog = config.graphics.fog ? new THREE.FogExp2(HAZE, 0.0045) : null;
  onResize();
}

const menu = new SettingsMenu(document.getElementById('menu'), config, {
  input,
  onChange: (path) => {
    applyConfig();
    // Material changes need a shader recompile for shadows.
    if (path === 'graphics.shadows') scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  },
  onClose: () => { lastTime = performance.now(); },
});
menu.onToast = toast;

input.on('menu', () => menu.toggle());
input.on('reset', () => { resetQuad(); });
input.on('camera', () => {
  const modes = ['fpv', 'chase', 'los'];
  config.camera.mode = modes[(modes.indexOf(config.camera.mode) + 1) % modes.length];
  toast(`Camera: ${config.camera.mode.toUpperCase()}`, 1200);
});
input.on('mode', () => {
  config.flight.mode = config.flight.mode === 'acro' ? 'angle' : 'acro';
  toast(`Flight mode: ${config.flight.mode.toUpperCase()}`, 1200);
});
input.on('help', () => menu.open('help'));
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'b' && !menu.isOpen && !e.repeat) osd.toggleBlackbox(); });
input.onChange = () => {
  const pad = input.getGamepad();
  toast(pad ? `Controller connected: ${pad.id}` : 'Controller disconnected — keyboard fallback', 3000);
  if (menu.isOpen) menu.render();
};

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
applyConfig();

// ── Loop ──────────────────────────────────────────────────────────────────
const collide = (q) => collision.resolveQuad(q, config.physics);
const tiltQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpV = new THREE.Vector3();
const losPos = new THREE.Vector3();
let lastTime = performance.now();
let accumulator = 0;

function updateArming(rc) {
  const wantArm = rc.armSwitch && !state.crashed;
  const throttleLow = rc.throttle < 0.05;
  if (!wantArm) {
    state.armed = false;
  } else if (!state.armed && throttleLow) {
    state.armed = true;
  }
  fc.armed = state.armed;
  if (state.crashed) state.warning = 'CRASHED · PRESS R';
  else if (rc.armSwitch && !state.armed) state.warning = 'THROTTLE HIGH';
  else state.warning = quad.battery.voltage / config.physics.cells < 3.4 && config.physics.battery ? 'LOW BATTERY' : '';
}

function updateGates() {
  if (!gates.length) return;
  const g = gates[state.nextGate];
  const d0 = tmpV.copy(prevPos).sub(g.pos).dot(g.dir);
  const d1 = tmpV.copy(quad.pos).sub(g.pos).dot(g.dir);
  if (d0 < 0 && d1 >= 0) {
    const t = d0 / (d0 - d1);
    const p = tmpV.copy(prevPos).lerp(quad.pos, t).sub(g.pos);
    const lateral = Math.abs(p.dot(g.right));
    if (lateral < g.size / 2 + 0.15 && Math.abs(p.y) < g.size / 2 + 0.15) {
      const now = state.raceClock;
      if (state.nextGate === 0) {
        if (state.lapStart !== null) {
          const lap = now - state.lapStart;
          state.lastLap = lap;
          state.laps++;
          if (state.bestLap === null || lap < state.bestLap) {
            state.bestLap = lap;
            toast(`New best lap: ${fmtTime(lap)}`, 2500);
          }
        }
        state.lapStart = now;
      }
      state.nextGate = (state.nextGate + 1) % gates.length;
    }
  }
  const n = gates[state.nextGate];
  gateHi.position.copy(n.pos);
  gateHi.rotation.y = Math.atan2(n.dir.x, n.dir.z);
  gateHi.children.forEach((c) => (c.material.opacity = 0.5 + 0.4 * Math.sin(performance.now() / 150)));
}
state.raceClock = 0;

function lapText() {
  const parts = [`GATE ${state.nextGate + 1}/${gates.length}`];
  if (state.lapStart !== null) parts.push(`LAP ${fmtTime(state.raceClock - state.lapStart)}`);
  if (state.lastLap !== null) parts.push(`LAST ${fmtTime(state.lastLap)}`);
  if (state.bestLap !== null) parts.push(`BEST ${fmtTime(state.bestLap)}`);
  return parts.join('  ');
}

function updateCamera(frameDt) {
  const mode = config.camera.mode;
  const aspect = camera.aspect;
  if (mode === 'fpv') {
    const hfov = THREE.MathUtils.degToRad(config.camera.fov);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
    tiltQ.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(config.camera.tilt));
    camera.quaternion.copy(quad.quat).multiply(tiltQ);
    camera.position.copy(quad.pos).add(tmpV.set(0, 0.03, -0.06).applyQuaternion(quad.quat));
    quadModel.visible = false;
  } else if (mode === 'chase') {
    camera.fov = 75;
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(quad.quat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const desired = quad.pos.clone().addScaledVector(fwd, -2.4).add(new THREE.Vector3(0, 0.9, 0));
    chasePos.lerp(desired, 1 - Math.exp(-frameDt * 8));
    camera.position.copy(chasePos);
    camera.lookAt(quad.pos);
    quadModel.visible = true;
  } else {
    camera.fov = Math.max(10, Math.min(60, 600 / Math.max(5, camera.position.distanceTo(quad.pos))));
    losPos.copy(spawn.pos).add(tmpV.set(0, 1.7, 4));
    camera.position.copy(losPos);
    camera.lookAt(quad.pos);
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

  if (!menu.isOpen) {
    updateArming(rc);
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
      const motors = fc.update(rc, quad.gyro, quad.attitude);
      quad.step(DT, motors, collide);
      accumulator -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
    if (state.armed) state.flightTime += frameDt;
    state.raceClock += frameDt;
    if (config.physics.crashEnabled && quad.lastImpact > config.physics.crashSpeed) {
      state.crashed = true;
      state.armed = false;
      fc.armed = false;
    }
    quad.lastImpact = 0;
    updateGates();
    prevPos.copy(quad.pos);
  }
  menu.update();

  // Visuals.
  quadModel.position.copy(quad.pos);
  quadModel.quaternion.copy(quad.quat);
  quadModel.userData.props.forEach((p, i) => {
    const s = quad.motorSpeed[i];
    p.blade.visible = s < 0.08;
    p.disc.visible = s >= 0.08;
    p.blade.rotation.y += s * 2;
  });
  sun.position.copy(quad.pos).addScaledVector(sunDir, 150);
  sun.target.position.copy(quad.pos);
  sky.position.copy(camera.position);
  updateCamera(frameDt);

  osd.update({ config, quad, fc, armed: state.armed, flightTime: state.flightTime, warning: state.warning, lap: lapText(), rc });
  renderer.render(scene, camera);
}

document.getElementById('loading').classList.add('done');
toast('Esc = settings · Space = arm (keyboard) · R = reset · C = camera · H = help', 6000);
requestAnimationFrame(frame);

// Expose for debugging / automated smoke tests.
window.__fpv = { config, quad, fc, state, input, menu, collision, scene, camera, gates };
