// The fixed timestep of a game loop ("Fix Your Timestep", Glenn Fiedler): the real time between callbacks goes into an
// accumulator, and the model moves in whole frames of it. A slow device makes more than one step in a callback, so the
// run keeps its speed setting.
export const MAX_FRAMES = 4 // a longer gap (a tab back from the background) is dropped, so the clock does not jump hours

/** Gives the number of frames to step for each callback at the time `now` (ms, as performance.now()). */
export const pacer = (frameMs: number, start: number) => {
  // Half a frame to start with: a timer up to half a frame early or late still gives one step, as a fixed step did.
  // A callback of 0 steps would show the same minute two times, and the extrapolated clock of the page would go back.
  let last = start, acc = frameMs / 2
  return (now: number) => {
    acc += now - last
    last = now
    const n = Math.floor(acc / frameMs)
    if (n > MAX_FRAMES) { acc = frameMs / 2; return MAX_FRAMES }
    acc -= n * frameMs
    return n
  }
}
