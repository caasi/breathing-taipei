import type { GeoProjection } from 'd3-geo'
import type { Geometry } from 'geojson'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'
import { triangles } from './Fills.tsx'
import { LINE_FS, LINE_VS } from './Borders.tsx'
import { strips } from './lines.ts'

// The look of the SVG it replaces: the counties in the colour of the land, and the borders between them white at 0.12,
// 1 map unit wide.
const BORDER = { opacity: 0.12, width: 1 }

const VS = `#version 300 es
in vec2 xy; uniform vec4 view;
void main() { gl_Position = vec4(xy * view.xy + view.zw, 0, 1); }`
const FS = `#version 300 es
precision mediump float;
uniform vec3 colour; out vec4 o;
void main() { o = vec4(colour, 1); }`

type Props = { counties: { geometry: Geometry }[]; borders: number[][]; colour: number[]; proj: GeoProjection }

/**
 * The land of Taiwan, the lowest layer of the map (GLMap.tsx), under the fills. It shows from the first frame: while the
 * map loads it is blurred with the map, but not faded. `colour` is RGB, 0 to 255; `borders` are lines (lon, lat, ...).
 */
export function Land({ counties, borders, colour, proj }: Props) {
  useLayer(LAYER.land, gl => {
    const fill = program(gl, VS, FS), line = program(gl, LINE_VS, LINE_FS)
    const fillAt = { view: gl.getUniformLocation(fill, 'view'), colour: gl.getUniformLocation(fill, 'colour') }
    const lineAt = Object.fromEntries(['view', 'devicePx', 'pxPerUnit', 'w', 'colour', 'dash'].map(n => [n, gl.getUniformLocation(line, n)]))
    const { xy } = triangles(counties, proj)
    const fillVao = gl.createVertexArray(); gl.bindVertexArray(fillVao)
    const fillBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer); gl.bufferData(gl.ARRAY_BUFFER, xy, gl.STATIC_DRAW)
    const xyAt = gl.getAttribLocation(fill, 'xy'); gl.enableVertexAttribArray(xyAt); gl.vertexAttribPointer(xyAt, 2, gl.FLOAT, false, 0, 0)
    const strip = strips(borders, proj, { gap: BORDER.width / 2 })
    const lineVao = gl.createVertexArray(); gl.bindVertexArray(lineVao)
    const lineBuffers = (['xy', 'normal', 'across', 'along'] as const).map(name => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, strip[name], gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(line, name); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, name === 'xy' || name === 'normal' ? 2 : 1, gl.FLOAT, false, 0, 0)
      return b
    })
    return {
      dirty: () => false,
      draw: ({ view, clip, width, height, cssWidth }) => {
        gl.useProgram(fill); gl.bindVertexArray(fillVao)
        gl.uniform4fv(fillAt.view, clip); gl.uniform3f(fillAt.colour, colour[0] / 255, colour[1] / 255, colour[2] / 255)
        gl.drawArrays(gl.TRIANGLES, 0, xy.length / 2)
        const pxPerUnit = view.k * width / cssWidth
        gl.useProgram(line); gl.bindVertexArray(lineVao); gl.enable(gl.BLEND)
        gl.uniform4fv(lineAt.view, clip); gl.uniform2f(lineAt.devicePx, 2 / width, 2 / height)
        gl.uniform1f(lineAt.pxPerUnit, pxPerUnit); gl.uniform1f(lineAt.w, BORDER.width * pxPerUnit)
        gl.uniform4f(lineAt.colour, 1, 1, 1, BORDER.opacity); gl.uniform2f(lineAt.dash, 0, 0)
        gl.drawArrays(gl.TRIANGLES, 0, strip.xy.length / 2)
      },
      dispose: () => {
        [fillBuffer, ...lineBuffers].forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(fillVao); gl.deleteVertexArray(lineVao)
        gl.deleteProgram(fill); gl.deleteProgram(line)
      },
    }
  }, [counties, borders, colour, proj])
  return null
}
