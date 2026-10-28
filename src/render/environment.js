// Sky, sun, ambient + image-based lighting, fog, and time-of-day presets.
// IBL uses CC0 Poly Haven HDRIs (via @pmndrs/assets, 512px EXR) for realistic PBR reflections.

import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const HDRI = {
  sky: () => import('@pmndrs/assets/hdri/sky.exr.js'),
  sunset: () => import('@pmndrs/assets/hdri/sunset.exr.js'),
  night: () => import('@pmndrs/assets/hdri/night.exr.js'),
};

export const TIME_OF_DAY = {
  day: {
    label: 'Midday', elev: 58, azim: 215, sun: '#fff3e2', sunI: 3.0, hemiSky: '#d2e2f5', hemiGround: '#5d5547', hemiI: 0.75,
    horizon: '#c9d5df', zenith: '#4f7fc4', fog: '#c3cfd9', fogD: 0.0032, exposure: 1.0, hdri: 'sky', envI: 0.55, lamps: false,
  },
  golden: {
    label: 'Golden hour', elev: 13, azim: 245, sun: '#ffb877', sunI: 2.8, hemiSky: '#f6d6b8', hemiGround: '#4b3c31', hemiI: 0.55,
    horizon: '#efc199', zenith: '#5d73a3', fog: '#d8b394', fogD: 0.0038, exposure: 1.05, hdri: 'sunset', envI: 0.6, lamps: false,
  },
  overcast: {
    label: 'Overcast', elev: 60, azim: 200, sun: '#f0f0f0', sunI: 0.7, hemiSky: '#d4d8dc', hemiGround: '#55524c', hemiI: 1.25,
    horizon: '#b9bdc1', zenith: '#8f979f', fog: '#b6babd', fogD: 0.006, exposure: 1.05, hdri: 'sky', envI: 0.8, lamps: false,
  },
  dusk: {
    label: 'Dusk', elev: 2, azim: 260, sun: '#ff7b4d', sunI: 1.1, hemiSky: '#7376a6', hemiGround: '#2b2420', hemiI: 0.5,
    horizon: '#e98059', zenith: '#1f2c55', fog: '#57506a', fogD: 0.0048, exposure: 1.2, hdri: 'sunset', envI: 0.35, lamps: true,
  },
  night: {
    label: 'Night', elev: 42, azim: 140, sun: '#a9bbff', sunI: 0.35, hemiSky: '#253056', hemiGround: '#0b0b0b', hemiI: 0.35,
    horizon: '#141a2e', zenith: '#03050b', fog: '#0f1424', fogD: 0.0055, exposure: 1.45, hdri: 'night', envI: 0.25, lamps: true,
  },
};

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envMaps = {};
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.horizon = new THREE.Color();
    this.zenith = new THREE.Color();
    this.fogColor = new THREE.Color();

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          sunDir: { value: this.sunDir }, horizon: { value: this.horizon }, zenith: { value: this.zenith },
          sunColor: { value: new THREE.Color() }, night: { value: 0 },
        },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunColor; uniform float night; varying vec3 vDir;
          float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 c = mix(horizon, zenith, pow(h, 0.5));
            c = mix(c, horizon * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
            float s = max(dot(d, sunDir), 0.0);
            c += sunColor * (smoothstep(0.9993, 0.9997, s) * 2.0 + pow(s, 9.0) * 0.22 + pow(s, 64.0) * 0.25);
            // soft streaky clouds
            vec2 uv = d.xz / max(0.08, d.y);
            float cl = 0.0;
            cl += sin(uv.x * 1.3 + sin(uv.y * 0.7) * 2.0) * 0.5 + 0.5;
            cl *= sin(uv.y * 0.9 + cos(uv.x * 0.4) * 1.5) * 0.5 + 0.5;
            cl = smoothstep(0.55, 0.95, cl) * smoothstep(0.02, 0.25, d.y) * (1.0 - night);
            c = mix(c, mix(horizon, vec3(1.0), 0.5) + sunColor * 0.08, cl * 0.35);
            // stars
            if (night > 0.0) { float st = step(0.9975, hash(floor(d * 400.0))) * smoothstep(0.05, 0.3, d.y); c += vec3(st) * night; }
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight();
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -60;
    sc.right = sc.top = 60;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.lamps = [];
    this.lampLights = [];
    this.lampMeshes = [];
  }

  /** Lamp heads (positions) that glow and light the scene at dusk / night. */
  setLamps(positions, meshes = []) {
    this.lamps = positions;
    this.lampMeshes = meshes;
    // Only a handful of real lights (nearest to the quad); the rest are emissive only.
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight('#ffc77a', 0, 28, 1.6);
      l.visible = false;
      this.scene.add(l);
      this.lampLights.push(l);
    }
  }

  async _envMap(name) {
    if (this.envMaps[name]) return this.envMaps[name];
    const mod = await HDRI[name]();
    const tex = await new EXRLoader().loadAsync(mod.default);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const rt = this.pmrem.fromEquirectangular(tex);
    tex.dispose();
    this.envMaps[name] = rt.texture;
    return rt.texture;
  }

  async apply(timeOfDay, { fog = true, shadows = true, ibl = true } = {}) {
    const p = TIME_OF_DAY[timeOfDay] || TIME_OF_DAY.golden;
    this.preset = p;
    const el = (p.elev * Math.PI) / 180, az = (p.azim * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.horizon.set(p.horizon);
    this.zenith.set(p.zenith);
    this.sky.material.uniforms.sunColor.value.set(p.sun).multiplyScalar(p.elev < 20 && timeOfDay !== 'night' ? 1 : 0.8);
    this.sky.material.uniforms.night.value = timeOfDay === 'night' ? 1 : 0;
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunI;
    this.sun.castShadow = shadows;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    this.fogColor.set(p.fog);
    this.scene.background = this.fogColor;
    this.scene.fog = fog ? new THREE.FogExp2(this.fogColor, p.fogD) : null;
    this.renderer.toneMappingExposure = p.exposure;
    for (const m of this.lampMeshes) m.material.emissiveIntensity = p.lamps ? 3 : 0.05;
    if (ibl) {
      try {
        this.scene.environment = await this._envMap(p.hdri);
        this.scene.environmentIntensity = p.envI;
      } catch (err) {
        console.warn('HDRI load failed, using analytic lights only', err);
        this.scene.environment = null;
      }
    } else {
      this.scene.environment = null;
    }
  }

  update(focus, cameraPos) {
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(cameraPos);
    if (this.preset?.lamps && this.lamps.length) {
      const sorted = this.lamps.map((p) => [p, p.distanceToSquared(focus)]).sort((a, b) => a[1] - b[1]);
      this.lampLights.forEach((l, i) => {
        const e = sorted[i];
        l.visible = !!e;
        if (e) {
          l.position.copy(e[0]).y -= 0.4;
          l.intensity = 40;
        }
      });
    } else {
      this.lampLights.forEach((l) => (l.visible = false));
    }
  }
}
