import { program } from './gl.ts'

// A Gaussian blur, as CSS `filter: blur(r)` is one with a standard deviation of r. A wide blur reads a smaller mip level
// of the source, so that each side takes at most TAPS texels: the mip level averages the pixels it replaces, and the
// blur hides that it is coarser.
const TAPS = 12

/**
 * How `sigma` device pixels are blurred: at mip level `lod` (1 / `scale` of the size), by `s` texels of that level,
 * with `taps` texels on each side, at most TAPS.
 */
export const planOf = (sigma: number) => {
  const lod = Math.max(0, Math.ceil(Math.log2(3 * sigma / TAPS))), scale = 2 ** lod, s = sigma / scale
  return { lod, scale, s, taps: Math.ceil(3 * s) }
}

const VS = `#version 300 es
void main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0, 1); }`
// One direction of the blur. Outside the source reads its edge (the textures clamp to the edge): the map goes on past the
// screen, so a transparent outside, as a CSS blur has, would fade the land to the sea along the edges of the box.
const FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform vec2 size; uniform vec2 step; uniform float lod; uniform float sigma; uniform int taps;
uniform float light; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec4 sum = vec4(0); float total = 0.0;
  for (int i = -taps; i <= taps; i++) {
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    vec2 p = uv + float(i) * step;
    total += w;
    sum += w * textureLod(src, p, lod);
  }
  o = sum / total;
  o.rgb *= light;
}`

/**
 * Draws the texture `src` (premultiplied, `width` x `height`) onto the framebuffer `target`, blurred by
 * `sigma` device pixels, its colour times `light`, with the blend of GLMap, or added with `add`. It sets the filter of `src` and makes its mip levels.
 */
export const gaussian = (gl: WebGL2RenderingContext) => {
  const prog = program(gl, VS, FS)
  const at = Object.fromEntries(['src', 'size', 'step', 'lod', 'sigma', 'taps', 'light'].map(n => [n, gl.getUniformLocation(prog, n)]))
  const vao = gl.createVertexArray()
  // The first direction goes into `half`, at the size of the mip level that it reads.
  const half = gl.createTexture(), frame = gl.createFramebuffer()
  gl.bindTexture(gl.TEXTURE_2D, half)
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
    gl.texParameteri(gl.TEXTURE_2D, k, v)
  let halfSize = ''
  return {
    run: (src: WebGLTexture, width: number, height: number, sigma: number, light: number, target: WebGLFramebuffer | null, add = false) => {
      const { lod, scale, s, taps } = planOf(sigma)
      const w = Math.max(1, Math.floor(width / scale)), h = Math.max(1, Math.floor(height / scale))
      gl.useProgram(prog); gl.bindVertexArray(vao); gl.activeTexture(gl.TEXTURE0)
      gl.uniform1i(at.src, 0); gl.uniform1f(at.sigma, Math.max(s, 1e-3)); gl.uniform1i(at.taps, taps)
      // A mip filter on a texture without its levels samples black, so the levels are made only when they are read.
      gl.bindTexture(gl.TEXTURE_2D, src)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lod ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      if (lod) gl.generateMipmap(gl.TEXTURE_2D)
      gl.bindTexture(gl.TEXTURE_2D, half)
      if (halfSize !== `${w} ${h}`) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); halfSize = `${w} ${h}` }
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, half, 0)
      gl.viewport(0, 0, w, h); gl.disable(gl.BLEND)
      gl.bindTexture(gl.TEXTURE_2D, src)
      gl.uniform2f(at.size, w, h); gl.uniform2f(at.step, 1 / w, 0); gl.uniform1f(at.lod, lod); gl.uniform1f(at.light, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      // `add` adds the light of src and does not darken what is under it (the sparks); the alpha still adds up.
      gl.viewport(0, 0, width, height); gl.enable(gl.BLEND)
      if (add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindTexture(gl.TEXTURE_2D, half)
      gl.uniform2f(at.size, width, height); gl.uniform2f(at.step, 0, 1 / h); gl.uniform1f(at.lod, 0); gl.uniform1f(at.light, light)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    /** Frees the half texture until the next run. */
    free: () => {
      gl.bindTexture(gl.TEXTURE_2D, half); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindTexture(gl.TEXTURE_2D, null); halfSize = ''
    },
    dispose: () => { gl.deleteTexture(half); gl.deleteFramebuffer(frame); gl.deleteVertexArray(vao); gl.deleteProgram(prog) },
  }
}
