import type { World } from './core.ts'

/** Policy settings by key (the keys of the query string), as numbers: 0 or 1 for a toggle, the value of a range. */
export type Policies = Record<string, number>

/** river.json (scripts/river.py): the ways of the 基隆河 and the points where a bicycle can cross it. */
export type River = { river: [number, number][][]; crossings: { name: string; lon: number; lat: number }[] }

// Bits of World.policy: the policies that changed an agent, for its events.
export const STAGGERED = 1, EBIKE_FREE = 2, ON_BRIDGE = 4, WASHED = 8

// The policies of the 內湖 bundle of 沈伯洋 (docs/platforms/shen.md).
export const KEY = { stagger: 'neihu-stagger', ebike: 'ebike-free', bridge: 'bike-bridge', straight: 'riverside-straight', hub: 'bike-hub' } as const

// ponytail: the point where 迎風河濱公園 meets the end of 港墘路 is a guess; the platform names the two ends only, and the
// news gives a length of about 340 m (DATA.md, "Figures in the code").
export const NEW_BRIDGE = { name: '迎風—港墘橋', lon: 121.5713, lat: 25.0741 }

type Point = [number, number]
const side = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const crosses = (a: Point, b: Point, c: Point, d: Point) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0

/**
 * The way of a bicycle between two points: straight, or through the crossing that makes the way shortest when the
 * straight line crosses the river. `km` is the distance of points. The model has no bicycle paths: this is the one
 * place where the river makes a bicycle trip longer.
 */
export const bikeWay = (river: River, extra: River['crossings'], km: (a: Point, b: Point) => number) => {
  const crossings = [...river.crossings, ...extra].map(c => [c.lon, c.lat] as Point)
  return (a: Point, b: Point): { km: number; via?: Point } => {
    const across = river.river.some(r => r.some((p, k) => k > 0 && crosses(a, b, r[k - 1], p)))
    if (!across) return { km: km(a, b) }
    let best = Infinity, via: Point | undefined
    for (const c of crossings) { const d = km(a, c) + km(c, b); if (d < best) { best = d; via = c } }
    return { km: best, via }
  }
}

/**
 * The 內湖 bundle on an agent of the OD that works away from home. Each agent draws the same random numbers whatever
 * the settings, from a stream of its own, so at the start of a run a policy changes only the agents it reaches.
 * - stagger (0 to 1): the share of the workers of 內科 whose firm takes the reward to stagger its hours. ponytail: such
 *   a worker starts and ends work 30 minutes earlier or later, half each way; a guess, there is no figure.
 * - ebike: in the free hours (08:00 to 10:00, 17:00 to 19:00), a commuter by bus, scooter or car whose trip by e-bike
 *   takes at most the free 30 minutes, with both ends in 台北市, rides a YouBike 2.0E with probability SWITCH (hub
 *   adds HUB_MORE), up to the e-bikes that the fleet has.
 */
export type Bundle = {
  stagger: number; ebike: boolean; hub: boolean
  jobs: (node: number) => boolean // a village of 內科
  taipei: (node: number) => boolean
  ebikeMinutes: (home: number, work: number) => number
  onNewBridge: (home: number, work: number) => boolean
  isMotor: (mode: number) => boolean
  EBIKE_MODE: number
  perAgent: number
}

// ponytail: guesses until a source gives them (DATA.md, "Figures in the code"). SWITCH: the share of the reached
// commuters who move to the e-bike. HUB_MORE: how much the showers of the 運動驛站 add to it. FLEET: the YouBike 2.0E
// of 臺北市, from a plan reported in 2024 (4,500 by the end of 2026, not checked against the fleet now); TURNS: rides
// of one e-bike in one free window.
const SWITCH = 0.1, HUB_MORE = 0.5, FLEET = 4500, TURNS = 2, SHIFT = 30
const FREE: [number, number][] = [[8 * 60, 10 * 60], [17 * 60, 19 * 60]]
const inFree = (m: number) => FREE.some(([a, b]) => m >= a && m < b)
const mod = (t: number) => ((t % 1440) + 1440) % 1440

export const applyBundle = (b: Bundle) => (w: World, rng: () => number) => {
  const reach: number[] = []
  for (let i = 0; i < w.home.length; i++) {
    const r1 = rng(), r2 = rng(), r3 = rng()
    if (w.kind[i] || w.work[i] === w.home[i]) continue
    const h = w.home[i], k = w.work[i]
    if (b.jobs(k) && r1 < b.stagger) {
      const s = r2 < 0.5 ? -SHIFT : SHIFT
      w.hours[2 * i] = mod(w.hours[2 * i] + s); w.hours[2 * i + 1] = mod(w.hours[2 * i + 1] + s)
      w.policy[i] |= STAGGERED
    }
    if (!b.ebike || !b.isMotor(w.mode[i]) || !b.taipei(h) || !b.taipei(k)) continue
    const minutes = b.ebikeMinutes(h, k)
    if (minutes > 30 || !(inFree(mod(w.hours[2 * i] - minutes)) || inFree(w.hours[2 * i + 1]))) continue
    if (r3 < SWITCH * (b.hub ? 1 + HUB_MORE : 1)) reach.push(i)
  }
  // The fleet caps the riders: when more are reached than the e-bikes can carry, each reached one rides with the same chance.
  const room = FLEET * TURNS / b.perAgent, keep = Math.min(1, room / Math.max(1, reach.length))
  for (const i of reach) {
    if (rng() >= keep) continue
    w.mode[i] = b.EBIKE_MODE
    w.policy[i] |= EBIKE_FREE | (b.onNewBridge(w.home[i], w.work[i]) ? ON_BRIDGE : 0) | (b.hub ? WASHED : 0)
  }
}
