// Prop-wash dust + crash debris as a GPU particle system.
// The CPU only writes spawn parameters into a ring buffer (a few dozen particles per frame);
// each particle's motion (drag, buoyancy/gravity), growth and fade are evaluated in the vertex shader.

import * as THREE from 'three';
import { grassUniforms } from './grassWind.js';

const MAX = 6000;

const vert = /* glsl */ `
  attribute vec3 aVel;
  attribute vec4 aInfo;   // x: birth time, y: life, z: start size, w: gravity
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;   // pixels per metre at distance 1
  varying float vAlpha;
  varying vec3 vColor;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    float age = uTime - aInfo.x;
    float life = aInfo.y;
    float k = 2.2; // aerodynamic drag on dust
    float t = clamp(age, 0.0, life);
    vec3 p = position + aVel * (1.0 - exp(-k * t)) / k + vec3(0.0, 0.5 * aInfo.w * t * t, 0.0);
    p.y = max(p.y, 0.02);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float x = t / life;
    bool alive = age >= 0.0 && age < life;
    vAlpha = alive ? smoothstep(0.0, 0.08, x) * (1.0 - x) * (1.0 - x) : 0.0;
    vColor = aColor;
    vSeed = fract(aInfo.x * 13.37 + position.x);
    float size = aInfo.z * (1.0 + x * 2.2);
    gl_PointSize = alive ? size * uScale / -mvPosition.z : 0.0;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  uniform float uLight;
  uniform float uOpacity;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vSeed;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    // Soft, slightly lumpy puff.
    float lump = 0.85 + 0.15 * sin(atan(c.y, c.x) * 5.0 + vSeed * 20.0);
    float a = smoothstep(1.0, 0.35, r / lump) * vAlpha * uOpacity;
    a *= 0.8 + 0.2 * hash(gl_PointCoord * 7.0 + vSeed);
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * uLight, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const DUST = new THREE.Color('#a39a8c');
const DUST_DARK = new THREE.Color('#6d665c');
const GRASS = new THREE.Color('#6f7a3a');
const CHIPS = new THREE.Color('#57524b');

export class PropWashEffects {
  constructor(scene, collision, grassPatches = []) {
    this.collision = collision;
    this.grassPatches = grassPatches;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.info = new Float32Array(MAX * 4).fill(-1000);
    this.color = new Float32Array(MAX * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScale: { value: 600 }, uLight: { value: 1 }, uOpacity: { value: 0.32 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.head = 0;
    this.time = 0;
    this.emitAcc = 0;
    this.dirty = { min: Infinity, max: -1 };
    this.washStrength = 0;
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._t1 = new THREE.Vector3();
    this._t2 = new THREE.Vector3();
    this.enabled = true;
    this.grassUniforms = grassUniforms;
  }

  _spawn(p, v, life, size, grav, col) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.info.set([this.time, life, size, grav], i * 4);
    this.color.set([col.r, col.g, col.b], i * 3);
    this.dirty.min = Math.min(this.dirty.min, i);
    this.dirty.max = Math.max(this.dirty.max, i);
  }

  _onGrass(x, z) {
    for (const g of this.grassPatches) if ((x - g.x) ** 2 + (z - g.z) ** 2 < g.r * g.r) return true;
    return false;
  }

  /** Burst of dust and chips at an impact point. */
  impact(pos, speed) {
    if (!this.enabled) return;
    const n = Math.min(90, Math.floor(speed * 9));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * speed * 0.45);
      const chip = i % 3 === 0;
      this._spawn(pos, v, chip ? 0.7 + Math.random() * 0.5 : 1.2 + Math.random(), chip ? 0.035 : 0.15 + Math.random() * 0.2, chip ? -9.8 : -0.25, chip ? CHIPS : DUST_DARK);
    }
  }

  /**
   * @param {number} dt frame time
   * @param {{pos, quat, motorSpeed:number[]}} subject live quad or replay proxy
   * @param {{armLengthMm:number, propInches:number}} physics
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} light scene light level for unlit particles
   */
  update(dt, subject, physics, camera, light, wind) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uLight.value = light;
    const h = camera.isPerspectiveCamera ? window.innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360)) : 600;
    u.uScale.value = h;
    grassUniforms.uTime.value = this.time;
    if (wind) grassUniforms.uWind.value.set(wind.x, wind.z);

    let washTarget = 0;
    if (this.enabled) {
      const size = physics.armLengthMm / 112;
      let thrust = 0;
      for (const s of subject.motorSpeed) thrust += Math.max(0, s) * Math.max(0, s);
      thrust /= 4;
      // Wash leaves along -body-up; find what it hits within a few prop diameters.
      const up = this._up.set(0, 1, 0).applyQuaternion(subject.quat);
      const dir = this._dir.copy(up).negate();
      const reach = 1.6 + 2.8 * size;
      const hit = thrust > 0.01 ? this.collision.raycast(subject.pos, dir, reach) : null;
      if (hit) {
        const prox = 1 - hit.t / reach;
        const strength = Math.min(1, thrust * 6) * prox * prox;
        washTarget = strength;
        const hp = this._hit.copy(subject.pos).addScaledVector(dir, hit.t);
        grassUniforms.uWashPos.value.copy(hp);
        grassUniforms.uWashRadius.value = 0.8 + 2.2 * size * (0.5 + prox);
        // Tangent basis on the surface for the radial outflow.
        const n = hit.normal;
        const t1 = this._t1.set(1, 0, 0);
        if (Math.abs(n.x) > 0.9) t1.set(0, 0, 1);
        t1.addScaledVector(n, -t1.dot(n)).normalize();
        const t2 = this._t2.copy(n).cross(t1);
        const grass = Math.abs(n.y) > 0.9 && hp.y < 0.1 && this._onGrass(hp.x, hp.z);
        this.emitAcc += strength * 520 * Math.max(0.35, size) * dt;
        const v = new THREE.Vector3();
        const p = new THREE.Vector3();
        while (this.emitAcc >= 1) {
          this.emitAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.35 * size;
          const c = Math.cos(a), s = Math.sin(a);
          p.copy(hp).addScaledVector(t1, c * r).addScaledVector(t2, s * r).addScaledVector(n, 0.03);
          const sp = (2.5 + Math.random() * 5.5) * (0.4 + strength) * Math.max(0.5, size);
          v.copy(t1).multiplyScalar(c * sp).addScaledVector(t2, s * sp).addScaledVector(n, 0.4 + Math.random() * 1.6);
          if (grass && Math.random() < 0.55) this._spawn(p, v, 0.6 + Math.random() * 0.6, 0.05 + Math.random() * 0.05, -3.5, GRASS);
          else this._spawn(p, v, 1.2 + Math.random() * 1.6, (0.12 + Math.random() * 0.22) * Math.max(0.4, size), -0.15 + Math.random() * 0.3, Math.random() < 0.5 ? DUST : DUST_DARK);
        }
      } else {
        this.emitAcc = 0;
      }
    }
    // Smooth so grass springs back instead of snapping.
    this.washStrength += (washTarget - this.washStrength) * Math.min(1, dt * (washTarget > this.washStrength ? 12 : 3));
    grassUniforms.uWashStrength.value = this.washStrength;

    if (this.dirty.max >= 0) {
      const { min, max } = this.dirty;
      for (const [name, size] of [['position', 3], ['aVel', 3], ['aInfo', 4], ['aColor', 3]]) {
        const attr = this.geometry.getAttribute(name);
        attr.clearUpdateRanges();
        attr.addUpdateRange(min * size, (max - min + 1) * size);
        attr.needsUpdate = true;
      }
      this.dirty.min = Infinity;
      this.dirty.max = -1;
    }
  }
}
