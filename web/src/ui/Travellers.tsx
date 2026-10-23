import { useEffect, useRef } from 'react'
import type { GeoProjection } from 'd3-geo'
import type { Trips } from '../sim/worker.ts'
import type { Batch } from '../sim/paths.ts'

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
export const addBatches = (tracks: (Track | undefined)[], batches: Batch[], proj: GeoProjection) => {
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
const DOT = 'rgba(255, 236, 214, 0.4)'

/** Dots for sampled commuters on the road, moving along their routed paths (trips not yet routed are not drawn). */
export function Travellers({ tracks, trips, clock, onFps, byMode }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = 640 * dpr; canvas.height = 640 * dpr
    ctx.scale(dpr, dpr)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = DOT
    let raf = 0, frames = 0, since = performance.now()
    const draw = () => {
      const m = clock()
      ctx.clearRect(0, 0, 640, 640)
      for (let k = 0; k < trips.home.length; k++) {
        const t = tracks.current[k]
        if (!t) continue
        let p: number
        if (m >= trips.dep[k] && m < trips.dep[k] + trips.dur1[k]) p = (m - trips.dep[k]) / trips.dur1[k]
        else if (m >= trips.ret[k] && m < trips.ret[k] + trips.dur2[k]) p = 1 - (m - trips.ret[k]) / trips.dur2[k]
        else continue
        const [x, y] = at(t, p)
        if (byMode) ctx.fillStyle = MODE_COLOURS[trips.mode[k]]
        ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
      }
      frames++
      const now = performance.now()
      if (now - since > 1000) { onFps(frames * 1000 / (now - since)); frames = 0; since = now }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [trips, byMode])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
