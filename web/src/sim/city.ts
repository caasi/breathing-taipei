import type { City } from './core.ts'

export type Village = { code: string; town: string; pop: number; arrivals: number; lon: number; lat: number }
export type Signal = Record<string, { day: number; night: number }> // weekday 07-13 activity, weekday night stay
export type Data = { od: number[][][]; districts: string[]; villages: Village[]; signal: Signal }

export const MODES = ['捷運', '公車', '機車', '汽車', '步行', '自行車'] as const
export const MRT = 0
export const WALK = 4, BIKE = 5
// Taipei residents' weekday trips, 2024 (MOTC survey via Taipei DBAS weekly 1341): bus 13.7, scooter 16.3,
// car 20.1, walk 20.8, bike 3.8 percent. New Taipei uses the same split until its own figures are found.
const OTHER = [0, 13.7, 16.3, 20.1, 20.8, 3.8]
// ponytail: assumed door-to-door speeds (km/h) and access minutes; calibrate with TDX travel times later.
const SPEED = [30, 14, 26, 22, 4.5, 12], PEAK_SPEED = [30, 11, 20, 15, 4.5, 12], ACCESS = [12, 12, 3, 6, 0, 2]
export const MAX_KM = [Infinity, Infinity, Infinity, Infinity, 2.5, 6] // walk and bike only for short trips
// Short trips (walk and bike) by people who do not commute on the OD, calibrated on two public figures:
// walking trips per MRT trip from the 2024 Taipei mode share (20.8 / 16.0), and YouBike rentals in Taipei,
// 234,000 a day in the first half of 2026 (DBAS weekly, 2026-07-29); one person rents twice (there and back).
// New Taipei uses Taipei's rates until its own figures are found.
const WALK_PER_MRT = 20.8 / 16.0, YOUBIKE_RENTALS = 234_000
// ponytail: assumed distance decay (km) of short-trip destinations; calibrate with YouBike station OD later.
const DECAY_KM: Record<number, number> = { [WALK]: 0.8, [BIKE]: 2 }
// arrivals in villages2.json are morning MRT exits summed over the 30 days of 2026-09.
const ARRIVAL_DAYS = 30
const PEAK = new Set([7, 8, 9, 17, 18, 19])
const MORNING = [5, 6, 7, 8, 9, 10, 11], EVENING = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

export const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) * r / 2), y = (b[1] - a[1]) * r
  return 6371 * Math.hypot(x, y)
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * MRT OD covers only MRT riders. People who reach work another way are added so that each district's
 * daytime population matches telecom signalling (day / night ratio applied to registered residents).
 * Their trips go from districts with a daytime surplus (and a little from the non-commuters of districts that are not short)
 * to districts with a deficit, with the MRT hour profile.
 */
const calibrate = (mrt: number[][][], residents: number[], signal: Signal, districts: string[], perAgent: number) => {
  const G = districts.length
  const morning = Array.from({ length: G }, (_, a) => Array.from({ length: G }, (_, b) => sum(MORNING.map(h => mrt[h][a][b]))))
  const out = morning.map(sum)
  const commuters = out.map((o, g) => Math.min(residents[g], o / perAgent))
  const day = residents.map((r, g) => r - (out[g] ? commuters[g] * (1 - morning[g][g] / out[g]) : 0))
  morning.forEach((row, a) => row.forEach((v, b) => { if (a !== b && out[a]) day[b] += commuters[a] * v / out[a] }))
  const target = districts.map((d, g) => residents[g] * signal[d].day / signal[d].night)
  const deficit = target.map((t, g) => Math.max(0, t - day[g]))
  const stay = residents.map((r, g) => r - commuters[g])
  // Districts short of people do not send their own residents away.
  const weight = day.map((d, g) => (deficit[g] > 0 ? 0 : d - target[g] + 0.2 * stay[g]))
  const X = sum(deficit), W = sum(weight)
  const origins = weight.map((w, g) => Math.min(stay[g], X * w / W))
  const other = Array.from({ length: G }, (_, a) => {
    const row = deficit.map((d, b) => (a === b ? 0 : d)), s = sum(row)
    return row.map(d => (s ? origins[a] * perAgent * d / s : 0))
  })
  const hourly = Array.from({ length: 24 }, (_, h) => sum(mrt[h].map(sum)))
  const mSum = sum(MORNING.map(h => hourly[h])), eSum = sum(EVENING.map(h => hourly[h]))
  const od = mrt.map((hr, h) => hr.map((row, a) => row.map((v, b) =>
    v + (MORNING.includes(h) ? other[a][b] * hourly[h] / mSum : 0) + (EVENING.includes(h) ? other[b][a] * hourly[h] / eSum : 0))))
  return { od, morningMrt: morning, other, target, commuters, hourly }
}

export const cityFrom = ({ od: mrt, districts, villages, signal }: Data, perAgent: number, level: 'district' | 'village') => {
  const g = villages.map(v => districts.indexOf(v.town))
  const popD = new Array(districts.length).fill(0), lon = [...popD], lat = [...popD]
  villages.forEach((v, i) => { popD[g[i]] += v.pop; lon[g[i]] += v.lon * v.pop; lat[g[i]] += v.lat * v.pop })
  const centreD = districts.map((_, d) => [lon[d] / popD[d], lat[d] / popD[d]] as [number, number])
  const residents = popD.map(p => Math.round(p / perAgent))
  const { od, morningMrt, other, target, commuters, hourly } = calibrate(mrt, residents, signal, districts, perAgent)

  const village = level === 'village'
  const coords = village ? villages.map(v => [v.lon, v.lat] as [number, number]) : centreD
  const groupOf = village ? g : districts.map((_, i) => i)
  // Walk and bike are allowed by the distance between the two nodes (villages at village level).
  const modeOf = (from: number, to: number, r: number) => {
    const a = groupOf[from], b = groupOf[to]
    const mrtPart = morningMrt[a][b], otherPart = other[a][b]
    if (r * (mrtPart + otherPart) < mrtPart) return MRT
    const d = km(coords[from], coords[to]), ws = OTHER.map((w, m) => (d <= MAX_KM[m] ? w : 0))
    let x = (r * (mrtPart + otherPart) - mrtPart) / otherPart * sum(ws)
    for (let m = 1; m < ws.length; m++) if ((x -= ws[m]) < 0) return m
    return ws.length - 1
  }
  // ponytail: a village's share of a district's arrivals is half MRT arrivals, half residents (no jobs data yet).
  const arrD = new Array(districts.length).fill(0)
  villages.forEach((v, i) => (arrD[g[i]] += v.arrivals))
  const to = villages.map((v, i) => 0.5 * (arrD[g[i]] ? v.arrivals / arrD[g[i]] : 0) + 0.5 * v.pop / popD[g[i]])
  const minutes = (a: number, b: number, mode: number, hour: number) =>
    ACCESS[mode] + 60 * 1.3 * km(coords[a], coords[b]) / (PEAK.has(hour) ? PEAK_SPEED : SPEED)[mode]

  const homes = village ? villages.map(v => Math.round(v.pop / perAgent)) : residents
  // Short trips stay inside the home district: the cross-district flows are already calibrated to the
  // telecom daytime targets, and a district-level run cannot show a move inside a district anyway.
  const local = village ? localTrips(districts, residents, commuters, coords, homes, villages.map(v => v.arrivals), g, hourly, perAgent) : undefined
  const city: City = village
    ? { od, group: g, homes, to, perAgent, modeOf, minutes, local }
    : { od, group: groupOf, homes, to: districts.map(() => 1), perAgent, modeOf, minutes, local }
  return { city, nodes: village ? villages.map(v => v.code) : districts, coords, target, local }
}

/**
 * Short walk and bike trips. Taipei's numbers set the rates (walkers per MRT commuter, YouBike rentals per
 * resident); every node uses them. A walker or rider goes to another village of the same district within
 * MAX_KM, chosen by its residents plus its daily MRT arrivals, with a distance decay.
 */
const localTrips = (districts: string[], residents: number[], commuters: number[], coords: [number, number][],
  homes: number[], arrivals: number[], group: number[], hourly: number[], perAgent: number) => {
  const taipei = districts.map(d => d.startsWith('台北市'))
  const tpResidents = sum(residents.filter((_, d) => taipei[d]))
  const tpMrt = sum(commuters.filter((_, d) => taipei[d]))
  const walkRate = WALK_PER_MRT * tpMrt / tpResidents
  const bikeRate = YOUBIKE_RENTALS / 2 / perAgent / tpResidents
  const attract = homes.map((h, v) => h + arrivals[v] / ARRIVAL_DAYS / perAgent)
  const lists = new Map<number, { nodes: number[]; cum: number[] }>()
  const listFor = (home: number, mode: number) => {
    const key = home * 8 + mode
    let l = lists.get(key)
    if (!l) {
      l = { nodes: [], cum: [] }
      let acc = 0
      for (let u = 0; u < coords.length; u++) {
        const d = km(coords[home], coords[u])
        if (u === home || group[u] !== group[home] || d > MAX_KM[mode]) continue
        acc += attract[u] * Math.exp(-d / DECAY_KM[mode])
        l.nodes.push(u); l.cum.push(acc)
      }
      lists.set(key, l)
    }
    return l
  }
  const pick = (home: number, r1: number, r2: number) => {
    let mode = r1 * (walkRate + bikeRate) < walkRate ? WALK : BIKE
    let l = listFor(home, mode)
    const empty = (x: typeof l) => !x.nodes.length || !x.cum[x.cum.length - 1]
    // A village with no other village of its district within walking range sends its walkers by bicycle.
    if (empty(l) && mode === WALK) { mode = BIKE; l = listFor(home, BIKE) }
    if (empty(l)) return undefined
    const x = r2 * l.cum[l.cum.length - 1]
    let lo = 0, hi = l.cum.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (l.cum[mid] > x) hi = mid; else lo = mid + 1 }
    return { work: l.nodes[lo], mode }
  }
  return { rate: homes.map(() => walkRate + bikeRate), pick, hours: hourly, walkRate, bikeRate }
}
