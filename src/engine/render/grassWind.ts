// GPU grass animation: ambient wind sway + radial push/flatten + flutter under the quad's prop wash.
// Everything happens in the vertex shader of the instanced grass, so the CPU only updates a few uniforms.

import * as THREE from 'three';

export const grassUniforms = {
  uTime: { value: 0 },
  uWashPos: { value: new THREE.Vector3(0, -1000, 0) }, // where the wash hits the ground
  uWashStrength: { value: 0 }, // 0..1
  uWashRadius: { value: 2.5 }, // metres
  uWind: { value: new THREE.Vector2(0.3, 0.2) }, // ambient wind (m/s-ish, xz)
};

/**
 * Patch a MeshStandardMaterial used on an InstancedMesh of grass cards.
 * `bladeHeight` = local-space height of the card (sway increases from root to tip).
 */
export function patchGrassMaterial<M extends THREE.Material>(material: M, bladeHeight = 0.7): M {
  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, grassUniforms);
    material.userData.shader = shader; // for debugging / tests
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uWashPos;
        uniform float uWashStrength;
        uniform float uWashRadius;
        uniform vec2 uWind;`,
      )
      .replace(
        '#include <project_vertex>',
        `
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        float tip = clamp(position.y / ${bladeHeight.toFixed(3)}, 0.0, 1.0);
        tip *= tip;
        // Ambient wind: two out-of-phase sways, stronger with wind speed.
        float windAmp = 0.03 + length(uWind) * 0.025;
        float ph = wp.x * 0.35 + wp.z * 0.27;
        wp.x += (sin(uTime * 1.9 + ph) * 0.6 + sin(uTime * 3.7 + ph * 2.3) * 0.4) * windAmp * tip + uWind.x * 0.03 * tip;
        wp.z += (cos(uTime * 1.6 + ph * 1.3) * 0.6) * windAmp * tip + uWind.y * 0.03 * tip;
        // Prop wash: push radially away from the impingement point, flatten, and flutter.
        vec2 d = wp.xz - uWashPos.xz;
        float dist = length(d);
        float hgt = clamp(1.0 - abs(wp.y - uWashPos.y) / 1.5, 0.0, 1.0);
        float f = uWashStrength * smoothstep(uWashRadius, uWashRadius * 0.15, dist) * hgt;
        vec2 dir = dist > 1e-3 ? d / dist : vec2(0.0);
        float flutter = 0.65 + 0.35 * sin(uTime * 31.0 + wp.x * 17.0 + wp.z * 11.0);
        wp.xz += dir * f * 0.7 * flutter * tip;
        wp.y -= f * 0.45 * tip;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
  };
  material.customProgramCacheKey = () => `grass-wind-${bladeHeight}`;
  return material;
}
