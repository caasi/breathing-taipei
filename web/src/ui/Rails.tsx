import { useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'
import { COVER, DASHED, rgb, strips } from './lines.ts'
import type { Transit } from './HeatMap.tsx'

// The look the SVG had, in map units, so a line grows with the zoom as an SVG stroke did: an MRT line is wider, a 台鐵
// line is dashed. Lines are for orientation, so they are faint and the eye follows the area colours.
const OPACITY = 0.35
const KINDS = ['mrt', 'lrt', 'tra', 'hsr'] as const
const STYLES = { mrt: { width: 1.8, dash: [0, 0] }, lrt: { width: 1.5, dash: [0, 0] }, tra: { width: 1.5, dash: [6, 3] }, hsr: { width: 1.5, dash: [0, 0] } }
// Segment values sit in a texture of this width, as one row of a texel per segment can be wider than a GPU allows.
const ROW = 1024

// The lines draw in the order of transit.json, as the SVG paths did: at 0.35 opacity, the order decides the colour
// where lines of two kinds overlap. So the style of each line is in its vertices, and a hidden kind is moved out of the
// view in the vertex shader instead of being a draw call left out.
const VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across; in float along; in vec3 colour; in float seg; in float width; in vec2 dashes;
in float kind;
uniform vec4 view; uniform vec2 devicePx; uniform float pxPerUnit; uniform float shown[${KINDS.length}]; uniform sampler2D segments;
out float d; out float s; out vec3 c; flat out float w; flat out vec2 dash;
void main() {
  w = width * pxPerUnit; dash = dashes;
  float reach = w * 0.5 + 1.0;
  d = across * reach; s = along;
  // A segment takes the colour of its texel by the share in alpha: 0 keeps the colour of its line.
  vec4 v = texelFetch(segments, ivec2(int(seg) % ${ROW}, int(seg) / ${ROW}), 0);
  c = mix(colour, v.rgb, v.a);
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = shown[int(kind)] > 0.0 ? vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1) : vec4(2, 2, 2, 1);
}`
const FS = `#version 300 es
precision highp float;
in float d; in float s; in vec3 c; flat in float w; flat in vec2 dash; uniform float pxPerUnit; out vec4 o;
${COVER}
${DASHED}
void main() {
  float a = ${OPACITY.toFixed(2)} * coverOf(d, w) * dashCover(s, dash, pxPerUnit);
  if (a <= 0.0) discard;
  o = vec4(c * a, a);
}`

type Props = {
  lines: Transit['lines']; proj: GeoProjection; show: Set<string>
  /**
   * RGBA for each segment, in the order of `lines` (an OSM way of transit.json each): the colour, and in alpha how much
   * of it replaces the colour of the line. Missing or 0 alpha keeps the look of the line. For the load of each segment
   * (issue #24); a segment of station to station needs ordered lines from scripts/transit.py first. The layer uploads
   * the texels when the array is another object: give a new array for a change, and the same one for no change.
   */
  segments?: Uint8Array
}

/** The rail lines, a layer of the map (GLMap.tsx) over the borders, one strip for each OSM way of transit.json. */
export function Rails({ lines, proj, show, segments }: Props) {
  const show$ = useRef(show), segments$ = useRef(segments)
  show$.current = show; segments$.current = segments
  useLayer(LAYER.rails, gl => {
    const prog = program(gl, VS, FS)
    const at = Object.fromEntries(['view', 'devicePx', 'pxPerUnit', 'shown', 'segments'].map(n => [n, gl.getUniformLocation(prog, n)]))
    const attrs = {
      xy: [] as number[], normal: [] as number[], across: [] as number[], along: [] as number[], colour: [] as number[],
      seg: [] as number[], width: [] as number[], dashes: [] as number[], kind: [] as number[],
    }
    lines.forEach((l, k) => {
      const kind = KINDS.indexOf(l.kind as typeof KINDS[number])
      if (kind < 0) return
      const style = STYLES[KINDS[kind]], q = strips([l.coords.flat()], proj, { gap: style.width / 2 }), c = rgb(l.colour)
      for (const name of ['xy', 'normal', 'across', 'along'] as const) attrs[name].push(...q[name])
      for (let i = 0; i < q.xy.length / 2; i++) {
        attrs.colour.push(...c); attrs.seg.push(k); attrs.width.push(style.width); attrs.dashes.push(...style.dash); attrs.kind.push(kind)
      }
    })
    const count = attrs.xy.length / 2
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = Object.entries(attrs).map(([name, data]) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, ['xy', 'normal', 'dashes'].includes(name) ? 2 : name === 'colour' ? 3 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    const rows = Math.max(1, Math.ceil(lines.length / ROW)), texels = new Uint8Array(ROW * rows * 4)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ROW, rows)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    let shown = '', uploaded: Uint8Array | undefined | null = null
    return {
      dirty: () => [...show$.current].sort().join() !== shown || segments$.current !== uploaded,
      draw: ({ view, clip, width, height, cssWidth }) => {
        const pxPerUnit = view.k * width / cssWidth
        gl.useProgram(prog); gl.bindVertexArray(vao); gl.enable(gl.BLEND)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (segments$.current !== uploaded) {
          texels.fill(0); if (segments$.current) texels.set(segments$.current.subarray(0, texels.length))
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RGBA, gl.UNSIGNED_BYTE, texels)
          uploaded = segments$.current
        }
        gl.uniform1i(at.segments, 0)
        gl.uniform4fv(at.view, clip); gl.uniform2f(at.devicePx, 2 / width, 2 / height); gl.uniform1f(at.pxPerUnit, pxPerUnit)
        gl.uniform1fv(at.shown, KINDS.map(k => show$.current.has(k) ? 1 : 0))
        gl.drawArrays(gl.TRIANGLES, 0, count)
        shown = [...show$.current].sort().join()
      },
      dispose: () => { buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(prog) },
    }
  }, [lines, proj])
  return null
}
