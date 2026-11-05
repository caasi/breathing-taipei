import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { init, hoursOf } from './core.ts'
import { cityFrom, km, EBIKE, BUS, SCOOTER, CAR } from './city.ts'
import { bikeWay, KEY, NEW_BRIDGE, STAGGERED, EBIKE_FREE, ON_BRIDGE, type River } from './policy.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const river: River = pub('river.json')
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), river }
const run = (policies = {}) => { const c = cityFrom(data, 10, undefined, policies); return { c, w: init(c.city, 42) } }
// One baseline for all tests: building the city and the world takes seconds.
const base = run()

test('a policy changes only the agents it reaches: every other agent is as in the baseline', () => {
  const { w } = run({ [KEY.stagger]: 0.5, [KEY.ebike]: 1 })
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
  const { w } = run({ [KEY.stagger]: 0.5 })
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

test('the bridge marks the e-bike riders whose way it carries', () => {
  const { w } = run({ [KEY.ebike]: 1, [KEY.bridge]: 1 })
  expect(w.policy.some(p => (p & ON_BRIDGE) !== 0)).toBe(true)
}, 60_000)
