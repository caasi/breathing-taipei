import { useMemo, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { program } from './gl.ts'
import { LAYER, useLayer, type Frame } from './GLMap.tsx'
import { COVER, quads } from './lines.ts'

// Stops of the colour ramp over the slowness of a road (traffic.ts, 0 to 1): where, colour and opacity. A free road is
// a faint hairline; a slow one turns orange, red, then dark red, as on a map app. ponytail: chosen by eye.
export const STOPS: [number, number[], number][] = [
  [0, [0xff, 0xff, 0xff], 0.16], [0.18, [0xff, 0xa2, 0x3a], 0.95], [0.43, [0xff, 0x45, 0x3a], 1], [1, [0xd0, 0x1f, 0x4a], 1],
]
// ponytail: one width for every road, in CSS pixels, as the network is drawn once per view; chosen by eye.
const WIDTH_PX = 0.6
// ponytail: the glow of slow roads, chosen by eye: it starts at slowness GLOW_FROM, spreads over GLOW_LEVELS halvings
// of the screen size (each level doubles its reach), and is added at GLOW_GAIN.
const GLOW_FROM = 0.15, GLOW_LEVELS = 5, GLOW_GAIN = 1.4
// ponytail: the flow on roads in use, chosen by eye: dashes of FLOW_PERIOD device pixels move both ways (the levels
// have no direction) at FLOW_FAST pixels a second on a free road down to FLOW_SLOW on the slowest.
const FLOW_PERIOD = 14, FLOW_FAST = 40, FLOW_SLOW = 3
const MAX_STEP_MS = 100
// Edge levels sit in a texture of this width, as one row of a texel per edge (33,019 on 2026-10-27) is wider than many GPUs allow.
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
// The roads are lines thinner than a pixel, drawn with the quads and the cover of lines.ts.
const BAKE_VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across; in float edge; in float along;
uniform vec4 view; uniform vec2 devicePx; uniform float w; uniform float pxPerUnit;
out float d; out float s; flat out int id;
void main() {
  float reach = w * 0.5 + 1.0;
  d = across * reach; id = int(edge) + 1; s = along * pxPerUnit / ${FLOW_PERIOD.toFixed(1)};
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1);
}`
// Pass 0 adds up the cover, so a pixel where roads meet is brighter. Pass 1 writes the edge (id + 1, 0 for none) in
// two bytes and the phase of the flow dashes along the edge in the third; where lines cross, the last one drawn keeps
// the pixel.
const BAKE_FS = `#version 300 es
precision highp float;
in float d; in float s; flat in int id; uniform float w; uniform int pass; out vec4 o;
${COVER}
void main() {
  float cover = coverOf(d, w);
  if (cover <= 0.0) discard;
  o = pass == 0 ? vec4(cover, 0, 0, 1) : vec4(float(id % 256) / 255.0, float(id / 256) / 255.0, fract(s), 1);
}`
const SHOW_VS = `#version 300 es
void main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0, 1); }`
// The output is premultiplied colour, which the layer blends over the map (see Traffic).
// With glow, it writes only the slow roads, at 1 / scale of the screen, for the bloom below.
const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D cover, edges, before, after; uniform float k; uniform bool glow; uniform int scale; uniform float time; out vec4 o;
${RAMP}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * scale;
  vec4 e = texelFetch(edges, p, 0);
  int id = int(e.r * 255.0 + 0.5) + 256 * int(e.g * 255.0 + 0.5) - 1;
  if (id < 0) discard;
  ivec2 at = ivec2(id % ${ROW}, id / ${ROW});
  // The level moves from the one before the last update to the last one, as the cell fills do. 0 is a road with no
  // traveller; 1 to 255 is the slowness of a road in use.
  float raw = mix(texelFetch(before, at, 0).r, texelFetch(after, at, 0).r, k) * 255.0, used = smoothstep(0.0, 1.0, raw);
  float t = max(0.0, raw - 1.0) / 254.0, cover = min(1.0, texelFetch(cover, p, 0).r);
  vec4 c = ramp(t);
  float a = glow ? cover * smoothstep(${GLOW_FROM.toFixed(2)}, 1.0, t) : c.a * cover;
  if (!glow) {
    // Dashes that move both ways, slower on a slower road; a road in use shows them over a brighter line. ponytail: the
    // dash (0.25 to 0.45 of a period), the line of a road in use (0.5) and the gap (0.3 of it) are chosen by eye.
    float run = time * mix(${FLOW_FAST.toFixed(1)}, ${FLOW_SLOW.toFixed(1)}, sqrt(t)) / ${FLOW_PERIOD.toFixed(1)};
    float dash = max(1.0 - smoothstep(0.25, 0.45, fract(e.b - run)), 1.0 - smoothstep(0.25, 0.45, fract(e.b + run)));
    a = mix(a, max(a, 0.5 * cover) * mix(0.3, 1.0, dash), used);
  }
  o = vec4(c.rgb * a, a);
}`
// Dual filtering (Kawase blur on a chain of half sizes; Marius Bjørge, ARM, SIGGRAPH 2015): each level down takes 5
// bilinear taps, each level up 8, so a wide glow costs a few small passes. The up pass adds onto the level it writes.
const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform vec2 texel; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * 2.0 * texel;
  o = (texture(src, uv) * 4.0 + texture(src, uv - texel) + texture(src, uv + texel)
    + texture(src, uv + vec2(texel.x, -texel.y)) + texture(src, uv - vec2(texel.x, -texel.y))) / 8.0;
}`
const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform vec2 texel; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * 0.5 * texel, h = texel * 0.5;
  o = (texture(src, uv + vec2(-h.x * 2.0, 0)) + texture(src, uv + vec2(0, h.y * 2.0))
    + texture(src, uv + vec2(h.x * 2.0, 0)) + texture(src, uv + vec2(0, -h.y * 2.0))
    + 2.0 * (texture(src, uv + vec2(-h.x, h.y)) + texture(src, uv + h) + texture(src, uv + vec2(h.x, -h.y)) + texture(src, uv - h))) / 12.0;
}`
const GLOW_FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform vec2 screen; out vec4 o;
void main() { o = min(vec4(1), texture(src, gl_FragCoord.xy / screen) * ${GLOW_GAIN.toFixed(2)}); }`

/** The real shape of each road edge (lon, lat, ...), in the order of road-graph.json (scripts/graphs.py). */
export type RoadLines = number[][]


type Props = { lines: RoadLines; proj: GeoProjection; levels: Uint8Array; fadeSeconds: number; running: boolean; shown: boolean }

/**
 * The road network, with its slow edges (traffic.ts) in colour, a layer of the map (GLMap.tsx) over the stations. The
 * network is drawn into textures once per view; a change of levels uploads one byte per edge, and the colours move
 * from the levels before to the new ones over `fadeSeconds`. The glow and the lines go onto the map with the blend of
 * the baseline: the same result as when this layer had its own canvas, which the browser put over the map.
 */
export function Traffic({ lines, proj, levels, fadeSeconds, running, shown }: Props) {
  const target = useRef(levels), fade = useRef(fadeSeconds), running$ = useRef(running), shown$ = useRef(shown)
  target.current = levels; fade.current = fadeSeconds; running$.current = running; shown$.current = shown
  const geometry = useMemo(() => quads(lines, proj), [lines, proj])
  useLayer(LAYER.traffic, gl => {
    const bake = program(gl, BAKE_VS, BAKE_FS), show = program(gl, SHOW_VS, SHOW_FS)
    const down = program(gl, SHOW_VS, DOWN_FS), up = program(gl, SHOW_VS, UP_FS), glow = program(gl, SHOW_VS, GLOW_FS)
    const bakeAt = (name: string) => gl.getUniformLocation(bake, name), showAt = (name: string) => gl.getUniformLocation(show, name)
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'normal', 'across', 'edge', 'along'] as const).map(name => {
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
    // Units 0 and 1: the slowness before and after the last update. Units 2 and 3: the baked cover and edges. Other
    // layers bind their own textures to these units, so draw binds them again.
    const rows = Math.ceil(lines.length / ROW), before = new Uint8Array(rows * ROW), next = new Uint8Array(rows * ROW)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const slowness = [0, 1].map(unit => { const t = texture(unit); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, ROW, rows); return t })
    const baked = [2, 3].map(texture), frame = gl.createFramebuffer()
    const bind = () => [...slowness, ...baked].forEach((t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t) })
    // Unit 4: the glow levels, from 1/2 of the screen down; bilinear, as the blur reads between texels.
    const bloom = Array.from({ length: GLOW_LEVELS }, () => {
      const t = texture(4)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    })
    let sizes: [number, number][] = [], width = 0, height = 0
    for (const p of [down, up, glow]) { gl.useProgram(p); gl.uniform1i(gl.getUniformLocation(p, 'src'), 4) }
    gl.useProgram(show)
    ;['before', 'after', 'cover', 'edges'].forEach((name, unit) => gl.uniform1i(showAt(name), unit))
    const upload = (unit: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, slowness[unit])
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    const drawNetwork = ({ view: v, clip, cssWidth }: Frame) => {
      const [cover, edges] = baked
      for (const [unit, t, format] of [[2, cover, gl.R8], [3, edges, gl.RGBA8]] as const) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format === gl.R8 ? gl.RED : gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.useProgram(bake); gl.bindVertexArray(vao)
      gl.uniform4fv(bakeAt('view'), clip)
      gl.uniform2f(bakeAt('devicePx'), 2 / width, 2 / height)
      gl.uniform1f(bakeAt('w'), WIDTH_PX * width / cssWidth)
      gl.uniform1f(bakeAt('pxPerUnit'), v.k * width / cssWidth)
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame); gl.viewport(0, 0, width, height)
      for (const [pass, t] of [[0, cover], [1, edges]] as const) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        if (pass === 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE) } else gl.disable(gl.BLEND)
        gl.uniform1i(bakeAt('pass'), pass)
        gl.drawArrays(gl.TRIANGLES, 0, geometry.xy.length / 2)
      }
      sizes = []
      for (let i = 0, w = width, h = height; i < GLOW_LEVELS; i++) {
        w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2)); sizes.push([w, h])
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloom[i])
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
    }
    /** Draws one pass over the screen into glow level i (or the map when i is -1), reading level `from`. */
    const pass = (p: WebGLProgram, i: number, from?: number) => {
      gl.useProgram(p)
      if (i < 0) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height) }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, frame); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloom[i], 0); gl.viewport(0, 0, ...sizes[i]) }
      if (from !== undefined) {
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloom[from])
        gl.uniform2f(gl.getUniformLocation(p, 'texel'), 1 / sizes[from][0], 1 / sizes[from][1])
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    let network = '', glowed = '', uploaded: Uint8Array | undefined, start = -Infinity, settled = false, flow = 0, last = performance.now()
    let wasShown = false
    const keyOf = ({ width, height, view: v }: Frame) => `${width} ${height} ${v.k} ${v.x} ${v.y}`
    return {
      // The dashes move while the clock runs, so the layer is dirty in each frame then; else only while the colours fade,
      // when the levels or the view change, and when it shows or hides.
      dirty: f => {
        // The dash clock moves here, as GLMap asks every layer in every frame: draw runs only when a layer is dirty, so a
        // clock kept in draw would take a whole pause in one step when the run goes on. A hidden tab gets no frames at
        // all, so one step is at most MAX_STEP_MS.
        if (running$.current) flow += Math.min(f.now - last, MAX_STEP_MS) / 1000
        last = f.now
        const toggled = shown$.current !== wasShown
        wasShown = shown$.current
        if (!shown$.current) return toggled
        return toggled || running$.current || !settled || target.current !== uploaded || keyOf(f) !== glowed
      },
      draw: f => {
        const now = f.now
        // A hidden layer draws nothing, and draws again in full when it shows.
        if (!shown$.current) { glowed = ''; return }
        width = f.width; height = f.height
        bind()
        const key = keyOf(f), t = target.current
        if (key !== network) { drawNetwork(f); network = key; glowed = '' }
        if (t !== uploaded) {
          // ponytail: a new level during a fade starts from the old target, not from the colour on the screen, so it can
          // jump a little at a high speed. Keep the shown levels on the CPU if that shows.
          before.set(next); next.fill(0); next.set(t.subarray(0, next.length))
          upload(0, before); upload(1, next); bind(); uploaded = t; start = glowed ? now : -Infinity; settled = false
        }
        gl.useProgram(show); gl.uniform1f(showAt('time'), flow)
        if (!settled || key !== glowed) {
          const k = Math.min(1, (now - start) / 1000 / Math.max(1e-3, fade.current))
          gl.uniform1f(showAt('k'), k); settled = k === 1
          // The slow roads at half size, then down the chain and back up, each level up added onto the one it writes.
          gl.disable(gl.BLEND)
          gl.uniform1i(showAt('glow'), 1); gl.uniform1i(showAt('scale'), 2)
          gl.bindFramebuffer(gl.FRAMEBUFFER, frame); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloom[0], 0)
          gl.viewport(0, 0, ...sizes[0]); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3)
          for (let i = 1; i < GLOW_LEVELS; i++) pass(down, i, i - 1)
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)
          for (let i = GLOW_LEVELS - 2; i >= 0; i--) pass(up, i, i + 1)
          glowed = key
        }
        // On the map: the glow, then the lines over it, both premultiplied with the blend of the baseline.
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.useProgram(glow); gl.uniform2f(gl.getUniformLocation(glow, 'screen'), width, height)
        pass(glow, -1, 0)
        gl.useProgram(show); gl.uniform1i(showAt('glow'), 0); gl.uniform1i(showAt('scale'), 1)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
      dispose: () => {
        buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao)
        ;[...slowness, ...baked, ...bloom].forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(frame)
        ;[bake, show, down, up, glow].forEach(p => gl.deleteProgram(p))
      },
    }
  }, [geometry])
  return null
}
