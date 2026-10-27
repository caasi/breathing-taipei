import { expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { init } from './core.ts'
import { cityFrom } from './city.ts'
import { finish, KNOWN_BATCH, networks, readRoutes, ROAD_MODES, roadNode, tripPaths, variantWeights, wayBack, writeRoutes, type Batch, type Routes } from './paths.ts'
import { contract } from './ch.ts'
import { SCOOTER } from './city.ts'
import { tree } from './route.ts'
import { mulberry32 } from './rng.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const road = pub('road-graph.json'), net = networks(road, pub('mrt-graph.json')), g = net.road
const data = () => ({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') })

// The routes of the real road graph, made here as scripts/routes.ts makes them (about 9 s), once for this file.
let made: { file: Uint16Array; routes: Routes } | undefined
const built = () => {
  if (made) return made
  const file = writeRoutes(g, variantWeights(g).map(w => contract(g, w)))
  return (made = { file, routes: readRoutes(file, g)! })
}

/** The cost of driving es from node a in a weighting, or undefined when es does not lead from a to b. */
const costOf = (a: number, b: number, es: ArrayLike<number>, slotW: ArrayLike<number>) => {
  let at = a, cost = 0
  for (let k = 0; k < es.length; k++) {
    let best = Infinity, next = -1
    for (let s = g.start[at]; s < g.start[at + 1]; s++) if (g.edge[s] === es[k] && slotW[s] < best) { best = slotW[s]; next = g.to[s] }
    if (next < 0) return undefined
    cost += best; at = next
  }
  return at === b ? cost : undefined
}

test('every variant of a road path from the routes file is a shortest path of its weighting, one-way edges only their own way (real data)', () => {
  const { routes } = built(), streets = Array.from({ length: g.lon.length }, (_, v) => v).filter(v => g.street[v]), rng = mulberry32(3)
  variantWeights(g).forEach((slotW, v) => {
    for (let q = 0; q < 100; q++) {
      const a = streets[Math.floor(rng() * streets.length)], b = streets[Math.floor(rng() * streets.length)]
      const want = tree(g, a, slotW).dist[b], es = routes.path(a, b, v)
      // A one-way edge driven against its way has the weight Infinity (route.ts graphFrom), so a finite cost rules it out.
      if (a === b || !Number.isFinite(want)) expect(es).toBeUndefined()
      else expect(costOf(a, b, es!, slotW)).toBeCloseTo(want, 6)
    }
  })
}, 120_000)

test('a batch (fill) finds the same paths as one query at a time, and a variant equal to the one before it is the same array (real data)', () => {
  const { file } = built(), one = readRoutes(file, g)!, many = readRoutes(file, g)!, rng = mulberry32(4)
  const pairs = Array.from({ length: 300 }, () => [Math.floor(rng() * g.lon.length), Math.floor(rng() * g.lon.length)] as [number, number])
  finish(many.fill(pairs))
  let shared = 0
  for (const [a, b] of pairs) for (let v = 0; v < 3; v++) {
    expect(many.path(a, b, v)).toEqual(one.path(a, b, v))
    if (v && many.path(a, b, v) && many.path(a, b, v) === many.path(a, b, v - 1)) shared++
  }
  expect(shared).toBeGreaterThan(0)
}, 120_000)

test('a routes file for another road graph, cut short, with a word too many or with a shortcut that does not fit is ignored', () => {
  const rank = Uint16Array.from({ length: g.lon.length }, (_, v) => v), file = writeRoutes(g, [0, 1, 2].map(() => ({ rank, shortcuts: new Uint32Array(0) })))
  expect(readRoutes(file, g)).toBeDefined()
  expect(readRoutes(file.subarray(0, file.length - 1), g)).toBeUndefined()
  expect(readRoutes(Uint16Array.from([...file, 0]), g)).toBeUndefined()
  const later = writeRoutes(g, [0, 1, 2].map(() => ({ rank, shortcuts: Uint32Array.from([10 ** 6, 0]) }))) // an arc after it
  expect(readRoutes(later, g)).toBeUndefined()
  file[0] ^= 1 // the hash of another graph
  expect(readRoutes(file, g)).toBeUndefined()
})

test('every road trip of the dots takes its path from the routes file, with no routing (real data)', () => {
  const c = cityFrom(data(), 10, 'village'), w = init(c.city, 42), { routes } = built()
  const ks = Array.from(w.movers).filter(i => ROAD_MODES.has(w.mode[i])).slice(0, 400)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  const at = (v: number) => roadNode(net, c.coords, v), batches = [...tripPaths(legs, c.coords, net, routes)]
  // The first batch, then the known batches; a trip that missed the file would add a routed batch.
  const roadTrips = legs.home.filter((h, k) => at(h) !== at(legs.work[k])).length
  expect(batches.length).toBe(1 + Math.ceil(roadTrips / KNOWN_BATCH))
  expect(batches.reduce((n, b: Batch) => n + b.ks.length, 0)).toBe(ks.length)
}, 120_000)

test('the first batch of the dots finds no road path, so it goes out before the road paths are found (real data)', () => {
  const c = cityFrom(data(), 10, 'village'), w = init(c.city, 42), { routes } = built()
  const ks = Array.from(w.movers).slice(0, 2000)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  let asked = 0
  const counting: Routes = { ...routes, path: (a, b, v) => { asked++; return routes.path(a, b, v) } }
  const gen = tripPaths(legs, c.coords, net, counting)
  gen.next()
  expect(asked).toBe(0)
  for (const _ of gen);
  expect(asked).toBeGreaterThan(0)
}, 120_000)

test('a scooter dot with no streets-only path takes the fastest path from the routes file, there and home (real data)', () => {
  const c = cityFrom(data(), 10, 'village'), w = init(c.city, 42), { routes } = built()
  const ks = Array.from(w.movers).filter(i => w.mode[i] === SCOOTER).slice(0, 500)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  const noStreets: Routes = { ...routes, path: (a, b, v) => (v === 1 ? undefined : routes.path(a, b, v)) }
  const at = (v: number) => roadNode(net, c.coords, v), roadTrips = legs.home.filter((h, k) => at(h) !== at(legs.work[k])).length
  // The first batch, then the known batches; a trip routed in the page would add a batch of its own.
  expect([...tripPaths(legs, c.coords, net, noStreets)].length).toBe(1 + Math.ceil(roadTrips / KNOWN_BATCH))
  const own = legs.home.filter((h, k) => {
    const back = routes.path(at(legs.work[k]), at(h), 0), there = routes.path(at(h), at(legs.work[k]), 0)
    return !!back && !!there && back.join() !== there.slice().reverse().join()
  }).length
  expect(own).toBeGreaterThan(0)
  expect([...wayBack(legs, c.coords, net, noStreets)].reduce((s, b) => s + b.ks.length, 0)).toBe(own)
}, 120_000)

test('a dot goes home on its own path when that is not the way there reversed, from the far end to home (real data)', () => {
  const { routes } = built(), c = cityFrom(data(), 10, 'village'), w = init(c.city, 42)
  const ks = Array.from(w.movers).filter(i => ROAD_MODES.has(w.mode[i])).slice(0, 2000)
  const legs = { home: ks.map(i => w.home[i]), work: ks.map(i => w.work[i]), mode: ks.map(i => w.mode[i]) }
  const at = (v: number) => roadNode(net, c.coords, v)
  const own = legs.home.map((h, k) => {
    const v = legs.mode[k] === 2 ? 1 : 0, back = routes.path(at(legs.work[k]), at(h), v), there = routes.path(at(h), at(legs.work[k]), v)
    return !!back && !!there && back.join() !== there.slice().reverse().join()
  })
  const seen = new Set<number>()
  for (const batch of wayBack(legs, c.coords, net, routes)) batch.ks.forEach((k, j) => {
    seen.add(k)
    const pts = batch.pts.subarray(batch.off[j], batch.off[j + 1])
    expect([pts[0], pts[1]]).toEqual(Array.from(Float32Array.from(c.coords[legs.work[k]])))
    expect([pts[pts.length - 2], pts[pts.length - 1]]).toEqual(Array.from(Float32Array.from(c.coords[legs.home[k]])))
  })
  expect(seen.size).toBeGreaterThan(0)
  own.forEach((o, k) => expect(seen.has(k)).toBe(o))
}, 120_000)

// The file is made by `pnpm routes` and is not in git, so this runs only where it was made.
const bin = new URL('../../public/road-routes.bin', import.meta.url)
test.skipIf(!existsSync(bin))('the routes file in web/public is the one that scripts/routes.ts makes from this road graph (run `pnpm routes` when it fails)', () => {
  const b = readFileSync(bin)
  expect(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2)).toEqual(built().file)
}, 120_000)
