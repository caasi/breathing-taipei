import { expect, test } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { init, now, type City } from './core.ts'
import { cityFrom } from './city.ts'
import { networks } from './paths.ts'
import { workNodes } from './jobs.ts'
import { extraTime, gridOf, levels, stepper } from './traffic.ts'
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
    expect(once.length).toBe(Math.floor(total / 15 + 1e-9))
  }))
})

test('every bucket has the lanes of its class, also a named road (real data)', () => {
  const road: GraphJson = pub('road-graph.json'), grid = gridOf(road, pub('road-names.json').edge)
  road.edges.forEach(([, , , , cls = 0], e) => expect(grid.lanes[grid.cellOf[e]]).toBe([1, 3, 2, 0.5][cls]))
})

test('every bucket key a dot can read is unique, and a named road counts at most the width of a cell', () => {
  const road: GraphJson = pub('road-graph.json'), names = pub('road-names.json'), grid = gridOf(road, names.edge)
  const keys = Array.from(grid.keys).filter(k => k >= 0)
  expect(new Set(keys).size).toBe(keys.length)
  grid.keys.forEach((k, b) => { if (k < 0) expect(grid.km[b]).toBeLessThanOrEqual(0.55) })
})

test('a level is 0 on an edge with no traveller, else 1 to 255, and the travel time is at most 4 times the free time', () => {
  fc.assert(fc.property(fc.array(fc.nat(500), { minLength: 1, maxLength: 30 }), loads => {
    const road: GraphJson = { lon: loads.map((_, i) => 121.5 + i * 0.01), lat: loads.map(() => 25), edges: loads.slice(1).map((_, i) => [i, i + 1, 200, []]) }
    const grid = gridOf(road), load = loads.slice(1), cells = Uint8Array.from(grid.km, () => 200)
    const out = levels(load, grid, cells, new Uint8Array(load.length))
    load.forEach((p, e) => (p > 0 ? expect(out[e]).toBeGreaterThanOrEqual(1) : expect(out[e]).toBe(0)))
    for (const p of loads) expect(1 + extraTime(p * 1000, 0.1)).toBeLessThanOrEqual(4)
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
