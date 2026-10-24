import type { City, Kind } from './core.ts'

export type Village = { code: string; town: string; pop: number; arrivals: number; lon: number; lat: number }
export type Signal = Record<string, { day: number; night: number }> // weekday 07-13 activity, weekday night stay
/** Businesses per village (villages2.json order) for each name in kinds; built by scripts/night.py. */
export type Night = { date: string; kinds: string[]; counts: number[][] }
export type Data = { od: number[][][]; districts: string[]; villages: Village[]; signal: Signal; night?: Night }

export const MODES = ['捷運', '公車', '機車', '汽車', '步行', '自行車'] as const
export const MRT = 0
export const WALK = 4, BIKE = 5
// Taipei residents' weekday trips, 2024 (MOTC survey via Taipei DBAS weekly 1341): bus 13.7, scooter 16.3,
// car 20.1, walk 20.8, bike 3.8 percent. New Taipei uses the same split until its own figures are found.
const OTHER = [0, 13.7, 16.3, 20.1, 20.8, 3.8], MRT_SHARE = 16.0
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

// ponytail: guessed on 2026-10-24 (no public source gives people per business, shift shares or visitors);
// replace with survey figures when found. Real people per business, the share of them on this shift,
// and the hours they leave home and leave work.
const SHIFTS = [
  { name: 'early', from: { early: 2.5 }, share: 1, dep: [4, 5], ret: [11] }, // breakfast shops
  { name: 'evening', from: { food: 4 }, share: 0.5, dep: [15, 16], ret: [22, 23] }, // restaurants, drink shops
  { name: 'overnight', from: { convenience: 8, hotel: 15 }, share: 1 / 3, dep: [22], ret: [7] },
  { name: 'nightlife', from: { nightlife: 10 }, share: 1, dep: [19, 20], ret: [3, 4] },
]
const WORK_DECAY_KM = 5
// Visitors per worker of a shift, and where they go (the businesses of that shift).
const VISITS = [
  { name: 'dinner', shift: 'evening', per: 1, dep: [18, 19], ret: [20], decay: 2 },
  { name: 'night-out', shift: 'nightlife', per: 5, dep: [21, 22], ret: [0, 1], decay: 6 },
]
// Hours (start, end) in which a mode runs. Buses of both cities: most first buses leave at 05:00 or later
// and most last buses before 24:00 (route files GetRoute.gz, 2026-10-24). MRT: od2.json has 44 trips in
// hour 5 and 34,851 in hour 6; hour 0 still has 10,629 (the last trains) but counts as closed here.
const SERVICE: Record<number, [number, number]> = { [MRT]: [6, 24], 1: [5, 24] }
const runs = (mode: number, hours: number[]) => !SERVICE[mode] || hours.every(h => h >= SERVICE[mode][0] && h < SERVICE[mode][1])
/** Mode by the survey split of Taipei residents, for a trip of d km in the given hours. */
const surveyMode = (d: number, hours: number[], r: number) => {
  const ws = [MRT_SHARE, ...OTHER.slice(1)].map((w, m) => (d <= MAX_KM[m] && runs(m, hours) ? w : 0))
  let x = r * sum(ws), last = 0
  for (let m = 0; m < ws.length; m++) if (ws[m]) { last = m; if ((x -= ws[m]) < 0) return m }
  return last
}
const weights = (hours: number[]) => Array.from({ length: 24 }, (_, h) => (hours.includes(h) ? 1 : 0))

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

export const cityFrom = ({ od: mrt, districts, villages, signal, night }: Data, perAgent: number, level: 'district' | 'village') => {
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
  const nightKinds = night ? nightTrips(night, g, groupOf, village, centreD, coords, homes, perAgent) : []
  const kinds = [...(local ? [local] : []), ...nightKinds]
  const city: City = village
    ? { od, group: g, homes, to, perAgent, modeOf, minutes, kinds }
    : { od, group: groupOf, homes, to: districts.map(() => 1), perAgent, modeOf, minutes, kinds }
  return { city, nodes: village ? villages.map(v => v.code) : districts, coords, target }
}

/**
 * Night-time workers (SHIFTS) and visitors (VISITS). Places of work come from the businesses in night.json.
 * Each kind is the same share of the residents of every node, taken from those who do not commute on the OD
 * and do not make a short trip; the work district is drawn with a gravity rule
 * (businesses x exp(-distance / decay) between district centers), then the village by its businesses.
 * At district level the district is the node.
 */
const nightTrips = (night: Night, villageGroup: number[], nodeGroup: number[], village: boolean, centreD: [number, number][],
  coords: [number, number][], homes: number[], perAgent: number): Kind[] => {
  const G = centreD.length, total = sum(homes)
  const col = (name: string) => night.counts.map(c => c[night.kinds.indexOf(name)])
  const shifts = SHIFTS.map(s => {
    const people = Object.entries(s.from).map(([k, per]) => col(k).map(n => n * per * s.share))
    return { ...s, jobs: villageGroup.map((_, v) => sum(people.map(p => p[v]))), decay: WORK_DECAY_KM }
  })
  const visits = VISITS.map(x => {
    const s = shifts.find(s => s.name === x.shift)!
    return { ...x, jobs: s.jobs.map(j => j * x.per), places: s.jobs }
  })
  return [...shifts.map(s => ({ ...s, places: s.jobs })), ...visits].map(k => {
    const people = sum(k.jobs)
    // Places per node: villages at village level, districts at district level.
    const place = new Array(nodeGroup.length).fill(0)
    k.places.forEach((p, v) => (place[village ? v : villageGroup[v]] += p))
    const placeD = new Array(G).fill(0)
    place.forEach((p, u) => (placeD[nodeGroup[u]] += p))
    const members: number[][] = Array.from({ length: G }, () => [])
    nodeGroup.forEach((d, u) => members[d].push(u))
    const toD = centreD.map(a => centreD.map((b, d) => placeD[d] * Math.exp(-km(a, b) / k.decay)))
    const draw = (ws: number[], r: number) => {
      let x = r * sum(ws)
      for (let i = 0; i < ws.length; i++) if ((x -= ws[i]) < 0) return i
      return ws.length - 1
    }
    const rate = people / perAgent / total
    return {
      name: k.name, dep: weights(k.dep), ret: weights(k.ret), rate: homes.map(() => rate),
      pick: (home: number, rng: () => number) => {
        const d = draw(toD[nodeGroup[home]], rng())
        const work = members[d][draw(members[d].map(u => place[u]), rng())]
        // They do not commute on the OD, so the mode comes from the survey split and the hours of the trip.
        return work === home ? undefined : { work, mode: surveyMode(km(coords[home], coords[work]), [...k.dep, ...k.ret], rng()) }
      },
    }
  })
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
  const pick = (home: number, rng: () => number) => {
    const r1 = rng(), r2 = rng()
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
  const hours = (keep: number[]) => hourly.map((n, h) => (keep.includes(h) ? n : 0))
  return { name: 'short', rate: homes.map(() => walkRate + bikeRate), pick, dep: hours(MORNING), ret: hours(EVENING), walkRate, bikeRate }
}
