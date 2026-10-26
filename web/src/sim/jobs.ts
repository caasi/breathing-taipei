import { nearest } from './route.ts'
import { roadNode, type networks } from './paths.ts'

/** The company spots of the villages with known jobs (jobs.json, scripts/villages.py): code -> [lon, lat, companies][]. */
export type JobsJson = Record<string, [number, number, number][]>

/**
 * The road node where agent i ends its trip to node v: for a village with company spots, the street node nearest to one
 * spot, drawn by the companies of each spot and fixed by the agent's index; elsewhere the road node of v. At district
 * level no node has spots (the keys are village codes).
 */
export const workNodes = (net: ReturnType<typeof networks>, coords: [number, number][], codes: string[], jobs: JobsJson) => {
  const spots = codes.map(c => jobs[c]), node = new Map<number, number>(), spot = new Map<string, number>()
  const at = (v: number) => node.get(v) ?? node.set(v, roadNode(net, coords, v)).get(v)!
  return (i: number, v: number) => {
    const s = spots[v]
    if (!s) return at(v)
    let x = (Math.imul(i + 1, 3266489917) >>> 0) / 2 ** 32 * s.reduce((t, p) => t + p[2], 0), k = 0
    while (k < s.length - 1 && (x -= s[k][2]) >= 0) k++
    const key = `${s[k][0]},${s[k][1]}`
    return spot.get(key) ?? spot.set(key, nearest(net.road, s[k][0], s[k][1], u => net.road.street[u] === 1)).get(key)!
  }
}
