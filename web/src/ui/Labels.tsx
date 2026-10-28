import { useRef } from 'react'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'

/**
 * One line of text on the map, as the SVG had it: `xy` and `dy` in map units, `dy` down to the baseline; `middle` centres
 * the line on xy, `start` begins it there.
 */
export type Text = { xy: [number, number]; dy: number; text: string; style: keyof typeof STYLES; anchor: 'middle' | 'start'; alpha: number }

// The look of the SVG text, in map units: the size of the font and the width of the halo (an SVG stroke, under the fill,
// with the miter joins and the miter limit 4 of SVG).
// A style whose text has an opacity below 1 is drawn as whole lines, halo and fill in one cell, as the SVG faded the
// text as one; the others are drawn by character, so that a count that changes needs no new cell.
export const STYLES = {
  district: { size: 12, halo: '#211d1d', whole: false },
  station: { size: 11, halo: '#000000', whole: true },
} as const
// ponytail: one atlas, drawn again on each change of scale, for the 7 stations of transit.json and the district text;
// with many more names, check its height against MAX_TEXTURE_SIZE and draw it less often.
const HALO = 3, PAD = 2, ROW = 1024

const VS = `#version 300 es
in vec2 anchor; in vec2 offset; in vec2 uv; in float alpha;
uniform vec4 view; uniform vec2 size;
out vec2 t; out float a;
void main() {
  t = uv; a = alpha;
  // The anchor goes to a whole device pixel and the offset is whole device pixels (y down as on the screen), so each
  // texel of the atlas falls on one pixel: with LINEAR, a texel between two pixels blurs the glyph.
  vec2 p = floor((anchor * view.xy + view.zw + 1.0) * 0.5 * size + 0.5) + offset * vec2(1, -1);
  gl_Position = vec4(p / size * 2.0 - 1.0, 0, 1);
}`
const FS = `#version 300 es
precision highp float;
in vec2 t; in float a; uniform sampler2D atlas; out vec4 o;
void main() { o = texture(atlas, t) * a; }`

type Glyph = { u0: number; v0: number; u1: number; v1: number; left: number; top: number; w: number; h: number; advance: number }

/** The pieces of a text: whole lines for a style that is drawn whole, else its characters. */
export const piecesOf = (t: Pick<Text, 'text' | 'style'>) => STYLES[t.style].whole ? [t.text] : [...t.text]

/**
 * The cells of every piece in `need` (style and piece), drawn with canvas 2D at `px` device pixels to a map unit. A
 * character has two cells, its halo and its fill, so that a line draws all its halo and then all its fill, as an SVG
 * text with paint-order stroke does; a whole line has one cell with both.
 */
const atlasOf = (need: [keyof typeof STYLES, string][], px: number, family: string) => {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
  const cells: { key: string; draw: (c: CanvasRenderingContext2D, x: number, y: number) => void; w: number; h: number; left: number; top: number; advance: number }[] = []
  for (const [style, piece] of need) {
    const { size, halo, whole } = STYLES[style], font = `${size * px}px ${family}`, line = HALO * px
    ctx.font = font
    const m = ctx.measureText('國'), ascent = m.fontBoundingBoxAscent || size * px * 0.9, descent = m.fontBoundingBoxDescent || size * px * 0.25
    // A digit takes the width of the widest digit, centred in it, which gives the fixed width of CSS tabular-nums
    // (canvas 2D has no font-variant-numeric): a count that changes keeps its width, so a centred count does not move.
    const edge = PAD + line / 2, own = ctx.measureText(piece).width, digit = /^[0-9]$/.test(piece)
    const advance = digit ? Math.max(...[...'0123456789'].map(d => ctx.measureText(d).width)) : own
    const w = Math.ceil(own + 2 * edge), h = Math.ceil(ascent + descent + 2 * edge)
    const paint = (c: CanvasRenderingContext2D, x: number, y: number, parts: ('halo' | 'fill')[]) => {
      c.font = font; c.textBaseline = 'alphabetic'
      for (const part of parts) {
        if (part === 'halo') { c.lineWidth = line; c.miterLimit = 4; c.strokeStyle = halo; c.strokeText(piece, x + edge, y + edge + ascent) }
        else { c.fillStyle = '#fff'; c.fillText(piece, x + edge, y + edge + ascent) }
      }
    }
    for (const part of whole ? ['whole'] as const : ['halo', 'fill'] as const) cells.push({
      key: `${style} ${part} ${piece}`, w, h, left: -edge + (advance - own) / 2, top: -(edge + ascent), advance,
      draw: (c, x, y) => paint(c, x, y, part === 'whole' ? ['halo', 'fill'] : [part]),
    })
  }
  // Rows of cells, as wide as ROW.
  let x = 0, y = 0, rowH = 0
  const at = cells.map(cell => {
    if (x + cell.w > ROW) { x = 0; y += rowH; rowH = 0 }
    const p = { x, y }; x += cell.w; rowH = Math.max(rowH, cell.h)
    return p
  })
  canvas.width = ROW; canvas.height = Math.max(1, y + rowH)
  const glyphs = new Map<string, Glyph>()
  cells.forEach((cell, i) => {
    const { x, y } = at[i]
    cell.draw(ctx, x, y)
    glyphs.set(cell.key, {
      u0: x / canvas.width, v0: y / canvas.height, u1: (x + cell.w) / canvas.width, v1: (y + cell.h) / canvas.height,
      left: cell.left, top: cell.top, w: cell.w, h: cell.h, advance: cell.advance,
    })
  })
  return { canvas, glyphs }
}

/**
 * The text of the map (the district names and counts, the station names), a layer of the map (GLMap.tsx) over the roads.
 * A change of the texts, for example a count, rebuilds only a small vertex buffer. React still renders HeatMap, but no SVG
 * text changes or takes a new layout.
 */
export function Labels({ texts }: { texts: Text[] }) {
  const texts$ = useRef(texts)
  texts$.current = texts
  useLayer(LAYER.labels, gl => {
    const prog = program(gl, VS, FS)
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    // anchor 2, offset 2, uv 2, alpha 1
    const stride = 7 * 4
    for (const [name, size, off] of [['anchor', 2, 0], ['offset', 2, 2], ['uv', 2, 4], ['alpha', 1, 6]] as const) {
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4)
    }
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const viewAt = gl.getUniformLocation(prog, 'view'), sizeAt = gl.getUniformLocation(prog, 'size')
    const family = getComputedStyle(gl.canvas as HTMLCanvasElement).fontFamily
    let glyphs = new Map<string, Glyph>(), atlasKey = '', built = '', count = 0
    // The pieces only grow, and start with the digits and the comma of a count (a locale with other characters adds them
    // once), so a count or a hidden station adds no cell.
    const seen = new Set([...'0123456789,'].map(c => `district\u0000${c}`))
    const keyOf = (ts: Text[]) => ts.map(t => `${t.xy} ${t.dy} ${t.text} ${t.style} ${t.anchor} ${t.alpha}`).join('|')
    return {
      dirty: () => keyOf(texts$.current) !== built,
      draw: ({ view, clip, width, height, cssWidth }) => {
        const ts = texts$.current, px = view.k * width / cssWidth
        for (const t of ts) for (const piece of piecesOf(t)) seen.add(`${t.style}\u0000${piece}`)
        gl.useProgram(prog); gl.bindVertexArray(vao); gl.bindTexture(gl.TEXTURE_2D, texture); gl.enable(gl.BLEND)
        // The glyphs are drawn at the size of the screen, so a new size (a resize, another display) draws them again.
        const key = `${px} ${seen.size}`
        if (key !== atlasKey) {
          const atlas = atlasOf([...seen].map(n => n.split('\u0000') as [keyof typeof STYLES, string]), px, family)
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
          // A failed upload removes this layer, and the other layers upload with the default.
          try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas) }
          finally { gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false) }
          glyphs = atlas.glyphs; atlasKey = key; built = ''
        }
        const textKey = keyOf(ts)
        if (textKey !== built) {
          const data: number[] = []
          for (const t of ts) {
            const pieces = piecesOf(t), parts = STYLES[t.style].whole ? ['whole'] : ['halo', 'fill']
            const lineW = pieces.reduce((w, piece) => w + (glyphs.get(`${t.style} ${parts[0]} ${piece}`)?.advance ?? 0), 0)
            const anchor = [t.xy[0], t.xy[1] + t.dy]
            for (const part of parts) {
              let pen = t.anchor === 'middle' ? -lineW / 2 : 0
              for (const piece of pieces) {
                const g = glyphs.get(`${t.style} ${part} ${piece}`)
                if (!g) continue
                const x0 = Math.round(pen + g.left), y0 = Math.round(g.top), x1 = x0 + g.w, y1 = y0 + g.h
                for (const [x, y, u, v] of [[x0, y0, g.u0, g.v0], [x1, y0, g.u1, g.v0], [x1, y1, g.u1, g.v1], [x0, y0, g.u0, g.v0], [x1, y1, g.u1, g.v1], [x0, y1, g.u0, g.v1]])
                  data.push(anchor[0], anchor[1], x, y, u, v, t.alpha)
                pen += g.advance
              }
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW)
          count = data.length / 7; built = textKey
        }
        gl.uniform4fv(viewAt, clip); gl.uniform2f(sizeAt, width, height)
        gl.drawArrays(gl.TRIANGLES, 0, count)
      },
      dispose: () => { gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(prog) },
    }
  }, [])
  return null
}
