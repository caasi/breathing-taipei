/**
 * The share of the paths found while the run routes that the page draws as sparks (Sparks.tsx). The worker finds
 * thousands in a frame, so in practice the cap sets how many.
 */
export const SPARK_RATE = 0.008
/** At most this many in one frame of the worker. */
export const SPARK_CAP = 10

/**
 * A sample of the road paths found while the run routes: `offer` each one, and `take` the sample since the last take.
 * The draw uses its own random source, so the sample changes nothing in the run.
 */
export const sampler = (rate = SPARK_RATE, cap = SPARK_CAP, random = Math.random) => {
  // A reservoir: once it holds `cap`, a new one takes a place by chance, so the sample comes from all the paths of the
  // frame, not from the first ones (fill finds them source by source).
  let taken: Uint16Array[] = [], seen = 0
  return {
    offer: (path: Uint16Array) => {
      if (random() >= rate) return
      seen++
      if (taken.length < cap) taken.push(path)
      else { const j = Math.floor(random() * seen); if (j < cap) taken[j] = path }
    },
    take: () => { const t = taken; taken = []; seen = 0; return t },
  }
}

/** A sampled path for the page: its edge ids, and for each edge 1 when the path runs it from its end node to its start. */
export type SparkPath = { edges: Uint16Array; back: Uint8Array }

/**
 * The direction of each edge of a path, from the node it shares with the edge before it (for the first edge, with the
 * edge after it). The shapes of the edges do not meet (the graph snaps its nodes, the shapes do not), so the page cannot
 * tell the direction from them. A path of one edge is taken from its start.
 */
export const directions = (path: Uint16Array, ends: (e: number) => [number, number]): Uint8Array => {
  const back = new Uint8Array(path.length)
  let at = -1 // the node where the path is
  for (let k = 0; k < path.length; k++) {
    const [a, b] = ends(path[k])
    if (k === 0) {
      const next = path.length > 1 ? ends(path[1]) : undefined
      back[0] = next && (a === next[0] || a === next[1]) && b !== next[0] && b !== next[1] ? 1 : 0
    } else back[k] = at === b ? 1 : 0
    at = back[k] ? a : b
  }
  return back
}
