import { useMemo, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { fit, program, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

import type { GraphJson } from '../sim/route.ts'

// Orange, red and dark red, as on a map app; level 0 (free) is not drawn.
const COLOURS = [[0, 0, 0, 0], [0xf2, 0x9a, 0x2e, 0xff], [0xe5, 0x39, 0x35, 0xff], [0x9b, 0x1c, 0x1c, 0xff]]
// A dark casing under each line keeps the orange apart from the orange of the cells where people arrive.
const WIDTH_PX = 2.5, CASING_PX = 4.5, CASING = [0x11, 0x0e, 0x0e]
// Edge levels sit in a texture of this width, as one row of 29,404 texels is wider than many GPUs allow.
const ROW = 1024

const VS = `#version 300 es
in vec2 xy; in vec2 side; in float edge;
uniform highp usampler2D levels; uniform vec4 view; uniform vec2 px; uniform bool casing;
out vec4 c;
const vec4 COLOURS[4] = vec4[4](${COLOURS.map(c => `vec4(${c.map(v => (v / 255).toFixed(3)).join(', ')})`).join(', ')});
void main() {
  int e = int(edge);
  c = COLOURS[int(texelFetch(levels, ivec2(e % ${ROW}, e / ${ROW}), 0).r)];
  if (casing && c.a > 0.0) c = vec4(${CASING.map(v => (v / 255).toFixed(3)).join(', ')}, 1);
  // The map is scaled the same on both axes and y points down on the screen, so the normal in pixels is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(side.x, -side.y) * px, 0, 1);
}`
const FS = `#version 300 es
precision mediump float;
in vec4 c; out vec4 o;
void main() { if (c.a == 0.0) discard; o = c; }`

// Two triangles per segment of every edge, in map space, with the unit normal (signed per side) and the edge index.
const quads = (road: GraphJson, proj: GeoProjection) => {
  const xy: number[] = [], side: number[] = [], edge: number[] = []
  road.edges.forEach(([a, b, , mid], e) => {
    const lonlat = [road.lon[a], road.lat[a], ...mid, road.lon[b], road.lat[b]], pts: [number, number][] = []
    for (let i = 0; i < lonlat.length; i += 2) pts.push(proj([lonlat[i], lonlat[i + 1]])!)
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0)
      if (!l) continue
      const nx = -(y1 - y0) / l, ny = (x1 - x0) / l
      for (const [x, y, s] of [[x0, y0, 1], [x0, y0, -1], [x1, y1, 1], [x1, y1, 1], [x0, y0, -1], [x1, y1, -1]]) {
        xy.push(x, y); side.push(nx * s, ny * s); edge.push(e)
      }
    }
  })
  return { xy: new Float32Array(xy), side: new Float32Array(side), edge: new Float32Array(edge) }
}

type Props = { road: GraphJson; proj: GeoProjection; levels: Uint8Array; view: View }

/** The slow road edges of the run (traffic.ts), drawn with WebGL: the geometry goes to the GPU once, a change of levels uploads one byte per edge. */
export function Traffic({ road, proj, levels, view }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef(levels), view$ = useRef(view)
  target.current = levels; view$.current = view
  const geometry = useMemo(() => quads(road, proj), [road, proj])
  useWebGL2(ref, { antialias: true, premultipliedAlpha: false }, (gl, canvas) => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    const viewAt = gl.getUniformLocation(prog, 'view'), pxAt = gl.getUniformLocation(prog, 'px'), casingAt = gl.getUniformLocation(prog, 'casing')
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'side', 'edge'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, geometry[name], gl.STATIC_DRAW)
      const at = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, name === 'edge' ? 1 : 2, gl.FLOAT, false, 0, 0)
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
        for (const [casing, width] of [[1, CASING_PX], [0, WIDTH_PX]]) {
          gl.uniform1i(casingAt, casing); gl.uniform2f(pxAt, width / canvas.clientWidth, width / canvas.clientHeight)
          gl.drawArrays(gl.TRIANGLES, 0, geometry.xy.length / 2)
        }
        drawn = key
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(prog) }
  }, [geometry])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
