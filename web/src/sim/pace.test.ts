import { expect, test } from 'vitest'
import fc from 'fast-check'
import { clockAt, FRAME_MS, MAX_FRAMES, respeed, stepsTo, type Clock } from './pace.ts'
import { mulberry32 } from './rng.ts'

const PER_MS = 8 * 60 / 1000, STEP = PER_MS * FRAME_MS // 8x
// The worker loop without the model: for callbacks that come the given number of ms apart, the steps of each one.
const run = (gaps: number[]) => {
  let c: Clock = { minute: 0, at: 0, perMs: PER_MS }, model = 0
  return gaps.map(gap => {
    const now = c.at + gap
    c.minute = clockAt(c, now); c.at = now
    const n = stepsTo(c.minute, model, STEP)
    model += n * STEP
    return n
  })
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

test('a fast device makes one step per callback, also when each callback is up to 15 ms early or late', () => {
  // setInterval keeps a schedule: callback k is due at k frames, so an early or late callback does not move the next one.
  const r = mulberry32(1)
  const times = Array.from({ length: 10_001 }, (_, k) => k * FRAME_MS + (k ? (r() * 2 - 1) * 15 : 0))
  expect(new Set(run(times.slice(1).map((t, k) => t - times[k])))).toEqual(new Set([1]))
})

test('a timer that runs every 33 ms (as in Chromium) makes no step in one callback of about 100', () => {
  const steps = run(Array(1000).fill(33))
  expect(sum(steps)).toBe(990)
  expect(steps.filter(s => s === 0).length).toBe(10)
})

test('a device at half the frame rate makes two steps per callback', () => {
  expect(new Set(run(Array(100).fill(2 * FRAME_MS)))).toEqual(new Set([2]))
})

test('the time that one callback does not use goes to the next one', () => {
  const steps = run(Array(100).fill(50)) // 1.5 frames each
  expect(new Set(steps)).toEqual(new Set([1, 2]))
  expect(sum(steps)).toBe(150)
})

test('a long gap (a tab back from the background) counts as MAX_FRAMES frames', () => {
  expect(run([10_000, FRAME_MS, FRAME_MS])).toEqual([MAX_FRAMES, 1, 1])
})

test('a clock far ahead of the model is made up over several callbacks, at most MAX_FRAMES + 1 steps in each', () => {
  // Several changes of speed with no callback between them can put the clock far ahead: each one starts a new cap.
  // At 1x a step is 2 minutes: without the cap, 95 minutes ahead gave 49 steps in the next callback.
  const slow = 60 / 1000, step = slow * FRAME_MS, c: Clock = { minute: 95, at: 0, perMs: slow }
  let model = 0
  const steps = Array.from({ length: 20 }, (_, k) => {
    c.minute = clockAt(c, (k + 1) * FRAME_MS); c.at = (k + 1) * FRAME_MS
    const n = stepsTo(c.minute, model, step)
    model += n * step
    return n
  })
  expect(Math.max(...steps)).toBe(MAX_FRAMES + 1)
  expect(Math.abs(c.minute - model)).toBeLessThan(step)
})

test('a pause makes no step', () => {
  expect(stepsTo(100, 0, 0)).toBe(0)
})

test('after a slow-down, the model goes on at the next callback, even when it was ahead of the clock', () => {
  // At 8x the model can be up to half a step (8 minutes) ahead of the clock. At 1x a step is 2 minutes, so without
  // moving the clock up to the model, the model would wait about 4 frames.
  const model = 100 + 0.4 * STEP, slow = 60 / 1000, c: Clock = { minute: 0, at: 0, perMs: 0 }
  respeed(c, 100, model, 0, slow)
  expect(stepsTo(clockAt(c, FRAME_MS), model, slow * FRAME_MS)).toBe(1)
})

// One event of a run: a callback of the worker (`gap` ms after the last event), with the delay of its message to the
// page, a change of speed on the page, or a new run that takes `load` ms to load in the worker.
const ms = (max: number) => fc.double({ min: 0, max, noNaN: true })
const events = fc.array(fc.oneof(
  fc.record({ gap: ms(10 * FRAME_MS), delay: ms(50) }),
  fc.record({ gap: ms(2 * FRAME_MS), speed: fc.constantFrom(0, 1, 2, 4, 8), delay: ms(50) }),
  fc.record({ gap: ms(2 * FRAME_MS), load: ms(20 * FRAME_MS), delay: ms(50) }),
), { maxLength: 200 })

test('the clock of the page never goes back in a run, for any timing of callbacks, messages, changes of speed and new runs', () => {
  fc.assert(fc.property(events, es => {
    let now = 0, model = 0, seen = -Infinity
    // since: the change of speed (or new run) that the clock uses. run: the run of the world; loaded: when it is ready.
    let worker: Clock = { minute: 0, at: 0, perMs: PER_MS }, workerSince = 0, workerRun = 0, loaded = 0
    let firstFrame = false, speedInLoad = false // the next frame is the first of a run; a change of speed came during its load
    let page: Clock = { ...worker }, pageSince = 0, pageModel = 0, pageRun = 0 // pageModel: the model minute of the last message
    // Messages in flight. Each way keeps its order, so a message never arrives before an earlier one of the same way.
    const inbox: { at: number; run: () => void }[] = []
    let lastToPage = 0, lastToWorker = 0
    const look = () => { const c = clockAt(page, now); expect(c).toBeGreaterThanOrEqual(seen - 1e-9); seen = c }
    const deliver = (until: number) => {
      inbox.sort((a, b) => a.at - b.at)
      // A look just before each message too: a message can take the clock back from where it has moved since the last look.
      while (inbox.length && inbox[0].at <= until) { const m = inbox.shift()!; now = m.at; look(); m.run(); look() }
    }
    for (const e of es) {
      const due = now + e.gap
      deliver(due)
      now = due
      look()
      if ('speed' in e) {
        respeed(page, clockAt(page, now), pageModel, now, e.speed * 60 / 1000)
        const sent = structuredClone(page) // postMessage copies the clock
        pageSince = now
        lastToWorker = Math.max(lastToWorker, now + e.delay)
        inbox.push({ at: lastToWorker, run: () => {
          respeed(worker, sent.minute, model, sent.at, sent.perMs); workerSince = sent.at
          if (now < loaded) speedInLoad = true
        } })
      } else if ('load' in e) {
        respeed(page, 0, 0, now, page.perMs)
        const at = now, run = ++pageRun, load = e.load
        pageModel = 0; pageSince = at; seen = -Infinity
        lastToWorker = Math.max(lastToWorker, now + e.delay)
        inbox.push({ at: lastToWorker, run: () => {
          model = 0; workerRun = run; loaded = now + load; firstFrame = true; speedInLoad = false
          respeed(worker, 0, 0, at, worker.perMs); workerSince = at
        } })
      } else {
        if (now < loaded) continue // the worker sends no frame while the world loads
        worker.minute = clockAt(worker, now); worker.at = now
        // The clock waited during the load, so the first frame of the run is at most the cap ahead of minute 0.
        if (firstFrame && !speedInLoad) expect(worker.minute).toBeLessThanOrEqual(MAX_FRAMES * FRAME_MS * worker.perMs + 1e-9)
        firstFrame = false
        const step = worker.perMs * FRAME_MS
        model += stepsTo(worker.minute, model, step) * step
        const sent = { clock: structuredClone(worker), model, since: workerSince, run: workerRun } // postMessage copies the clock
        lastToPage = Math.max(lastToPage, now + e.delay)
        inbox.push({ at: lastToPage, run: () => {
          if (sent.run !== pageRun) return // a frame of an earlier run
          // As App.tsx: only minute and at; the page keeps its own perMs.
          pageModel = sent.model; if (sent.since === pageSince) { page.minute = sent.clock.minute; page.at = sent.clock.at }
        } })
      }
    }
    deliver(Infinity)
  }), {
    seed: 1,
    // Random cases seldom make these, as the numbers lean to 0: a load longer than the cap, with callbacks all through
    // it; and a frame message still on its way when the speed changes, which the since check must drop.
    examples: [
      [[{ gap: 0, load: 20 * FRAME_MS, delay: 0 }, ...Array(40).fill({ gap: FRAME_MS, delay: 0 })]],
      [[{ gap: FRAME_MS, delay: 0 }, { gap: FRAME_MS, delay: 30 }, { gap: 1, speed: 1, delay: 0 }, { gap: FRAME_MS, delay: 0 }, { gap: FRAME_MS, delay: 0 }]],
    ],
  })
})
