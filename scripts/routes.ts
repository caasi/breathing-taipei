/**
 * Make the road paths ahead of time: one contraction hierarchy (web/src/sim/ch.ts) for each variant of paths.ts, so
 * the page finds the exact shortest path between any two road nodes without routing the whole graph.
 *
 * Usage (from the repository root, Node 24):
 *   node --experimental-strip-types scripts/routes.ts
 *
 * Reads web/public/road-graph.json and web/public/mrt-graph.json and writes web/public/road-routes.bin.
 * Run it again after a change to the road graph or to the routing costs (route.ts, paths.ts variantWeights). The model
 * does not change the file. The worker ignores a file for another road graph.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { networks, variantWeights, writeRoutes } from '../web/src/sim/paths.ts'
import { contract } from '../web/src/sim/ch.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../web/public/${f}`, import.meta.url), 'utf8'))
const g = networks(pub('road-graph.json'), pub('mrt-graph.json')).road
const parts = variantWeights(g).map(w => contract(g, w))
const out = writeRoutes(g, parts)
writeFileSync(new URL('../web/public/road-routes.bin', import.meta.url), out)
console.log(`${parts.map(p => p.shortcuts.length / 2).join(' + ')} shortcuts, ${out.byteLength} bytes`)
