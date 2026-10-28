// Identify the GPU WebGL is running on, and whether the browser fell back to software rendering.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i;

export function detectGpu(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'unknown');
  const vendor = String((ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || 'unknown');
  return {
    name,
    vendor,
    software: SOFTWARE.test(name) || SOFTWARE.test(vendor),
    webgl2: renderer.capabilities.isWebGL2,
    maxTextureSize: renderer.capabilities.maxTextureSize,
  };
}

/** Short, human-readable GPU label (strips the ANGLE wrapper noise). */
export function gpuLabel(info) {
  const m = info.name.match(/ANGLE \([^,]*,\s*([^,(]+)/);
  return (m ? m[1] : info.name).replace(/\s+Direct3D.*$/, '').trim();
}
