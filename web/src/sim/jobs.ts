import { roadNode, type networks } from './paths.ts'

// ponytail: the most street nodes that the trips to work of one village end at; more spreads the load into more of its
// streets, and grows the routes file (DATA.md gives its size). A guess.
const ENDS = 4

/**
 * The road node where agent i ends its trip to work in node v. At village level each street node belongs to the
 * nearest village centre, and the trips to a village end at up to ENDS of its street nodes, spread over the list,
 * one fixed by the agent's index; a village with no street node of its own ends at its nearest road node. At
 * district level every trip ends at the road node of the district.
 */
export const workNodes = (net: ReturnType<typeof networks>, coords: [number, number][], village: boolean) => {
  const g = net.road, at = new Map<number, number>()
  const near = (v: number) => at.get(v) ?? at.set(v, roadNode(net, coords, v)).get(v)!
  if (!village) return (_i: number, v: number) => near(v)
  const own: number[][] = coords.map(() => [])
  for (let u = 0; u < g.lon.length; u++) {
    if (!g.street[u]) continue
    let best = 0, d = Infinity
    coords.forEach(([x, y], v) => { const e = (x - g.lon[u]) ** 2 + (y - g.lat[u]) ** 2; if (e < d) { d = e; best = v } })
    own[best].push(u)
  }
  const ends = own.map(us => (us.length <= ENDS ? us : Array.from({ length: ENDS }, (_, k) => us[Math.floor(k * us.length / ENDS)])))
  return (i: number, v: number) => {
    const es = ends[v]
    return es.length ? es[(Math.imul(i + 1, 3266489917) >>> 0) % es.length] : near(v)
  }
}
