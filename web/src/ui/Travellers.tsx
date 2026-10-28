import { useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import type { Trips } from '../sim/worker.ts'
import { GONE, PLAY } from '../sim/core.ts'
import { ROAD_MODES, type Batch } from '../sim/paths.ts'
import { cellKey } from '../sim/traffic.ts'
import { RAMP } from './Traffic.tsx'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'

// Mode colours, in MODES order (捷運, 公車, 機車, 汽車, 步行, 自行車); kept apart from the 洋流橘 heat scale.
export const MODE_COLOURS = ['#f5f0e8', '#7ec8a5', '#ffd166', '#9ad0ff', '#c9a7ff', '#a0e060']

/** A trip's path in map space with cumulative lengths, for placing a dot at any progress, and the traffic cell of each point. */
export type Track = { xy: Float32Array; len: Float32Array; cell: Int32Array }
export const track = (pts: Float32Array, proj: GeoProjection): Track => {
  const n = pts.length / 2, xy = new Float32Array(pts.length), len = new Float32Array(n), cell = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y] = proj([pts[2 * i], pts[2 * i + 1]])!
    // A dot shows the slowest road of its cell (traffic.ts cellMax).
    xy[2 * i] = x; xy[2 * i + 1] = y; cell[i] = cellKey(pts[2 * i], pts[2 * i + 1])
    if (i) len[i] = len[i - 1] + Math.hypot(x - xy[2 * i - 2], y - xy[2 * i - 1])
  }
  return { xy, len, cell }
}
// Counts routed batches, so a paused view still redraws when new paths arrive.
let routedBatches = 0
export const addBatches = (tracks: (Track | undefined)[], batches: Batch[], proj: GeoProjection) => {
  routedBatches += batches.length
  for (const b of batches) b.ks.forEach((k, i) => (tracks[k] = track(b.pts.subarray(b.off[i], b.off[i + 1]), proj)))
}

/** The point at progress p, and the index of the point of the path before it. */
const at = (t: Track, p: number): [number, number, number] => {
  const d = p * t.len[t.len.length - 1]
  let lo = 0, hi = t.len.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.len[mid] <= d) lo = mid; else hi = mid }
  const seg = t.len[hi] - t.len[lo], f = seg ? (d - t.len[lo]) / seg : 0
  return [t.xy[2 * lo] + (t.xy[2 * hi] - t.xy[2 * lo]) * f, t.xy[2 * lo + 1] + (t.xy[2 * hi + 1] - t.xy[2 * lo + 1]) * f, lo]
}

/** The slowness of each traffic cell (0 to 255), by the key of the cell; undefined when the traffic layer is off. */
export type CellTraffic = { index: Map<number, number>; level: Uint8Array }
type Props = { tracks: React.MutableRefObject<(Track | undefined)[]>; trips: Trips; clock: () => number; byMode: boolean
  traffic: React.MutableRefObject<CellTraffic | undefined> }

// The area colour carries the story; dots stay faint and add up (additive blending) so only busy lines glow. They add
// onto the map itself, as the author chose: where many dots meet, the map under them is not darkened first, as it was
// when the dots had a canvas of their own.
const DOT = [1, 236 / 255, 214 / 255, 0.4]
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

const VS = `#version 300 es
in vec2 xy; in float mode; in float slow;
uniform vec3 palette[6]; uniform bool byMode; uniform vec4 dot; uniform float size; uniform float gain; uniform vec4 view;
out vec4 c;
${RAMP}
void main() {
  c = byMode ? vec4(palette[int(mode)], gain) : vec4(dot.rgb, dot.a * gain);
  // A dot on a slow road takes the colour of the traffic layer, so the jam shows on the dots as well. ponytail: it takes
  // the full colour at the orange stop (AT[1]), chosen by eye.
  vec4 r = ramp(slow);
  if (slow > 0.0) c = mix(c, vec4(r.rgb, r.a * gain), smoothstep(0.0, AT[1], slow));
  gl_PointSize = size;
  // Not on the pixel grid: the map has multisampling on, so a dot between pixels covers parts of them, and a moving dot
  // glides instead of stepping by whole pixels, as the author chose on the dev server.
  gl_Position = vec4(xy * view.xy + view.zw, 0, 1);
}`
const FS = `#version 300 es
precision mediump float;
in vec4 c; out vec4 o;
void main() { o = c; }`

/**
 * Dots for sampled agents on the road, moving along their routed paths (trips not yet routed are not drawn), a layer of
 * the map (GLMap.tsx) under the text. The CPU finds each dot's position; WebGL draws them all in one call, because a
 * fillRect per dot was the main cost of the page once the fills moved to WebGL. While the clock runs, the layer is dirty
 * in each frame, so the map draws all its layers in each frame.
 */
export function Travellers({ tracks, trips, clock, byMode, traffic }: Props) {
  const mode$ = useRef(byMode)
  mode$.current = byMode
  useLayer(LAYER.dots, gl => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    gl.uniform3fv(gl.getUniformLocation(prog, 'palette'), MODE_COLOURS.flatMap(rgb))
    gl.uniform4fv(gl.getUniformLocation(prog, 'dot'), DOT)
    const size = gl.getUniformLocation(prog, 'size'), gain = gl.getUniformLocation(prog, 'gain'), byModeAt = gl.getUniformLocation(prog, 'byMode'), viewAt = gl.getUniformLocation(prog, 'view')
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const n = trips.home.length, xy = new Float32Array(2 * n), mode = new Float32Array(n), slow = new Float32Array(n)
    const buffer = (name: string, data: Float32Array, width: number) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW)
      const at = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, width, gl.FLOAT, false, 0, 0)
      return b
    }
    const xyBuffer = buffer('xy', xy, 2), modeBuffer = buffer('mode', mode, 1), slowBuffer = buffer('slow', slow, 1)
    // The levels arrive as a new array; a new one counts as a change, so a paused map still recolours its dots. The map
    // draws again for the view and the size by itself.
    let drawn = '', levels: Uint8Array | undefined, turn = 0
    const keyOf = (m: number) => {
      const cells = traffic.current
      if (cells?.level !== levels) { levels = cells?.level; turn++ }
      return `${m} ${mode$.current} ${routedBatches} ${turn}`
    }
    return {
      // A paused clock with nothing new is not dirty.
      dirty: () => keyOf(clock()) !== drawn,
      draw: ({ view: v, clip, width, cssWidth }) => {
        // One reading of the clock, for the key and for the positions.
        const m = clock(), cells = traffic.current
        drawn = keyOf(m)
        let count = 0
        for (let k = 0; k < n; k++) {
          // A trip out of the city has no path on the map, so it draws no dot.
          const play = trips.dest[k] === PLAY, there = trips.dest[k] === GONE ? undefined : tracks.current[play ? n + k : k]
          if (!there) continue
          // Home along its own path when it has one (a one-way road), else along the way there backwards.
          let p: number, t = there, reversed = false
          if (m >= trips.dep[k] && m < trips.dep[k] + trips.dur1[k]) p = (m - trips.dep[k]) / trips.dur1[k]
          else if (m >= trips.ret[k] && m < trips.ret[k] + trips.dur2[k]) {
            const back = tracks.current[(play ? 3 : 2) * n + k]
            p = (m - trips.ret[k]) / trips.dur2[k]
            if (back) t = back; else { p = 1 - p; reversed = true }
          }
          else continue
          // The cell of the last point passed: on a track run backwards, the point after the one that `at` gives.
          const [x, y, lo] = at(t, p), i = reversed ? Math.min(lo + 1, t.cell.length - 1) : lo
          const md = play ? trips.playMode[k] : trips.mode[k], c = cells && ROAD_MODES.has(md) ? cells.index.get(t.cell[i]) : undefined
          xy[2 * count] = x; xy[2 * count + 1] = y; mode[count] = md; slow[count] = c === undefined ? 0 : cells!.level[c] / 255; count++
        }
        // A whole number of device pixels, as the dots had on their own canvas, where a fractional size flickered with no
        // multisampling; kept so the dots keep their size.
        // Rounded up and the alpha scaled down by the area gained, so the glow stays that of a 1.5-unit dot.
        const ideal = 1.5 * v.k * width / cssWidth, whole = Math.max(1, Math.ceil(ideal))
        gl.useProgram(prog); gl.bindVertexArray(vao)
        gl.uniform1f(size, whole); gl.uniform1f(gain, (ideal / whole) ** 2) // at most 1: the GPU would clamp a larger alpha
        gl.uniform4fv(viewAt, clip)
        gl.uniform1i(byModeAt, mode$.current ? 1 : 0)
        // Colour and alpha add up onto the map.
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE)
        // A length of 0 would upload the whole array (WebGL2 reads 0 as "to the end").
        if (count) {
          gl.bindBuffer(gl.ARRAY_BUFFER, xyBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, xy, 0, 2 * count)
          gl.bindBuffer(gl.ARRAY_BUFFER, modeBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, mode, 0, count)
          gl.bindBuffer(gl.ARRAY_BUFFER, slowBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, slow, 0, count)
          gl.drawArrays(gl.POINTS, 0, count)
        }
      },
      dispose: () => { gl.deleteBuffer(xyBuffer); gl.deleteBuffer(modeBuffer); gl.deleteBuffer(slowBuffer); gl.deleteVertexArray(vao); gl.deleteProgram(prog) },
    }
  }, [trips])
  return null
}
