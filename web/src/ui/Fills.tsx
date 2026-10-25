import { useRef } from 'react'
import earcut from 'earcut'
import type { GeoProjection } from 'd3-geo'
import type { Geometry } from 'geojson'
import { fit, program, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

/** Cell k of the map, filled with colour k (RGB, 3 bytes per cell). */
export type Cell = { geometry: Geometry }

const VS = `#version 300 es
in vec2 xy; in float cell;
uniform sampler2D colours; uniform vec4 view;
out vec3 c;
void main() {
  c = texelFetch(colours, ivec2(int(cell), 0), 0).rgb;
  gl_Position = vec4(xy * view.xy + view.zw, 0, 1);
}`
const FS = `#version 300 es
precision mediump float;
in vec3 c; out vec4 o;
void main() { o = vec4(c, 1); }`

// Triangles of every cell in map space, with the cell index per vertex.
const triangles = (cells: Cell[], proj: GeoProjection) => {
  const xy: number[] = [], cell: number[] = []
  cells.forEach(({ geometry: g }, k) => {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const rings of polygons) {
      const flat: number[] = [], holes: number[] = []
      rings.forEach((ring, r) => {
        if (r) holes.push(flat.length / 2)
        for (const p of ring) flat.push(...proj(p as [number, number])!)
      })
      for (const i of earcut(flat, holes)) { xy.push(flat[2 * i], flat[2 * i + 1]); cell.push(k) }
    }
  })
  return { xy: new Float32Array(xy), cell: new Float32Array(cell) }
}

type Props = { cells: Cell[]; proj: GeoProjection; colours: Uint8Array; fadeSeconds: number; view: View }

/**
 * The cell fills, drawn with WebGL: the triangles go to the GPU once, and each frame uploads only one
 * colour per cell. Redrawing 1,465 SVG paths each frame was the main cost of the page.
 * When `colours` changes, the shown colours move in a straight line from where they are to it over
 * `fadeSeconds`, as the SVG fill transition did. A frame with nothing to change draws nothing.
 */
export function Fills({ cells, proj, colours, fadeSeconds, view }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef(colours), fade = useRef(fadeSeconds), view$ = useRef(view)
  target.current = colours; fade.current = fadeSeconds; view$.current = view
  useWebGL2(ref, { antialias: true }, (gl, canvas) => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    const viewAt = gl.getUniformLocation(prog, 'view')
    const { xy, cell } = triangles(cells, proj)
    const buffers = [['xy', xy, 2], ['cell', cell, 1]].map(([name, data, size]) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data as Float32Array, gl.STATIC_DRAW)
      const at = gl.getAttribLocation(prog, name as string); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size as number, gl.FLOAT, false, 0, 0)
      return b
    })
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8, cells.length, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const shown = Float32Array.from(target.current), from = Float32Array.from(shown), bytes = new Uint8Array(shown.length)
    // HeatMap makes a new array on every render (the worker posts up to 30 times a second),
    // so a change is a change of content, not of identity.
    const seen = Uint8Array.from(target.current)
    const changed = (t: Uint8Array) => t.length !== seen.length || t.some((v, i) => v !== seen[i])
    // The first frame draws the colours as they are; there is nothing to fade from.
    let raf = 0, start = -Infinity, settled = false, drawn = ''
    const draw = () => {
      const now = performance.now(), t = target.current, w = fit(gl, canvas), v = view$.current, key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y}`
      if (changed(t)) { if (t.length === seen.length) seen.set(t); from.set(shown); start = now; settled = false }
      if (!settled || key !== drawn) {
        const k = Math.min(1, (now - start) / 1000 / Math.max(1e-3, fade.current))
        for (let i = 0; i < shown.length && i < t.length; i++) { shown[i] = from[i] + (t[i] - from[i]) * k; bytes[i] = Math.round(shown[i]) }
        gl.uniform4fv(viewAt, clip(v, canvas.clientWidth, canvas.clientHeight))
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cells.length, 1, gl.RGB, gl.UNSIGNED_BYTE, bytes)
        gl.drawArrays(gl.TRIANGLES, 0, xy.length / 2)
        settled = k === 1; drawn = key
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteTexture(texture); gl.deleteProgram(prog) }
  }, [cells, proj])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
}
