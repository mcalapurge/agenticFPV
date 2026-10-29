// Identify the GPU WebGL is running on, and whether the browser fell back to software rendering.

import type { WebGLRenderer } from 'three';
import type { GpuInfo } from '../../state/uiStore';

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i;

export function isSoftwareRenderer(name: string, vendor = ''): boolean {
  return SOFTWARE.test(name) || SOFTWARE.test(vendor);
}

/** Short, human-readable GPU label (strips the ANGLE wrapper noise). */
export function gpuLabel(name: string): string {
  const m = name.match(/ANGLE \([^,]*,\s*([^,(]+)/);
  return (m ? m[1] : name).replace(/\s+Direct3D.*$/, '').trim();
}

export function detectGpu(renderer: WebGLRenderer): GpuInfo {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(
    (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'unknown',
  );
  const vendor = String((ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || 'unknown');
  return {
    name,
    vendor,
    label: gpuLabel(name),
    software: isSoftwareRenderer(name, vendor),
    webgl2: renderer.capabilities.isWebGL2,
  };
}
