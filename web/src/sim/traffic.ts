import { where, now, ROAD, PLAY, GONE, type World } from './core.ts'
import { ROAD_MODES } from './paths.ts'
import type { GraphJson } from './route.ts'

// BPR (Bureau of Public Roads, 1964): time on a road = free time x (1 + ALPHA (volume / capacity)^BETA).
const ALPHA = 0.15, BETA = 4
// ponytail: one capacity for every cell, in people per km of road, fitted so that the morning peak of 台北市 has the
// TomTom congestion level (scripts/traffic.ts, DATA.md "Figures in the code"). Real roads differ in lanes.
export const CAPACITY = 54
// ponytail: the road load is taken over cells of CELL degrees (about 1 km) and the people per km of road in a cell stand
// in for the flow of BPR. Every trip takes one shortest path, so per edge only a few edges carried any load, with a
// travel time up to 25 times the free time; a cell spreads it over the roads nearby. Use flows per hour on each edge
// when trips get more than one path and edges get capacities of their own.
const CELL = 0.01
// ponytail: the travel time over free time at which the colour of a road is at its end (dark red); chosen by eye.
const SLOWEST = 1 / 0.3

/** The road path of each mover (by its index in w.movers) to work and to its day-off place, with cumulative metres. */
export type RoadUse = { work: (Uint16Array | undefined)[]; play: (Uint16Array | undefined)[]; cum: Map<Uint16Array, Float32Array> }

/** pathOf gives the edges from one node to another, or undefined when there is no road path (same road node, no route). */
export const roadUse = (w: World, pathOf: (from: number, to: number) => Uint16Array | undefined, metres: ArrayLike<number>): RoadUse => {
  const cum = new Map<Uint16Array, Float32Array>()
  const path = (from: number, to: number, mode: number) => {
    const es = ROAD_MODES.has(mode) ? pathOf(from, to) : undefined
    if (es && !cum.has(es)) { const c = new Float32Array(es.length); let s = 0; es.forEach((e, j) => (c[j] = s += metres[e])); cum.set(es, c) }
    return es
  }
  const work = Array.from(w.movers, i => path(w.home[i], w.work[i], w.mode[i]))
  const play = Array.from(w.movers, i => path(w.home[i], w.play[i], w.playMode[i]))
  return { work, play, cum }
}

/** Real people on each edge now: each road traveller is on the edge at its share of the trip. onRoad gets each traveller and its edge. */
export const loadNow = (w: World, use: RoadUse, out: Float32Array, onRoad?: (agent: number, edge: number) => void) => {
  out.fill(0)
  const t = now(w)
  for (let j = 0; j < w.movers.length; j++) {
    const i = w.movers[j]
    // A trip out of the two cities has no path on the map (its plan goes from home to home).
    if (w.dest[i] === GONE || where(w, i, t) !== ROAD) continue
    const es = w.dest[i] === PLAY ? use.play[j] : use.work[j]
    if (!es) continue
    const out1 = t < w.dep[i] + w.dur1[i], p = out1 ? (t - w.dep[i]) / w.dur1[i] : 1 - (t - w.ret[i]) / w.dur2[i]
    const c = use.cum.get(es)!, d = p * c[c.length - 1]
    let lo = 0, hi = c.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m + 1; else hi = m }
    out[es[lo]] += w.city.perAgent
    onRoad?.(i, es[lo])
  }
  return out
}

/** The cell of each edge (by the middle of its ends) and the km of road in each cell. */
export type Grid = { cellOf: Int32Array; km: Float64Array; keys: Int32Array }
/** The key of the cell that holds a point; the page finds the cell of a dot with it. */
export const cellKey = (lon: number, lat: number) => Math.floor(lon / CELL) * 100_000 + Math.floor(lat / CELL)
export const gridOf = (road: GraphJson): Grid => {
  const ids = new Map<number, number>()
  const cellOf = Int32Array.from(road.edges, ([a, b]) => {
    const k = cellKey((road.lon[a] + road.lon[b]) / 2, (road.lat[a] + road.lat[b]) / 2)
    return ids.get(k) ?? ids.set(k, ids.size).get(k)!
  })
  const km = new Float64Array(ids.size)
  road.edges.forEach(([, , m], e) => (km[cellOf[e]] += m / 1000))
  return { cellOf, km, keys: Int32Array.from(ids.keys()) }
}

/** People on the road of each cell. */
export const cellLoad = (load: ArrayLike<number>, grid: Grid) => {
  const out = new Float64Array(grid.km.length)
  for (let e = 0; e < load.length; e++) out[grid.cellOf[e]] += load[e]
  return out
}

/** Extra time over free flow, as a share of the free time, for `people` on `km` of road. */
export const extraTime = (people: number, km: number, capacity = CAPACITY) => ALPHA * (people / km / capacity) ** BETA

/** Per cell, 0 (free) to 255 (SLOWEST or slower). */
export const cellLevels = (load: ArrayLike<number>, grid: Grid, capacity = CAPACITY) =>
  Uint8Array.from(cellLoad(load, grid), (p, c) => Math.round(255 * Math.min(1, extraTime(p, grid.km[c], capacity) / (SLOWEST - 1))))

/**
 * Per edge: 0 for an edge with no traveller, else 1 + the level of its cell (cellLevels) on 1 to 255. The map draws
 * the flow only on roads in use, and the colour follows those roads and not the square of the cell.
 */
export const levels = (load: ArrayLike<number>, grid: Grid, cells: Uint8Array, out: Uint8Array) => {
  for (let e = 0; e < out.length; e++) out[e] = load[e] > 0 ? 1 + Math.round(cells[grid.cellOf[e]] * 254 / 255) : 0
  return out
}
