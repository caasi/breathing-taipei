import { useEffect, useRef } from 'react'

// ponytail: the 1% low and 1% top come from the frames of the last 10 s, a guess: long enough for a few slow frames at
// 60 fps (600 frames, the 6 slowest), short enough to show a change of speed or layer soon.
const WINDOW_MS = 10_000
// ponytail: by eye: two redraws a second are readable, and the size of the small notes of the page.
const REDRAW_MS = 500, FONT_PX = 12

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
    const c = canvas.current!, g = c.getContext('2d')!, font = `${FONT_PX}px ui-monospace, monospace`, h = FONT_PX + 4
    // The canvas is as wide as its text, so the layout (index.html .top-row) alone puts it left or right. The pixel ratio
    // is read at each redraw: browser zoom and another display change it.
    let w = 0, dpr = 0
    const frames: number[] = [], at: number[] = []
    // The time of an animation frame is the start of the frame, which can be before performance.now() of this effect.
    let raf = 0, last = -1, drawn = 0, start = 0
    const tick = (now: number) => {
      if (last >= 0) { frames.push(now - last); at.push(now) } else start = now
      last = now
      while (at[0] < now - WINDOW_MS) { at.shift(); frames.shift() }
      if (frames.length && now - drawn >= REDRAW_MS) {
        drawn = now
        // Frames a second, also in the first second after a start, when the window is shorter than a second.
        const recent = at.filter(t => t > now - 1000).length * 1000 / Math.max(1, Math.min(1000, now - start)), sorted = frames.slice().sort((a, b) => a - b)
        const sim = `SIM ${Math.min(999.9, simMs.current).toFixed(1).padStart(5, '0')}ms `, text = `${sim}  FPS ${fps(recent)} ↓${fps(tail(sorted, true))}↑${fps(tail(sorted, false))}`
        g.font = font
        const tw = Math.ceil(g.measureText(text).width) + 2
        // A new size clears the canvas and its state; it changes only when a figure gets another digit.
        if (tw !== w || devicePixelRatio !== dpr) { w = tw; dpr = devicePixelRatio; c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px` }
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
        g.font = font; g.fillStyle = '#ccc'; g.textBaseline = 'middle'
        g.fillText(text, 1, h / 2)
        // The separator is a line as tall as a figure: the bar of the font went below the line.
        const zero = g.measureText('0'), x = Math.round(1 + g.measureText(sim).width + g.measureText(' ').width / 2) + 0.5
        g.strokeStyle = '#666'; g.lineWidth = 1 // dimmer than the text, so it parts the figures without standing out
        g.beginPath(); g.moveTo(x, h / 2 - zero.actualBoundingBoxAscent); g.lineTo(x, h / 2 + zero.actualBoundingBoxDescent); g.stroke()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // No frame runs while the tab is hidden; the time hidden is not a frame, so the window starts again on return.
    const restart = () => { last = -1; frames.length = 0; at.length = 0 }
    document.addEventListener('visibilitychange', restart)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', restart) }
  }, [])
  // Empty until the first line; a canvas with no size is 300 x 150.
  return <canvas ref={canvas} aria-hidden width={0} height={0} style={{ display: 'block' }} />
}
