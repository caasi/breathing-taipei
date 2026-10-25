// The fixed timestep of a game loop ("Fix Your Timestep", Glenn Fiedler): the real time between callbacks goes into an
// accumulator, and the model moves in whole frames of it. A slow device makes more than one step in a callback, so the
// run keeps its speed setting.
export const FPS = 30
export const FRAME_MS = 1000 / FPS
// A longer gap (a tab back from the background) counts as this many frames, so the clock does not jump hours.
// The page caps its clock at the same gap; with a different cap the clock of the page would go back.
export const MAX_FRAMES = 4

/**
 * Gives the frames to step for each callback at the time `now` (ms, as performance.now()), and the lead: the part of a
 * frame that the accumulator still holds, from -0.5 to 0.5. Steps plus lead is the real time since `start` in frames.
 */
export const pacer = (start: number) => {
  // Half a frame to start with: a timer up to half a frame early or late still gives one step, as a fixed step did.
  let last = start, acc = FRAME_MS / 2
  return (now: number) => {
    acc += Math.min(now - last, MAX_FRAMES * FRAME_MS)
    last = now
    const steps = Math.floor(acc / FRAME_MS)
    acc -= steps * FRAME_MS
    return { steps, lead: acc / FRAME_MS - 0.5 }
  }
}

/**
 * The clock of the page: the minute of the last message (with its lead), moved on by the real time since its callback.
 * It moves at most as far as the pacer would count, so the next message does not take it back.
 */
export const clockAt = (minute: number, at: number, minutesPerMs: number, now: number) =>
  minute + Math.min(Math.max(0, now - at), MAX_FRAMES * FRAME_MS) * minutesPerMs
