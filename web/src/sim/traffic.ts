import { where, now, ROAD, PLAY, GONE, type World } from './core.ts'
import { ROAD_MODES, VARIANTS } from './paths.ts'
import { FASTER, type GraphJson } from './route.ts'

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
// ponytail: the share of drivers and bus riders who follow the live traffic (a map app) when they leave; the others take
// their usual, fastest route. A guess. A scooter always takes the streets-only variant.
const NAV = 0.6, SCOOTER = 2

/**
 * The road paths of each mover j (its index in w.movers), with cumulative metres: path (2j + leg) x VARIANTS + v is the
 * variant v (paths.ts) of its trip to work (leg 0) or to its day-off place (leg 1); a variant that the routes do not
 * hold repeats variant 0. pick and since: the variant of the trip under way, and the minute that trip started.
 */
export type RoadUse = { paths: (Uint16Array | undefined)[]; cum: Map<Uint16Array, Float32Array>; pick: Int8Array; since: Int32Array }

/** pathOf gives the edges of a variant from one node to another, or undefined when the routes do not hold it. */
export const roadUse = (w: World, pathOf: (from: number, to: number, variant: number) => Uint16Array | undefined, metres: ArrayLike<number>): RoadUse => {
  const cum = new Map<Uint16Array, Float32Array>(), n = w.movers.length, paths: (Uint16Array | undefined)[] = new Array(2 * n * VARIANTS)
  const add = (es: Uint16Array) => { if (!cum.has(es)) { const c = new Float32Array(es.length); let s = 0; es.forEach((e, j) => (c[j] = s += metres[e])); cum.set(es, c) } }
  w.movers.forEach((i, j) => [[w.work[i], w.mode[i]], [w.play[i], w.playMode[i]]].forEach(([to, mode], leg) => {
    if (!ROAD_MODES.has(mode)) return
    const first = pathOf(w.home[i], to, 0)
    for (let v = 0; v < VARIANTS; v++) {
      const es = (v ? pathOf(w.home[i], to, v) : undefined) ?? first
      if (es) { add(es); paths[(2 * j + leg) * VARIANTS + v] = es }
    }
  }))
  return { paths, cum, pick: new Int8Array(n), since: new Int32Array(n).fill(-(2 ** 31)) }
}

/** What a driver who follows the live traffic weighs a path by: the free time of each edge, and the slowness of its bucket. */
export type Live = { grid: Grid; time: Float64Array; slower: Float64Array }
export const liveOf = (road: GraphJson, grid: Grid): Live => ({
  grid, time: Float64Array.from(road.edges, ([, , m, , cls = 0]) => m / FASTER[cls]), slower: new Float64Array(grid.km.length).fill(1),
})

const choose = (w: World, use: RoadUse, i: number, base: number, mode: number, live?: Live) => {
  if (mode === SCOOTER) return 1
  // Its own hash, apart from the temper of the jam events (worker.ts).
  if (!live || (Math.imul(i + 1, 2246822519) >>> 0) / 2 ** 32 >= NAV) return 0
  let best = 0, least = Infinity
  for (let v = 0; v < VARIANTS; v++) {
    const es = use.paths[base + v]
    if (!es) continue
    let cost = 0
    for (let k = 0; k < es.length; k++) cost += live.time[es[k]] * live.slower[live.grid.cellOf[es[k]]]
    if (cost < least) { least = cost; best = v }
  }
  return best
}

/**
 * Real people on each edge now: each road traveller is on the edge at its share of the trip. A trip takes its variant
 * when it is first seen on the road, by the slowness of `live` then. onRoad gets each traveller and its edge.
 */
export const loadNow = (w: World, use: RoadUse, out: Float32Array, onRoad?: (agent: number, edge: number) => void, live?: Live) => {
  out.fill(0)
  const t = now(w)
  for (let j = 0; j < w.movers.length; j++) {
    const i = w.movers[j]
    // A trip out of the two cities has no path on the map (its plan goes from home to home).
    if (w.dest[i] === GONE || where(w, i, t) !== ROAD) continue
    const out1 = t < w.dep[i] + w.dur1[i], start = out1 ? w.dep[i] : w.ret[i], leg = w.dest[i] === PLAY ? 1 : 0
    const base = (2 * j + leg) * VARIANTS
    if (use.since[j] !== start) { use.pick[j] = choose(w, use, i, base, leg ? w.playMode[i] : w.mode[i], live); use.since[j] = start }
    const es = use.paths[base + use.pick[j]]
    if (!es) continue
    const p = out1 ? (t - w.dep[i]) / w.dur1[i] : 1 - (t - w.ret[i]) / w.dur2[i]
    const c = use.cum.get(es)!, d = p * c[c.length - 1]
    let lo = 0, hi = c.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m + 1; else hi = m }
    out[es[lo]] += w.city.perAgent
    onRoad?.(i, es[lo])
  }
  return out
}

// ponytail: the capacity of a road of each class (scripts/graphs.py: street, 國道, 快速道路, ramp) over that of a street,
// for their lanes; guesses. Each class of a cell is taken apart, so the many km of 國道 and ramps at an interchange do
// not thin out the load of the streets next to them.
const LANES = [1, 3, 2, 0.5]

/** A bucket is the roads of one class in one cell: the bucket of each edge, and the km and lanes of each bucket. */
export type Grid = { cellOf: Int32Array; km: Float64Array; lanes: Float64Array; keys: Int32Array }
/** The key of the cell that holds a point. The key of a bucket is 4 x the key of its cell + its class. */
export const cellKey = (lon: number, lat: number) => (Math.floor(lon / CELL) - 12_000) * 10_000 + Math.floor(lat / CELL) - 2_400
export const gridOf = (road: GraphJson): Grid => {
  const ids = new Map<number, number>()
  const cellOf = Int32Array.from(road.edges, ([a, b, , , cls = 0]) => {
    const k = 4 * cellKey((road.lon[a] + road.lon[b]) / 2, (road.lat[a] + road.lat[b]) / 2) + cls
    return ids.get(k) ?? ids.set(k, ids.size).get(k)!
  })
  const km = new Float64Array(ids.size), keys = Int32Array.from(ids.keys())
  road.edges.forEach(([, , m], e) => (km[cellOf[e]] += m / 1000))
  return { cellOf, km, lanes: Float64Array.from(keys, k => LANES[k % 4]), keys }
}

/** People on the road of each bucket. */
export const cellLoad = (load: ArrayLike<number>, grid: Grid) => {
  const out = new Float64Array(grid.km.length)
  for (let e = 0; e < load.length; e++) out[grid.cellOf[e]] += load[e]
  return out
}

/** Extra time over free flow, as a share of the free time, for `people` on `km` of road. */
export const extraTime = (people: number, km: number, capacity = CAPACITY) => ALPHA * (people / km / capacity) ** BETA

/** Per bucket, the travel time over free time. */
export const slowness = (load: ArrayLike<number>, grid: Grid, capacity = CAPACITY) =>
  Float64Array.from(cellLoad(load, grid), (p, c) => 1 + extraTime(p, grid.km[c], capacity * grid.lanes[c]))

/** Per bucket, 0 (free) to 255 (SLOWEST or slower). */
export const cellLevels = (load: ArrayLike<number>, grid: Grid, capacity = CAPACITY) =>
  Uint8Array.from(slowness(load, grid, capacity), x => Math.round(255 * Math.min(1, (x - 1) / (SLOWEST - 1))))

/** One take of the traffic: the load now, with the routes chosen by the last take, then the slowness for the next. */
export const take = (w: World, use: RoadUse, load: Float32Array, live: Live, onRoad?: (agent: number, edge: number) => void, capacity = CAPACITY) => {
  loadNow(w, use, load, onRoad, live)
  live.slower = slowness(load, live.grid, capacity)
  return cellLevels(load, live.grid, capacity)
}

/**
 * Per edge: 0 for an edge with no traveller, else 1 + the level of its cell (cellLevels) on 1 to 255. The map draws
 * the flow only on roads in use, and the colour follows those roads and not the square of the cell.
 */
export const levels = (load: ArrayLike<number>, grid: Grid, cells: Uint8Array, out: Uint8Array) => {
  for (let e = 0; e < out.length; e++) out[e] = load[e] > 0 ? 1 + Math.round(cells[grid.cellOf[e]] * 254 / 255) : 0
  return out
}
