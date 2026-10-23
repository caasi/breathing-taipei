/** One population snapshot at a simulated time (minutes since the start). */
export type Entry = { t: number; counts: Uint32Array }

/**
 * Adds a snapshot and drops the ones older than the window, keeping one entry at or before
 * the start of the window so that, once a run is one window old, the change rate spans it. A snapshot at the same time as
 * the last one replaces it, so a paused clock does not grow the history.
 */
export const record = (history: Entry[], entry: Entry, window: number): Entry[] => {
  const h = history.length && history[history.length - 1].t === entry.t ? history.slice(0, -1) : history.slice()
  h.push(entry)
  while (h.length > 2 && h[1].t <= entry.t - window) h.shift()
  return h
}

/** The longest window the UI offers; the history always keeps this much, so a larger window works at once. */
export const KEEP = 120

/** The newest entry at least `window` minutes before the last one, or the oldest entry if none is that old. */
export const since = (history: Entry[], window: number): Entry => {
  const now = history[history.length - 1].t
  let from = history[0]
  for (const e of history) if (e.t <= now - window) from = e
  return from
}
