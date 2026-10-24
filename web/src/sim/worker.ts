import { getJson } from '../load.ts'
import { init, advance, counts, type World } from './core.ts'
import { cityFrom, MODES } from './city.ts'
import { networks, tripPaths, type Batch } from './paths.ts'

export type Level = 'district' | 'village'
export type ToWorker =
  | { type: 'init'; perAgent: number; seed: number; level: Level; every: number }
  | { type: 'speed'; hoursPerSec: number }
/** Sampled agents' current plans (minutes since 00:00 of day 0), for the renderer to interpolate. */
export type Trips = { home: Uint16Array; work: Uint16Array; mode: Uint8Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** New plans of sampled agents since the last message; k indexes Trips. */
export type Replans = { k: Uint32Array; dep: Int32Array; dur1: Uint16Array; ret: Int32Array; dur2: Uint16Array }
/** A failure while starting (load, city build, sampling) ends the worker's work; the page shows it instead of waiting. */
export type WorkerError = { error: string }
export type FromWorker = {
  nodes?: string[]; homes?: Uint32Array; coords?: [number, number][]; trips?: Trips; replans?: Replans; paths?: Batch[]; routed?: number
  minute: number; day: number; counts: Uint32Array; road: Uint32Array; ms: number
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
const data = Promise.all(['od2.json', 'villages2.json', 'signal.json', 'road-graph.json', 'mrt-graph.json', 'night.json'].map(getJson))
const net = data.then(([, , , road, mrt]) => networks(road, mrt))
// Both are awaited in the start handler, which reports a failure; mark them handled so a failure
// that settles before the first start does not also log an unhandled rejection.
data.catch(() => {}); net.catch(() => {})

const take = <T extends Uint32Array | Int32Array | Uint16Array | Uint8Array>(a: T, at: ArrayLike<number>, ctor: new (n: number) => T) => {
  const out = new ctor(at.length); for (let k = 0; k < at.length; k++) out[k] = a[at[k]]; return out
}

const sample = (w: World): Trips => {
  const picked: number[] = []
  for (let i = 0; i < w.home.length; i += every) if (w.home[i] !== w.work[i]) picked.push(i)
  idx = Uint32Array.from(picked)
  sentDep = take(w.dep, idx, Int32Array)
  return { home: take(w.home, idx, Uint16Array), work: take(w.work, idx, Uint16Array), mode: take(w.mode, idx, Uint8Array),
    dep: take(w.dep, idx, Int32Array), dur1: take(w.dur1, idx, Uint16Array), ret: take(w.ret, idx, Int32Array), dur2: take(w.dur2, idx, Uint16Array) }
}

const replans = (w: World): Replans | undefined => {
  const ks: number[] = []
  for (let k = 0; k < idx.length; k++) if (w.dep[idx[k]] !== sentDep[k]) { ks.push(k); sentDep[k] = w.dep[idx[k]] }
  if (!ks.length) return undefined
  const at = ks.map(k => idx[k])
  return { k: Uint32Array.from(ks), dep: take(w.dep, at, Int32Array), dur1: take(w.dur1, at, Uint16Array), ret: take(w.ret, at, Int32Array), dur2: take(w.dur2, at, Uint16Array) }
}

const frame = () => {
  if (!w) return
  const t = performance.now()
  advance(w, hoursPerSec * 60 / FPS)
  extra.replans = replans(w)
  const c = counts(w, MODES.length)
  const ms = performance.now() - t
  // Road routing is slow, so it runs in the spare time of each frame.
  const paths: Batch[] = []
  while (pending && performance.now() - t < 12) {
    const b = pending.next()
    if (b.done) { pending = undefined; break }
    paths.push(b.value); routed += b.value.ks.length
  }
  const msg: FromWorker = { ...extra, paths, routed, minute: w.minute, day: w.day, counts: c.nodes, road: c.road, ms }
  postMessage(msg)
  extra = {}
}
setInterval(frame, 1000 / FPS)

onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'speed') { hoursPerSec = m.hoursPerSec; return }
  // Any failure while starting (loading, building the city, sampling) goes to the page.
  // The async handler would otherwise reject without a message, and onerror does not see a rejection.
  try {
    const [[od2, villages, signal, , , night], graphs] = await Promise.all([data, net])
    const c = cityFrom({ ...od2, villages, signal, night }, m.perAgent, m.level)
    every = m.every
    w = init(c.city, m.seed)
    const trips = sample(w)
    extra = { nodes: c.nodes, homes: Uint32Array.from(c.city.homes), coords: c.coords, trips }
    // Same sampled agents every day with fixed home and work, so paths are built once per init.
    pending = tripPaths(trips, c.coords, graphs)
    routed = 0
  } catch (err) {
    w = undefined
    postMessage({ error: String(err) } satisfies WorkerError)
  }
}
