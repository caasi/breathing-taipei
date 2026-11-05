import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { init, hoursOf, repolicy, advance, now } from './core.ts'
import { cityFrom, km, EBIKE, BIKE, BUS, SCOOTER, CAR } from './city.ts'
import { bikeWay, KEY, NEW_BRIDGE, STAGGERED, EBIKE_FREE, ON_BRIDGE, TO_BIKE, STRAIGHT, type River } from './policy.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const river: River = pub('river.json')
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), river }
const run = (policies = {}) => { const c = cityFrom(data, 10, undefined, policies); return { c, w: init(c.city, 42) } }
// One baseline for all tests: building the city and the world takes seconds.
const base = run()

test('a policy changes only the agents it reaches: every other agent is as in the baseline', () => {
  const { w } = run({ [KEY.stagger]: 50, [KEY.ebike]: 1 })
  let reached = 0
  const bad: number[] = []
  for (let i = 0; i < w.home.length; i++) {
    if (w.work[i] !== base.w.work[i]) bad.push(i)
    if (w.policy[i]) { reached++; continue }
    if (w.mode[i] !== base.w.mode[i] || w.hours[2 * i] !== base.w.hours[2 * i] || w.hours[2 * i + 1] !== base.w.hours[2 * i + 1]) bad.push(i)
  }
  expect(bad.slice(0, 5)).toEqual([])
  expect(reached).toBeGreaterThan(0)
}, 60_000)

test('staggered hours move 30 minutes, only for the workers of 內科', () => {
  const { w } = run({ [KEY.stagger]: 50 })
  const jobs = (v: number) => (data.villages[v].jobs ?? 0) > 0
  let n = 0
  for (let i = 0; i < w.home.length; i++) {
    if (!(w.policy[i] & STAGGERED)) continue
    n++
    expect(jobs(w.work[i])).toBe(true)
    const [[a, b]] = hoursOf(w, i), [[a0, b0]] = hoursOf(base.w, i), d = (x: number) => ((x % 1440) + 1440) % 1440
    expect([30, 1410]).toContain(d(a - a0))
    expect(d(b - b0)).toBe(d(a - a0))
  }
  expect(n).toBeGreaterThan(0)
}, 60_000)

test('the free e-bike takes only motor commuters inside 台北市, on trips of at most the free 30 minutes', () => {
  const { c, w } = run({ [KEY.ebike]: 1 })
  const taipei = (v: number) => data.villages[v].town.startsWith('台北市')
  for (let i = 0; i < w.home.length; i++) {
    if (!(w.policy[i] & EBIKE_FREE)) continue
    expect(w.mode[i]).toBe(EBIKE)
    expect([BUS, SCOOTER, CAR]).toContain(base.w.mode[i])
    expect(taipei(w.home[i]) && taipei(w.work[i])).toBe(true)
    expect(c.city.minutes(w.home[i], w.work[i], EBIKE, 8)).toBeLessThanOrEqual(30)
  }
}, 60_000)

test('a bicycle crosses the 基隆河 on a bridge, and the new bridge is a crossing only when its setting is on', () => {
  const way = bikeWay(river, [], km), withBridge = bikeWay(river, [NEW_BRIDGE], km)
  // 迎風河濱公園 (south of the river) to the end of 港墘路 (north of it).
  const a: [number, number] = [121.5600, 25.0700], b: [number, number] = [121.5725, 25.0760]
  const off = way(a, b), on = withBridge(a, b)
  expect(off.via).toBeDefined()
  expect(on.via).toEqual([NEW_BRIDGE.lon, NEW_BRIDGE.lat])
  expect(on.km).toBeLessThan(off.km)
  expect(way(a, [121.5650, 25.0690]).via).toBeUndefined() // same side
})

test('the bridge marks exactly the e-bike riders whose way it carries', () => {
  const { c, w } = run({ [KEY.ebike]: 1, [KEY.bridge]: 1, [KEY.straight]: 1, [KEY.hub]: 1 })
  const bad: number[] = []
  for (let i = 0; i < w.home.length; i++) {
    if (!(w.policy[i] & EBIKE_FREE)) continue
    if (((w.policy[i] & ON_BRIDGE) !== 0) !== (c.bike(w.home[i], w.work[i]).via?.[0] === NEW_BRIDGE.lon)) bad.push(i)
  }
  expect(bad).toEqual([])
}, 60_000)

test('a change of the settings in a run: off gives the baseline back, on again gives the same agents, and a plan under way keeps its mode', () => {
  const { c, w } = run()
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, k: number) => x === b[k])
  advance(w, 8 * 60) // 08:00, many commuters on the way
  const mode = w.mode.slice()
  c.setPolicies({ [KEY.stagger]: 50, [KEY.ebike]: 1 }); repolicy(w)
  const on = { choice: w.choice.slice(), hours: w.hours.slice(), policy: w.policy.slice() }
  expect(same(w.mode, mode)).toBe(true) // nothing changes the plans under way
  expect(same(on.choice, base.w.choice)).toBe(false)
  c.setPolicies({}); repolicy(w)
  expect(same(w.choice, base.w.choice) && same(w.hours, base.w.hours) && w.policy.every(p => p === 0)).toBe(true)
  c.setPolicies({ [KEY.stagger]: 50, [KEY.ebike]: 1 }); repolicy(w)
  expect(same(w.choice, on.choice) && same(w.hours, on.hours) && same(w.policy, on.policy)).toBe(true)
  // The next plan to work takes the new mode: by the next morning every reached e-bike rider that left home rides it.
  advance(w, 24 * 60)
  const t = now(w)
  let rode = 0, wrong = 0
  for (let i = 0; i < w.home.length; i++) if (w.policy[i] & EBIKE_FREE && w.dep[i] >= t - 24 * 60 && w.dep[i] <= t) (w.mode[i] === EBIKE ? rode++ : wrong++)
  expect(wrong).toBe(0)
  expect(rode).toBeGreaterThan(0)
}, 120_000)

test('the what-if moves commuters whose bicycle way crosses the new bridge to the bicycle, only with the bridge', () => {
  const { c, w } = run({ [KEY.bridge]: 1, [KEY.bikeShift]: 100 })
  let moved = 0
  for (let i = 0; i < w.home.length; i++) {
    if (!(w.policy[i] & TO_BIKE)) continue
    moved++
    expect(w.mode[i]).toBe(BIKE)
    expect(c.bike(w.home[i], w.work[i]).via?.[0]).toBe(NEW_BRIDGE.lon)
    expect(c.city.minutes(w.home[i], w.work[i], BIKE, 8)).toBeLessThanOrEqual(60)
  }
  expect(moved).toBeGreaterThan(100)
  const { w: off } = run({ [KEY.bikeShift]: 100 })
  expect(off.policy.some(p => (p & TO_BIKE) !== 0)).toBe(false)
}, 120_000)

test('取直 marks exactly the cyclists whose way it shortens: across the river, with an end in 內科', () => {
  const { c, w } = run({ [KEY.straight]: 1, [KEY.bridge]: 1, [KEY.bikeShift]: 100 })
  const jobs = (v: number) => (data.villages[v].jobs ?? 0) > 0
  let marked = 0
  const bad: number[] = []
  for (let i = 0; i < w.home.length; i++) {
    const cyclist = !w.kind[i] && (w.choice[i] === BIKE || w.choice[i] === EBIKE)
    const shortened = cyclist && (jobs(w.home[i]) || jobs(w.work[i])) && c.bike(w.home[i], w.work[i]).via !== undefined
    if (((w.policy[i] & STRAIGHT) !== 0) !== shortened) bad.push(i)
    if (shortened) marked++
  }
  expect(bad).toEqual([])
  expect(marked).toBeGreaterThan(0)
}, 120_000)

test('a run that starts with the settings equals a run that turns them on later: the baseline hours use no policy', () => {
  const p = { [KEY.bridge]: 1, [KEY.straight]: 1, [KEY.ebike]: 1, [KEY.bikeShift]: 50 }
  const { w: atStart } = run(p)
  const { c, w: later } = run()
  c.setPolicies(p); repolicy(later)
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, k: number) => x === b[k])
  expect(same(atStart.base.hours, later.base.hours)).toBe(true)
  expect(same(atStart.hours, later.hours) && same(atStart.choice, later.choice) && same(atStart.policy, later.policy)).toBe(true)
}, 120_000)
