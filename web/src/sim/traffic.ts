import { advance, where, now, stretch, ROAD, PLAY, GONE, type World } from './core.ts'
import { pathIn, ROAD_MODES, routeKey, VARIANTS, type Routes } from './paths.ts'
import { BUS, SCOOTER } from './city.ts'
import { freeTime, type GraphJson } from './route.ts'

// BPR (Bureau of Public Roads, 1964): time on a road = free time x (1 + ALPHA (volume / capacity)^BETA).
const ALPHA = 0.15, BETA = 4
// ponytail: one capacity for every cell, in passenger car units (PCU) per km of road, fitted so that the morning peak of 台北市 has the
// TomTom congestion level (scripts/traffic.ts, DATA.md "Figures in the code"). Real roads differ in lanes.
export const CAPACITY = 72
// ponytail: the road load is taken over cells of CELL degrees (about 500 m) and the PCU per km of road in a cell stand
// in for the flow of BPR. Every trip takes one shortest path, so per edge only a few edges carried any load, with a
// travel time up to 25 times the free time; a cell spreads it over the roads nearby. Use flows per hour on each edge
// when trips get more than one path and edges get capacities of their own.
const CELL = 0.005, ACROSS = 0.55
// ponytail: the travel time over free time at which the colour of a road is at its end (dark red); chosen by eye.
const SLOWEST = 1 / 0.3
// ponytail: the share of drivers who follow the live traffic (a map app) when they leave; the others take their usual,
// fastest route. A guess. A scooter always takes the streets-only variant. A bus keeps its fixed route (the fastest
// variant stands in for it), and a jam still slows it.
const NAV = 0.6
// ponytail: the road space of one traveller of each mode (city.ts MODES), in PCU: a vehicle's PCU over the people in it.
// A bus is 2 PCU with 20 riders, a scooter 0.4 PCU with 1.2 riders, a car 1 PCU with 1.4 riders; all guesses. So a
// move from car to bus frees road space, and a bus lane has a load to take off the other lanes.
export const PCU = [0, 2 / 20, 0.4 / 1.2, 1 / 1.4, 0, 0]

/**
 * The road paths of each mover j (its index in w.movers), with their cumulative free time (route.ts freeTime, which
 * holds the traffic lights), so a traveller is placed by time and waits longer where streets meet: path
 * ((2j + leg) x 2 + back) x VARIANTS + v is the variant v (paths.ts) of its trip to work (leg 0) or to its day-off
 * place (leg 1), on the way there (back 0) or home (back 1), each listed in the order it is driven. Per mover, for the
 * trip under way: pick its variant, since the minute it started (it moves when the trip is stretched), free its
 * minutes with no jam, path the index of its path in paths and at the edge it is on at the last take; on: the movers
 * on the road at the last take.
 */
export type RoadUse = {
  paths: (Uint16Array | undefined)[]; cum: Map<Uint16Array, Float32Array>
  pick: Int8Array; since: Int32Array; free: Float32Array; path: Int32Array; at: Int32Array; on: number[]
}

/**
 * ends gives the road nodes of agent i's trip (leg 0 to work, 1 to its day-off place). The way home is the path from
 * the far end in `routes` when the file holds it (a one-way road made it differ), else the way there reversed.
 */
export const roadUse = (w: World, routes: Routes, ends: (agent: number, leg: number) => [number, number], time: ArrayLike<number>): RoadUse => {
  const cum = new Map<Uint16Array, Float32Array>(), n = w.movers.length, paths: (Uint16Array | undefined)[] = new Array(4 * n * VARIANTS)
  const add = (es: Uint16Array) => { if (!cum.has(es)) { const c = new Float32Array(es.length); let s = 0; es.forEach((e, j) => (c[j] = s += time[e])); cum.set(es, c) } }
  const flipped = new Map<Uint16Array, Uint16Array>(), flip = (es: Uint16Array) => flipped.get(es) ?? flipped.set(es, es.slice().reverse()).get(es)!
  w.movers.forEach((i, j) => [w.mode[i], w.playMode[i]].forEach((mode, leg) => {
    if (!ROAD_MODES.has(mode)) return
    const [a, b] = ends(i, leg), own = routes.has(routeKey(b, a))
    for (let v = 0; v < VARIANTS; v++) {
      const there = pathIn(routes, a, b, v), back = own ? pathIn(routes, b, a, v) : there && flip(there)
      ;[there, back].forEach((es, k) => { if (es) { add(es); paths[((2 * j + leg) * 2 + k) * VARIANTS + v] = es } })
    }
  }))
  return { paths, cum, pick: new Int8Array(n), since: new Int32Array(n).fill(-(2 ** 31)), free: new Float32Array(n), path: new Int32Array(n), at: new Int32Array(n), on: [] }
}

/** What a driver who follows the live traffic weighs a path by: the free time of each edge, and the slowness of its bucket. */
export type Live = { grid: Grid; time: Float64Array; slower: Float64Array }
export const liveOf = (road: GraphJson, grid: Grid): Live => ({
  grid, time: freeTime(road, true), slower: new Float64Array(grid.km.length).fill(1),
})

const choose = (w: World, use: RoadUse, i: number, base: number, mode: number, live?: Live) => {
  if (mode === SCOOTER) return 1
  if (mode === BUS) return 0
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

/** The travel time of a path from its edge `from` to its end over its free time, by the slowness of `live`. */
const slowerOn = (es: Uint16Array, from: number, live: Live) => {
  let free = 0, jam = 0
  for (let k = from; k < es.length; k++) { const f = live.time[es[k]]; free += f; jam += f * live.slower[live.grid.cellOf[es[k]]] }
  return free ? jam / free : 1
}

/**
 * The road load on each edge now, in PCU: each road traveller is on the edge at its share of the trip. When a trip is
 * first seen on the road, it takes its variant by the slowness of `live` then (what a driver knows when it leaves).
 * onRoad gets each traveller and its edge.
 */
export const loadNow = (w: World, use: RoadUse, out: Float32Array, onRoad?: (agent: number, edge: number) => void, live?: Live) => {
  out.fill(0); use.on.length = 0
  const t = now(w)
  for (let j = 0; j < w.movers.length; j++) {
    const i = w.movers[j]
    // A trip out of the two cities has no path on the map (its plan goes from home to home).
    if (w.dest[i] === GONE || where(w, i, t) !== ROAD) continue
    const out1 = t < w.dep[i] + w.dur1[i], start = out1 ? w.dep[i] : w.ret[i], leg = w.dest[i] === PLAY ? 1 : 0
    const base = ((2 * j + leg) * 2 + (out1 ? 0 : 1)) * VARIANTS
    if (use.since[j] !== start) {
      use.pick[j] = choose(w, use, i, base, leg ? w.playMode[i] : w.mode[i], live); use.since[j] = start
      use.free[j] = out1 ? w.dur1[i] : w.dur2[i]
    }
    const es = use.paths[base + use.pick[j]]
    if (!es) continue
    use.path[j] = base + use.pick[j]; use.on.push(j)
    const p = out1 ? (t - w.dep[i]) / w.dur1[i] : (t - w.ret[i]) / w.dur2[i]
    const c = use.cum.get(es)!, d = p * c[c.length - 1]
    let lo = 0, hi = c.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m + 1; else hi = m }
    use.at[j] = lo
    out[es[lo]] += w.city.perAgent * PCU[leg ? w.playMode[i] : w.mode[i]]
    onRoad?.(i, es[lo])
  }
  return out
}

// ponytail: the capacity of a road of each class (scripts/graphs.py: street, 國道, 快速道路, ramp) over that of a street,
// for their lanes; guesses. Each class of a cell is taken apart, so the many km of 國道 and ramps at an interchange do
// not thin out the load of the streets next to them.
const LANES = [1, 3, 2, 0.5]

/**
 * A bucket is one named road (road-names.json), or the roads with no name, of one class in one cell, and for a one-way
 * edge one of the two headings, so that the two carriageways of a road are apart: the bucket of each edge, and the km
 * and lanes of each bucket. A named road on its own keeps a main road from being thinned out by the
 * small streets of its cell (瑞光路 had 10 to 210 people at 09:00 against 4 to 12 km of streets in its cells).
 * keys: the key of each cell that holds a bucket (cellKey), and cellIn: the index in keys of the cell of each bucket.
 */
export type Grid = { cellOf: Int32Array; km: Float64Array; lanes: Float64Array; keys: Int32Array; cellIn: Int32Array }
/** The key of the cell that holds a point. */
// From 121°E and 24°N, so that 4 times the key fits in an Int32Array.
export const cellKey = (lon: number, lat: number) => Math.floor((lon - 121) / CELL) * 10_000 + Math.floor((lat - 24) / CELL)
export const gridOf = (road: GraphJson, name: ArrayLike<number> = []): Grid => {
  const ids = new Map<string, number>(), cells = new Map<number, number>(), cellIn: number[] = [], lanes: number[] = []
  const cellOf = Int32Array.from(road.edges, ([a, b, , , cls = 0, one], e) => {
    // A heading in [-45°, 135°) or the other half, from the first node to the second.
    const heading = one ? (Math.atan2(road.lat[b] - road.lat[a], road.lon[b] - road.lon[a]) + Math.PI / 4 + 2 * Math.PI) % (2 * Math.PI) < Math.PI ? ':+' : ':-' : ''
    const c = cellKey((road.lon[a] + road.lon[b]) / 2, (road.lat[a] + road.lat[b]) / 2), id = `${4 * c + cls}:${name[e] ?? -1}${heading}`
    if (!ids.has(id)) {
      ids.set(id, ids.size); lanes.push(LANES[cls])
      if (!cells.has(c)) cells.set(c, cells.size)
      cellIn.push(cells.get(c)!)
    }
    return ids.get(id)!
  })
  const km = new Float64Array(ids.size)
  road.edges.forEach(([, , m], e) => (km[cellOf[e]] += m / 1000))
  // ponytail: a named road counts at most the width of a cell (ACROSS km). Its edges in one cell can add up to much more,
  // from the shapes of many bus routes and from small roads near it that took its name (瑞光路: 7.9 km in one cell).
  if (name.length) ids.forEach((b, id) => { if (!/:-1(:[+-])?$/.test(id)) km[b] = Math.min(km[b], ACROSS) })
  return { cellOf, km, lanes: Float64Array.from(lanes), keys: Int32Array.from(cells.keys()), cellIn: Int32Array.from(cellIn) }
}

/** The load (PCU) on the road of each bucket. */
export const cellLoad = (load: ArrayLike<number>, grid: Grid) => {
  const out = new Float64Array(grid.km.length)
  for (let e = 0; e < load.length; e++) out[grid.cellOf[e]] += load[e]
  return out
}

// ponytail: the most travel time over free time; a guess. BPR grows without limit past capacity, which it overstates
// (DATA.md). Before the limit, a few ramps at 10 to 25 times the free time carried the bucket mean that the fit then
// matched, and left the main streets free.
const MOST = 4

/** Extra time over free flow, as a share of the free time, for a load of `pcu` on `km` of road (at most MOST - 1). */
export const extraTime = (pcu: number, km: number, capacity = CAPACITY) => Math.min(MOST - 1, ALPHA * (pcu / km / capacity) ** BETA)

/** Per bucket, the travel time over free time. */
export const slowness = (load: ArrayLike<number>, grid: Grid, capacity = CAPACITY) =>
  Float64Array.from(cellLoad(load, grid), (p, c) => 1 + extraTime(p, grid.km[c], capacity * grid.lanes[c]))

/**
 * Per cell of grid.keys, the level of its slowest bucket: what a dot in the cell shows (Travellers.tsx). ponytail: a dot
 * cannot tell its road, so a dot on a side street of a jammed main road shows the jam; most road travellers of a cell
 * are on its main roads.
 */
export const cellMax = (grid: Grid, buckets: Uint8Array) => {
  const out = new Uint8Array(grid.keys.length)
  buckets.forEach((v, b) => { if (v > out[grid.cellIn[b]]) out[grid.cellIn[b]] = v })
  return out
}

/** Per bucket, 0 (free) to 255 (SLOWEST or slower). */
export const cellLevels = (load: ArrayLike<number>, grid: Grid, capacity = CAPACITY) =>
  Uint8Array.from(slowness(load, grid, capacity), x => Math.round(255 * Math.min(1, (x - 1) / (SLOWEST - 1))))

/**
 * A step function that advances the model and calls onEdge at each boundary of `period` minutes that it reaches, once,
 * whatever the steps: the same boundaries for one step of a day or for many small ones (a sum of fractional minutes can
 * stop just short of a boundary and reach it again, so the last boundary is kept).
 */
export const stepper = (period: number, onEdge: (w: World) => void) => {
  let last = -Infinity
  return (w: World, minutes: number) => {
    for (let left = minutes; left > 0;) {
      const t = now(w), edge = (Math.floor(t / period) + 1) * period, d = Math.min(left, edge - t)
      advance(w, d); left -= d
      if (d === edge - t && edge !== last) { last = edge; onEdge(w) }
    }
  }
}

/**
 * Each traveller on the road at the last take drives the rest of its path at the slowness of `live`: its leg ends at
 * now + the free time left x the slowness of the edges left (core.ts stretch), so a jam keeps more people on the road,
 * and a trip that drives into a jam, or out of one, changes as it goes.
 */
const retime = (w: World, use: RoadUse, live: Live) => {
  const t = now(w)
  for (const j of use.on) {
    const i = w.movers[j], out1 = t < w.dep[i] + w.dur1[i], start = out1 ? w.dep[i] : w.ret[i], dur = out1 ? w.dur1[i] : w.dur2[i]
    stretch(w, i, t + (1 - (t - start) / dur) * use.free[j] * slowerOn(use.paths[use.path[j]]!, use.at[j], live))
    use.since[j] = out1 ? w.dep[i] : w.ret[i]
  }
}

/** One take of the traffic: the load now, with the routes chosen when each trip was first seen, then the slowness, by which each trip drives on. */
export const take = (w: World, use: RoadUse, load: Float32Array, live: Live, onRoad?: (agent: number, edge: number) => void, capacity = CAPACITY) => {
  loadNow(w, use, load, onRoad, live)
  live.slower = slowness(load, live.grid, capacity)
  retime(w, use, live)
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
