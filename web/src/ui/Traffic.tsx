import { useMemo, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { fit, program, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'
import type { GraphJson } from '../sim/route.ts'

// Per level (traffic.ts): colour, opacity and width in CSS pixels. Every road shows as a faint hairline; a slow one
// is a little wider, in orange, red or dark red as on a map app. ponytail: chosen by eye.
const STYLES: [number[], number, number][] = [
  [[0xff, 0xff, 0xff], 0.16, 0.5], [[0xff, 0xa2, 0x3a], 0.95, 0.9], [[0xff, 0x45, 0x3a], 1, 1.1], [[0xd0, 0x1f, 0x4a], 1, 1.3],
]
// Edge levels sit in a texture of this width, as one row of 29,404 texels is wider than many GPUs allow.
const ROW = 1024
const vec = (xs: number[]) => `vec${xs.length}(${xs.map(v => v.toFixed(3)).join(', ')})`

// A line thinner than a pixel cannot be drawn by rasterising its width, so each segment is a quad one device pixel
// wider than the line on each side, and the fragment shader gives each pixel the share of it that the line covers.
const VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across;
in float edge;
uniform highp usampler2D levels; uniform vec4 view; uniform vec2 devicePx; uniform float dpr;
out vec4 c; out float d; out float w;
const vec4 COLOURS[4] = vec4[4](${STYLES.map(([rgb, a]) => vec([...rgb.map(v => v / 255), a])).join(', ')});
const float WIDTHS[4] = float[4](${STYLES.map(s => s[2].toFixed(2)).join(', ')});
void main() {
  int e = int(edge), level = int(texelFetch(levels, ivec2(e % ${ROW}, e / ${ROW}), 0).r);
  c = COLOURS[level]; w = WIDTHS[level] * dpr;
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

// Two triangles per segment of every edge, in map space, with the unit normal, the side (+1 or -1) and the edge index.
const quads = (road: GraphJson, proj: GeoProjection) => {
  const xy: number[] = [], normal: number[] = [], across: number[] = [], edge: number[] = []
  road.edges.forEach(([a, b, , mid], e) => {
    const lonlat = [road.lon[a], road.lat[a], ...mid, road.lon[b], road.lat[b]], pts: [number, number][] = []
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

type Props = { road: GraphJson; proj: GeoProjection; levels: Uint8Array; view: View }

/** The road network, with its slow edges (traffic.ts) in colour. The geometry goes to the GPU once; a change of levels uploads one byte per edge. */
export function Traffic({ road, proj, levels, view }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef(levels), view$ = useRef(view)
  target.current = levels; view$.current = view
  const geometry = useMemo(() => quads(road, proj), [road, proj])
  useWebGL2(ref, { antialias: false, premultipliedAlpha: false }, (gl, canvas) => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    const at = (name: string) => gl.getUniformLocation(prog, name)
    const viewAt = at('view'), devicePxAt = at('devicePx'), dprAt = at('dpr')
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'normal', 'across', 'edge'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, geometry[name], gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, name === 'xy' || name === 'normal' ? 2 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    const rows = Math.ceil(road.edges.length / ROW), bytes = new Uint8Array(rows * ROW)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, ROW, rows)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    let raf = 0, drawn = '', uploaded: Uint8Array | undefined
    const draw = () => {
      const w = fit(gl, canvas), v = view$.current, t = target.current, key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y}`
      if (t !== uploaded || key !== drawn) {
        if (t !== uploaded) { bytes.fill(0); bytes.set(t.subarray(0, bytes.length)); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, bytes); uploaded = t }
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform4fv(viewAt, clip(v, canvas.clientWidth, canvas.clientHeight))
        gl.uniform2f(devicePxAt, 2 / canvas.width, 2 / canvas.height); gl.uniform1f(dprAt, canvas.width / canvas.clientWidth)
        gl.drawArrays(gl.TRIANGLES, 0, geometry.xy.length / 2)
        drawn = key
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(prog) }
  }, [geometry])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
