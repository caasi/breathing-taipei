// The fixed timestep of a game loop ("Fix Your Timestep", Glenn Fiedler). The clock is real time times the speed; the
// model follows it in whole steps of one frame at that speed. A slow device makes more than one step in a callback, so
// the run keeps its speed setting. The worker and the page compute the clock with the same functions, so the clock
// that the page shows does not go back when a message comes.
export const FPS = 30
export const FRAME_MS = 1000 / FPS
// A longer gap (a tab back from the background) counts as this many frames, so the clock does not jump hours.
export const MAX_FRAMES = 4

/** The clock shows `minute` (since 00:00 of day 0) at `at` (ms, as performance.now()) and moves `perMs` minutes a ms. */
export type Clock = { minute: number; at: number; perMs: number }

export const clockAt = (c: Clock, now: number) => c.minute + Math.min(Math.max(0, now - c.at), MAX_FRAMES * FRAME_MS) * c.perMs

/**
 * The clock from a change of speed at `at`. The model never goes back, so a clock behind it moves up to it; the
 * page and the worker both use this, so they agree.
 */
export const respeed = (minute: number, model: number, at: number, perMs: number): Clock => ({ minute: Math.max(minute, model), at, perMs })

/**
 * The steps of `step` minutes that bring the model closest to the clock. Rounded, so a timer up to half a frame early
 * or late still gives one step, as a fixed step for each callback did.
 */
export const stepsTo = (clock: number, model: number, step: number) => (step > 0 ? Math.max(0, Math.round((clock - model) / step)) : 0)
