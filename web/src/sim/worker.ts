import { getJson, getOptional } from '../load.ts'
import { init, advance, counts, type World } from './core.ts'
import { kindAt, type Calendar } from './calendar.ts'
import { cityFrom, MODES } from './city.ts'
import { networks, readRoutes, tripPaths, type Batch, type Routes } from './paths.ts'

export type Level = 'district' | 'village'
export type ToWorker =
  | { type: 'init'; perAgent: number; seed: number; level: Level; every: number; startDay: number } // startDay: index into calendar.json of day 0
  | { type: 'speed'; hoursPerSec: number }
/**
 * Sampled agents' current plans (minutes since 00:00 of day 0), for the renderer to interpolate.
 * dest is WORK, PLAY, GONE or STAY (core.ts); the path of trip k to work is path k, to its day-off place path n + k.
 */
export type Trips = { home: Uint16Array; work: Uint16Array; mode: Uint8Array; play: Uint16Array; playMode: Uint8Array; dest: Uint8Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** New plans of sampled agents since the last message; k indexes Trips. */
export type Replans = { k: Uint32Array; dest: Uint8Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** A failure while starting (load, city build, sampling) ends the worker's work; the page shows it instead of waiting. */
export type WorkerError = { error: string }
export type FromWorker = {
  nodes?: string[]; homes?: Uint32Array; coords?: [number, number][]; trips?: Trips; replans?: Replans; paths?: Batch[]; routed?: number
  minute: number; day: number; counts: Uint32Array; road: Uint32Array; away: number; ms: number
}

const FPS = 30
let w: World | undefined
let every = 20
let hoursPerSec = 0
let extra: Pick<FromWorker, 'nodes' | 'homes' | 'coords' | 'trips' | 'replans'> = {}
let pending: Generator<Batch> | undefined
let routed = 0
let idx = new Uint32Array(0) // agent of each sampled trip
let sentDep = new Int32Array(0) // departure last sent for each sampled trip; a new plan always changes it
const data = Promise.all(['od2.json', 'villages2.json', 'signal.json', 'road-graph.json', 'mrt-graph.json', 'night.json', 'calendar.json'].map(getJson))
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
  if (!w) return
  const t = performance.now()
  advance(w, hoursPerSec * 60 / FPS)
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
  const msg: FromWorker = { ...extra, paths, routed, minute: w.minute, day: w.day, counts: c.nodes, road: c.road, away: c.away, ms }
  postMessage(msg)
  extra = {}
}
setInterval(frame, 1000 / FPS)

let run = 0 // the latest start; a routes file that arrives after a newer start is not applied to the old one
onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'speed') { hoursPerSec = m.hoursPerSec; return }
  // Any failure while starting (loading, building the city, sampling) goes to the page.
  // The async handler would otherwise reject without a message, and onerror does not see a rejection.
  const thisRun = ++run
  try {
    const [[od2, villages, signal, , , night, cal], graphs] = await Promise.all([data, net])
    const c = cityFrom({ ...od2, villages, signal, night }, m.perAgent, m.level, day => kindAt(cal as Calendar, m.startDay + day))
    every = m.every
    w = init(c.city, m.seed)
    const trips = sample(w)
    extra = { nodes: c.nodes, homes: Uint32Array.from(c.city.homes), coords: c.coords, trips }
    // Same sampled agents every day with fixed home, work and day-off place, so paths are built once per init.
    // The simulation does not wait for the routes file (4.6 MB); the paths start when it is there.
    pending = undefined
    routed = 0
    routes.then(known => { if (thisRun === run) pending = bothPaths(trips, c.coords, graphs, known) }, () => {})
  } catch (err) {
    w = undefined
    postMessage({ error: String(err) } satisfies WorkerError)
  }
}
