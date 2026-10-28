import { useRef } from 'react'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'
import { rgb } from './lines.ts'
import { ICONS, type Kind } from './icons.ts'

// In map units: a badge (a square with rounded corners) in the dark of the map, with an edge 1 unit wide and the sign
// of its kind in the colour of its kind, as a station sign of a transit map is. The SVG markers were discs at 0.6 opacity, and
// the airport was larger (r 7); the author chose solid badges of one size, so the sign reads over the lines and fills.
// A station of two kinds (臺北, 南港) stacks the badges of its shown kinds as cards, from the top left to the bottom
// right, SPACING apart on each axis, in the order of KINDS; the first one is at the station, and each next one draws
// over the one before. The stack hints that the two stations are one building (author's choice).
const KINDS: Kind[] = ['hsr', 'tra', 'airport']
const COLOURS = { hsr: '#f47321', tra: '#cccccc', airport: '#ffffff' }
// The half side of a badge, in map units, for every kind.
export const R = 5
export const SPACING = 4
// The badge grows with the zoom, as the SVG marker did, but its half side is never below MIN_RADIUS CSS pixels: the
// desktop layout has about 1.2 CSS pixels to a map unit, where a disc of 5 units carried a sign of about 6 pixels. The edge, the sign and
// the spacing grow with it, and so does the place of the name (HeatMap.tsx).
const MIN_RADIUS = 9
export const stationScale = (k: number) => Math.max(1, MIN_RADIUS / (R * k))
// The cell of a sign, padding included, takes this share of the half side on each side of the centre; the atlas holds
// each sign in CELL pixels. A sign is a few pixels wide on the screen, so the lookup uses a small mip level, whose
// texels reach PAD pixels of the atlas: the padding keeps a sign from taking a sliver of the next one. With this
// padding, the glyph itself spans 0.75 of the half side on each side, inside the edge and the rounded corners (ROUND
// of the half side).
const SIGN = 1.5, CELL = 64, PAD = 16, ROUND = 0.35
// The fill of a badge: the background of the map (BACKGROUND in HeatMap.tsx), so a badge sits in the map and only its
// sign and its edge stand out (author's choice, after solid colour fills drew the eye away from the area colours). The
// fill is at FILL opacity, so the lines and the fills show through it (author's choice); in a stack of two, the card
// under it shows through too.
const BADGE = '#211d1d', FILL = 0.6
const vec3 = (hex: string) => `vec3(${rgb(hex).map(v => v.toFixed(3)).join(', ')})`

const VS = `#version 300 es
in vec2 centre; in vec2 corner; in float kind; in float slot;
uniform vec4 view; uniform float pxPerUnit; uniform float scale;
out vec2 p; flat out int k;
void main() {
  k = int(kind);
  // Half the side of the quad: the badge, its edge and one pixel for the coverage.
  float side = (${R.toFixed(1)} + 0.5) * scale + 1.0 / pxPerUnit;
  p = corner * side;
  gl_Position = vec4((centre + vec2(slot) * ${SPACING.toFixed(1)} * scale + p) * view.xy + view.zw, 0, 1);
}`
const FS = `#version 300 es
precision highp float;
in vec2 p; flat in int k; uniform vec3 colours[${KINDS.length}]; uniform float pxPerUnit; uniform float scale;
uniform sampler2D signs;
out vec4 o;
void main() {
  // A badge: a square with rounded corners, half side r, and an edge in the colour of its kind. dist is its signed
  // distance (a rounded box).
  float r = ${R.toFixed(1)} * scale, edge = 0.5 * scale, rc = ${ROUND.toFixed(2)} * r;
  vec2 q = abs(p) - vec2(r - rc);
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rc;
  // The share of the pixel inside the outer side of the edge, and inside the badge.
  float outer = clamp((edge - dist) * pxPerUnit + 0.5, 0.0, 1.0), inner = clamp((-edge - dist) * pxPerUnit + 0.5, 0.0, 1.0);
  // The sign is sampled in every pixel, before any branch or discard: a lookup with mipmaps needs the derivatives of
  // its neighbours, which are undefined in a branch that some of them do not take.
  vec2 uv = p / (2.0 * ${SIGN.toFixed(2)} * r) + 0.5;
  float inBox = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float mark = texture(signs, vec2((float(k) + clamp(uv.x, 0.0, 1.0)) / ${KINDS.length.toFixed(1)}, clamp(uv.y, 0.0, 1.0))).a * inBox;
  if (outer <= 0.0) discard;
  // The fill is the dark of the map at FILL opacity; the sign and the edge are solid, in the colour of the kind.
  // Premultiplied: each part adds its colour times its share of the pixel.
  float fill = ${FILL.toFixed(2)} * inner * (1.0 - mark), solid = inner * mark + (outer - inner);
  o = vec4(${vec3(BADGE)} * fill + colours[k] * solid, fill + solid);
}`

// The signs, white on clear, one cell each, in the order of KINDS; the alpha is what the shader reads.
const atlas = () => {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
  canvas.width = CELL * KINDS.length; canvas.height = CELL
  ctx.fillStyle = '#fff'
  KINDS.forEach((kind, i) => {
    const s = (CELL - 2 * PAD) / 15
    ctx.setTransform(s, 0, 0, s, i * CELL + PAD, PAD)
    ctx.fill(new Path2D(ICONS[kind]))
  })
  return canvas
}

type Point = { kinds: string[]; xy: [number, number] }
type Props = { points: Point[]; show: Set<string> }

/** The signs that a station shows, in the order they are drawn; its name goes after the last one. */
export const signsOf = (p: Point, show: Set<string>) => KINDS.filter(k => p.kinds.includes(k) && show.has(k))

/** The stations of 台鐵, high speed rail and the airport, a layer of the map (GLMap.tsx) over the rail lines. */
export function Stations({ points, show }: Props) {
  const show$ = useRef(show)
  show$.current = show
  useLayer(LAYER.stations, gl => {
    const prog = program(gl, VS, FS)
    const at = (name: string) => gl.getUniformLocation(prog, name)
    // The quads of the shown signs; built again when the shown kinds change, so a sign moves into the place of a hidden
    // one. Seven stations make this cheap.
    const quads = (show: Set<string>) => {
      const centre: number[] = [], corner: number[] = [], kind: number[] = [], slot: number[] = []
      for (const p of points) signsOf(p, show).forEach((k, i) => {
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
          centre.push(...p.xy); corner.push(x, y); kind.push(KINDS.indexOf(k)); slot.push(i)
        }
      })
      return { centre, corner, kind, slot }
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = ([['centre', 2], ['corner', 2], ['kind', 1], ['slot', 1]] as const).map(([name, size]) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      return { name, b }
    })
    let count = 0
    const upload = (show: Set<string>) => {
      const q = quads(show)
      for (const { name, b } of buffers) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q[name]), gl.DYNAMIC_DRAW) }
      count = q.kind.length
    }
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas())
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.useProgram(prog)
    gl.uniform3fv(at('colours'), KINDS.flatMap(k => rgb(COLOURS[k])))
    gl.uniform1i(at('signs'), 0)
    const viewAt = at('view'), pxAt = at('pxPerUnit'), scaleAt = at('scale')
    let shown = ''
    return {
      dirty: () => [...show$.current].sort().join() !== shown,
      draw: ({ view, clip, width, cssWidth }) => {
        gl.useProgram(prog); gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.bindTexture(gl.TEXTURE_2D, texture)
        const key = [...show$.current].sort().join()
        if (key !== shown) { upload(show$.current); shown = key }
        gl.uniform4fv(viewAt, clip); gl.uniform1f(pxAt, view.k * width / cssWidth); gl.uniform1f(scaleAt, stationScale(view.k))
        gl.drawArrays(gl.TRIANGLES, 0, count)
      },
      dispose: () => { buffers.forEach(({ b }) => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(prog) },
    }
  }, [points])
  return null
}
