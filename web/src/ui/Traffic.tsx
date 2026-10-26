import { useMemo, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { fit, program, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

// Stops of the colour ramp over the slowness of a road (traffic.ts, 0 to 1): where, colour, opacity and width in CSS
// pixels. A free road is a faint hairline; a slow one turns orange, red, then dark red, as on a map app, and gets a
// little wider. ponytail: chosen by eye.
const STOPS: [number, number[], number, number][] = [
  [0, [0xff, 0xff, 0xff], 0.16, 0.5], [0.18, [0xff, 0xa2, 0x3a], 0.95, 0.9], [0.43, [0xff, 0x45, 0x3a], 1, 1.1], [1, [0xd0, 0x1f, 0x4a], 1, 1.3],
]
// Edge levels sit in a texture of this width, as one row of 29,404 texels is wider than many GPUs allow.
const ROW = 1024
const vec = (xs: number[]) => `vec${xs.length}(${xs.map(v => v.toFixed(3)).join(', ')})`

// A line thinner than a pixel cannot be drawn by rasterising its width, so each segment is a quad one device pixel
// wider than the line on each side, and the fragment shader gives each pixel the share of it that the line covers.
const VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across;
in float edge;
uniform sampler2D before, after; uniform float k; uniform vec4 view; uniform vec2 devicePx; uniform float dpr;
out vec4 c; out float d; out float w;
const float AT[${STOPS.length}] = float[${STOPS.length}](${STOPS.map(s => s[0].toFixed(2)).join(', ')});
const vec4 COLOURS[${STOPS.length}] = vec4[${STOPS.length}](${STOPS.map(([, rgb, a]) => vec([...rgb.map(v => v / 255), a])).join(', ')});
const float WIDTHS[${STOPS.length}] = float[${STOPS.length}](${STOPS.map(s => s[3].toFixed(2)).join(', ')});
void main() {
  ivec2 at = ivec2(int(edge) % ${ROW}, int(edge) / ${ROW});
  // The slowness moves from the one before the last update to the last one, as the cell fills do.
  float t = mix(texelFetch(before, at, 0).r, texelFetch(after, at, 0).r, k);
  int i = 0;
  while (i < ${STOPS.length - 2} && t > AT[i + 1]) i++;
  float f = clamp((t - AT[i]) / (AT[i + 1] - AT[i]), 0.0, 1.0);
  c = mix(COLOURS[i], COLOURS[i + 1], f); w = mix(WIDTHS[i], WIDTHS[i + 1], f) * dpr;
  float reach = w * 0.5 + 1.0;
  d = across * reach;
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1);
}`
const FS = `#version 300 es
precision mediump float;
in vec4 c; in float d; in float w; out vec4 o;
void main() {
  // The overlap of this pixel, [|d| - 0.5, |d| + 0.5], with the line, [-w / 2, w / 2], in device pixels.
  float a = abs(d), cover = max(0.0, min(a + 0.5, w * 0.5) - max(a - 0.5, -w * 0.5));
  o = vec4(c.rgb, c.a * cover);
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
 * The road network, with its slow edges (traffic.ts) in colour. The geometry goes to the GPU once; a change of levels
 * uploads one byte per edge, and the colours move from the levels before to the new ones over `fadeSeconds`.
 */
export function Traffic({ lines, proj, levels, fadeSeconds, view }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef(levels), view$ = useRef(view), fade = useRef(fadeSeconds)
  target.current = levels; view$.current = view; fade.current = fadeSeconds
  const geometry = useMemo(() => quads(lines, proj), [lines, proj])
  useWebGL2(ref, { antialias: false, premultipliedAlpha: false }, (gl, canvas) => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    const at = (name: string) => gl.getUniformLocation(prog, name)
    const viewAt = at('view'), devicePxAt = at('devicePx'), dprAt = at('dpr'), kAt = at('k')
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'normal', 'across', 'edge'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, geometry[name], gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, name === 'xy' || name === 'normal' ? 2 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    const rows = Math.ceil(lines.length / ROW), shown = new Uint8Array(rows * ROW), next = new Uint8Array(rows * ROW)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const textures = ['before', 'after'].map((name, unit) => {
      const t = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, ROW, rows)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.uniform1i(at(name), unit)
      return t
    })
    const upload = (unit: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit])
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    let raf = 0, drawn = '', uploaded: Uint8Array | undefined, start = -Infinity, settled = false
    const draw = () => {
      const now = performance.now(), w = fit(gl, canvas), v = view$.current, t = target.current, key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y}`
      if (t !== uploaded) {
        // ponytail: a new level during a fade starts from the old target, not from the colour on the screen, so it can
        // jump a little at a high speed. Keep the shown levels on the CPU if that shows.
        shown.set(next); next.fill(0); next.set(t.subarray(0, next.length))
        upload(0, shown); upload(1, next); uploaded = t; start = drawn ? now : -Infinity; settled = false
      }
      if (!settled || key !== drawn) {
        const k = Math.min(1, (now - start) / 1000 / Math.max(1e-3, fade.current))
        gl.uniform1f(kAt, k); settled = k === 1
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform4fv(viewAt, clip(v, canvas.clientWidth, canvas.clientHeight))
        gl.uniform2f(devicePxAt, 2 / canvas.width, 2 / canvas.height); gl.uniform1f(dprAt, canvas.width / canvas.clientWidth)
        gl.drawArrays(gl.TRIANGLES, 0, geometry.xy.length / 2)
        drawn = key
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); textures.forEach(t => gl.deleteTexture(t)); gl.deleteProgram(prog) }
  }, [geometry])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
