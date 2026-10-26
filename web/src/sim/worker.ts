import { getJson, getOptional } from '../load.ts'
import { init, advance, counts, now, PLAY, STAY, WORK, type World } from './core.ts'
import { kindAt, WORKDAY, type Calendar } from './calendar.ts'
import { drawNames, nameOf, type People } from './people.ts'
import { evenPick, type Mood, type SimEvent } from './events.ts'
import { mulberry32 } from './rng.ts'
import { FPS, clockAt, respeed, stepsTo, type Clock } from './pace.ts'
import { cityFrom, MODES, SCOOTER } from './city.ts'
import { networks, readRoutes, roadNode, tripPaths, wayBack, type Batch, type Routes } from './paths.ts'
import type { GraphJson } from './route.ts'
import { workNodes } from './jobs.ts'
import { cellMax, gridOf, levels, liveOf, roadUse, stepper, take as takeTraffic, type Grid, type Live, type RoadUse } from './traffic.ts'

export type Level = 'district' | 'village'
export type ToWorker =
  // startDay: index into calendar.json of day 0. start: an id that the first frame of the run gives back.
  // at: as in speed. The clock of the new run stands at minute 0 from that time until the page sends a speed.
  | { type: 'init'; perAgent: number; seed: number; level: Level; startDay: number; start: number; at: number }
  // minute: the clock of the page at at (performance.timeOrigin + performance.now() of the change), so both clocks agree.
  | { type: 'speed'; hoursPerSec: number; minute: number; at: number }
  | { type: 'sample'; every: number } // the run goes on; only the agents drawn as dots change
  | { type: 'traffic'; on: boolean } // the traffic layer is shown; the worker sends the levels only then
/**
 * Sampled agents' current plans (minutes since 00:00 of day 0), for the renderer to interpolate.
 * dest is WORK, PLAY, GONE or STAY (core.ts); the path of trip k to work is path k, to its day-off place path n + k,
 * and its own ways home, where they differ from the way there reversed, paths 2n + k and 3n + k (bothPaths).
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
  traffic?: Uint8Array // per road edge: 0 no traveller, 1 (free) to 255 (slowest) (traffic.ts levels); sent when it changes
  cells?: Uint8Array // per cell of the traffic, the level of its slowest bucket, in the order of cellKeys, sent with traffic
  cellKeys?: Int32Array // the key of each cell of the traffic (traffic.ts gridOf keys), sent once a run
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
let hoursPerSec = 0, lastHours = 0 // lastHours: the last speed that was not a pause
const clock: Clock = { minute: 0, at: performance.now(), perMs: 0 }
let since = 0, owed = false // owed: the page has no frame yet with the clock of the latest change of speed
let extra: Pick<FromWorker, 'start' | 'nodes' | 'homes' | 'coords' | 'trips' | 'replans' | 'traffic' | 'cells' | 'cellKeys'> = {}
let pending: Generator<Batch> | undefined
let newEvents: SimEvent[] = []
let eventId = 0
let routed = 0
let idx = new Uint32Array(0) // agent of each sampled trip
// The plan last sent for each sampled trip: a new plan always changes the departure, and a jam (traffic.ts) a leg.
let sentDep = new Int32Array(0), sentDur1 = new Uint16Array(0), sentDur2 = new Uint16Array(0)
let use: RoadUse | undefined, grid: Grid | undefined, live: Live | undefined, load = new Float32Array(0), jam = new Uint8Array(0)
let trafficOn = false, lastCells = new Uint8Array(0), jamRng = mulberry32(0)
// ponytail: the traffic is taken at each boundary of 15 simulated minutes (a guess; scripts/traffic.ts fits with the
// same step), whatever the speed, so a seed gives the same run at any speed. One take costs 7 to 26 ms at the morning peak in Node on an i7-7700 (2026-10-27), so at 8x (32 takes a second) it is the main cost.
const JAM_MINUTES = 15
// A jam event comes from a road traveller on an edge at least this slow (traffic.ts levels: 1 + 254 x the colour level
// of levelsOf; red from 0.43, 2 times the free time; angry from 0.75, 2.75 times). ponytail: at most one jam event a take, and one a day for each character; by eye.
// The temper of a character, 0 to 1, fixed by its index.
const temperOf = (i: number) => Math.imul(i + 1, 2654435761) / 2 ** 32 + 0.5
const JAM_FROM = 1 + Math.round(0.43 * 254), ANGRY_FROM = 1 + Math.round(0.75 * 254)
let onJam: ((agent: number, edge: number, level: number) => void) | undefined
// After each take: moves the shown way home of a character that a jam made late to work.
let onLate: (() => void) | undefined
const data = Promise.all(['od2.json', 'villages2.json', 'signal.json', 'road-graph.json', 'mrt-graph.json', 'night.json', 'calendar.json', 'people.json', 'road-names.json'].map(getJson))
/** The name of each road edge, from scripts/names.py: edge[e] indexes names, or is -1. */
type RoadNames = { names: string[]; edge: number[] }
const net = data.then(([, , , road, mrt]) => networks(road, mrt))
// Made by `pnpm routes` before dev and build; without it (or for another road graph) the worker routes every road trip itself.
const routes = Promise.all([net, getOptional('road-routes.bin').catch(() => undefined)])
  .then(([n, file]) => (file ? readRoutes(file, n.road) : undefined))
// The start handler awaits data and net and reports their failure; routes only feeds the paths. Mark all three
// handled, so a failure that settles before the first start does not also log an unhandled rejection.
data.catch(() => {}); net.catch(() => {}); routes.catch(() => {})

/** The node (village, or district centre) nearest to a point; a linear search, as it runs about once a take. */
const nearestOf = (coords: [number, number][], lon: number, lat: number) => {
  let best = 0, bd = Infinity
  coords.forEach(([x, y], v) => { const d = (x - lon) ** 2 + (y - lat) ** 2; if (d < bd) { bd = d; best = v } })
  return best
}

const take = <T extends Uint32Array | Int32Array | Uint16Array | Uint8Array>(a: T, at: ArrayLike<number>, ctor: new (n: number) => T) => {
  const out = new ctor(at.length); for (let k = 0; k < at.length; k++) out[k] = a[at[k]]; return out
}

const sample = (w: World): Trips => {
  const picked: number[] = []
  for (let i = 0; i < w.home.length; i += every) if (w.home[i] !== w.work[i] || w.home[i] !== w.play[i]) picked.push(i)
  idx = Uint32Array.from(picked)
  sentDep = take(w.dep, idx, Int32Array); sentDur1 = take(w.dur1, idx, Uint16Array); sentDur2 = take(w.dur2, idx, Uint16Array)
  return { home: take(w.home, idx, Uint16Array), work: take(w.work, idx, Uint16Array), mode: take(w.mode, idx, Uint8Array),
    play: take(w.play, idx, Uint16Array), playMode: take(w.playMode, idx, Uint8Array), dest: take(w.dest, idx, Uint8Array),
    dep: take(w.dep, idx, Int32Array), dur1: take(w.dur1, idx, Uint16Array), ret: take(w.ret, idx, Int32Array), dur2: take(w.dur2, idx, Uint16Array) }
}

const replans = (w: World): Replans | undefined => {
  const ks: number[] = []
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    if (w.dep[i] !== sentDep[k] || w.dur1[i] !== sentDur1[k] || w.dur2[i] !== sentDur2[k]) { ks.push(k); sentDep[k] = w.dep[i]; sentDur1[k] = w.dur1[i]; sentDur2[k] = w.dur2[i] }
  }
  if (!ks.length) return undefined
  const at = ks.map(k => idx[k])
  return { k: Uint32Array.from(ks), dest: take(w.dest, at, Uint8Array), dep: take(w.dep, at, Int32Array), dur1: take(w.dur1, at, Uint16Array), ret: take(w.ret, at, Int32Array), dur2: take(w.dur2, at, Uint16Array) }
}

/**
 * The paths to work as paths 0..n-1, the paths to the day-off places as paths n..2n-1, then the paths home from them
 * that differ from the way there reversed as paths 2n..3n-1 and 3n..4n-1 (Travellers.tsx).
 */
// The two take turns, so the dots of a day off do not wait for every road path to work.
function* bothPaths(trips: Trips, coords: [number, number][], graphs: Awaited<typeof net>, known?: Routes): Generator<Batch> {
  const n = trips.home.length
  const work = tripPaths(trips, coords, graphs, known)
  const play = tripPaths({ home: trips.home, work: trips.play, mode: trips.playMode }, coords, graphs, known)
  for (let a = work.next(), b = play.next(); !a.done || !b.done; a = a.done ? a : work.next(), b = b.done ? b : play.next()) {
    if (!a.done) yield a.value
    if (!b.done) yield { ...b.value, ks: b.value.ks.map(k => k + n) }
  }
  if (!known) return
  for (const batch of wayBack(trips, coords, graphs, known)) yield { ...batch, ks: batch.ks.map(k => k + 2 * n) }
  for (const batch of wayBack({ home: trips.home, work: trips.play, mode: trips.playMode }, coords, graphs, known)) yield { ...batch, ks: batch.ks.map(k => k + 3 * n) }
}

/** Advances the model by `minutes`, and takes the traffic at each boundary of JAM_MINUTES that it reaches. */
let stepWithTraffic = stepper(JAM_MINUTES, world => takeTrafficNow(world))

const takeTrafficNow = (world: World) => {
  if (!use || !grid || !live) return
  const onRoad: number[] = []
  const buckets = takeTraffic(world, use, load, live, (i, e) => onRoad.push(i, e)), next = levels(load, grid, buckets, new Uint8Array(load.length))
  // The jam events need the traffic with the layer off too; the page gets the levels only while it shows them.
  const changed = next.some((v, e) => v !== jam[e])
  jam = next; lastCells = cellMax(grid, buckets)
  if (trafficOn && changed) { extra.traffic = next; extra.cells = lastCells }
  const stuck: number[] = []
  for (let k = 0; k < onRoad.length; k += 2) if (next[onRoad[k + 1]] >= JAM_FROM) stuck.push(k)
  onLate?.()
  if (stuck.length && onJam) { const k = stuck[Math.floor(jamRng() * stuck.length)]; onJam(onRoad[k], onRoad[k + 1], next[onRoad[k + 1]]) }
}

const frame = () => {
  // On a pause the clock stops, and the model goes on to it in steps of the last speed, at most MAX_FRAMES + 1 a
  // callback, so within a few callbacks the dots (on the clock) and the shown time (the model) agree. The model can end
  // up to half a step past the clock.
  const t = performance.now(), step = (hoursPerSec || lastHours) * 60 / FPS
  // While a world loads, the clock waits; the page clock stops at the cap, as no message moves it on. Without this,
  // the first frames would make up the whole load.
  if (!w) return
  clock.minute = clockAt(clock, t); clock.at = t
  const n = stepsTo(clock.minute, w.day * 1440 + w.minute, step)
  // Nothing moves and nothing new is there to send (a pause, a hidden tab, a run that waits): skip the frame, so a
  // paused page costs almost nothing. After a change of speed one frame goes out anyway: the page takes the worker
  // clock only from a frame of its latest change, and a frame from before it can have moved the model past its clock.
  if (n === 0 && !owed && !pending && !newEvents.length && !Object.keys(extra).length) return
  for (let k = n; k > 0; k--) stepWithTraffic(w, step)
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
  owed = false
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
// Every road traveller of the run, on the paths of the routes file. Without the file there is no traffic.
const traffic = (world: World, graphs: Awaited<typeof net>, roadJson: GraphJson, village: boolean, roadNames: RoadNames) => {
  use = undefined; jam = new Uint8Array(0); lastCells = new Uint8Array(0); stepWithTraffic = stepper(JAM_MINUTES, takeTrafficNow)
  routes.then(known => {
    if (!known || world !== w) return
    const node = new Map<number, number>(), at = (v: number) => node.get(v) ?? node.set(v, roadNode(graphs, coords, v)).get(v)!
    const metres = Float32Array.from(roadJson.edges, e => e[2])
    load = new Float32Array(metres.length); grid = gridOf(roadJson, roadNames.edge); live = liveOf(roadJson, grid); extra.cellKeys = grid.keys
    const workAt = workNodes(graphs, coords, village)
    use = roadUse(world, known, (i, leg) => [at(world.home[i]), leg ? at(world.play[i]) : workAt(i, world.work[i])], live.time)
  }, () => {})
}
onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'speed') {
    hoursPerSec = m.hoursPerSec
    if (hoursPerSec) lastHours = hoursPerSec
    respeed(clock, m.minute, w ? w.day * 1440 + w.minute : 0, m.at - performance.timeOrigin, hoursPerSec * 60 / 1000)
    since = m.at; owed = true
    return
  }
  // Showing the layer sends the traffic of the last take; it never adds a take, so the run does not depend on the toggle.
  if (m.type === 'traffic') { trafficOn = m.on; if (trafficOn && jam.length) { extra.traffic = jam; extra.cells = lastCells }; return }
  if (m.type === 'sample') { every = m.every; if (w) net.then(g => { if (w) extra = { ...extra, trips: draw(w, g) } }); return }
  // The old world stops now. The clock of the new run stands at minute 0 until the page is ready for it and sends a
  // speed, as the clock of the page does.
  w = undefined
  respeed(clock, 0, 0, m.at - performance.timeOrigin, 0)
  since = m.at
  // Any failure while starting (loading, building the city, sampling) goes to the page.
  // The async handler would otherwise reject without a message, and onerror does not see a rejection.
  try {
    const [[od2, villages, signal, roadJson, , night, cal, people, roadNames], graphs] = await Promise.all([data, net])
    onJam = undefined; onLate = undefined; jamRng = mulberry32(m.seed + 3)
    const c = cityFrom({ ...od2, villages, signal, night }, m.perAgent, m.level, day => kindAt(cal as Calendar, m.startDay + day))
    w = init(c.city, m.seed)
    const world = w, districtOf = Array.from(w.home, h => (m.level === 'village' ? villages[h].town : c.nodes[h]))
    const ids = drawNames(people as People, districtOf, m.seed + 1), pickRng = mulberry32(m.seed + 2)
    // ponytail: EVENTS_PER_DAY is the base rate before the SHOWN weights (each agent makes about one plan a day); DATA.md,
    // "Figures in the code", gives the measured rate. Tune it when the stream feels too fast or too slow.
    const keep = EVENTS_PER_DAY / Math.max(1, w.movers.length)
    newEvents = []
    eventId = 0
    const pick = evenPick(SHOWN.map(s => keep * s), pickRng)
    w.onPlan = i => {
      backs.delete(i)
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
      if (dest === WORK || play) { const b = { ...e, id: `a${++eventId}`, t: world.ret[i], back: true }; newEvents.push(b); backs.set(i, b) }
    }
    // A jam on the way can make a character reach work after its usual leaving time, so it leaves later (core.ts
    // stretch). The way home is sent again with the same id, the new time, how late, and the temper of the character.
    const backs = new Map<number, Extract<SimEvent, { kind: 'personal' }>>()
    onLate = () => backs.forEach((b, i) => {
      // Once the character has left, a jam on the way home moves its start (core.ts stretch), not the leaving time.
      if (now(world) >= world.ret[i]) { backs.delete(i); return }
      if (world.ret[i] === b.t) return
      // How late against the planned time; back to the plain way home when the jam eases in time.
      const minutes = world.ret[i] - world.leave[i]
      const next = minutes > 0 ? { ...b, t: world.ret[i], late: minutes, mood: temperOf(i) < 0.55 ? 'angry' as const : 'blank' as const }
        : { ...b, t: world.ret[i], late: undefined, mood: undefined }
      newEvents.push(next); backs.set(i, next)
    })
    // ponytail: a character's temper is fixed by its index; about 55% take a jam by how slow it is (angry on the slowest
    // roads, else stuck), the rest go blank, work by phone or ask for an hour of leave to come late (only on the way to
    // work; leave only before noon). The shares are by eye. The character goes on to work, so the plan does not change.
    const { names, edge: edgeName } = roadNames as RoadNames, jammed = new Map<number, number>()
    onJam = (i, e, level) => {
      const t = world.day * 1440 + Math.floor(world.minute), today = Math.floor(t / 1440)
      if (jammed.get(i) === today) return
      jammed.set(i, today)
      const temper = temperOf(i), toWork = world.dest[i] === WORK && t < world.dep[i] + world.dur1[i]
      const mode = world.dest[i] === PLAY ? world.playMode[i] : world.mode[i]
      // A scooter rider cannot start work by phone in the saddle; one who would waits instead.
      const working: Mood = mode === SCOOTER ? 'stuck' : 'work'
      const mood: Mood = temper < 0.55 ? (level >= ANGRY_FROM ? 'angry' : 'stuck') : temper < 0.75 || !toWork ? 'blank'
        : temper < 0.92 || t % 1440 >= 12 * 60 ? working : 'leave'
      // A road with no name is told by the village nearest the middle of the edge: an edge can be longer than a cell.
      const [a, b] = roadJson.edges[e], road = edgeName[e] >= 0 ? names[edgeName[e]] : undefined
      const near = road ? 0 : nearestOf(c.coords, (roadJson.lon[a] + roadJson.lon[b]) / 2, (roadJson.lat[a] + roadJson.lat[b]) / 2)
      newEvents.push({ id: `j${++eventId}`, t, kind: 'jam', name: nameOf(ids, i), home: world.home[i],
        mode, road, near, mood })
    }
    // The plans under way at day 0 were made during init, which calls no onPlan: pass them through the same filter.
    for (const i of w.movers) w.onPlan(i)
    coords = c.coords
    traffic(w, graphs, roadJson, m.level === 'village', roadNames as RoadNames)
    extra = { start: m.start, nodes: c.nodes, homes: Uint32Array.from(c.city.homes), coords: c.coords, trips: draw(w, graphs) }
  } catch (err) {
    w = undefined
    postMessage({ error: String(err), start: m.start } satisfies WorkerError)
  }
}
