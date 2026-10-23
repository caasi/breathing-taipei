import { getJson } from '../load.ts'
import { init, advance, counts, type World } from './core.ts'
import { cityFrom, MODES } from './city.ts'
import { networks, tripPaths, type Batch } from './paths.ts'

export type Level = 'district' | 'village'
export type ToWorker =
  | { type: 'init'; perAgent: number; seed: number; level: Level; every: number }
  | { type: 'speed'; hoursPerSec: number }
/** Sampled commuters' plans for one day, for the renderer to interpolate. */
export type Trips = { home: Uint16Array; work: Uint16Array; mode: Uint8Array; dep: Uint16Array; dur1: Uint16Array; ret: Uint16Array; dur2: Uint16Array }
/** A failure while starting (load, city build, sampling) ends the worker's work; the page shows it instead of waiting. */
export type WorkerError = { error: string }
export type FromWorker = {
  nodes?: string[]; homes?: Uint32Array; coords?: [number, number][]; trips?: Trips; paths?: Batch[]; routed?: number
  minute: number; day: number; counts: Uint32Array; road: Uint32Array; ms: number
}

const FPS = 30
let w: World | undefined
let every = 20
let hoursPerSec = 0
let extra: Pick<FromWorker, 'nodes' | 'homes' | 'coords' | 'trips'> = {}
let pending: Generator<Batch> | undefined
let routed = 0
const data = Promise.all(['od2.json', 'villages2.json', 'signal.json', 'road-graph.json', 'mrt-graph.json'].map(getJson))
const net = data.then(([, , , road, mrt]) => networks(road, mrt))
// Both are awaited in the start handler, which reports a failure; mark them handled so a failure
// that settles before the first start does not also log an unhandled rejection.
data.catch(() => {}); net.catch(() => {})

const sample = (w: World): Trips => {
  const idx: number[] = []
  for (let i = 0; i < w.home.length; i += every) if (w.home[i] !== w.work[i]) idx.push(i)
  const take = <T extends Uint16Array | Uint8Array>(a: T, ctor: new (n: number) => T) => {
    const out = new ctor(idx.length); idx.forEach((i, k) => (out[k] = a[i])); return out
  }
  return { home: take(w.home, Uint16Array), work: take(w.work, Uint16Array), mode: take(w.mode, Uint8Array),
    dep: take(w.dep, Uint16Array), dur1: take(w.dur1, Uint16Array), ret: take(w.ret, Uint16Array), dur2: take(w.dur2, Uint16Array) }
}

const frame = () => {
  if (!w) return
  const t = performance.now(), day = w.day
  advance(w, hoursPerSec * 60 / FPS)
  if (w.day !== day) extra.trips = sample(w)
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
    const [[od2, villages, signal], graphs] = await Promise.all([data, net])
    const c = cityFrom({ ...od2, villages, signal }, m.perAgent, m.level)
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
