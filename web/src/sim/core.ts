import { mulberry32, pick } from './rng.ts'

/**
 * Two-level origin-destination model. Trips are known between groups (districts);
 * nodes (villages) inside a group share the group's trips: as an origin in proportion to
 * residents, as a destination in proportion to the `to` weight.
 * A district-only run is the case where every group has exactly one node.
 *
 * Each agent has one plan at a time (leave home, travel, work, travel, home), in minutes since 00:00 of day 0.
 * Where an agent is at any minute is a pure function of that plan, so the renderer can ask for any time.
 * When an agent is home again, it gets its next plan; a plan can cross midnight (night shifts).
 */
export type City = {
  od: ArrayLike<number>[][] // [hour][from group][to group] = trips on an average workday
  group: ArrayLike<number> // node -> group
  homes: ArrayLike<number> // agents living in each node
  to: ArrayLike<number> // destination weight of each node within its group; all 0 means uniform
  perAgent: number // real people per agent
  modeOf: (fromNode: number, toNode: number, r: number) => number
  kinds?: Kind[] // people who do not commute on the OD, tried in this order
  minutes: (from: number, to: number, mode: number, hour: number) => number // door-to-door trip time
  off?: DaysOff // absent: every day is a workday
}

/**
 * Days off change the plans of the commuters on the OD (the other kinds keep theirs). On such a day a commuter
 * leaves Taipei and New Taipei for the day (away), goes out to its day-off place (out), or stays home.
 * Index k - 1 holds the values of kind of day k (SATURDAY, HOLIDAY).
 */
export type DaysOff = {
  kindOf: (day: number) => number // the kind of day of a day since day 0 (WORKDAY: a workday)
  od: ArrayLike<number>[][][] // [k - 1][hour][from group][to group] = trips on that kind of day
  out: ArrayLike<number>[] // [k - 1][home group] = share of the commuters who go out to their day-off place
  away: ArrayLike<number> // [k - 1] = share of the commuters who are away for the day
}

/**
 * A group of people who do not commute on the OD (short trips, night shifts, night-time visitors).
 * rate[node] is the share of all residents of the node in the group; pick gives the work node and mode
 * (undefined: no trip after all). dep and ret weigh the 24 hours of the day for leaving home and leaving work;
 * an agent leaves work at the first such time after it left home (not before it arrives), so when the two share
 * an hour, a drawn leaving time just before the departure keeps the agent at work until the next day.
 */
export type Kind = {
  name: string
  rate: ArrayLike<number>
  pick: (home: number, rng: () => number) => { work: number; mode: number } | undefined
  dep: ArrayLike<number>
  ret: ArrayLike<number>
}

export type World = {
  city: City
  home: Uint16Array // node index
  work: Uint16Array
  kind: Uint8Array // 0: commuter on the OD, k: city.kinds[k - 1]
  mode: Uint8Array
  play: Uint16Array // day-off place of a commuter, drawn once from the day-off OD (its home if none)
  playMode: Uint8Array
  dest: Uint8Array // where the current plan goes: WORK, PLAY, AWAY, or STAY (no trip: dep = ret, no legs)
  dep: Int32Array // minute (since 00:00 of day 0) the agent leaves home; before 0 for a night shift that started on day -1
  dur1: Uint16Array // minutes on the way to work
  ret: Int32Array // minute the agent leaves work
  dur2: Uint16Array
  movers: Uint32Array // agents whose work node or day-off place differs from home; the others never leave
  stayers: Uint32Array // per node, agents who never leave
  due: number[][] // due[m % RING]: agents home again at minute m, to get their next plan then
  done: number // the last minute whose agents got their next plan
  minute: number // 0 <= minute < MINUTES_PER_DAY, may be fractional
  day: number
  rng: () => number
  onPlan?: (i: number) => void // called with each agent that gets its next plan while the clock moves (not during init)
}

export const MINUTES_PER_DAY = 24 * 60
export const ROAD = -1, AWAY = -2
export const WORK = 0, PLAY = 1, GONE = 2, STAY = 3

const MAX_LEG = 600
const RING = 3 * MINUTES_PER_DAY

const MORNING = [5, 6, 7, 8, 9, 10, 11]
const EVENING = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
// ponytail: a day-off departure falls between 05:00 and 17:00, weighted by that day's OD (so no morning peak); the window is a guess.
const DAYTIME = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

// The hour comes from OD; the minute inside it is uniform (OD has no finer grain).
const minuteOf = (od: City['od'], hours: number[], o: number, d: number, r: number, q: number) =>
  hours[pick(hours.map(h => od[h][o][d]), r)] * 60 + Math.floor(q * 60)

const minuteFrom = (perHour: ArrayLike<number>, hours: number[], r: number, q: number) =>
  hours[pick(hours.map(h => perHour[h]), r)] * 60 + Math.floor(q * 60)

const firstAtOrAfter = (t: number, minuteOfDay: number) => t + (((minuteOfDay - t) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
const hourOf = (t: number) => Math.floor((((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60)
const leg = (m: number) => Math.min(MAX_LEG, Math.max(1, Math.round(m)))

const dayOf = (t: number) => Math.floor(t / MINUTES_PER_DAY)

const trip = (w: World, i: number, dest: number, dep: number, to: number, mode: number, leave: number) => {
  const h = w.home[i], dur1 = leg(w.city.minutes(h, to, mode, hourOf(dep)))
  const ret = Math.max(firstAtOrAfter(dep, leave), dep + dur1)
  const dur2 = leg(w.city.minutes(to, h, mode, hourOf(ret)))
  w.dest[i] = dest; w.dep[i] = dep; w.dur1[i] = dur1; w.ret[i] = ret; w.dur2[i] = dur2
  return ret + dur2
}

const stay = (w: World, i: number, day: number) => {
  const end = (day + 1) * MINUTES_PER_DAY
  w.dest[i] = STAY; w.dep[i] = end; w.dur1[i] = 0; w.ret[i] = end; w.dur2[i] = 0
  return end
}

/** Gives agent i its next plan, leaving home at or after minute `after`; returns the minute it is home again. */
const plan = (w: World, i: number, after: number): number => {
  const { od, group, off } = w.city
  const h = w.home[i], k = w.work[i]
  const kind = w.kind[i] ? w.city.kinds![w.kind[i] - 1] : undefined
  if (kind) return trip(w, i, WORK, firstAtOrAfter(after, minuteFrom(kind.dep, HOURS, w.rng(), w.rng())), k, w.mode[i], minuteFrom(kind.ret, HOURS, w.rng(), w.rng()))
  // A plan belongs to the day it leaves on. A time of day already past moves the departure to the next day;
  // when that day is of another kind, the plan is drawn again for it, from its 00:00.
  for (let day = dayOf(after); ; day++, after = day * MINUTES_PER_DAY) {
    const today = off?.kindOf(day) ?? 0
    if (!today && k === h) return stay(w, i, day) // works in its home node: it only moves on a day off
    if (!today) {
      const dep = firstAtOrAfter(after, minuteOf(od, MORNING, group[h], group[k], w.rng(), w.rng()))
      if (today !== (off?.kindOf(dayOf(dep)) ?? 0)) continue
      return trip(w, i, WORK, dep, k, w.mode[i], minuteOf(od, EVENING, group[k], group[h], w.rng(), w.rng()))
    }
    if (w.dest[i] !== STAY && dayOf(w.dep[i]) === day) continue
    const r = w.rng(), away = off!.away[today - 1], p = w.play[i], dayOd = off!.od[today - 1]
    if (r >= away + (1 - away) * off!.out[today - 1][group[h]]) return stay(w, i, day)
    // ponytail: the hours of a day away follow the trips inside the home district; there is no data on trips out of the city.
    const gone = r < away, to = gone ? h : p
    const dep = firstAtOrAfter(after, minuteOf(dayOd, DAYTIME, group[h], group[to], w.rng(), w.rng()))
    // A commuter home late from the day before can find the drawn hour gone; the departure then rolls into the next day.
    if (dayOf(dep) !== day) continue
    const leave = minuteOf(dayOd, EVENING.filter(x => x > hourOf(dep)), group[to], group[h], w.rng(), w.rng())
    const mode = gone ? w.mode[i] : w.playMode[i], end = (day + 1) * MINUTES_PER_DAY
    trip(w, i, gone ? GONE : PLAY, dep, to, mode, leave)
    // Leave for home early enough to be in by 24:00, when the two legs leave room for it. An earlier hour can have a
    // longer way home, so the way home is timed again at each move. The time to leave only moves earlier, so this ends;
    // it stops at the arrival at the place, where the two legs alone pass midnight.
    while (w.ret[i] + w.dur2[i] > end) {
      const ret = Math.max(dep + w.dur1[i], end - w.dur2[i])
      if (ret >= w.ret[i]) break
      w.ret[i] = ret
      w.dur2[i] = leg(w.city.minutes(to, h, mode, hourOf(ret)))
    }
    return w.ret[i] + w.dur2[i]
  }
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
  const share = morning.map((row, g) =>
    residents[g] ? Math.min(1, row.reduce((a, b) => a + b, 0) / (residents[g] * perAgent)) : 0)

  // ponytail: one day-off place per commuter, drawn from all trips of all days off; a real person goes to more places.
  const playOf = city.off && Array.from({ length: groups }, (_, a) => Array.from({ length: groups }, (_, b) =>
    city.off!.od.reduce((s, kind) => s + kind.reduce((t, hour) => t + hour[a][b], 0), 0)))

  let n = 0
  for (let v = 0; v < homes.length; v++) n += homes[v]
  const commuter = new Uint8Array(n)
  const w: World = {
    city, minute: 0, day: 0, rng: mulberry32(seed), movers: new Uint32Array(0), stayers: new Uint32Array(homes.length),
    home: new Uint16Array(n), work: new Uint16Array(n), kind: new Uint8Array(n), mode: new Uint8Array(n),
    play: new Uint16Array(n), playMode: new Uint8Array(n), dest: new Uint8Array(n),
    dep: new Int32Array(n), dur1: new Uint16Array(n), ret: new Int32Array(n), dur2: new Uint16Array(n),
    due: Array.from({ length: RING }, () => []), done: -1,
  }
  for (let v = 0, i = 0; v < homes.length; v++) for (let k = 0; k < homes[v]; k++, i++) {
    const g = group[v]
    w.home[i] = v
    w.work[i] = v
    w.play[i] = v
    if (w.rng() < share[g]) {
      commuter[i] = 1
      const dg = pick(morning[g], w.rng())
      w.work[i] = members[dg][pick(weights[dg], w.rng())]
      w.mode[i] = city.modeOf(v, w.work[i], w.rng())
      if (playOf) {
        const pg = pick(playOf[g], w.rng())
        w.play[i] = members[pg][pick(weights[pg], w.rng())]
        w.playMode[i] = city.modeOf(v, w.play[i], w.rng())
      }
    } else {
      // Each rate is a share of all residents; the agents left here are those not taken yet, hence the division.
      let left = 1 - share[g]
      for (let c = 0; c < (city.kinds?.length ?? 0); c++) {
        const kind = city.kinds![c]
        if (w.rng() < Math.min(1, kind.rate[v] / left)) {
          const t = kind.pick(v, w.rng)
          if (t) { w.work[i] = t.work; w.mode[i] = t.mode; w.kind[i] = c + 1 }
          break
        }
        left -= kind.rate[v]
      }
    }
  }
  const movers: number[] = []
  // With days off, every commuter on the OD moves: one whose work and day-off place are its home node can still be away.
  w.home.forEach((h, i) => (h === w.work[i] && h === w.play[i] && !(city.off && commuter[i]) ? w.stayers[h]++ : movers.push(i)))
  w.movers = Uint32Array.from(movers)
  // Plan from 00:00 of day -1 and step forward to the plan that is under way at 00:00 of day 0,
  // so a night shift starts the run at work.
  for (const i of w.movers) {
    let end = plan(w, i, -MINUTES_PER_DAY)
    while (end < 0) end = plan(w, i, end)
    w.due[end % RING].push(i)
  }
  return w
}

export const now = (w: World) => w.day * MINUTES_PER_DAY + w.minute

/** Node index, ROAD while travelling, or AWAY outside Taipei and New Taipei, at a minute since 00:00 of day 0. */
export const where = (w: World, i: number, minute = now(w)): number => {
  if (minute < w.dep[i]) return w.home[i]
  if (minute < w.dep[i] + w.dur1[i]) return ROAD
  if (minute < w.ret[i]) return w.dest[i] === PLAY ? w.play[i] : w.dest[i] === GONE ? AWAY : w.work[i]
  if (minute < w.ret[i] + w.dur2[i]) return ROAD
  return w.home[i]
}

/**
 * Moves the clock forward. Agents get their next plan in the minute they are home again, minute by minute
 * in order, so any split of the same whole minutes gives the same plans. Fractional steps are not exact:
 * floating-point sums can stop just short of a minute and process its agents one step later.
 * Home times spread over the day, so no frame plans everyone.
 */
export const advance = (w: World, minutes: number) => {
  w.minute += minutes
  while (w.minute >= MINUTES_PER_DAY) { w.minute -= MINUTES_PER_DAY; w.day++ }
  for (const t = Math.floor(now(w)); w.done < t;) {
    const m = ++w.done, slot = m % RING, agents = w.due[slot]
    w.due[slot] = []
    for (const i of agents) { w.due[plan(w, i, m) % RING].push(i); w.onPlan?.(i) }
  }
}

export const counts = (w: World, modes: number) => {
  const c = Uint32Array.from(w.stayers)
  const road = new Uint32Array(modes)
  let away = 0
  for (const i of w.movers) {
    const at = where(w, i)
    if (at === ROAD) road[w.dest[i] === PLAY ? w.playMode[i] : w.mode[i]]++
    else if (at === AWAY) away++
    else c[at]++
  }
  return { nodes: c, road, away }
}
