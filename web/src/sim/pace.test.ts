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
    c = { ...c, minute: clockAt(c, now), at: now }
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

test('a pause makes no step', () => {
  expect(stepsTo(100, 0, 0)).toBe(0)
})

test('after a slow-down, the model goes on at the next callback, even when it was ahead of the clock', () => {
  // At 8x the model can be up to half a step (8 minutes) ahead of the clock. At 1x a step is 2 minutes, so without
  // moving the clock up to the model, the model would wait about 4 frames.
  const model = 100 + 0.4 * STEP, slow = 60 / 1000
  const c = respeed(100, model, 0, slow)
  expect(stepsTo(clockAt(c, FRAME_MS), model, slow * FRAME_MS)).toBe(1)
})

// One event of a run: a callback of the worker (`gap` ms after the last event), with the delay of its message to the
// page, or a change of speed on the page.
const events = fc.array(fc.oneof(
  fc.record({ gap: fc.double({ min: 0, max: 10 * FRAME_MS, noNaN: true }), delay: fc.double({ min: 0, max: 50, noNaN: true }) }),
  fc.record({ gap: fc.double({ min: 0, max: 2 * FRAME_MS, noNaN: true }), speed: fc.constantFrom(0, 1, 2, 4, 8), delay: fc.double({ min: 0, max: 50, noNaN: true }) }),
), { maxLength: 200 })

test('the clock of the page never goes back, for any timing of callbacks, messages and changes of speed', () => {
  fc.assert(fc.property(events, es => {
    let now = 0, model = 0, seen = -Infinity
    let worker: Clock = { minute: 0, at: 0, perMs: PER_MS }, workerSince = 0 // the change of speed that the worker uses
    let page: Clock = { ...worker }, pageSince = 0, pageModel = 0 // pageModel: the model minute of the last message
    // Messages in flight. Each way keeps its order, so a message never arrives before an earlier one of the same way.
    const inbox: { at: number; run: () => void }[] = []
    let lastToPage = 0, lastToWorker = 0
    const look = () => { const c = clockAt(page, now); expect(c).toBeGreaterThanOrEqual(seen - 1e-9); seen = c }
    const deliver = (until: number) => {
      inbox.sort((a, b) => a.at - b.at)
      while (inbox.length && inbox[0].at <= until) { const m = inbox.shift()!; now = m.at; m.run(); look() }
    }
    for (const e of es) {
      const due = now + e.gap
      deliver(due)
      now = due
      look()
      if ('speed' in e) {
        const sent = (page = respeed(clockAt(page, now), pageModel, now, e.speed * 60 / 1000))
        pageSince = now
        lastToWorker = Math.max(lastToWorker, now + e.delay)
        inbox.push({ at: lastToWorker, run: () => { worker = respeed(sent.minute, model, sent.at, sent.perMs); workerSince = sent.at } })
      } else {
        worker = { ...worker, minute: clockAt(worker, now), at: now }
        const step = worker.perMs * FRAME_MS
        model += stepsTo(worker.minute, model, step) * step
        const sent = { clock: worker, model, since: workerSince }
        lastToPage = Math.max(lastToPage, now + e.delay)
        inbox.push({ at: lastToPage, run: () => { pageModel = sent.model; if (sent.since === pageSince) page = sent.clock } })
      }
    }
    deliver(Infinity)
  }), { seed: 1 })
})
