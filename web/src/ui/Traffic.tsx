import { useMemo, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { fit, program, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

// Stops of the colour ramp over the slowness of a road (traffic.ts, 0 to 1): where, colour and opacity. A free road is
// a faint hairline; a slow one turns orange, red, then dark red, as on a map app. ponytail: chosen by eye.
export const STOPS: [number, number[], number][] = [
  [0, [0xff, 0xff, 0xff], 0.16], [0.18, [0xff, 0xa2, 0x3a], 0.95], [0.43, [0xff, 0x45, 0x3a], 1], [1, [0xd0, 0x1f, 0x4a], 1],
]
// ponytail: one width for every road, in CSS pixels, as the network is drawn once per view; chosen by eye.
const WIDTH_PX = 0.6
// Edge levels sit in a texture of this width, as one row of 29,404 texels is wider than many GPUs allow.
const ROW = 1024
const vec = (xs: number[]) => `vec${xs.length}(${xs.map(v => v.toFixed(3)).join(', ')})`
/** GLSL that defines `vec4 ramp(float t)`, the colour and opacity of STOPS at slowness t. */
export const RAMP = `
const float AT[${STOPS.length}] = float[${STOPS.length}](${STOPS.map(s => s[0].toFixed(2)).join(', ')});
const vec4 COLOURS[${STOPS.length}] = vec4[${STOPS.length}](${STOPS.map(([, rgb, a]) => vec([...rgb.map(v => v / 255), a])).join(', ')});
vec4 ramp(float t) {
  int i = 0;
  while (i < ${STOPS.length - 2} && t > AT[i + 1]) i++;
  return mix(COLOURS[i], COLOURS[i + 1], clamp((t - AT[i]) / (AT[i + 1] - AT[i]), 0.0, 1.0));
}`

// The network is drawn into two textures only when the view changes: how much of each pixel the roads cover, and
// which edge the pixel belongs to. Each frame then draws one triangle over the screen that looks up the slowness of
// that edge, instead of all the segments.
// A line thinner than a pixel cannot be drawn by rasterising its width, so each segment is a quad one device pixel
// wider than the line on each side, and the fragment shader gives each pixel the share of it that the line covers.
const BAKE_VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across; in float edge;
uniform vec4 view; uniform vec2 devicePx; uniform float w;
out float d; flat out int id;
void main() {
  float reach = w * 0.5 + 1.0;
  d = across * reach; id = int(edge) + 1;
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1);
}`
// Pass 0 adds up the cover, so a pixel where roads meet is brighter. Pass 1 writes the edge (id + 1, 0 for none) in
// two bytes; where lines cross, the last one drawn keeps the pixel.
const BAKE_FS = `#version 300 es
precision highp float;
in float d; flat in int id; uniform float w; uniform int pass; out vec4 o;
void main() {
  // The overlap of this pixel, [|d| - 0.5, |d| + 0.5], with the line, [-w / 2, w / 2], in device pixels.
  float a = abs(d), cover = max(0.0, min(a + 0.5, w * 0.5) - max(a - 0.5, -w * 0.5));
  if (cover <= 0.0) discard;
  o = pass == 0 ? vec4(cover, 0, 0, 1) : vec4(float(id % 256) / 255.0, float(id / 256) / 255.0, 0, 1);
}`
const SHOW_VS = `#version 300 es
void main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0, 1); }`
const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D cover, edges, before, after; uniform float k; out vec4 o;
${RAMP}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 e = texelFetch(edges, p, 0).rg * 255.0;
  int id = int(e.r + 0.5) + 256 * int(e.g + 0.5) - 1;
  if (id < 0) discard;
  ivec2 at = ivec2(id % ${ROW}, id / ${ROW});
  // The slowness moves from the one before the last update to the last one, as the cell fills do.
  vec4 c = ramp(mix(texelFetch(before, at, 0).r, texelFetch(after, at, 0).r, k));
  o = vec4(c.rgb, c.a * min(1.0, texelFetch(cover, p, 0).r));
}`

/** The real shape of each road edge (lon, lat, ...), in the order of road-graph.json (scripts/graphs.py). */
export type RoadLines = number[][]

// Two triangles per segment of every edge, in map space, with the unit normal, the side (+1 or -1) and the edge index.
const quads = (lines: RoadLines, proj: GeoProjection) => {
  const xy: number[] = [], normal: number[] = [], across: number[] = [], edge: number[] = []
  lines.forEach((lonlat, e) => {
    const pts: [number, number][] = []
    for (let i = 0; i < lonlat.length; i += 2) pts.push(proj([lonlat[i], lonlat[i + 1]])!)
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0)
      if (!l) continue
      const nx = -(y1 - y0) / l, ny = (x1 - x0) / l
      for (const [x, y, s] of [[x0, y0, 1], [x0, y0, -1], [x1, y1, 1], [x1, y1, 1], [x0, y0, -1], [x1, y1, -1]]) {
        xy.push(x, y); normal.push(nx * s, ny * s); across.push(s); edge.push(e)
      }
    }
  })
  return { xy: new Float32Array(xy), normal: new Float32Array(normal), across: new Float32Array(across), edge: new Float32Array(edge) }
}

type Props = { lines: RoadLines; proj: GeoProjection; levels: Uint8Array; fadeSeconds: number; view: View }

/**
 * The road network, with its slow edges (traffic.ts) in colour. The network is drawn into textures once per view; a
 * change of levels uploads one byte per edge, and the colours move from the levels before to the new ones over
 * `fadeSeconds`.
 */
export function Traffic({ lines, proj, levels, fadeSeconds, view }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef(levels), view$ = useRef(view), fade = useRef(fadeSeconds)
  target.current = levels; view$.current = view; fade.current = fadeSeconds
  const geometry = useMemo(() => quads(lines, proj), [lines, proj])
  useWebGL2(ref, { antialias: false, premultipliedAlpha: false }, (gl, canvas) => {
    const bake = program(gl, BAKE_VS, BAKE_FS), show = program(gl, SHOW_VS, SHOW_FS)
    const bakeAt = (name: string) => gl.getUniformLocation(bake, name), showAt = (name: string) => gl.getUniformLocation(show, name)
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'normal', 'across', 'edge'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, geometry[name], gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(bake, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, name === 'xy' || name === 'normal' ? 2 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    const texture = (unit: number) => {
      const t = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      return t
    }
    // Units 0 and 1: the slowness before and after the last update. Units 2 and 3: the baked cover and edges.
    const rows = Math.ceil(lines.length / ROW), shown = new Uint8Array(rows * ROW), next = new Uint8Array(rows * ROW)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const slowness = [0, 1].map(unit => { const t = texture(unit); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, ROW, rows); return t })
    const baked = [2, 3].map(texture), frame = gl.createFramebuffer()
    gl.useProgram(show)
    ;['before', 'after', 'cover', 'edges'].forEach((name, unit) => gl.uniform1i(showAt(name), unit))
    const upload = (unit: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, slowness[unit])
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    const drawNetwork = (v: View) => {
      const [cover, edges] = baked
      for (const [unit, t, format] of [[2, cover, gl.R8], [3, edges, gl.RG8]] as const) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, format, canvas.width, canvas.height, 0, format === gl.R8 ? gl.RED : gl.RG, gl.UNSIGNED_BYTE, null)
      }
      gl.useProgram(bake)
      gl.uniform4fv(bakeAt('view'), clip(v, canvas.clientWidth, canvas.clientHeight))
      gl.uniform2f(bakeAt('devicePx'), 2 / canvas.width, 2 / canvas.height)
      gl.uniform1f(bakeAt('w'), WIDTH_PX * canvas.width / canvas.clientWidth)
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame)
      for (const [pass, t] of [[0, cover], [1, edges]] as const) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        if (pass === 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE) } else gl.disable(gl.BLEND)
        gl.uniform1i(bakeAt('pass'), pass)
        gl.drawArrays(gl.TRIANGLES, 0, geometry.xy.length / 2)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    let raf = 0, network = '', drawn = '', uploaded: Uint8Array | undefined, start = -Infinity, settled = false
    const draw = () => {
      const now = performance.now(), w = fit(gl, canvas), v = view$.current, t = target.current, key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y}`
      if (key !== network) { drawNetwork(v); network = key; drawn = '' }
      if (t !== uploaded) {
        // ponytail: a new level during a fade starts from the old target, not from the colour on the screen, so it can
        // jump a little at a high speed. Keep the shown levels on the CPU if that shows.
        shown.set(next); next.fill(0); next.set(t.subarray(0, next.length))
        upload(0, shown); upload(1, next); uploaded = t; start = drawn ? now : -Infinity; settled = false
      }
      if (!settled || key !== drawn) {
        const k = Math.min(1, (now - start) / 1000 / Math.max(1e-3, fade.current))
        gl.useProgram(show); gl.uniform1f(showAt('k'), k); settled = k === 1
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        drawn = key
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf); buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao)
      ;[...slowness, ...baked].forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(frame); gl.deleteProgram(bake); gl.deleteProgram(show)
    }
  }, [geometry])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
