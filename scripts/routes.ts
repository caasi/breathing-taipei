/**
 * Make the road paths of the app's run ahead of time, so the page does not route them on start.
 *
 * Usage (from the repository root, Node 24):
 *   node --experimental-strip-types scripts/routes.ts
 *
 * Reads web/public/*.json and writes web/public/road-routes.bin. It runs the model as the app does
 * (seed 42, 10 people per agent, village and district level) and routes every road trip (bus, scooter,
 * car), to work and to the day-off place, between two different road nodes that the road graph connects.
 * Run it again after a change to the road graph, the routing code, the model, or the app's seed or
 * PER_AGENT. The worker ignores a file for another road graph; for a stale model it routes the trips
 * that the file does not hold.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { init } from '../web/src/sim/core.ts'
import { cityFrom } from '../web/src/sim/city.ts'
import { networks, ROAD_MODES, roadNode, routeKey, writeRoutes } from '../web/src/sim/paths.ts'
import { tree, edgesTo } from '../web/src/sim/route.ts'

const SEED = 42, PER_AGENT = 10 // the app's values (web/src/App.tsx)
const pub = (f: string) => JSON.parse(readFileSync(new URL(`../web/public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
const net = networks(pub('road-graph.json'), pub('mrt-graph.json'))

const wanted = new Map<number, Set<number>>() // from road node -> to road nodes
for (const level of ['village', 'district'] as const) {
  // The kind of each day does not matter here: the day-off places are drawn at init, whatever the calendar says.
  const c = cityFrom(data, PER_AGENT, level, () => 0), w = init(c.city, SEED)
  const node = new Map<number, number>()
  const at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, c.coords, v)).get(v)!
  const want = (home: number, to: number, mode: number) => {
    if (!ROAD_MODES.has(mode)) return
    const a = at(home), b = at(to)
    if (a !== b) (wanted.get(a) ?? wanted.set(a, new Set()).get(a)!).add(b)
  }
  for (const i of w.movers) { want(w.home[i], w.work[i], w.mode[i]); want(w.home[i], w.play[i], w.playMode[i]) }
}
const paths = new Map<number, number[]>()
for (const [a, bs] of wanted) {
  const { via, dist } = tree(net.road, a)
  // An unreachable pair stays out, so the worker routes it as before.
  for (const b of bs) if (Number.isFinite(dist[b])) paths.set(routeKey(a, b), edgesTo(net.road, via, b))
}
const out = writeRoutes(net.road, paths)
writeFileSync(new URL('../web/public/road-routes.bin', import.meta.url), out)
console.log(`${paths.size} paths from ${wanted.size} road nodes, ${out.byteLength} bytes`)
