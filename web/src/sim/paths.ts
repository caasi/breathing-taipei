import { graphFrom, nearest, tree, pathTo, type GraphJson, type Graph } from './route.ts'
import { MRT } from './city.ts'

/** Paths for trips ks: trip ks[i]'s points (lon, lat, ...) are pts[off[i] .. off[i + 1]), from home to work. */
export type Batch = { ks: Uint32Array; pts: Float32Array; off: Uint32Array }
type Leg = { home: ArrayLike<number>; work: ArrayLike<number>; mode: ArrayLike<number> }

const ROAD_MODES = new Set([1, 2, 3]) // bus, scooter, car follow bus route shapes; walk and bike go straight

export const networks = (road: GraphJson, mrt: GraphJson) => {
  const r = graphFrom(road), m = graphFrom(mrt)
  // Stations a passenger can actually reach (one station is not joined to any OSM line).
  const any = Object.values(mrt.stations!)[0], reach = tree(m, any).dist
  const stations = new Set(Object.values(mrt.stations!).filter(s => Number.isFinite(reach[s])))
  return { road: r, mrt: m, stations }
}

const pack = (ks: number[], parts: number[][]): Batch => {
  const off = new Uint32Array(ks.length + 1)
  parts.forEach((p, i) => (off[i + 1] = off[i] + p.length))
  const pts = new Float32Array(off[ks.length])
  parts.forEach((p, i) => pts.set(p, off[i]))
  return { ks: Uint32Array.from(ks), pts, off }
}

/**
 * Yields path batches: first every trip that needs no road routing (MRT, walk, bike, same node),
 * then one batch per road start node, so a caller can spread the slow part over many frames.
 */
export function* tripPaths(legs: Leg, coords: [number, number][], net: ReturnType<typeof networks>): Generator<Batch> {
  const n = legs.home.length
  const roadAt = new Map<number, number>(), stationAt = new Map<number, number>()
  const on = (g: Graph, cache: Map<number, number>, v: number, ok?: (x: number) => boolean) => {
    if (!cache.has(v)) cache.set(v, nearest(g, coords[v][0], coords[v][1], ok))
    return cache.get(v)!
  }
  const full = (k: number, mid: number[]) => [...coords[legs.home[k]], ...mid, ...coords[legs.work[k]]]
  const station = (v: number) => on(net.mrt, stationAt, v, x => net.stations.has(x))
  const first: number[] = [], firstParts: number[][] = []
  const mrtFrom = new Map<number, number[]>(), roadFrom = new Map<number, number[]>()
  for (let k = 0; k < n; k++) {
    const m = legs.mode[k], h = legs.home[k], w = legs.work[k]
    const into = (map: Map<number, number[]>, a: number) => (map.get(a) ?? map.set(a, []).get(a)!).push(k)
    if (m === MRT && station(h) !== station(w)) into(mrtFrom, station(h))
    else if (ROAD_MODES.has(m) && on(net.road, roadAt, h) !== on(net.road, roadAt, w)) into(roadFrom, on(net.road, roadAt, h))
    else { first.push(k); firstParts.push(full(k, [])) }
  }
  // The MRT graph is small (about 0.1 ms per start), so MRT trips go out with the first batch.
  for (const [a, ks] of mrtFrom) {
    const { via } = tree(net.mrt, a)
    for (const k of ks) { first.push(k); firstParts.push(full(k, pathTo(net.mrt, via, station(legs.work[k])))) }
  }
  yield pack(first, firstParts)
  for (const [a, ks] of roadFrom) {
    const { via } = tree(net.road, a)
    yield pack(ks, ks.map(k => full(k, pathTo(net.road, via, on(net.road, roadAt, legs.work[k])))))
  }
}
