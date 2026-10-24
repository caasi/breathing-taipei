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
  modeOf: (fromNode: number, toNode: number, r: number) => number
  /**
   * Short trips by people who do not commute on the OD: rate[node] is the share of all residents of the
   * node who make one, and pick gives the work node and mode (undefined: no trip after all).
   */
  local?: {
    rate: ArrayLike<number>
    pick: (home: number, r1: number, r2: number) => { work: number; mode: number } | undefined
    hours: ArrayLike<number> // trips per hour of the day; short trips take their hours from this, not from the OD
  }
  minutes: (from: number, to: number, mode: number, hour: number) => number // door-to-door trip time
}

export type World = {
  city: City
  home: Uint16Array // node index; Uint8 overflowed at 457 village nodes
  work: Uint16Array
  isLocal: Uint8Array // 1 for a short trip of city.local
  mode: Uint8Array
  dep: Uint16Array // minute of the day the agent leaves home
  dur1: Uint16Array // minutes on the way to work
  ret: Uint16Array // minute the agent leaves work
  dur2: Uint16Array
  movers: Uint32Array // agents whose work node differs from home; the others never leave
  replanned: number // movers[0 .. replanned) already have today's plan
  stayers: Uint32Array // per node, agents who never leave
  minute: number // 0 <= minute < MINUTES_PER_DAY, may be fractional
  day: number
  rng: () => number
}

export const MINUTES_PER_DAY = 24 * 60
export const ROAD = -1

// ponytail: one weekday commute per agent, hours 0-1 and non-commute trips ignored; add schedule templates (Real Time mod style) when events need them.
// Each leg is capped so that two legs and the day always fit: the clamps in plan() then never
// push a departure below minute 0 (the plan fields are Uint16 and would wrap).
const MAX_LEG = 600

const MORNING = [5, 6, 7, 8, 9, 10, 11]
// Every plan for the day is made in the first two hours, well before the first departure (05:00),
// so the night stays free for later work (events) that may need the day's plans early.
const REPLAN_BY = 2 * 60
const EVENING = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

// The hour comes from OD; the minute inside it is uniform (OD has no finer grain).
const minuteOf = (od: City['od'], hours: number[], o: number, d: number, r: number, q: number) =>
  hours[pick(hours.map(h => od[h][o][d]), r)] * 60 + Math.floor(q * 60)

const minuteFrom = (perHour: ArrayLike<number>, hours: number[], r: number, q: number) =>
  hours[pick(hours.map(h => perHour[h]), r)] * 60 + Math.floor(q * 60)

const plan = (w: World, i: number) => {
  const { od, group, minutes } = w.city
  const h = w.home[i], k = w.work[i]
  if (h === k) { w.dep[i] = w.ret[i] = w.dur1[i] = w.dur2[i] = 0; return }
  // A short trip has no OD row of its own (many districts have no trips inside them), so it uses the city's hours.
  const local = w.isLocal[i] ? w.city.local!.hours : undefined
  const dep = local ? minuteFrom(local, MORNING, w.rng(), w.rng()) : minuteOf(od, MORNING, group[h], group[k], w.rng(), w.rng())
  const dur1 = Math.min(MAX_LEG, Math.max(1, Math.round(minutes(h, k, w.mode[i], Math.floor(dep / 60)))))
  let ret = local ? minuteFrom(local, EVENING, w.rng(), w.rng()) : minuteOf(od, EVENING, group[k], group[h], w.rng(), w.rng())
  const dur2 = Math.min(MAX_LEG, Math.max(1, Math.round(minutes(k, h, w.mode[i], Math.floor(ret / 60)))))
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
    city, minute: 0, day: 0, rng: mulberry32(seed), movers: new Uint32Array(0), replanned: 0, stayers: new Uint32Array(homes.length),
    home: new Uint16Array(n), work: new Uint16Array(n), isLocal: new Uint8Array(n), mode: new Uint8Array(n),
    dep: new Uint16Array(n), dur1: new Uint16Array(n), ret: new Uint16Array(n), dur2: new Uint16Array(n),
  }
  for (let v = 0, i = 0; v < homes.length; v++) for (let k = 0; k < homes[v]; k++, i++) {
    const g = group[v]
    w.home[i] = v
    w.work[i] = v
    if (w.rng() < share[g]) {
      const dg = pick(morning[g], w.rng())
      w.work[i] = members[dg][pick(weights[dg], w.rng())]
      w.mode[i] = city.modeOf(v, w.work[i], w.rng())
    } else if (city.local && w.rng() < Math.min(1, city.local.rate[v] / (1 - share[g]))) {
      // The rate is a share of all residents; the agents left here are the non-commuters, hence the division.
      const t = city.local.pick(v, w.rng(), w.rng())
      if (t) { w.work[i] = t.work; w.mode[i] = t.mode; w.isLocal[i] = 1 }
    }
    plan(w, i)
  }
  const movers: number[] = []
  w.home.forEach((h, i) => (h === w.work[i] ? w.stayers[h]++ : movers.push(i)))
  w.movers = Uint32Array.from(movers)
  w.replanned = w.movers.length // day 0 is planned above
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

/**
 * Moves the clock forward. A new day's plans are made between 00:00 and 02:00, a share of the movers per
 * call in proportion to the time, so one frame never replans everyone. This is safe because nobody leaves
 * before 05:00 (MORNING), so an agent with yesterday's plan is at home until it is replanned.
 */
export const advance = (w: World, minutes: number) => {
  w.minute += minutes
  while (w.minute >= MINUTES_PER_DAY) {
    w.minute -= MINUTES_PER_DAY
    w.day++
    for (; w.replanned < w.movers.length; w.replanned++) plan(w, w.movers[w.replanned])
    w.replanned = 0
  }
  const due = Math.min(w.movers.length, Math.ceil(w.movers.length * w.minute / REPLAN_BY))
  for (; w.replanned < due; w.replanned++) plan(w, w.movers[w.replanned])
}

/** True once every mover has its plan for the current day. */
export const planned = (w: World) => w.replanned === w.movers.length

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
