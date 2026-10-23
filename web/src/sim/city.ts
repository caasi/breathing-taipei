import type { City } from './core.ts'

export type Village = { code: string; town: string; pop: number; arrivals: number; lon: number; lat: number }
export type Signal = Record<string, { day: number; night: number }> // weekday 07-13 activity, weekday night stay
export type Data = { od: number[][][]; districts: string[]; villages: Village[]; signal: Signal }

export const MODES = ['捷運', '公車', '機車', '汽車', '步行', '自行車'] as const
export const MRT = 0
// Taipei residents' weekday trips, 2024 (MOTC survey via Taipei DBAS weekly 1341): bus 13.7, scooter 16.3,
// car 20.1, walk 20.8, bike 3.8 percent. New Taipei uses the same split until its own figures are found.
const OTHER = [0, 13.7, 16.3, 20.1, 20.8, 3.8]
// ponytail: assumed door-to-door speeds (km/h) and access minutes; calibrate with TDX travel times later.
const SPEED = [30, 14, 26, 22, 4.5, 12], PEAK_SPEED = [30, 11, 20, 15, 4.5, 12], ACCESS = [12, 12, 3, 6, 0, 2]
const MAX_KM = [Infinity, Infinity, Infinity, Infinity, 2.5, 6] // walk and bike only for short trips
const PEAK = new Set([7, 8, 9, 17, 18, 19])
const MORNING = [5, 6, 7, 8, 9, 10, 11], EVENING = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

const km = (a: [number, number], b: [number, number]) => {
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
  return { od, morningMrt: morning, other, target }
}

export const cityFrom = ({ od: mrt, districts, villages, signal }: Data, perAgent: number, level: 'district' | 'village') => {
  const g = villages.map(v => districts.indexOf(v.town))
  const popD = new Array(districts.length).fill(0), lon = [...popD], lat = [...popD]
  villages.forEach((v, i) => { popD[g[i]] += v.pop; lon[g[i]] += v.lon * v.pop; lat[g[i]] += v.lat * v.pop })
  const centreD = districts.map((_, d) => [lon[d] / popD[d], lat[d] / popD[d]] as [number, number])
  const residents = popD.map(p => Math.round(p / perAgent))
  const { od, morningMrt, other, target } = calibrate(mrt, residents, signal, districts, perAgent)

  const modeOf = (a: number, b: number, r: number) => {
    const mrtPart = morningMrt[a][b], otherPart = other[a][b]
    if (r * (mrtPart + otherPart) < mrtPart) return MRT
    const d = km(centreD[a], centreD[b]), ws = OTHER.map((w, m) => (d <= MAX_KM[m] ? w : 0))
    let x = (r * (mrtPart + otherPart) - mrtPart) / otherPart * sum(ws)
    for (let m = 1; m < ws.length; m++) if ((x -= ws[m]) < 0) return m
    return ws.length - 1
  }
  const village = level === 'village'
  // ponytail: a village's share of a district's arrivals is half MRT arrivals, half residents (no jobs data yet).
  const arrD = new Array(districts.length).fill(0)
  villages.forEach((v, i) => (arrD[g[i]] += v.arrivals))
  const to = villages.map((v, i) => 0.5 * (arrD[g[i]] ? v.arrivals / arrD[g[i]] : 0) + 0.5 * v.pop / popD[g[i]])
  const coords = village ? villages.map(v => [v.lon, v.lat] as [number, number]) : centreD
  const minutes = (a: number, b: number, mode: number, hour: number) =>
    ACCESS[mode] + 60 * 1.3 * km(coords[a], coords[b]) / (PEAK.has(hour) ? PEAK_SPEED : SPEED)[mode]

  const city: City = village
    ? { od, group: g, homes: villages.map(v => Math.round(v.pop / perAgent)), to, perAgent, modeOf, minutes }
    : { od, group: districts.map((_, i) => i), homes: residents, to: districts.map(() => 1), perAgent, modeOf, minutes }
  return { city, nodes: village ? villages.map(v => v.code) : districts, coords, target }
}
