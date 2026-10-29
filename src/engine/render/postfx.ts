// FPV video post-processing: fisheye lens, chromatic aberration, vignette, analog static/breakup,
// digital-link pixelation/freeze. One full-screen pass over a render target.

import * as THREE from 'three';
import type { CameraMode, Config } from '../../state/configSchema';

const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const frag = `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float time, fisheye, chroma, vignette, staticAmt, breakup, scanlines, pixelate, digital, aspect;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 lens(vec2 uv){
  vec2 c = uv - 0.5;
  c.x *= aspect;
  float r2 = dot(c, c);
  float k = fisheye;
  float rc2 = 0.25 * aspect * aspect + 0.25; // corner radius²: keep corners (almost) filled
  c *= (1.0 + k * r2) / (1.0 + k * rc2 * 0.9);
  c.x /= aspect;
  return c + 0.5;
}

void main(){
  vec2 uv = vUv;
  // Analog breakup: horizontal tearing and rolling.
  if (breakup > 0.0) {
    float line = floor(uv.y * 220.0);
    float tear = (hash(vec2(line, floor(time * 30.0))) - 0.5) * breakup * 0.08;
    tear *= step(0.6 - breakup * 0.5, hash(vec2(floor(uv.y * 18.0), floor(time * 12.0))));
    uv.x += tear;
    uv.y += sin(time * 3.0) * breakup * breakup * 0.02;
  }
  if (pixelate > 1.0) {
    vec2 block = pixelate / resolution;
    uv = (floor(uv / block) + 0.5) * block;
  }
  vec2 luv = lens(uv);
  vec2 dir = (luv - 0.5) * chroma * 0.012;
  vec3 col;
  col.r = texture2D(tDiffuse, luv + dir).r;
  col.g = texture2D(tDiffuse, luv).g;
  col.b = texture2D(tDiffuse, luv - dir).b;
  if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) col = vec3(0.0);

  if (digital < 0.5) {
    // Analog: slight softness, desaturation as signal fades, static noise, scanlines.
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum), clamp(staticAmt * 1.1, 0.0, 0.9));
    float n = hash(uv * resolution + fract(time * 61.0) * 100.0);
    float sparkle = step(1.0 - staticAmt * 0.25, hash(vec2(floor(uv.y * 400.0), floor(time * 60.0)) + uv.x));
    col = mix(col, vec3(n), clamp(staticAmt, 0.0, 1.0) * 0.85) + sparkle * staticAmt * 0.6;
    col *= 1.0 - scanlines * 0.08 * (0.5 + 0.5 * sin(vUv.y * resolution.y * 1.5));
  }
  // Vignette
  vec2 v = vUv - 0.5;
  col *= 1.0 - vignette * smoothstep(0.35, 0.85, length(v * vec2(aspect, 1.0)) / max(1.0, aspect * 0.75));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface VideoFx {
  enabled: boolean;
  fisheye: number;
  chroma: number;
  vignette: number;
  staticAmt?: number;
  breakup?: number;
  scanlines?: number;
  pixelate?: number;
  digital: number;
  freeze?: boolean;
}

/** Metres of clean video by VTX power (mW), roughly. */
export const VTX_RANGE: Record<number, number> = { 25: 250, 200: 650, 600: 1100, 1000: 1600 };

/**
 * Link quality 0..1 from distance to the pilot and the number of walls in between.
 * Digital links punch through walls slightly better.
 */
export function signalQuality(distance: number, occluders: number, video: Config['video']): number {
  const range = VTX_RANGE[video.vtxPower] ?? 650;
  const perWall = video.system === 'digital' ? 0.13 : 0.17;
  return Math.max(0, Math.min(1, 1 - Math.pow(distance / range, 2) - occluders * perWall));
}

/** Post-FX parameters for the current video system and link quality. */
export function computeVideoFx(video: Config['video'], cameraMode: CameraMode, signal: number, t: number): VideoFx {
  const fpv = cameraMode === 'fpv';
  if (!fpv || video.system === 'clean') {
    return {
      enabled: fpv && (video.fisheye > 0 || video.vignette > 0),
      fisheye: video.fisheye,
      chroma: video.chroma * 0.5,
      vignette: video.vignette,
      digital: 1,
    };
  }
  if (video.system === 'digital') {
    const bad = Math.max(0, (0.3 - signal) / 0.3);
    return {
      enabled: true,
      fisheye: video.fisheye,
      chroma: video.chroma * 0.4,
      vignette: video.vignette,
      digital: 1,
      pixelate: bad > 0 ? 1 + bad * 22 : 0,
      freeze: signal < 0.06 || (bad > 0.5 && Math.sin(t * 9) > 0.2),
    };
  }
  const noise = Math.pow(1 - signal, 2.2) * video.staticAmount;
  return {
    enabled: true,
    fisheye: video.fisheye,
    chroma: video.chroma,
    vignette: video.vignette,
    digital: 0,
    scanlines: video.scanlines,
    staticAmt: Math.min(1, 0.04 * video.staticAmount + noise),
    breakup: signal < 0.35 ? ((0.35 - signal) / 0.35) * video.staticAmount : 0,
  };
}

const FX_UNIFORMS = ['fisheye', 'chroma', 'vignette', 'staticAmt', 'breakup', 'scanlines', 'pixelate', 'digital'] as const;

export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        resolution: { value: new THREE.Vector2() },
        time: { value: 0 },
        aspect: { value: 1 },
        ...Object.fromEntries(FX_UNIFORMS.map((k) => [k, { value: 0 }])),
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.target.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
    this.material.uniforms.resolution.value.set(w * pixelRatio, h * pixelRatio);
    this.material.uniforms.aspect.value = w / h;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, fx: VideoFx, time: number): void {
    const r = this.renderer;
    if (!fx.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (!fx.freeze) {
      r.setRenderTarget(this.target);
      r.render(scene, camera);
    }
    const u = this.material.uniforms;
    u.time.value = time;
    for (const k of FX_UNIFORMS) {
      const v = fx[k];
      u[k].value = typeof v === 'number' ? v : 0;
    }
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
