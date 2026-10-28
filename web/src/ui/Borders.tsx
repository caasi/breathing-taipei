import type { GeoProjection } from 'd3-geo'
import type { Geometry } from 'geojson'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'
import { COVER, strips } from './lines.ts'
import { PLACE } from './Dashboard.tsx'

// The look the SVG had, in map units, so a line grows with the zoom as an SVG stroke did. The borders take the blue of
// the place names in the events (Dashboard.tsx), and village edges are dashed, so they stay apart from the roads.
const STYLES = {
  cells: { colour: PLACE.village, opacity: 0.15, width: 0.4, dash: [1.2, 1] },
  towns: { colour: PLACE.town, opacity: 0.3, width: 1, dash: [0, 0] },
  taipei: { colour: PLACE.town, opacity: 0.3, width: 1.8, dash: [0, 0] },
} as const

const VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across; in float along;
uniform vec4 view; uniform vec2 devicePx; uniform float w;
out float d; out float s;
void main() {
  float reach = w * 0.5 + 1.0;
  d = across * reach; s = along;
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1);
}`
// The dash runs on map units from the start of each ring, as an SVG dash does from the start of each path. Each pixel
// gets the share of its length along the line that the dashes cover (a box filter), so a dash shorter than a pixel
// still averages to the right tone.
const FS = `#version 300 es
precision highp float;
in float d; in float s; uniform float w; uniform vec4 colour; uniform vec2 dash; uniform float pxPerUnit; out vec4 o;
${COVER}
// The length of dash from the start of the line to s: whole periods, then the part of the last one.
float dashed(float s, vec2 dash) {
  float p = dash.x + dash.y;
  return floor(s / p) * dash.x + min(mod(s, p), dash.x);
}
void main() {
  float a = colour.a * coverOf(d, w);
  if (dash.y > 0.0) {
    float h = 0.5 / pxPerUnit;
    a *= (dashed(s + h, dash) - dashed(s - h, dash)) / (2.0 * h);
  }
  if (a <= 0.0) discard;
  o = vec4(colour.rgb * a, a);
}`

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
// Each ring of a polygon as one line (lon, lat, ...).
const rings = (g: Geometry) => {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polygons.flatMap(p => p.map(ring => ring.flat()))
}

type Props = { cells: { geometry: Geometry }[]; districts: { geometry: Geometry; taipei: boolean }[]; proj: GeoProjection }

/**
 * The edges of the cells and the borders of the districts, a layer of the map (GLMap.tsx) over the fills. Each cell and
 * each district draws its own outline, as the SVG paths did, so an edge that two of them share is drawn twice.
 */
export function Borders({ cells, districts, proj }: Props) {
  useLayer(LAYER.borders, gl => {
    const prog = program(gl, VS, FS)
    const at = Object.fromEntries(['view', 'devicePx', 'pxPerUnit', 'w', 'colour', 'dash'].map(n => [n, gl.getUniformLocation(prog, n)]))
    const groups = [
      { style: STYLES.cells, lines: cells.flatMap(c => rings(c.geometry)) },
      { style: STYLES.towns, lines: districts.filter(t => !t.taipei).flatMap(t => rings(t.geometry)) },
      { style: STYLES.taipei, lines: districts.filter(t => t.taipei).flatMap(t => rings(t.geometry)) },
    ].map(({ style, lines }) => ({ style, ...strips(lines, proj, { gap: style.width / 2 }) }))
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = (['xy', 'normal', 'across', 'along'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b)
      const all = new Float32Array(groups.reduce((n, g) => n + g[name].length, 0))
      groups.reduce((o, g) => (all.set(g[name], o), o + g[name].length), 0)
      gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, name === 'xy' || name === 'normal' ? 2 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    return {
      dirty: () => false,
      draw: ({ view, clip, width, height, cssWidth }) => {
        const pxPerUnit = view.k * width / cssWidth
        gl.useProgram(prog); gl.bindVertexArray(vao); gl.enable(gl.BLEND)
        gl.uniform4fv(at.view, clip); gl.uniform2f(at.devicePx, 2 / width, 2 / height)
        gl.uniform1f(at.pxPerUnit, pxPerUnit)
        let first = 0
        for (const { style, xy } of groups) {
          gl.uniform1f(at.w, style.width * pxPerUnit)
          const [r, g, b] = rgb(style.colour)
          gl.uniform4f(at.colour, r, g, b, style.opacity); gl.uniform2f(at.dash, style.dash[0], style.dash[1])
          gl.drawArrays(gl.TRIANGLES, first, xy.length / 2)
          first += xy.length / 2
        }
      },
      dispose: () => { buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteProgram(prog) },
    }
  }, [cells, districts, proj])
  return null
}
