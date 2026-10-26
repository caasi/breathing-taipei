/**
 * Fit CAPACITY in web/src/sim/traffic.ts to the TomTom congestion level of 台北市 (DATA.md, "Figures in the code").
 *
 * Usage (from the repository root, Node 24, after `pnpm routes` in web/):
 *   node --experimental-strip-types scripts/traffic.ts
 *
 * It runs the app's model (seed 42, 10 people per agent, village level) on the workday 2026-10-27 and takes the
 * people on the road of each cell every 15 minutes. The congestion level is the extra travel time over free flow,
 * averaged over the people on the roads of the cells of 台北市. The routes follow the traffic (traffic.ts take), so
 * the level is not a simple power of the capacity: the script bisects the capacity until the morning level is within
 * 0.5 points of TomTom (the level falls as the capacity grows).
 * It prints the fitted capacity and the levels of both peaks with it.
 */
import { readFileSync } from 'node:fs'
import { init, advance } from '../web/src/sim/core.ts'
import { cityFrom } from '../web/src/sim/city.ts'
import { kindAt, indexOf, type Calendar } from '../web/src/sim/calendar.ts'
import { networks, readRoutes, roadNode, routeKey } from '../web/src/sim/paths.ts'
import { CAPACITY, cellLoad, extraTime, gridOf, liveOf, roadUse, take } from '../web/src/sim/traffic.ts'
import { workNodes } from '../web/src/sim/jobs.ts'

// TomTom Traffic Index 2025, 台北市: morning rush hour 64.6%, evening rush hour 92%.
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

// A bucket (the roads of one class in a cell) is in 台北市 when the village nearest to the first node of its first edge is.
const villages: { town: string; lon: number; lat: number }[] = data.villages, grid = gridOf(roadJson, pub('road-names.json').edge)
const taipei = new Array<boolean | undefined>(grid.km.length)
roadJson.edges.forEach(([a]: number[], e: number) => {
  if (taipei[grid.cellOf[e]] !== undefined) return
  let best = 0, d = Infinity
  villages.forEach((v, i) => { const x = (v.lon - roadJson.lon[a]) ** 2 + (v.lat - roadJson.lat[a]) ** 2; if (x < d) { d = x; best = i } })
  taipei[grid.cellOf[e]] = villages[best].town.startsWith('台北市')
})

const run = (capacity: number) => {
  const c = cityFrom(data, PER_AGENT, 'village', day => kindAt(cal, start + day)), w = init(c.city, SEED)
  const use = roadUse(w, (i, leg, v) => routes.get(routeKey(at(w.home[i]), leg ? at(w.play[i]) : workAt(i, w.work[i]), v)), metres)
  const live = liveOf(roadJson, grid)
  const load = new Float32Array(metres.length), sums = new Map<number, [number, number]>() // hour -> [people x extra, people]
  for (let slot = 0; slot < 96; slot++, advance(w, 15)) {
    take(w, use, load, live, undefined, capacity)
    const hour = Math.floor(slot / 4)
    if (!MORNING.hours.includes(hour) && !EVENING.hours.includes(hour)) continue
    const s = sums.get(hour) ?? [0, 0]
    cellLoad(load, grid).forEach((p, k) => { if (p && taipei[k]) { s[0] += p * extraTime(p, grid.km[k], capacity * grid.lanes[k]); s[1] += p } })
    sums.set(hour, s)
  }
  const level = (hours: number[]) => { let x = 0, n = 0; for (const h of hours) { x += sums.get(h)![0]; n += sums.get(h)![1] } return x / n }
  return { morning: level(MORNING.hours), evening: level(EVENING.hours) }
}
let low = CAPACITY / 4, high = CAPACITY * 4, capacity = CAPACITY, got = run(capacity)
for (let k = 0; k < 16 && Math.abs(got.morning - MORNING.level) > 0.005; k++) {
  if (got.morning > MORNING.level) low = capacity; else high = capacity
  capacity = Math.sqrt(low * high); got = run(capacity)
}
console.log(`capacity ${capacity.toFixed(1)} people per km of street (CAPACITY is ${CAPACITY})`)
console.log(`with it: morning ${(100 * got.morning).toFixed(1)}% (TomTom ${(100 * MORNING.level).toFixed(1)}%), evening ${(100 * got.evening).toFixed(1)}% (TomTom ${(100 * EVENING.level).toFixed(1)}%)`)
