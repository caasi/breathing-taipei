import { expect, test } from 'vitest'
import fc from 'fast-check'
import { existsSync, readFileSync } from 'node:fs'
import { advance, init, now, where, ROAD, type City, type World } from './core.ts'
import { cityFrom } from './city.ts'
import { networks, readRoutes, roadNode } from './paths.ts'
import { workNodes } from './jobs.ts'
import { cellKey, cellMax, extraTime, MOST, gridOf, levels, liveOf, roadUse, slowerOn, stepper, take, type Live } from './traffic.ts'
import type { GraphJson } from './route.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
// A world with no agents: the stepper only needs its clock.
const empty: City = { od: Array.from({ length: 24 }, () => [[0]]), group: [0], homes: [0], to: [1], perAgent: 10, modeOf: () => 0, minutes: () => 10 }

test('the stepper takes each boundary once, at the same times for any steps', () => {
  fc.assert(fc.property(fc.array(fc.double({ min: 0.01, max: 200, noNaN: true }), { minLength: 1, maxLength: 60 }), steps => {
    const total = steps.reduce((a, b) => a + b, 0)
    const at = (parts: number[]) => {
      const w = init(empty, 1), seen: number[] = [], step = stepper(15, x => seen.push(Math.round(now(x) * 1e6) / 1e6))
      for (const p of parts) step(w, p)
      return seen
    }
    const once = at([total]), many = at(steps)
    expect(many).toEqual(once)
    expect(once.length).toBe(Math.floor(total / 15))
  }))
})

test('the two carriageways of a one-way road are apart, and a two-way road is one bucket', () => {
  // A cell with one named road: a carriageway each way (edges 0 and 1, one-way) and a two-way street (edges 2 and 3).
  const road: GraphJson = { lon: [121.5001, 121.5021, 121.5001, 121.5021], lat: [25.0001, 25.0001, 25.0002, 25.0002],
    edges: [[0, 1, 200, [], 1, 1], [1, 0, 200, [], 1, 1], [2, 3, 200, []], [3, 2, 200, []]] }
  const grid = gridOf(road, [0, 0, 1, 1])
  expect(grid.cellOf[0]).not.toBe(grid.cellOf[1])
  expect(grid.cellOf[2]).toBe(grid.cellOf[3])
})

test('every bucket has the lanes of its class, also a named road (real data)', () => {
  const road: GraphJson = pub('road-graph.json'), grid = gridOf(road, pub('road-names.json').edge)
  road.edges.forEach(([, , , , cls = 0], e) => expect(grid.lanes[grid.cellOf[e]]).toBe([1, 3, 2, 0.5][cls]))
})

test('each cell key a dot can read is unique and holds the slowest bucket of its cell, and a named road counts at most the width of a cell', () => {
  const road: GraphJson = pub('road-graph.json'), names = pub('road-names.json'), grid = gridOf(road, names.edge)
  expect(new Set(grid.keys).size).toBe(grid.keys.length)
  const buckets = Uint8Array.from(grid.km, (_, b) => (b * 37) % 256), max = cellMax(grid, buckets)
  buckets.forEach((v, b) => expect(max[grid.cellIn[b]]).toBeGreaterThanOrEqual(v))
  road.edges.forEach(([a, b], e) => expect(grid.keys[grid.cellIn[grid.cellOf[e]]]).toBe(cellKey((road.lon[a] + road.lon[b]) / 2, (road.lat[a] + road.lat[b]) / 2)))
  road.edges.forEach((_, e) => { if (names.edge[e] >= 0) expect(grid.km[grid.cellOf[e]]).toBeLessThanOrEqual(0.55) })
})

test('a level is 0 on an edge with no traveller, else 1 to 255, and the travel time stays at most MOST times the free time and grows with the load', () => {
  fc.assert(fc.property(fc.array(fc.nat(500), { minLength: 1, maxLength: 30 }), loads => {
    const road: GraphJson = { lon: loads.map((_, i) => 121.5 + i * 0.01), lat: loads.map(() => 25), edges: loads.slice(1).map((_, i) => [i, i + 1, 200, []]) }
    const grid = gridOf(road), load = loads.slice(1), cells = Uint8Array.from(grid.km, () => 200)
    const out = levels(load, grid, cells, new Uint8Array(load.length))
    load.forEach((p, e) => (p > 0 ? expect(out[e]).toBeGreaterThanOrEqual(1) : expect(out[e]).toBe(0)))
    for (const p of loads) {
      expect(1 + extraTime(p * 1000, 0.1)).toBeLessThanOrEqual(MOST)
      // A larger load, where the bent curve is still not flat in floating point, is a slower road.
      if (extraTime(p * 1000, 0.1) < MOST - 1.01) expect(extraTime(p * 1000 + 1, 0.1)).toBeGreaterThan(extraTime(p * 1000, 0.1))
    }
  }))
})

test('a trip to work ends at a fixed street node of its village, at most 4 per village (real data)', () => {
  const c = cityFrom({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }, 10, 'village')
  const net = networks(pub('road-graph.json'), pub('mrt-graph.json')), at = workNodes(net, c.coords, true)
  for (const v of [0, 100, 700, 1400]) {
    const ends = new Set(Array.from({ length: 200 }, (_, i) => at(i, v)))
    expect(ends.size).toBeLessThanOrEqual(4)
    for (const u of ends) expect(net.road.street[u]).toBe(1)
    expect(at(7, v)).toBe(at(7, v))
  }
})

test('the slowness of the rest of a path counts only the part of the current edge still to drive', () => {
  // Two edges of the same free time, at 4 and 1 times it; 90% of the first is driven: (0.1 x 4 + 1 x 1) / 1.1.
  const live = { grid: { cellOf: Int32Array.from([0, 1]) }, time: Float64Array.from([10, 10]), slower: Float64Array.from([4, 1]) } as unknown as Live
  expect(slowerOn([0, 1], 0, live, 0.1)).toBeCloseTo(1.4 / 1.1, 9)
  expect(slowerOn([0, 1], 0, live)).toBeCloseTo(2.5, 9)
})

// The app's run on the real data, with its routes file (made by `pnpm routes`, not in git).
const bin = new URL('../../public/road-routes.bin', import.meta.url)
const appRun = () => {
  const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
  const c = cityFrom(data, 10, 'village', () => 0), w = init(c.city, 42), road: GraphJson = pub('road-graph.json')
  const net = networks(road, pub('mrt-graph.json')), b = readFileSync(bin)
  const routes = readRoutes(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2), net.road)!
  const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
  const workAt = workNodes(net, c.coords, true), grid = gridOf(road, pub('road-names.json').edge), live = liveOf(road, grid)
  const use = roadUse(w, routes, (i, leg) => [at(w.home[i]), leg ? at(w.play[i]) : workAt(i, w.work[i])], live.time)
  return { w, use, live, load: new Float32Array(road.edges.length) }
}
const plans = (w: World) => [Int32Array.from(w.dep), Uint16Array.from(w.dur1), Int32Array.from(w.ret), Uint16Array.from(w.dur2)]
// The share of its leg that a traveller on the road has done at the minute of w.
const share = (w: World, i: number) => {
  const t = now(w)
  return t < w.dep[i] + w.dur1[i] ? (t - w.dep[i]) / w.dur1[i] : (t - w.ret[i]) / w.dur2[i]
}

test.skipIf(!existsSync(bin))('with no jam, the takes of a morning change no plan (real data)', () => {
  const a = appRun(), b = appRun()
  for (let s = 0; s < 40; s++) { advance(a.w, 15); advance(b.w, 15); take(a.w, a.use, a.load, a.live, undefined, 1e12) }
  expect(plans(a.w)).toEqual(plans(b.w))
}, 120_000)

test.skipIf(!existsSync(bin))('in a jam, a take keeps each traveller where it is and each agent in one bucket of the due ring (real data)', () => {
  const { w, use, live, load } = appRun()
  for (let s = 0; s < 36; s++) {
    advance(w, 15)
    const before = new Map<number, number>()
    for (const i of w.movers) if (where(w, i) === ROAD) before.set(i, share(w, i))
    take(w, use, load, live)
    // Whole minutes move the share by less than a minute of the leg (core.ts stretch).
    before.forEach((p, i) => {
      const d = now(w) < w.dep[i] + w.dur1[i] ? w.dur1[i] : w.dur2[i]
      expect(Math.abs(share(w, i) - p)).toBeLessThanOrEqual(1 / d + 1e-9)
    })
  }
  const slot = new Map<number, number>()
  w.due.forEach((agents, k) => agents.forEach(i => { expect(slot.has(i)).toBe(false); slot.set(i, k) }))
  for (const i of w.movers) expect(slot.get(i)).toBe((w.ret[i] + w.dur2[i]) % w.due.length)
  // The morning is jammed somewhere, or the test checks nothing.
  expect(Math.max(...live.slower)).toBeGreaterThan(2)
}, 120_000)
