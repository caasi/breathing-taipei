/**
 * Fit CAPACITY in web/src/sim/traffic.ts to the TomTom congestion level of 台北市 (DATA.md, "Figures in the code").
 *
 * Usage (from the repository root, Node 24, after `pnpm routes` in web/):
 *   node --experimental-strip-types scripts/traffic.ts
 *
 * It runs the app's model (seed 42, 10 people per agent, village level) on the workday 2026-10-27 and takes the
 * people on the road of each cell every 15 minutes. The congestion level is the extra travel time over free flow,
 * averaged over the people on the roads of the cells of 台北市. BPR makes it proportional to capacity^-4, so one run
 * gives the capacity.
 * It prints the fitted capacity and the levels of both peaks with it.
 */
import { readFileSync } from 'node:fs'
import { init, advance } from '../web/src/sim/core.ts'
import { cityFrom } from '../web/src/sim/city.ts'
import { kindAt, indexOf, type Calendar } from '../web/src/sim/calendar.ts'
import { networks, readRoutes, roadNode, routeKey } from '../web/src/sim/paths.ts'
import { CAPACITY, cellLoad, extraTime, gridOf, loadNow, roadUse } from '../web/src/sim/traffic.ts'

// TomTom Traffic Index 2025, 台北市: morning rush hour 64.6%, evening rush hour 92%.
const MORNING = { level: 0.646, hours: [7, 8, 9] }, EVENING = { level: 0.92, hours: [17, 18, 19] }
const SEED = 42, PER_AGENT = 10, DAY = '2026-10-27'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../web/public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
const cal: Calendar = pub('calendar.json'), start = indexOf(cal, DAY)
const c = cityFrom(data, PER_AGENT, 'village', day => kindAt(cal, start + day)), w = init(c.city, SEED)
const roadJson = pub('road-graph.json'), net = networks(roadJson, pub('mrt-graph.json'))
const file = readFileSync(new URL('../web/public/road-routes.bin', import.meta.url))
const routes = readRoutes(new Uint16Array(file.buffer, file.byteOffset, file.byteLength / 2), net.road)
if (!routes) throw new Error('road-routes.bin is missing or for another road graph: run `pnpm routes` in web/')
const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
const metres: number[] = roadJson.edges.map((e: number[]) => e[2])
const use = roadUse(w, (a, b) => routes.get(routeKey(at(a), at(b))), metres)

// A bucket (the roads of one class in a cell) is in 台北市 when the village nearest to the first node of its first edge is.
const villages: { town: string; lon: number; lat: number }[] = data.villages, grid = gridOf(roadJson)
const taipei = new Array<boolean | undefined>(grid.km.length)
roadJson.edges.forEach(([a]: number[], e: number) => {
  if (taipei[grid.cellOf[e]] !== undefined) return
  let best = 0, d = Infinity
  villages.forEach((v, i) => { const x = (v.lon - roadJson.lon[a]) ** 2 + (v.lat - roadJson.lat[a]) ** 2; if (x < d) { d = x; best = i } })
  taipei[grid.cellOf[e]] = villages[best].town.startsWith('台北市')
})
// Any capacity gives the same fit, as the level scales with capacity^-4.
const REFERENCE = 100

const load = new Float32Array(metres.length), sums = new Map<number, [number, number]>() // hour -> [people x extra, people]
for (let slot = 0; slot < 96; slot++, advance(w, 15)) {
  const hour = Math.floor(slot / 4)
  if (!MORNING.hours.includes(hour) && !EVENING.hours.includes(hour)) continue
  loadNow(w, use, load)
  const s = sums.get(hour) ?? [0, 0]
  cellLoad(load, grid).forEach((p, c) => { if (p && taipei[c]) { s[0] += p * extraTime(p, grid.km[c], REFERENCE * grid.lanes[c]); s[1] += p } })
  sums.set(hour, s)
}
const level = (hours: number[], capacity: number) => {
  let x = 0, n = 0
  for (const h of hours) { x += sums.get(h)![0]; n += sums.get(h)![1] }
  return x / n * (REFERENCE / capacity) ** 4
}
const fitted = REFERENCE * (level(MORNING.hours, REFERENCE) / MORNING.level) ** (1 / 4)
console.log(`capacity ${fitted.toFixed(1)} people per km (CAPACITY is ${CAPACITY})`)
console.log(`with it: morning ${(100 * level(MORNING.hours, fitted)).toFixed(1)}% (TomTom ${(100 * MORNING.level).toFixed(1)}%), evening ${(100 * level(EVENING.hours, fitted)).toFixed(1)}% (TomTom ${(100 * EVENING.level).toFixed(1)}%)`)
