import { expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { init } from './core.ts'
import { cityFrom } from './city.ts'
import { KNOWN_BATCH, networks, readRoutes, ROAD_MODES, roadNode, routeKey, tripPaths, writeRoutes, type Batch } from './paths.ts'
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
    const c = cityFrom(data, 10, level), w = init(c.city, 42), node = new Map<number, number>()
    const at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
    const missing = Array.from(w.movers).filter(i => ROAD_MODES.has(w.mode[i]) && at(w.home[i]) !== at(w.work[i])
      && !routes!.has(routeKey(at(w.home[i]), at(w.work[i])))
      // The script leaves out pairs that the road graph does not connect; those are not missing.
      && Number.isFinite(tree(net.road, at(w.home[i])).dist[at(w.work[i])]))
    expect({ level, missing: missing.length }).toEqual({ level, missing: 0 })
  }
}, 60_000)
