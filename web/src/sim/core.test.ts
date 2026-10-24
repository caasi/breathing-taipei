import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { init, advance, counts, where, ROAD, MINUTES_PER_DAY, type City, type World } from './core.ts'
import { cityFrom, km, MODES, MAX_KM, WALK, BIKE } from './city.ts'

// 1-5 groups with 1-4 nodes each, sparse non-negative OD, any destination weights,
// 0-20 agents per node and trip times from 0 to 900 minutes (longer than any real trip, to reach the clamps).
const cityArb = fc.integer({ min: 1, max: 5 }).chain(g => fc.record({
  od: fc.array(fc.array(fc.array(fc.oneof(fc.constant(0), fc.nat(50)), { minLength: g, maxLength: g }), { minLength: g, maxLength: g }), { minLength: 24, maxLength: 24 }),
  sizes: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: g, maxLength: g }),
  times: fc.array(fc.integer({ min: 0, max: 900 }), { minLength: 1, maxLength: 20 }),
}).chain(({ od, sizes, times }) => {
  const group = sizes.flatMap((s, i) => new Array(s).fill(i))
  return fc.record({
    homes: fc.array(fc.nat(20), { minLength: group.length, maxLength: group.length }),
    to: fc.array(fc.nat(10), { minLength: group.length, maxLength: group.length }),
    // Optional short trips: any rate, and a pick that may give any node, any mode, or no trip.
    local: fc.option(fc.record({ rate: fc.double({ min: 0, max: 1, noNaN: true }), none: fc.double({ min: 0, max: 1, noNaN: true }) }), { nil: undefined }),
  }).map(({ homes, to, local }): City => ({
    od, group, homes, to, perAgent: 10,
    local: local && {
      rate: group.map(() => local.rate),
      pick: (_home, r1, r2) => (r1 < local.none ? undefined : { work: Math.floor(r2 * group.length), mode: Math.floor(r1 * MODES.length) }),
      hours: od.map(hr => hr.flat().reduce((x, y) => x + y, 0)),
    },
    modeOf: (_a, _b, r) => Math.floor(r * MODES.length),
    minutes: (a, b, m, h) => times[(a * 7 + b * 3 + m + h) % times.length],
  }))
}))

const total = (city: City) => Array.from(city.homes).reduce((a, b) => a + b, 0)
const run = (city: City, seed: number, minutes: number) => { const w = init(city, seed); advance(w, minutes); return w }
const sumOf = (c: { nodes: Uint32Array; road: Uint32Array }) => c.nodes.reduce((a, b) => a + b, 0) + c.road.reduce((a, b) => a + b, 0)

describe('core properties', () => {
  test('everyone is at a valid node or on the road, never lost', () => {
    fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 0, max: 3 * MINUTES_PER_DAY }), (city, seed, m) => {
      const w = run(city, seed, m)
      expect(sumOf(counts(w, MODES.length))).toBe(total(city))
      w.home.forEach((_, i) => { const at = where(w, i); expect(at === ROAD || (at >= 0 && at < city.homes.length)).toBe(true) })
    }))
  })

  test('a day plan arrives before it leaves again and ends before midnight', () => {
    fc.assert(fc.property(cityArb, fc.integer(), (city, seed) => {
      const w = init(city, seed)
      w.home.forEach((h, i) => {
        if (h === w.work[i]) return
        expect(w.dep[i] + w.dur1[i]).toBeLessThanOrEqual(w.ret[i])
        expect(w.ret[i] + w.dur2[i]).toBeLessThan(MINUTES_PER_DAY)
      })
    }))
  })

  test('same seed gives the same run', () => {
    fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 0, max: 2 * MINUTES_PER_DAY }), (city, seed, m) => {
      const a = run(city, seed, m), b = run(city, seed, m)
      expect([a.dep, a.ret, a.work]).toEqual([b.dep, b.ret, b.work])
      expect(counts(a, MODES.length)).toEqual(counts(b, MODES.length))
    }))
  })

  test('everyone is home at midnight (no teleport, no lost return trip)', () => {
    fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 1, max: 3 }), (city, seed, days) => {
      const c = counts(run(city, seed, days * MINUTES_PER_DAY), MODES.length)
      expect(Array.from(c.nodes)).toEqual(Array.from(city.homes))
      expect(Array.from(c.road).every(r => r === 0)).toBe(true)
    }))
  })

  test('a commuter only works in a group that has morning trips from home, else stays home', () => {
    fc.assert(fc.property(cityArb, fc.integer(), (city, seed) => {
      fc.pre(!city.local) // short trips go wherever their pick says; the city builder tests those
      const w: World = init(city, seed)
      const morning = (a: number, b: number) => [5, 6, 7, 8, 9, 10, 11].reduce((s, h) => s + city.od[h][a][b], 0)
      w.home.forEach((h, i) => {
        if (w.work[i] !== h) expect(morning(city.group[h], city.group[w.work[i]])).toBeGreaterThan(0)
      })
    }))
  })
})

test('replanning spread over the night gives the same plans as one big step', () => {
  fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 120, max: 1439 }), fc.integer({ min: 1, max: 90 }), (city, seed, at, step) => {
    const big = init(city, seed), small = init(city, seed)
    advance(big, MINUTES_PER_DAY + at)
    for (let m = 0; m < MINUTES_PER_DAY + at; m += step) advance(small, Math.min(step, MINUTES_PER_DAY + at - m))
    expect([small.dep, small.ret, small.dur1, small.dur2]).toEqual([big.dep, big.ret, big.dur1, big.dur2])
    // Every mover has today's plan by 02:00 (REPLAN_BY), well before the first departure at 05:00.
    expect(small.replanned).toBe(small.movers.length)
  }))
})

test('node indices above 255 survive (village level has 1,465 nodes)', () => {
  const n = 300
  const w = init({
    od: Array.from({ length: 24 }, () => [[0]]), group: new Array(n).fill(0), homes: new Array(n).fill(1),
    to: new Array(n).fill(1), perAgent: 10, modeOf: () => 0, minutes: () => 10,
  }, 1)
  expect(Array.from(counts(w, 1).nodes)).toEqual(new Array(n).fill(1))
})

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const data = () => ({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json') })

test('daytime district population is near the telecom target after calibration (real data)', () => {
  const d = data()
  const { city, target } = cityFrom(d, 10, 'district')
  const w = init(city, 1)
  advance(w, 11 * 60)
  const c = counts(w, MODES.length).nodes
  // Small rural districts (under 50,000 people) are noisy at 1 agent = 10 people, so only larger ones are checked.
  const off = d.districts.filter((_: string, g: number) => city.homes[g] >= 5000 && Math.abs(c[g] / target[g] - 1) > 0.15)
  expect(off).toEqual([])
})

test('short trips match the walking and YouBike targets and stay short and in the district (real data)', () => {
  const d = data()
  const c = cityFrom(d, 10, 'village')
  const w = init(c.city, 1)
  // Targets from the public figures, computed here and not read back from city.ts.
  const M = [5, 6, 7, 8, 9, 10, 11]
  const taipei = d.districts.map((n: string) => n.startsWith('台北市'))
  const residents = d.districts.map(() => 0)
  d.villages.forEach((v: { town: string; pop: number }) => (residents[d.districts.indexOf(v.town)] += v.pop))
  const mrtCommuters = d.districts.reduce((s: number, _: string, g: number) => !taipei[g] ? s
    : s + Math.min(Math.round(residents[g] / 10), M.reduce((t, h) => t + d.od[h][g].reduce((a: number, b: number) => a + b, 0), 0) / 10), 0)
  const walkTarget = 20.8 / 16.0 * mrtCommuters, bikeTarget = 234_000 / 2 / 10
  let walk = 0, bike = 0
  // Plain checks per agent, one expect at the end: an expect per agent (hundreds of thousands) took ~5 s.
  const tooFar: number[] = [], leftDistrict: number[] = [], notShortMode: number[] = []
  w.home.forEach((h, i) => {
    const k = w.work[i]
    if (h === k) return
    // Every walk and ride respects its distance cap, short trip or not.
    if (km(c.coords[h], c.coords[k]) > MAX_KM[w.mode[i]]) tooFar.push(i)
    if (!w.isLocal[i]) return
    if (c.city.group[k] !== c.city.group[h]) leftDistrict.push(i)
    if (w.mode[i] !== WALK && w.mode[i] !== BIKE) notShortMode.push(i)
    if (taipei[c.city.group[h]]) w.mode[i] === WALK ? walk++ : bike++
  })
  expect({ tooFar, leftDistrict, notShortMode }).toEqual({ tooFar: [], leftDistrict: [], notShortMode: [] })
  expect(Math.abs(walk / walkTarget - 1)).toBeLessThan(0.1)
  expect(Math.abs(bike / bikeTarget - 1)).toBeLessThan(0.1)
})

test('short trips in a district without MRT trips inside it follow the city hours, not a flat spread (real data)', () => {
  const d = data()
  const c = cityFrom(d, 10, 'village')
  const w = init(c.city, 1)
  const g = d.districts.indexOf('新北市樹林區')
  expect([5, 6, 7, 8, 9, 10, 11].every(h => d.od[h][g][g] === 0)).toBe(true)
  const byHour = new Array(24).fill(0)
  w.home.forEach((h, i) => { if (w.isLocal[i] && c.city.group[h] === g) byHour[Math.floor(w.dep[i] / 60)]++ })
  expect(byHour[8]).toBeGreaterThan(10 * byHour[5])
})
