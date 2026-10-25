// The fixed timestep of a game loop ("Fix Your Timestep", Glenn Fiedler). The clock is real time times the speed; the
// model follows it in whole steps of one frame at that speed. A slow device makes more than one step in a callback, so
// the run keeps its speed setting. The worker and the page compute the clock with the same functions, so the clock
// that the page shows does not go back when a message comes.
export const FPS = 30
export const FRAME_MS = 1000 / FPS
// A longer gap (a tab back from the background) counts as this many frames, so the clock does not jump hours.
// ponytail: so a device with callbacks more than 133 ms apart (below 7.5 fps) runs slower than its speed setting, at
// 133 ms of each gap. Raise the cap if such devices matter; the clock of a stalled page then jumps further.
export const MAX_FRAMES = 4
// A new run starts when the page has drawn its first frame. If that does not come by this time after the start (an
// error, or a first load of more than this time on a slow network), the run starts anyway: the clock then moves
// before the map shows, up to the cap.
export const READY_MS = 5000

/** The clock shows `minute` (since 00:00 of day 0) at `at` (ms, as performance.now()) and moves `perMs` minutes a ms. */
export type Clock = { minute: number; at: number; perMs: number }

export const clockAt = (c: Clock, now: number) => c.minute + Math.min(Math.max(0, now - c.at), MAX_FRAMES * FRAME_MS) * c.perMs

/**
 * Sets `c` to the clock from a change of speed (or a new run) at `at`. The model never goes back, so a clock behind
 * it moves up to it; the page and the worker both use this, so they agree.
 */
export const respeed = (c: Clock, minute: number, model: number, at: number, perMs: number) => {
  c.minute = Math.max(minute, model); c.at = at; c.perMs = perMs
}

/**
 * The steps of `step` minutes that bring the model closest to the clock. Rounded, so a timer up to half a frame early
 * or late still gives one step, as a fixed step for each callback did. At most MAX_FRAMES + 1: the cap, plus the one
 * that the rounding can add. A clock further ahead (several changes of speed with no callback between them, each with
 * a new cap) is made up over the next callbacks, so one callback does not stall the run.
 */
export const stepsTo = (clock: number, model: number, step: number) =>
  step > 0 ? Math.min(MAX_FRAMES + 1, Math.max(0, Math.round((clock - model) / step))) : 0
