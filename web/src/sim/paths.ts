import { graphFrom, graphHash, nearest, tree, pathTo, pathAlong, type GraphJson, type Graph } from './route.ts'
import { MRT, SCOOTER } from './city.ts'

/** Paths for trips ks: trip ks[i]'s points (lon, lat, ...) are pts[off[i] .. off[i + 1]), from home to work. */
export type Batch = { ks: Uint32Array; pts: Float32Array; off: Uint32Array }
type Leg = { home: ArrayLike<number>; work: ArrayLike<number>; mode: ArrayLike<number> }

export const ROAD_MODES = new Set([1, 2, 3]) // bus, scooter, car follow bus route shapes; walk and bike go straight
// Known road paths are built and sent in batches of this many trips, small enough to fit in one frame of the worker.
export const KNOWN_BATCH = 2000

export const networks = (road: GraphJson, mrt: GraphJson) => {
  const r = graphFrom(road, true), m = graphFrom(mrt)
  // Stations a passenger can actually reach (one station is not joined to any OSM line).
  const any = Object.values(mrt.stations!)[0], reach = tree(m, any).dist
  const stations = new Set(Object.values(mrt.stations!).filter(s => Number.isFinite(reach[s])))
  return { road: r, mrt: m, stations }
}

/**
 * Road paths made ahead of time by scripts/routes.ts: (from road node, to road node, variant) -> edge ids.
 * File layout, all Uint16: graph hash (low, high), layout (2), then per path to the end of the file: from, to, variant,
 * length, edge ids.
 * The hash ties the file to its road graph; a file for another graph, or one cut inside a record, is ignored.
 * A file cut at a record boundary reads as a smaller set of paths; the worker routes the trips it lacks.
 * Limits: fewer than 65,536 road nodes and edges, and paths shorter than 65,536 edges (writeRoutes throws
 * beyond them); the number of paths has no limit. The hash does not cover
 * the routing code: after a change to tree() or its costs, run `pnpm routes` again (dev and build do).
 */
export type Routes = Map<number, Uint16Array>
/**
 * The variants of a road path: 0 the fastest (route.ts FASTER), 1 on streets only (a scooter cannot take a 國道 or a
 * 快速道路), 2 the shortest in metres. A file holds a variant only when it differs from the variant before it (pathIn),
 * and a way back (b to a) only when it is not the way there reversed (traffic.ts roadUse).
 */
export const VARIANTS = 3
export const routeKey = (from: number, to: number, variant = 0) => (variant * 65536 + from) * 65536 + to
/** Variant v of the path from a to b: a variant that the file leaves out is the one before it. */
export const pathIn = <P>(routes: Map<number, P>, a: number, b: number, v: number): P | undefined =>
  routes.get(routeKey(a, b, v)) ?? (v ? pathIn(routes, a, b, v - 1) : undefined)
// The third word of the file, so that a file of the older layout (no variant) is not read as this one.
const LAYOUT = 2
export const readRoutes = (data: Uint16Array, g: Graph): Routes | undefined => {
  if (data.length < 3 || (data[0] | (data[1] << 16)) >>> 0 !== graphHash(g) || data[2] !== LAYOUT) return undefined
  const routes: Routes = new Map()
  for (let i = 3; i < data.length;) {
    if (i + 4 > data.length || i + 4 + data[i + 3] > data.length) return undefined
    routes.set(routeKey(data[i], data[i + 1], data[i + 2]), data.subarray(i + 4, i + 4 + data[i + 3]))
    i += 4 + data[i + 3]
  }
  return routes
}
export const writeRoutes = (g: Graph, paths: Map<number, number[]>) => {
  if (g.lon.length > 65535 || g.geom.length > 65535) throw new Error('road nodes or edges do not fit Uint16')
  const hash = graphHash(g), out = [hash & 0xffff, hash >>> 16, LAYOUT]
  for (const [key, edges] of paths) {
    const variant = Math.floor(key / 2 ** 32), rest = key % 2 ** 32
    out.push(Math.floor(rest / 65536), rest % 65536, variant, edges.length, ...edges)
  }
  if (out.some(v => v > 65535)) throw new Error('a value does not fit Uint16')
  return Uint16Array.from(out)
}
/** The road node a village (or district center) starts and ends its road trips at; the script and the worker share it. */
export const roadNode = (net: ReturnType<typeof networks>, coords: [number, number][], v: number) =>
  nearest(net.road, coords[v][0], coords[v][1], u => net.road.street[u] === 1)

const pack = (ks: number[], parts: number[][]): Batch => {
  const off = new Uint32Array(ks.length + 1)
  parts.forEach((p, i) => (off[i + 1] = off[i] + p.length))
  const pts = new Float32Array(off[ks.length])
  parts.forEach((p, i) => pts.set(p, off[i]))
  return { ks: Uint32Array.from(ks), pts, off }
}

/**
 * Yields path batches: first every trip that needs no road routing (MRT, walk, bike, same node), then the
 * road trips found in `routes`, then one batch per road start node for the rest, so a caller can spread
 * the slow part over many frames.
 */
export function* tripPaths(legs: Leg, coords: [number, number][], net: ReturnType<typeof networks>, routes?: Routes): Generator<Batch> {
  const n = legs.home.length
  const roadAt = new Map<number, number>(), stationAt = new Map<number, number>()
  const road = (v: number) => roadAt.get(v) ?? roadAt.set(v, roadNode(net, coords, v)).get(v)!
  const known: number[] = [], knownFrom: number[] = [], knownEdges: Uint16Array[] = []
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
    else if (ROAD_MODES.has(m) && road(h) !== road(w)) {
      // A scooter dot takes the streets-only variant, as its road load does (traffic.ts); the others the fastest one.
      const a = road(h), edges = (m === SCOOTER ? routes?.get(routeKey(a, road(w), 1)) : undefined) ?? routes?.get(routeKey(a, road(w)))
      if (edges) { known.push(k); knownFrom.push(a); knownEdges.push(edges) }
      else into(roadFrom, a)
    }
    else { first.push(k); firstParts.push(full(k, [])) }
  }
  // The MRT graph is small (about 0.1 ms per start), so MRT trips go out with the first batch.
  for (const [a, ks] of mrtFrom) {
    const { via } = tree(net.mrt, a)
    for (const k of ks) { first.push(k); firstParts.push(full(k, pathTo(net.mrt, via, station(legs.work[k])))) }
  }
  yield pack(first, firstParts)
  for (let s = 0; s < known.length; s += KNOWN_BATCH) {
    const ks = known.slice(s, s + KNOWN_BATCH)
    yield pack(ks, ks.map((k, j) => full(k, pathAlong(net.road, knownFrom[s + j], knownEdges[s + j]))))
  }
  for (const [a, ks] of roadFrom) {
    const { via } = tree(net.road, a)
    yield pack(ks, ks.map(k => full(k, pathTo(net.road, via, road(legs.work[k])))))
  }
}
