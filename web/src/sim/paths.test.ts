import { expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { init } from './core.ts'
import { cityFrom } from './city.ts'
import { KNOWN_BATCH, networks, pathIn, readRoutes, ROAD_MODES, roadNode, routeKey, tripPaths, wayBack, writeRoutes, type Batch } from './paths.ts'
import { edgesTo, tree } from './route.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))

test('road paths read from a routes file are the paths the worker would route itself (real data)', () => {
  const c = cityFrom({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }, 10, 'village')
  const w = init(c.city, 42), net = networks(pub('road-graph.json'), pub('mrt-graph.json'))
  // A sample of road trips: enough start nodes to cover forward and reversed edges, small enough to stay fast.
  const ks = Array.from(w.movers).filter(i => ROAD_MODES.has(w.mode[i])).slice(0, 400)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  const wanted = new Map<number, number[]>()
  const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
  legs.home.forEach((h, k) => {
    const a = at(h), b = at(legs.work[k])
    if (a !== b) wanted.set(routeKey(a, b), [a, b])
  })
  const paths = new Map<number, number[]>()
  for (const [key, [a, b]] of wanted) paths.set(key, edgesTo(net.road, tree(net.road, a).via, b))
  const routes = readRoutes(writeRoutes(net.road, paths), net.road)!
  const byTrip = (batches: Iterable<Batch>) => {
    const out = new Map<number, number[]>()
    for (const b of batches) b.ks.forEach((k, i) => out.set(k, Array.from(b.pts.subarray(b.off[i], b.off[i + 1]))))
    return out
  }
  const live = byTrip(tripPaths(legs, c.coords, net)), batches = [...tripPaths(legs, c.coords, net, routes)], read = byTrip(batches)
  expect(routes.size).toBe(wanted.size)
  expect(read.size).toBe(live.size)
  // Every road trip comes from the file: the first batch, then the known batches, and no routing.
  // A lookup that misses (other road nodes in the script than in the worker) would add routed batches.
  const roadTrips = legs.home.filter((h, k) => at(h) !== at(legs.work[k])).length
  expect(batches.length).toBe(1 + Math.ceil(roadTrips / KNOWN_BATCH))
  expect([...live].filter(([k, p]) => p.join() !== read.get(k)!.join()).map(([k]) => k)).toEqual([])
})

test('a routes file for another road graph, cut inside a record, or ending in a partial record is ignored', () => {
  const net = networks(pub('road-graph.json'), pub('mrt-graph.json'))
  const file = writeRoutes(net.road, new Map([[routeKey(0, 1), [0]], [routeKey(1, 2), [1, 2]]]))
  expect(readRoutes(file, net.road)?.size).toBe(2)
  expect(readRoutes(file.subarray(0, file.length - 1), net.road)).toBeUndefined()
  expect(readRoutes(Uint16Array.from([...file, 0]), net.road)).toBeUndefined() // a partial record at the end
  file[0] ^= 1 // the hash of another graph
  expect(readRoutes(file, net.road)).toBeUndefined()
})

// The file is made by `pnpm routes` and is not in git, so this runs only where it was made.
const bin = new URL('../../public/road-routes.bin', import.meta.url)
test.skipIf(!existsSync(bin))('the routes file in web/public matches the road graph and holds every road trip of the app (run `pnpm routes` when it fails)', () => {
  const net = networks(pub('road-graph.json'), pub('mrt-graph.json')), b = readFileSync(bin)
  const routes = readRoutes(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2), net.road)
  expect(routes).toBeDefined()
  // The app's run (seed 42, 10 people per agent), both levels, every agent: no road trip may need routing.
  const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
  for (const level of ['village', 'district'] as const) {
    const c = cityFrom(data, 10, level, () => 0), w = init(c.city, 42), node = new Map<number, number>()
    const at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
    const missing = (to: Uint16Array, mode: Uint8Array) => Array.from(w.movers).filter(i => ROAD_MODES.has(mode[i]) && at(w.home[i]) !== at(to[i])
      && !routes!.has(routeKey(at(w.home[i]), at(to[i])))
      // The script leaves out pairs that the road graph does not connect; those are not missing.
      && Number.isFinite(tree(net.road, at(w.home[i])).dist[at(to[i])])).length
    expect({ level, work: missing(w.work, w.mode), play: missing(w.play, w.playMode) }).toEqual({ level, work: 0, play: 0 })
  }
}, 60_000)

test.skipIf(!existsSync(bin))('every path of the routes file, and every way back that the worker reverses, drives a one-way edge only its own way (real data)', () => {
  const road = pub('road-graph.json'), net = networks(road, pub('mrt-graph.json')), b = readFileSync(bin), g = net.road
  const routes = readRoutes(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2), g)!
  // From node a along es: the edges driven against their one-way direction.
  const against = (a: number, es: ArrayLike<number>) => {
    let p = a, bad = 0
    for (let k = 0; k < es.length; k++) {
      const e = es[k], forward = g.from[e] === p
      if (!forward && road.edges[e][5]) bad++
      p = forward ? g.end[e] : g.from[e]
    }
    return bad
  }
  let bad = 0, flipped = 0
  for (const [key, es] of routes) {
    const v = Math.floor(key / 2 ** 32), a = Math.floor(key % 2 ** 32 / 65536), z = key % 65536
    bad += against(a, es)
    // traffic.ts roadUse: with no path back in the file, the way back is the way there reversed.
    if (!routes.has(routeKey(z, a))) { flipped++; bad += against(z, pathIn(routes, a, z, v)!.slice().reverse()) }
  }
  expect(flipped).toBeGreaterThan(0)
  expect(bad).toBe(0)
}, 60_000)

test.skipIf(!existsSync(bin))('a dot goes home on its own path when the routes file holds one, from the far end to home (real data)', () => {
  const net = networks(pub('road-graph.json'), pub('mrt-graph.json')), b = readFileSync(bin)
  const routes = readRoutes(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2), net.road)!
  const c = cityFrom({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }, 10, 'village')
  const w = init(c.city, 42), ks = Array.from(w.movers).filter(i => ROAD_MODES.has(w.mode[i])).slice(0, 2000)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  const at = (v: number) => roadNode(net, c.coords, v)
  const own = legs.home.map((h, k) => at(legs.work[k]) !== at(h) && routes.has(routeKey(at(legs.work[k]), at(h))))
  const seen = new Set<number>()
  for (const batch of wayBack(legs, c.coords, net, routes)) batch.ks.forEach((k, j) => {
    seen.add(k)
    const pts = batch.pts.subarray(batch.off[j], batch.off[j + 1])
    expect([pts[0], pts[1]]).toEqual(Array.from(Float32Array.from(c.coords[legs.work[k]])))
    expect([pts[pts.length - 2], pts[pts.length - 1]]).toEqual(Array.from(Float32Array.from(c.coords[legs.home[k]])))
  })
  expect(seen.size).toBeGreaterThan(0)
  own.forEach((o, k) => expect(seen.has(k)).toBe(o))
}, 60_000)
