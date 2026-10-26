/**
 * Compare the app's model with the measured traffic of VALIDATION.md: the spread of the peak slowness of the named
 * roads of 台北市 (as scripts/tdx.py measures the TDX sections), and the news hotspots.
 *
 * Usage (from the repository root, Node 24, after `pnpm routes` in web/):
 *   node --experimental-strip-types scripts/validate.ts
 *
 * It runs the model as scripts/traffic.ts does (seed 42, 10 people per agent, village level, the workday 2026-10-27,
 * a take every 15 minutes from 00:15). The slowness of a bucket at a peak is the median of all its takes from 07:00 to
 * 09:59 (am) or 17:00 to 19:59 (pm), a take with no traveller counting as free (1), for the buckets that have a
 * traveller at a take of that peak, as a detector of TDX gives a speed at every minute of the peak; a hotspot is a road
 * name, and its level the highest of its buckets at the peak.
 * The per-trip levels against TomTom are printed by scripts/traffic.ts.
 */
import { readFileSync } from 'node:fs'
import { init, advance, now } from '../web/src/sim/core.ts'
import { cityFrom } from '../web/src/sim/city.ts'
import { kindAt, indexOf, type Calendar } from '../web/src/sim/calendar.ts'
import { networks, readRoutes, roadNode } from '../web/src/sim/paths.ts'
import { cellLoad, gridOf, liveOf, roadUse, take } from '../web/src/sim/traffic.ts'
import { workNodes } from '../web/src/sim/jobs.ts'

// The roads of the news of 2026 (VALIDATION.md, "Hotspots"), by a prefix of their name in road-names.json.
const HOTSPOTS = ['台北橋', '重陽橋', '中興橋', '艋舺大道', '中華路二段', '華翠大橋', '承德路', '洲美快速道路', '重慶北路四段',
  '堤頂大道', '環東大道', '港墘路', '瑞光路', '舊宗路', '民權東路六段', '國道1號', '中正路', '至善路', '木柵路']

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../web/public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
const cal: Calendar = pub('calendar.json'), start = indexOf(cal, '2026-10-27')
const c = cityFrom(data, 10, 'village', day => kindAt(cal, start + day)), w = init(c.city, 42)
const road = pub('road-graph.json'), names = pub('road-names.json'), net = networks(road, pub('mrt-graph.json'))
const file = readFileSync(new URL('../web/public/road-routes.bin', import.meta.url))
const routes = readRoutes(new Uint16Array(file.buffer, file.byteOffset, file.byteLength / 2), net.road)
if (!routes) throw new Error('road-routes.bin is missing or for another road graph: run `pnpm routes` in web/')
const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
const workAt = workNodes(net, c.coords, true), grid = gridOf(road, names.edge), live = liveOf(road, grid)
const use = roadUse(w, routes, (i, leg) => [at(w.home[i]), leg ? at(w.play[i]) : workAt(i, w.work[i])], live.time)

// A bucket is in 台北市 when the village nearest to the first node of its first edge is; its name is the road's.
const villages: { town: string; lon: number; lat: number }[] = data.villages
const taipei: boolean[] = [], nameOf: (string | undefined)[] = []
road.edges.forEach(([a]: number[], e: number) => {
  const b = grid.cellOf[e]
  if (taipei[b] !== undefined) return
  let best = 0, d = Infinity
  villages.forEach((v, i) => { const x = (v.lon - road.lon[a]) ** 2 + (v.lat - road.lat[a]) ** 2; if (x < d) { d = x; best = i } })
  taipei[b] = villages[best].town.startsWith('台北市'); nameOf[b] = names.edge[e] >= 0 ? names.names[names.edge[e]] : undefined
})

const load = new Float32Array(road.edges.length), peaks = { am: new Map<number, number[]>(), pm: new Map<number, number[]>() }
const used = { am: new Set<number>(), pm: new Set<number>() }
for (let slot = 0; slot < 96; slot++) {
  advance(w, 15)
  take(w, use, load, live)
  const h = Math.floor(now(w) / 60), k = h >= 7 && h < 10 ? 'am' : h >= 17 && h < 20 ? 'pm' : undefined
  if (k) cellLoad(load, grid).forEach((p, b) => {
    if (!taipei[b] || !nameOf[b]) return
    const xs = peaks[k].get(b) ?? []
    xs.push(live.slower[b]); if (p) used[k].add(b)
    peaks[k].set(b, xs)
  })
}
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1]
for (const k of ['am', 'pm'] as const) {
  const bucket = new Map([...peaks[k]].filter(([b]) => used[k].has(b)).map(([b, xs]) => [b, median(xs)]))
  const rs = [...bucket.values()].sort((a, b) => a - b), q = (x: number) => rs[Math.min(rs.length - 1, Math.floor(x * rs.length))].toFixed(2)
  console.log(`${k}: ${rs.length} named buckets of 台北市, p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${rs[rs.length - 1].toFixed(2)}`)
  const road = new Map<string, number>()
  bucket.forEach((x, b) => road.set(nameOf[b]!, Math.max(road.get(nameOf[b]!) ?? 0, x)))
  const ranked = [...road].sort((a, b) => b[1] - a[1])
  console.log(HOTSPOTS.map(h => {
    const r = ranked.findIndex(([n]) => n.startsWith(h))
    return r < 0 ? `${h} -` : `${h} ${ranked[r][1].toFixed(2)}x (${r + 1}/${ranked.length})`
  }).join(', '))
}
