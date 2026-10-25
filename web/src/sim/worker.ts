import { getJson, getOptional } from '../load.ts'
import { init, advance, counts, PLAY, STAY, WORK, type World } from './core.ts'
import { kindAt, WORKDAY, type Calendar } from './calendar.ts'
import { drawNames, nameOf, type People } from './people.ts'
import { evenPick, type SimEvent } from './events.ts'
import { mulberry32 } from './rng.ts'
import { FPS, clockAt, respeed, stepsTo, type Clock } from './pace.ts'
import { cityFrom, MODES } from './city.ts'
import { networks, readRoutes, tripPaths, type Batch, type Routes } from './paths.ts'

export type Level = 'district' | 'village'
export type ToWorker =
  // startDay: index into calendar.json of day 0. start: an id that the first frame of the run gives back.
  | { type: 'init'; perAgent: number; seed: number; level: Level; startDay: number; start: number }
  // minute: the clock of the page at at (performance.timeOrigin + performance.now() of the change), so both clocks agree.
  | { type: 'speed'; hoursPerSec: number; minute: number; at: number }
  | { type: 'sample'; every: number } // the run goes on; only the agents drawn as dots change
/**
 * Sampled agents' current plans (minutes since 00:00 of day 0), for the renderer to interpolate.
 * dest is WORK, PLAY, GONE or STAY (core.ts); the path of trip k to work is path k, to its day-off place path n + k.
 */
export type Trips = { home: Uint16Array; work: Uint16Array; mode: Uint8Array; play: Uint16Array; playMode: Uint8Array; dest: Uint8Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** New plans of sampled agents since the last message; k indexes Trips. */
export type Replans = { k: Uint32Array; dest: Uint8Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** A failure while starting (load, city build, sampling) ends the worker's work; the page shows it instead of waiting. */
export type WorkerError = { error: string; start: number } // start: the id of the init that failed
export type FromWorker = {
  start?: number; nodes?: string[]; homes?: Uint32Array; coords?: [number, number][]; trips?: Trips; replans?: Replans; paths?: Batch[]; routed?: number
  minute: number; day: number; counts: Uint32Array; road: Uint32Array; away: number; ms: number
  events?: SimEvent[] // personal events of plans made since the last message
  clock: number; at: number // the clock (pace.ts) shows minute `clock` at `at` (performance.timeOrigin + performance.now())
  since: number // the `at` of the change of speed that the clock uses; the page takes the clock only from its latest change
}

const EVENTS_PER_DAY = 48
// Every plan is simulated; the stream shows a few of the everyday ones (to work, home all day) and more of the rarer
// ones (out on a day off, away from the two cities), as the user asked. Indexed by dest (WORK, PLAY, GONE, STAY).
// ponytail: weights by eye; an accident, when it comes, is shown every time.
const SHOWN = [0.25, 1, 3, 0.05]
let w: World | undefined
let every = 20
let hoursPerSec = 0
let clock: Clock = { minute: 0, at: performance.now(), perMs: 0 }, since = 0
let extra: Pick<FromWorker, 'start' | 'nodes' | 'homes' | 'coords' | 'trips' | 'replans'> = {}
let pending: Generator<Batch> | undefined
let newEvents: SimEvent[] = []
let eventId = 0
let routed = 0
let idx = new Uint32Array(0) // agent of each sampled trip
let sentDep = new Int32Array(0) // departure last sent for each sampled trip; a new plan always changes it
const data = Promise.all(['od2.json', 'villages2.json', 'signal.json', 'road-graph.json', 'mrt-graph.json', 'night.json', 'calendar.json', 'people.json'].map(getJson))
const net = data.then(([, , , road, mrt]) => networks(road, mrt))
// Made by `pnpm routes` before dev and build; without it (or for another road graph) the worker routes every road trip itself.
const routes = Promise.all([net, getOptional('road-routes.bin').catch(() => undefined)])
  .then(([n, file]) => (file ? readRoutes(file, n.road) : undefined))
// The start handler awaits data and net and reports their failure; routes only feeds the paths. Mark all three
// handled, so a failure that settles before the first start does not also log an unhandled rejection.
data.catch(() => {}); net.catch(() => {}); routes.catch(() => {})

const take = <T extends Uint32Array | Int32Array | Uint16Array | Uint8Array>(a: T, at: ArrayLike<number>, ctor: new (n: number) => T) => {
  const out = new ctor(at.length); for (let k = 0; k < at.length; k++) out[k] = a[at[k]]; return out
}

const sample = (w: World): Trips => {
  const picked: number[] = []
  for (let i = 0; i < w.home.length; i += every) if (w.home[i] !== w.work[i] || w.home[i] !== w.play[i]) picked.push(i)
  idx = Uint32Array.from(picked)
  sentDep = take(w.dep, idx, Int32Array)
  return { home: take(w.home, idx, Uint16Array), work: take(w.work, idx, Uint16Array), mode: take(w.mode, idx, Uint8Array),
    play: take(w.play, idx, Uint16Array), playMode: take(w.playMode, idx, Uint8Array), dest: take(w.dest, idx, Uint8Array),
    dep: take(w.dep, idx, Int32Array), dur1: take(w.dur1, idx, Uint16Array), ret: take(w.ret, idx, Int32Array), dur2: take(w.dur2, idx, Uint16Array) }
}

const replans = (w: World): Replans | undefined => {
  const ks: number[] = []
  for (let k = 0; k < idx.length; k++) if (w.dep[idx[k]] !== sentDep[k]) { ks.push(k); sentDep[k] = w.dep[idx[k]] }
  if (!ks.length) return undefined
  const at = ks.map(k => idx[k])
  return { k: Uint32Array.from(ks), dest: take(w.dest, at, Uint8Array), dep: take(w.dep, at, Int32Array), dur1: take(w.dur1, at, Uint16Array), ret: take(w.ret, at, Int32Array), dur2: take(w.dur2, at, Uint16Array) }
}

/** The paths to work as paths 0..n-1, then the paths to the day-off places as paths n..2n-1. */
// The two take turns, so the dots of a day off do not wait for every road path to work.
function* bothPaths(trips: Trips, coords: [number, number][], graphs: Awaited<typeof net>, known?: Routes): Generator<Batch> {
  const n = trips.home.length
  const work = tripPaths(trips, coords, graphs, known)
  const play = tripPaths({ home: trips.home, work: trips.play, mode: trips.playMode }, coords, graphs, known)
  for (let a = work.next(), b = play.next(); !a.done || !b.done; a = a.done ? a : work.next(), b = b.done ? b : play.next()) {
    if (!a.done) yield a.value
    if (!b.done) yield { ...b.value, ks: b.value.ks.map(k => k + n) }
  }
}

const frame = () => {
  const t = performance.now(), step = hoursPerSec * 60 / FPS
  clock.minute = clockAt(clock, t); clock.at = t
  if (!w) return
  for (let k = stepsTo(clock.minute, w.day * 1440 + w.minute, step); k > 0; k--) advance(w, step)
  extra.replans = replans(w)
  const c = counts(w, MODES.length)
  const ms = performance.now() - t
  // Road routing is slow, so it runs in the spare time of each frame, but at least 4 ms of it: on a slow
  // device (iPhone) the simulation alone can fill the 12 ms, and the routing then never started.
  const paths: Batch[] = []
  const until = Math.max(t + 12, performance.now() + 4)
  while (pending && performance.now() < until) {
    const b = pending.next()
    if (b.done) { pending = undefined; break }
    paths.push(b.value); routed += b.value.ks.length
  }
  const msg: FromWorker = { ...extra, paths, routed, minute: w.minute, day: w.day, counts: c.nodes, road: c.road, away: c.away, ms, events: newEvents, clock: clock.minute, at: performance.timeOrigin + t, since }
  newEvents = []
  postMessage(msg)
  extra = {}
}
setInterval(frame, 1000 / FPS)

let drawn = 0 // the latest draw; a routes file that arrives after a newer draw is not applied to the old one
let coords: [number, number][] = []
// Same sampled agents every day with fixed home, work and day-off place, so paths are built once per draw.
// The simulation does not wait for the routes file (megabytes); the paths start when it is there.
const draw = (world: World, graphs: Awaited<typeof net>) => {
  const trips = sample(world), thisDraw = ++drawn
  pending = undefined
  routed = 0
  routes.then(known => { if (thisDraw === drawn) pending = bothPaths(trips, coords, graphs, known) }, () => {})
  return trips
}
onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'speed') {
    hoursPerSec = m.hoursPerSec
    clock = respeed(m.minute, w ? w.day * 1440 + w.minute : 0, m.at - performance.timeOrigin, hoursPerSec * 60 / 1000)
    since = m.at
    return
  }
  if (m.type === 'sample') { every = m.every; if (w) net.then(g => { if (w) extra = { ...extra, trips: draw(w, g) } }); return }
  // Any failure while starting (loading, building the city, sampling) goes to the page.
  // The async handler would otherwise reject without a message, and onerror does not see a rejection.
  try {
    const [[od2, villages, signal, , , night, cal, people], graphs] = await Promise.all([data, net])
    const c = cityFrom({ ...od2, villages, signal, night }, m.perAgent, m.level, day => kindAt(cal as Calendar, m.startDay + day))
    w = init(c.city, m.seed)
    clock = { minute: 0, at: performance.now(), perMs: hoursPerSec * 60 / 1000 }
    const world = w, districtOf = Array.from(w.home, h => (m.level === 'village' ? villages[h].town : c.nodes[h]))
    const ids = drawNames(people as People, districtOf, m.seed + 1), pickRng = mulberry32(m.seed + 2)
    // ponytail: EVENTS_PER_DAY is the base rate before the SHOWN weights (each agent makes about one plan a day); DATA.md,
    // "Figures in the code", gives the measured rate. Tune it when the stream feels too fast or too slow.
    const keep = EVENTS_PER_DAY / Math.max(1, w.movers.length)
    newEvents = []
    eventId = 0
    const pick = evenPick(SHOWN.map(s => keep * s), pickRng)
    w.onPlan = i => {
      const dest = world.dest[i]
      // A STAY on a workday is a commuter who works in its home node (at district level: its own district), not a day of rest.
      if (dest === STAY && kindAt(cal as Calendar, m.startDay + Math.floor(world.dep[i] / 1440) - 1) === WORKDAY) return
      const play = dest === PLAY, group = world.kind[i] ? c.city.kinds![world.kind[i] - 1].name : ''
      // A day at home has no departure. ponytail: it shows at 09:00 of that day, a time chosen by eye.
      const t = dest === STAY ? world.dep[i] - 15 * 60 : world.dep[i]
      if (t < 0) return // a night shift that left on day -1
      if (!pick(dest)) return
      const e = { t, kind: 'personal' as const, name: nameOf(ids, i), home: world.home[i], to: play ? world.play[i] : world.work[i],
        dest, mode: play ? world.playMode[i] : world.mode[i], group }
      newEvents.push({ ...e, id: `a${++eventId}` })
      // A shown trip also shows its way home, so the stream follows one character through the day.
      if (dest === WORK || play) newEvents.push({ ...e, id: `a${++eventId}`, t: world.ret[i], back: true })
    }
    // The plans under way at day 0 were made during init, which calls no onPlan: pass them through the same filter.
    for (const i of w.movers) w.onPlan(i)
    coords = c.coords
    extra = { start: m.start, nodes: c.nodes, homes: Uint32Array.from(c.city.homes), coords: c.coords, trips: draw(w, graphs) }
  } catch (err) {
    w = undefined
    postMessage({ error: String(err), start: m.start } satisfies WorkerError)
  }
}
