import { mulberry32, pick } from './rng.ts'

/**
 * Two-level origin-destination model. Trips are known between groups (districts);
 * nodes (villages) inside a group share the group's trips: as an origin in proportion to
 * residents, as a destination in proportion to the `to` weight.
 * A district-only run is the case where every group has exactly one node.
 *
 * Each agent gets one plan per day (leave home, travel, work, travel, home). Where an agent is
 * at any minute is a pure function of that plan, so the renderer can ask for any time.
 */
export type City = {
  od: ArrayLike<number>[][] // [hour][from group][to group] = trips on an average weekday
  group: ArrayLike<number> // node -> group
  homes: ArrayLike<number> // agents living in each node
  to: ArrayLike<number> // destination weight of each node within its group; all 0 means uniform
  perAgent: number // real people per agent
  modeOf: (fromGroup: number, toGroup: number, r: number) => number
  minutes: (from: number, to: number, mode: number, hour: number) => number // door-to-door trip time
}

export type World = {
  city: City
  home: Uint16Array // node index; Uint8 overflowed at 457 village nodes
  work: Uint16Array
  mode: Uint8Array
  dep: Uint16Array // minute of the day the agent leaves home
  dur1: Uint16Array // minutes on the way to work
  ret: Uint16Array // minute the agent leaves work
  dur2: Uint16Array
  movers: Uint32Array // agents whose work node differs from home; the others never leave
  stayers: Uint32Array // per node, agents who never leave
  minute: number // 0 <= minute < MINUTES_PER_DAY, may be fractional
  day: number
  rng: () => number
}

export const MINUTES_PER_DAY = 24 * 60
export const ROAD = -1

// ponytail: one weekday commute per agent, hours 0-1 and non-commute trips ignored; add schedule templates (Real Time mod style) when events need them.
const MORNING = [5, 6, 7, 8, 9, 10, 11]
const EVENING = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

// The hour comes from OD; the minute inside it is uniform (OD has no finer grain).
const minuteOf = (od: City['od'], hours: number[], o: number, d: number, r: number, q: number) =>
  hours[pick(hours.map(h => od[h][o][d]), r)] * 60 + Math.floor(q * 60)

const plan = (w: World, i: number) => {
  const { od, group, minutes } = w.city
  const h = w.home[i], k = w.work[i]
  if (h === k) { w.dep[i] = w.ret[i] = w.dur1[i] = w.dur2[i] = 0; return }
  const dep = minuteOf(od, MORNING, group[h], group[k], w.rng(), w.rng())
  const dur1 = Math.max(1, Math.round(minutes(h, k, w.mode[i], Math.floor(dep / 60))))
  let ret = minuteOf(od, EVENING, group[k], group[h], w.rng(), w.rng())
  const dur2 = Math.max(1, Math.round(minutes(k, h, w.mode[i], Math.floor(ret / 60))))
  // Arrive before leaving again, and be home before midnight.
  ret = Math.min(Math.max(ret, dep + dur1), MINUTES_PER_DAY - 1 - dur2)
  w.dep[i] = Math.min(dep, ret - dur1)
  w.dur1[i] = dur1; w.ret[i] = ret; w.dur2[i] = dur2
}

export const init = (city: City, seed: number): World => {
  const { od, group, homes, to, perAgent } = city
  const groups = od[0].length
  const members: number[][] = Array.from({ length: groups }, () => [])
  for (let v = 0; v < group.length; v++) members[group[v]].push(v)
  const weights = members.map(vs => vs.map(v => to[v]))
  const morning = Array.from({ length: groups }, (_, a) =>
    Array.from({ length: groups }, (_, b) => MORNING.reduce((s, h) => s + od[h][a][b], 0)))
  const residents = new Array(groups).fill(0)
  for (let v = 0; v < group.length; v++) residents[group[v]] += homes[v]
  // Share of a group's agents that commute = its morning departures / its people, at most 1.
  const share = morning.map((row, g) =>
    residents[g] ? Math.min(1, row.reduce((a, b) => a + b, 0) / (residents[g] * perAgent)) : 0)

  let n = 0
  for (let v = 0; v < homes.length; v++) n += homes[v]
  const w: World = {
    city, minute: 0, day: 0, rng: mulberry32(seed), movers: new Uint32Array(0), stayers: new Uint32Array(homes.length),
    home: new Uint16Array(n), work: new Uint16Array(n), mode: new Uint8Array(n),
    dep: new Uint16Array(n), dur1: new Uint16Array(n), ret: new Uint16Array(n), dur2: new Uint16Array(n),
  }
  for (let v = 0, i = 0; v < homes.length; v++) for (let k = 0; k < homes[v]; k++, i++) {
    const g = group[v]
    w.home[i] = v
    w.work[i] = v
    if (w.rng() < share[g]) {
      const dg = pick(morning[g], w.rng())
      w.work[i] = members[dg][pick(weights[dg], w.rng())]
      w.mode[i] = city.modeOf(g, dg, w.rng())
    }
    plan(w, i)
  }
  const movers: number[] = []
  w.home.forEach((h, i) => (h === w.work[i] ? w.stayers[h]++ : movers.push(i)))
  w.movers = Uint32Array.from(movers)
  return w
}

/** Node index, or ROAD while travelling. */
export const where = (w: World, i: number, minute = w.minute): number => {
  if (minute < w.dep[i] || w.home[i] === w.work[i]) return w.home[i]
  if (minute < w.dep[i] + w.dur1[i]) return ROAD
  if (minute < w.ret[i]) return w.work[i]
  if (minute < w.ret[i] + w.dur2[i]) return ROAD
  return w.home[i]
}

/** Moves the clock forward; a new day replans everyone (all are home by then). */
export const advance = (w: World, minutes: number) => {
  w.minute += minutes
  while (w.minute >= MINUTES_PER_DAY) {
    w.minute -= MINUTES_PER_DAY
    w.day++
    for (const i of w.movers) plan(w, i)
  }
}

/** People per node, and the number on the road by mode. */
export const counts = (w: World, modes: number) => {
  const c = Uint32Array.from(w.stayers)
  const road = new Uint32Array(modes)
  for (const i of w.movers) {
    const at = where(w, i)
    if (at === ROAD) road[w.mode[i]]++
    else c[at]++
  }
  return { nodes: c, road }
}
