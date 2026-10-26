/**
 * Fit CAPACITY in web/src/sim/traffic.ts to the TomTom congestion level of 台北市 (DATA.md, "Figures in the code").
 *
 * Usage (from the repository root, Node 24, after `pnpm routes` in web/):
 *   node --experimental-strip-types scripts/traffic.ts
 *
 * It runs the app's model (seed 42, 10 people per agent, village level) on the workday 2026-10-27 and takes the
 * traffic every 15 minutes, as the app does. The congestion level is that of TomTom: the extra travel time of the
 * trips over their time on the road with no jam (without the minutes off the road, city.ts ACCESS), summed over the trips (so a long trip weighs more, as TomTom counts per 10 km).
 * The trips are the road trips (bus, scooter, car) to work in 台北市 that leave home in the morning hours, and the
 * trips home from work in 台北市 that leave in the evening hours. The traffic changes the trips (traffic.ts take), so
 * the level is not a simple power of the capacity: the script bisects the capacity until the morning level is within
 * 0.5 points of TomTom (the level falls as the capacity grows).
 * It prints the fitted capacity and the levels of both peaks with it.
 */
import { readFileSync } from 'node:fs'
import { init, advance, now, WORK } from '../web/src/sim/core.ts'
import { ACCESS, cityFrom } from '../web/src/sim/city.ts'
import { kindAt, indexOf, type Calendar } from '../web/src/sim/calendar.ts'
import { networks, readRoutes, ROAD_MODES, roadNode } from '../web/src/sim/paths.ts'
import { CAPACITY, gridOf, liveOf, roadUse, take } from '../web/src/sim/traffic.ts'
import { workNodes } from '../web/src/sim/jobs.ts'

// TomTom Traffic Index 2025, 台北市: morning rush hour 64.6%, evening rush hour 92%. ponytail: TomTom does not give the
// hours of its rush hours; 07:00 to 09:59 and 17:00 to 19:59 are guesses (KNOWN-ISSUES.md).
const MORNING = { level: 0.646, hours: [7, 8, 9] }, EVENING = { level: 0.92, hours: [17, 18, 19] }
const SEED = 42, PER_AGENT = 10, DAY = '2026-10-27'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../web/public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
const cal: Calendar = pub('calendar.json'), start = indexOf(cal, DAY)
const { coords } = cityFrom(data, PER_AGENT, 'village', day => kindAt(cal, start + day))
const roadJson = pub('road-graph.json'), net = networks(roadJson, pub('mrt-graph.json'))
const file = readFileSync(new URL('../web/public/road-routes.bin', import.meta.url))
const routes = readRoutes(new Uint16Array(file.buffer, file.byteOffset, file.byteLength / 2), net.road)
if (!routes) throw new Error('road-routes.bin is missing or for another road graph: run `pnpm routes` in web/')
const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, coords, v)).get(v)!
const workAt = workNodes(net, coords, true)
const metres: number[] = roadJson.edges.map((e: number[]) => e[2])
const villages: { town: string }[] = data.villages, grid = gridOf(roadJson, pub('road-names.json').edge)
const inTaipei = (v: number) => villages[v].town.startsWith('台北市')

const run = (capacity: number) => {
  const c = cityFrom(data, PER_AGENT, 'village', day => kindAt(cal, start + day)), w = init(c.city, SEED)
  const live = liveOf(roadJson, grid)
  const use = roadUse(w, routes, (i, leg) => [at(w.home[i]), leg ? at(w.play[i]) : workAt(i, w.work[i])], live.time)
  const load = new Float32Array(metres.length)
  // Per trip, seen before it leaves: [planned start, time with no jam]; per peak: [extra time, time with no jam].
  const trips = [new Map<number, number[]>(), new Map<number, number[]>()], sums = [[0, 0], [0, 0]]
  const peaks = [MORNING.hours, EVENING.hours]
  const done = (back: number, i: number, end: number) => {
    const seen = trips[back].get(i)
    // TomTom counts the time on the road, so the minutes off the road (city.ts ACCESS) are not in the time with no jam.
    if (seen?.length === 2) { seen.push(end); sums[back][0] += end - seen[0] - seen[1]; sums[back][1] += Math.max(1, seen[1] - ACCESS[w.mode[i]]) }
  }
  // An agent home again gets its next plan at once (core.ts advance), so the end of a trip home is seen here.
  w.onPlan = i => done(1, i, w.done)
  // The first take at 00:15, as the worker's stepper takes at each boundary that it reaches.
  for (let slot = 0; slot < 96; slot++) {
    advance(w, 15)
    take(w, use, load, live, undefined, capacity)
    const t = now(w)
    for (const i of w.movers) {
      if (w.dest[i] !== WORK || !ROAD_MODES.has(w.mode[i]) || !inTaipei(w.work[i])) continue
      for (const back of [0, 1]) {
        const start = back ? w.ret[i] : w.dep[i], end = back ? w.ret[i] + w.dur2[i] : w.dep[i] + w.dur1[i], seen = trips[back].get(i)
        if (!seen && t < start && start < 1440 && peaks[back].includes(Math.floor(start / 60))) trips[back].set(i, [start, end - start])
        else if (!back && t >= end) done(0, i, end)
      }
    }
  }
  return { morning: sums[0][0] / sums[0][1], evening: sums[1][0] / sums[1][1] }
}
let low = CAPACITY / 4, high = CAPACITY * 4, capacity = CAPACITY, got = run(capacity)
for (let k = 0; k < 16 && Math.abs(got.morning - MORNING.level) > 0.005; k++) {
  if (got.morning > MORNING.level) low = capacity; else high = capacity
  capacity = Math.sqrt(low * high); got = run(capacity)
}
console.log(`capacity ${capacity.toFixed(1)} PCU per km of street (CAPACITY is ${CAPACITY})`)
console.log(`with it: morning ${(100 * got.morning).toFixed(1)}% (TomTom ${(100 * MORNING.level).toFixed(1)}%), evening ${(100 * got.evening).toFixed(1)}% (TomTom ${(100 * EVENING.level).toFixed(1)}%)`)
// The capacity is searched within CAPACITY / 4 to CAPACITY x 4; a level out of reach there is a miss, not a fit.
if (Math.abs(got.morning - MORNING.level) > 0.005) {
  console.error(`the morning level is not within 0.5 points of TomTom: do not use this capacity`)
  process.exitCode = 1
}
