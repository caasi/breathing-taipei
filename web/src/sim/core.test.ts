import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { init, advance, counts, where, ROAD, AWAY, MINUTES_PER_DAY, type City, type World } from './core.ts'
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
    // Optional other kinds: any rate, any hours (also overlapping and all 0), and a pick that may give any node, any mode, or no trip.
    kinds: fc.array(fc.record({
      rate: fc.double({ min: 0, max: 1, noNaN: true }), none: fc.double({ min: 0, max: 1, noNaN: true }),
      dep: fc.array(fc.oneof(fc.constant(0), fc.nat(5)), { minLength: 24, maxLength: 24 }),
      ret: fc.array(fc.oneof(fc.constant(0), fc.nat(5)), { minLength: 24, maxLength: 24 }),
    }), { maxLength: 3 }),
    // Optional days off: any weekly pattern of the three kinds of day, any shares; the day-off OD is the workday one.
    off: fc.option(fc.record({
      week: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 7, maxLength: 7 }),
      out: fc.double({ min: 0, max: 1, noNaN: true }), away: fc.double({ min: 0, max: 0.5, noNaN: true }),
    }), { nil: undefined }),
  }).map(({ homes, to, kinds, off }): City => ({
    od, group, homes, to, perAgent: 10,
    off: off && { kindOf: d => off.week[((d % 7) + 7) % 7], od: [od, od], out: [group.map(() => off.out), group.map(() => off.out)], away: [off.away, off.away] },
    kinds: kinds.map((k, c) => ({
      name: `k${c}`, rate: group.map(() => k.rate), dep: k.dep, ret: k.ret,
      pick: (_home, rng) => { const r1 = rng(), r2 = rng(); return r1 < k.none ? undefined : { work: Math.floor(r2 * group.length), mode: Math.floor(r1 * MODES.length) } },
    })),
    modeOf: (_a, _b, r) => Math.floor(r * MODES.length),
    minutes: (a, b, m, h) => times[(a * 7 + b * 3 + m + h) % times.length],
  }))
}))

const total = (city: City) => Array.from(city.homes).reduce((a, b) => a + b, 0)
const run = (city: City, seed: number, minutes: number) => { const w = init(city, seed); advance(w, minutes); return w }
const sumOf = (c: { nodes: Uint32Array; road: Uint32Array; away: number }) => c.nodes.reduce((a, b) => a + b, 0) + c.road.reduce((a, b) => a + b, 0) + c.away

describe('core properties', () => {
  test('everyone is at a valid node or on the road, never lost', () => {
    fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 0, max: 3 * MINUTES_PER_DAY }), (city, seed, m) => {
      const w = run(city, seed, m)
      expect(sumOf(counts(w, MODES.length))).toBe(total(city))
      w.home.forEach((_, i) => { const at = where(w, i); expect(at === ROAD || at === AWAY || (at >= 0 && at < city.homes.length)).toBe(true) })
    }))
  })

  test('a plan arrives before it leaves again, leaves work within a day, and the next one starts after it', () => {
    fc.assert(fc.property(cityArb, fc.integer(), (city, seed) => {
      const w = init(city, seed)
      const bad: string[] = []
      const end = new Map<number, number>()
      for (let t = 0; t <= 3 * MINUTES_PER_DAY; t += 30, advance(w, 30)) for (const i of w.movers) {
        const prev = end.get(i)
        if (prev !== undefined && prev !== w.ret[i] + w.dur2[i] && w.dep[i] < prev) bad.push(`overlap ${i}`)
        if (w.dep[i] + w.dur1[i] > w.ret[i]) bad.push(`leaves before arriving ${i}`)
        if (w.ret[i] - w.dep[i] >= MINUTES_PER_DAY) bad.push(`too long ${i}`)
        if (w.ret[i] + w.dur2[i] < t) bad.push(`no plan ${i}`)
        end.set(i, w.ret[i] + w.dur2[i])
      }
      expect(bad).toEqual([])
    }))
  })

  test('same seed gives the same run', () => {
    fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 0, max: 2 * MINUTES_PER_DAY }), (city, seed, m) => {
      const a = run(city, seed, m), b = run(city, seed, m)
      expect([a.dep, a.ret, a.work]).toEqual([b.dep, b.ret, b.work])
      expect(counts(a, MODES.length)).toEqual(counts(b, MODES.length))
    }))
  })

  test('a commuter only works in a group that has morning trips from home, else stays home', () => {
    fc.assert(fc.property(cityArb, fc.integer(), (city, seed) => {
      fc.pre(!city.kinds?.length) // other kinds go wherever their pick says; the city builder tests those
      const w: World = init(city, seed)
      const morning = (a: number, b: number) => [5, 6, 7, 8, 9, 10, 11].reduce((s, h) => s + city.od[h][a][b], 0)
      w.home.forEach((h, i) => {
        if (w.work[i] !== h) expect(morning(city.group[h], city.group[w.work[i]])).toBeGreaterThan(0)
      })
    }))
  })
})

test('replanning each agent when it is home gives the same plans for any step size', () => {
  fc.assert(fc.property(cityArb, fc.integer(), fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 90 }), (city, seed, at, step) => {
    const big = init(city, seed), small = init(city, seed)
    advance(big, MINUTES_PER_DAY + at)
    for (let m = 0; m < MINUTES_PER_DAY + at; m += step) advance(small, Math.min(step, MINUTES_PER_DAY + at - m))
    expect([small.dep, small.ret, small.dur1, small.dur2]).toEqual([big.dep, big.ret, big.dur1, big.dur2])
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
const data = () => ({ ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') })

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
  const short = c.city.kinds!.findIndex(k => k.name === 'short') + 1
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
    if (w.kind[i] !== short) return
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
  const short = c.city.kinds!.findIndex(k => k.name === 'short') + 1
  const g = d.districts.indexOf('新北市樹林區')
  expect([5, 6, 7, 8, 9, 10, 11].every(h => d.od[h][g][g] === 0)).toBe(true)
  const byHour = new Array(24).fill(0)
  w.home.forEach((h, i) => { if (w.kind[i] === short && c.city.group[h] === g) byHour[Math.floor((((w.dep[i] % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60)]++ })
  expect(byHour[8]).toBeGreaterThan(10 * byHour[5])
})

test('night workers are at work at 00:00 and 02:00, as many as their businesses give (real data)', () => {
  const d = data()
  const c = cityFrom(d, 10, 'village')
  const w = init(c.city, 1)
  const night = ['overnight', 'nightlife'].map(n => c.city.kinds!.findIndex(k => k.name === n) + 1)
  // The agreed guesses, computed here from night.json and not read back from city.ts:
  // overnight = a third of 8 per convenience store and 15 per hotel, nightlife = 10 per place; 10 people per agent.
  const col = (n: string) => d.night.counts.reduce((s: number, c: number[]) => s + c[d.night.kinds.indexOf(n)], 0)
  const expected = ((8 * col('convenience') + 15 * col('hotel')) / 3 + 10 * col('nightlife')) / 10
  const atWork = () => w.movers.reduce((s, i) => s + (night.includes(w.kind[i]) && where(w, i) === w.work[i] ? 1 : 0), 0)
  const first = atWork()
  advance(w, 26 * 60)
  const second = atWork()
  expect(Math.abs(first / expected - 1)).toBeLessThan(0.1)
  expect(Math.abs(second / expected - 1)).toBeLessThan(0.1)
})

test('night-time groups with an hour outside the MRT and bus hours use neither (real data)', () => {
  const c = cityFrom(data(), 10, 'village')
  const w = init(c.city, 1)
  const closed = ['early', 'nightlife', 'night-out'].map(n => c.city.kinds!.findIndex(k => k.name === n) + 1)
  const bad = w.movers.filter(i => closed.includes(w.kind[i]) && (w.mode[i] === 0 || w.mode[i] === 1))
  expect(bad.length).toBe(0)
  // Inside the MRT hours the night-time groups do not all ride it: dinner is mostly not MRT.
  const dinner = c.city.kinds!.findIndex(k => k.name === 'dinner') + 1
  const all = w.movers.filter(i => w.kind[i] === dinner)
  expect(all.filter(i => w.mode[i] === 0).length / all.length).toBeLessThan(0.5)
})

test('a day off has no morning peak, fewer people out, and some away (real data)', () => {
  const leaving = (kindOf: (day: number) => number) => {
    const c = cityFrom(data(), 100, 'district', kindOf), w = init(c.city, 7)
    const perHour = new Array(24).fill(0)
    let away = 0
    for (let m = 0; m < MINUTES_PER_DAY; m += 10) {
      advance(w, 10)
      for (const i of w.movers) if (w.dep[i] >= m && w.dep[i] < m + 10 && w.dur1[i]) perHour[Math.floor(w.dep[i] / 60) % 24]++
      if (m === 12 * 60) away = counts(w, MODES.length).away
    }
    return { perHour, away, out: perHour.reduce((a, b) => a + b, 0) }
  }
  const workday = leaving(() => 0), holiday = leaving(() => 2)
  const peak = (p: number[]) => Math.max(...p.slice(7, 9)) / (p.slice(10, 17).reduce((a, b) => a + b, 0) / 7)
  expect(peak(workday.perHour)).toBeGreaterThan(2)
  expect(peak(holiday.perHour)).toBeLessThan(1.5)
  expect(holiday.out).toBeLessThan(workday.out)
  expect(workday.away).toBe(0)
  expect(holiday.away).toBeGreaterThan(0)
})
