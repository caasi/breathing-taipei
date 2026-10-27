import { graphFrom, graphHash, nearest, tree, pathTo, pathAlong, type GraphJson, type Graph } from './route.ts'
import { dense, hierarchyOf, join, searcher, type Hierarchy, type Space } from './ch.ts'
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
 * The variants of a road path: 0 the fastest (route.ts FASTER), 1 on streets only (a scooter cannot take a 國道 or a
 * 快速道路), 2 the shortest in metres.
 */
export const VARIANTS = 3
/** The weight of each adjacency slot in each variant; the slot against a one-way edge is Infinity in each (route.ts graphFrom). */
export const variantWeights = (g: Graph): ArrayLike<number>[] => [g.w,
  Float64Array.from(g.w, (w, k) => (g.cls[g.edge[k]] ? Infinity : w)),
  Float64Array.from(g.edge, (e, k) => (g.w[k] === Infinity ? Infinity : g.metres[e]))]
export const routeKey = (from: number, to: number, variant = 0) => (variant * 65536 + from) * 65536 + to

/**
 * Road paths from the routes file: one contraction hierarchy (ch.ts) for each variant, made by scripts/routes.ts.
 * path(a, b, v) is the edges of variant v from road node a to road node b, undefined when a = b or the road graph does
 * not connect them; one query takes about 0.25 ms (Node, 2026-10-27). fill(pairs, variants) finds many in a batch
 * (all variants by default), yielding between parts so a caller can spread it over frames; a path is found once and kept, and a variant equal to the one
 * before it is the same array.
 */
export type Routes = {
  path: (a: number, b: number, v: number) => Uint16Array | undefined
  fill: (pairs: Iterable<[number, number]>, variants?: number[]) => Generator<void>
}

/**
 * File layout, all Uint16: graph hash (low, high), layout (3), then per variant: the rank of each node, the number of
 * shortcuts (low, high), and per shortcut its left and right arc (each low, high).
 * The hash ties the file to its road graph; a file for another graph, of another length, or with a shortcut that does
 * not fit its hierarchy is ignored.
 * Limits: fewer than 65,536 road nodes and road edges, as a path is a Uint16Array of edge ids (writeRoutes throws
 * beyond them). The hash does not cover the routing costs: after a change to them, run `pnpm routes` again (dev and
 * build do).
 */
const LAYOUT = 3
export const writeRoutes = (g: Graph, parts: { rank: Uint16Array; shortcuts: Uint32Array }[]) => {
  if (g.lon.length > 65535 || g.geom.length > 65535) throw new Error('road nodes or edges do not fit Uint16')
  const hash = graphHash(g), out = [hash & 0xffff, hash >>> 16, LAYOUT]
  for (const { rank, shortcuts } of parts) {
    out.push(...rank, shortcuts.length / 2 & 0xffff, shortcuts.length / 2 >>> 16)
    for (const a of shortcuts) out.push(a & 0xffff, a >>> 16)
  }
  return Uint16Array.from(out)
}
export const readRoutes = (data: Uint16Array, g: Graph): Routes | undefined => {
  const n = g.lon.length, ws = variantWeights(g), hs: Hierarchy[] = []
  if (data.length < 3 || (data[0] | (data[1] << 16)) >>> 0 !== graphHash(g) || data[2] !== LAYOUT) return undefined
  let i = 3
  for (const w of ws) {
    if (i + n + 2 > data.length) return undefined
    const rank = data.slice(i, i + n), count = data[i + n] + data[i + n + 1] * 65536
    i += n + 2
    if (i + 4 * count > data.length) return undefined
    const shortcuts = new Uint32Array(2 * count)
    for (let k = 0; k < 2 * count; k++, i += 2) shortcuts[k] = data[i] + data[i + 1] * 65536
    try { hs.push(hierarchyOf(g, w, rank, shortcuts)) } catch { return undefined }
  }
  return i === data.length ? routesOf(hs) : undefined
}

const same = (a: Uint16Array, b: Uint16Array) => a.length === b.length && a.every((e, k) => e === b[k])

const routesOf = (hs: Hierarchy[]): Routes => {
  const n = hs[0].rank.length, found = new Map<number, Uint16Array | null>(), search = hs.map(searcher), scratch = dense(n)
  // ponytail: every search space is kept (per variant, forward and backward), as the sources and targets repeat across
  // calls of fill; about 107 nodes each, some 30 MB for the roads of the app's run (estimated). Drop them when memory matters.
  const spaces = hs.map(() => [new Map<number, Space>(), new Map<number, Space>()])
  const spaceOf = (v: number, x: number, forward: boolean) => {
    const m = spaces[v][forward ? 0 : 1]
    let s = m.get(x)
    if (!s) { s = search[v](x, forward); m.set(x, s) }
    return s
  }
  // Keeps a path of variant v, as the array of variant v - 1 when the two are equal.
  const keep = (a: number, b: number, v: number, es: number[] | undefined) => {
    let p = es ? Uint16Array.from(es) : null
    const before = v ? found.get(routeKey(a, b, v - 1)) : undefined
    if (p && before && same(p, before)) p = before
    found.set(routeKey(a, b, v), p)
    return p ?? undefined
  }
  const path = (a: number, b: number, v: number): Uint16Array | undefined => {
    if (a === b) return undefined
    const known = found.get(routeKey(a, b, v))
    if (known !== undefined) return known ?? undefined
    if (v) path(a, b, v - 1)
    const f = spaceOf(v, a, true)
    scratch.set(f)
    const es = join(hs[v], f, scratch, spaceOf(v, b, false))
    scratch.clear(f)
    return keep(a, b, v, es)
  }
  // Yields after each source and each 200 joins, so that no part takes long. Each call has its own dense arrays: two
  // fills can take turns (the worker runs the dots' and the road load's), and a fill left unfinished is dropped.
  function* fill(pairs: Iterable<[number, number]>, variants = hs.map((_, v) => v)) {
    const bySource = new Map<number, Set<number>>(), mine = dense(n)
    for (const [a, b] of pairs) if (a !== b) (bySource.get(a) ?? bySource.set(a, new Set()).get(a)!).add(b)
    for (const v of variants) {
      let k = 0
      for (const [a, bs] of bySource) {
        const todo = [...bs].filter(b => !found.has(routeKey(a, b, v)))
        if (!todo.length) continue
        const f = spaceOf(v, a, true)
        mine.set(f)
        for (const b of todo) {
          keep(a, b, v, join(hs[v], f, mine, spaceOf(v, b, false)))
          if (++k % 200 === 0) yield
        }
        mine.clear(f)
        yield
      }
    }
  }
  return { path, fill }
}

/** Runs a generator to its end and gives its result, for a caller that does not spread the work over frames. */
export const finish = <T>(g: Generator<unknown, T>) => { for (;;) { const r = g.next(); if (r.done) return r.value } }

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
      const a = road(h), edges = routes?.path(a, road(w), m === SCOOTER ? 1 : 0)
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

/**
 * Yields the paths home of the road trips whose way back is not the way there reversed (a one-way road, or a tie), as
 * points from the far end to home, in batches. Any other trip goes home along its way there reversed.
 */
export function* wayBack(legs: Leg, coords: [number, number][], net: ReturnType<typeof networks>, routes: Routes): Generator<Batch> {
  const at = new Map<number, number>(), road = (v: number) => at.get(v) ?? at.set(v, roadNode(net, coords, v)).get(v)!
  const ks: number[] = [], parts: number[][] = []
  for (let k = 0; k < legs.home.length; k++) {
    const m = legs.mode[k], a = road(legs.work[k]), b = road(legs.home[k]), v = m === SCOOTER ? 1 : 0
    const edges = ROAD_MODES.has(m) ? routes.path(a, b, v) : undefined, there = edges && routes.path(b, a, v)
    if (!edges || !there || same(edges, there.slice().reverse())) continue
    ks.push(k); parts.push([...coords[legs.work[k]], ...pathAlong(net.road, a, edges), ...coords[legs.home[k]]])
    if (ks.length === KNOWN_BATCH) { yield pack(ks.splice(0), parts.splice(0)) }
  }
  if (ks.length) yield pack(ks, parts)
}
