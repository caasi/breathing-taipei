import { useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import type { Trips } from '../sim/worker.ts'
import type { Batch } from '../sim/paths.ts'
import { fit, program, useWebGL2 } from './gl.ts'

// Mode colours, in MODES order (捷運, 公車, 機車, 汽車, 步行, 自行車); kept apart from the 洋流橘 heat scale.
export const MODE_COLOURS = ['#f5f0e8', '#7ec8a5', '#ffd166', '#9ad0ff', '#c9a7ff', '#a0e060']

/** A trip's path in screen space with cumulative lengths, for placing a dot at any progress. */
export type Track = { xy: Float32Array; len: Float32Array }
export const track = (pts: Float32Array, proj: GeoProjection): Track => {
  const n = pts.length / 2, xy = new Float32Array(pts.length), len = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y] = proj([pts[2 * i], pts[2 * i + 1]])!
    xy[2 * i] = x; xy[2 * i + 1] = y
    if (i) len[i] = len[i - 1] + Math.hypot(x - xy[2 * i - 2], y - xy[2 * i - 1])
  }
  return { xy, len }
}
// Counts routed batches, so a paused view still redraws when new paths arrive.
let routedBatches = 0
export const addBatches = (tracks: (Track | undefined)[], batches: Batch[], proj: GeoProjection) => {
  routedBatches += batches.length
  for (const b of batches) b.ks.forEach((k, i) => (tracks[k] = track(b.pts.subarray(b.off[i], b.off[i + 1]), proj)))
}

const at = (t: Track, p: number): [number, number] => {
  const d = p * t.len[t.len.length - 1]
  let lo = 0, hi = t.len.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.len[mid] <= d) lo = mid; else hi = mid }
  const seg = t.len[hi] - t.len[lo], f = seg ? (d - t.len[lo]) / seg : 0
  return [t.xy[2 * lo] + (t.xy[2 * hi] - t.xy[2 * lo]) * f, t.xy[2 * lo + 1] + (t.xy[2 * hi + 1] - t.xy[2 * lo + 1]) * f]
}

type Props = { tracks: React.MutableRefObject<(Track | undefined)[]>; trips: Trips; clock: () => number; onFps: (fps: number) => void; byMode: boolean }

// The area colour carries the story; dots stay faint and add up (additive blending) so only busy lines glow.
const DOT = [1, 236 / 255, 214 / 255, 0.4]
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

const VS = `#version 300 es
in vec2 xy; in float mode;
uniform vec3 palette[6]; uniform bool byMode; uniform vec4 dot; uniform float size; uniform float gain;
out vec4 c;
void main() {
  c = byMode ? vec4(palette[int(mode)], gain) : vec4(dot.rgb, dot.a * gain);
  gl_PointSize = size;
  gl_Position = vec4(xy.x / 320.0 - 1.0, 1.0 - xy.y / 320.0, 0, 1);
}`
const FS = `#version 300 es
precision mediump float;
in vec4 c; out vec4 o;
void main() { o = c; }`

/**
 * Dots for sampled agents on the road, moving along their routed paths (trips not yet routed are not drawn).
 * The CPU finds each dot's position; WebGL draws them all in one call, because a fillRect per dot was the
 * main cost of the page once the fills moved to WebGL.
 */
export function Travellers({ tracks, trips, clock, onFps, byMode }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const mode$ = useRef(byMode)
  mode$.current = byMode
  useWebGL2(ref, { antialias: false }, (gl, canvas) => {
    const prog = program(gl, VS, FS)
    gl.useProgram(prog)
    gl.uniform3fv(gl.getUniformLocation(prog, 'palette'), MODE_COLOURS.flatMap(rgb))
    gl.uniform4fv(gl.getUniformLocation(prog, 'dot'), DOT)
    const size = gl.getUniformLocation(prog, 'size'), gain = gl.getUniformLocation(prog, 'gain'), byModeAt = gl.getUniformLocation(prog, 'byMode')
    // Colour adds up; alpha adds up too, so the canvas holds premultiplied colour like 'lighter' did.
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE)
    const n = trips.home.length, xy = new Float32Array(2 * n), mode = new Float32Array(n)
    const buffer = (name: string, data: Float32Array, width: number) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW)
      const at = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, width, gl.FLOAT, false, 0, 0)
      return b
    }
    const xyBuffer = buffer('xy', xy, 2), modeBuffer = buffer('mode', mode, 1)
    let raf = 0, frames = 0, since = performance.now(), drawn = ''
    const draw = () => {
      raf = requestAnimationFrame(draw)
      frames++
      const now = performance.now()
      if (now - since > 1000) { onFps(frames * 1000 / (now - since)); frames = 0; since = now }
      const m = clock(), w = fit(gl, canvas), key = `${m} ${w} ${mode$.current} ${routedBatches}`
      // A paused clock with nothing new draws nothing; the canvas keeps the last picture.
      if (key === drawn) return
      drawn = key
      let count = 0
      for (let k = 0; k < n; k++) {
        const t = tracks.current[k]
        if (!t) continue
        let p: number
        if (m >= trips.dep[k] && m < trips.dep[k] + trips.dur1[k]) p = (m - trips.dep[k]) / trips.dur1[k]
        else if (m >= trips.ret[k] && m < trips.ret[k] + trips.dur2[k]) p = 1 - (m - trips.ret[k]) / trips.dur2[k]
        else continue
        const [x, y] = at(t, p)
        xy[2 * count] = x; xy[2 * count + 1] = y; mode[count] = trips.mode[k]; count++
      }
      // A whole number of device pixels: a fractional size covers 1 or 2 pixels by position, and moving dots flicker.
      // Rounded up and the alpha scaled down by the area gained, so the glow stays that of a 1.5-unit dot.
      const ideal = 1.5 * w / 640, whole = Math.max(1, Math.ceil(ideal))
      gl.uniform1f(size, whole); gl.uniform1f(gain, (ideal / whole) ** 2) // at most 1: the GPU would clamp a larger alpha
      gl.uniform1i(byModeAt, mode$.current ? 1 : 0)
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      // A length of 0 would upload the whole array (WebGL2 reads 0 as "to the end").
      if (count) {
        gl.bindBuffer(gl.ARRAY_BUFFER, xyBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, xy, 0, 2 * count)
        gl.bindBuffer(gl.ARRAY_BUFFER, modeBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, mode, 0, count)
        gl.drawArrays(gl.POINTS, 0, count)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); gl.deleteBuffer(xyBuffer); gl.deleteBuffer(modeBuffer); gl.deleteProgram(prog) }
  }, [trips])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
