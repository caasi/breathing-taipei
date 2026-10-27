import { useEffect, useRef } from 'react'

// ponytail: the 1% low and 1% top come from the frames of the last 10 s, a guess: long enough for a few slow frames at
// 60 fps (600 frames, the 6 slowest), short enough to show a change of speed or layer soon.
const WINDOW_MS = 10_000, REDRAW_MS = 500, FONT_PX = 12

// Zero-padded to 2 digits (SIM to 000.0), so the line does not move as the figures change.
const fps = (n: number) => String(Math.min(999, Math.round(n))).padStart(2, '0')
// The fps of the mean frame of the slowest (or fastest) 1% of the frames, at least one.
export const tail = (sorted: number[], slow: boolean) => {
  const k = Math.max(1, Math.round(sorted.length / 100)), part = slow ? sorted.slice(-k) : sorted.slice(0, k)
  return 1000 / (part.reduce((a, b) => a + b, 0) / k)
}

/**
 * The time of the model in one frame of the worker and the frame rate of the page, drawn on a canvas so that the text
 * changes without a render of React. It counts its own animation frames, so it goes on when the dots are hidden, and
 * costs nothing when it is not shown.
 */
export function Metrics({ ms }: { ms: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), simMs = useRef(ms)
  simMs.current = ms
  useEffect(() => {
    const c = canvas.current!, g = c.getContext('2d')!, dpr = devicePixelRatio, font = `${FONT_PX}px ui-monospace, monospace`
    g.font = font
    // Wide enough for the longest line; the text is drawn from the right, so it keeps its right edge.
    const w = Math.ceil(g.measureText('SIM 999.9ms · FPS 999 ↓999↑999').width) + 2
    c.width = w * dpr; c.height = (FONT_PX + 4) * dpr; c.style.width = `${w}px`; c.style.height = `${FONT_PX + 4}px`
    const frames: number[] = [], at: number[] = []
    // The time of an animation frame is the start of the frame, which can be before performance.now() of this effect.
    let raf = 0, last = -1, drawn = 0
    const tick = (now: number) => {
      if (last >= 0) { frames.push(now - last); at.push(now) }
      last = now
      while (at[0] < now - WINDOW_MS) { at.shift(); frames.shift() }
      if (frames.length && now - drawn >= REDRAW_MS) {
        drawn = now
        const recent = at.filter(t => t > now - 1000).length, sorted = frames.slice().sort((a, b) => a - b)
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, FONT_PX + 4)
        g.font = font; g.fillStyle = '#ccc'; g.textBaseline = 'top'; g.textAlign = 'right'
        g.fillText(`SIM ${Math.min(999.9, simMs.current).toFixed(1).padStart(5, '0')}ms · FPS ${fps(recent)} ↓${fps(tail(sorted, true))}↑${fps(tail(sorted, false))}`, w - 1, 2)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={canvas} aria-hidden style={{ display: 'block' }} />
}
