import { expect, test } from 'vitest'
import fc from 'fast-check'
import { clockAt, FRAME_MS, MAX_FRAMES, READY_MS, respeed, stepsTo, type Clock } from './pace.ts'
import { mulberry32 } from './rng.ts'

const PER_MS = 8 * 60 / 1000, STEP = PER_MS * FRAME_MS // 8 simulated hours a second, more than the fastest button (8x is 4)
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
  // At 1 simulated hour a second a step is 2 minutes: without the cap, 95 minutes ahead gave 49 steps in the next callback.
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

test('a step of 0 (no speed yet that was not a pause) makes no step', () => {
  expect(stepsTo(100, 0, 0)).toBe(0)
})

test('after a slow-down, the model goes on at the next callback, even when it was ahead of the clock', () => {
  // At 8 simulated hours a second the model can be up to half a step (8 minutes) ahead of the clock. At 1 simulated hour a second a step is 2 minutes, so without
  // moving the clock up to the model, the model would wait about 4 frames.
  const model = 100 + 0.4 * STEP, slow = 60 / 1000, c: Clock = { minute: 0, at: 0, perMs: 0 }
  respeed(c, 100, model, 0, slow)
  expect(stepsTo(clockAt(c, FRAME_MS), model, slow * FRAME_MS)).toBe(1)
})

// One event of a run: a callback of the worker (`gap` ms after the last event), with the delay of its message to the
// page, a change of speed on the page, a new run that takes `load` ms to load in the worker, or the page being ready
// for the new run. As in App.tsx, ready counts only after a frame of the run has reached the page, or READY_MS after
// the start.
const ms = (max: number) => fc.double({ min: 0, max, noNaN: true })
const events = fc.array(fc.oneof(
  fc.record({ gap: ms(10 * FRAME_MS), delay: ms(50) }),
  fc.record({ gap: ms(2 * FRAME_MS), speed: fc.constantFrom(0, 1, 2, 4, 8), delay: ms(50) }),
  fc.record({ gap: ms(2 * FRAME_MS), load: ms(20 * FRAME_MS), delay: ms(50) }),
  fc.record({ gap: ms(10 * FRAME_MS), ready: fc.constant(true), delay: ms(50) }),
), { maxLength: 200 })

// ponytail: the test models the clock code of the message handlers in App.tsx and worker.ts (respeed on a change of
// speed and on a new run, the since check, the hold while a world loads, the wait for the page, the skipped frames and
// the owed frame); it does not run them. A change there must be made here too. To test the handlers themselves, move
// their clock code into functions in pace.ts that both call.
test('the clock of the page never goes back in a run, for any timing of callbacks, messages, changes of speed and new runs', () => {
  fc.assert(fc.property(events, es => {
    let now = 0, model = 0, seen = -Infinity
    // since: the change of speed (or new run) that the clock uses. run: the run of the world; loaded: when it is ready.
    let worker: Clock = { minute: 0, at: 0, perMs: PER_MS }, workerSince = 0, workerRun = 0, loaded = 0
    // The next frame is the first of a run; a change of speed came before it; the last speed that was not a pause.
    let firstFrame = false, speedBeforeFirst = false, lastPerMs = PER_MS
    let page: Clock = { ...worker }, pageSince = 0, pageModel = 0, pageRun = 0 // pageModel: the model minute of the last message
    let speed = PER_MS, waiting = false // the speed chosen on the page; a new run waits for the page to be ready
    let startedAt = 0, gotFrame = false // when the page started the run; a frame of it has reached the page
    let owed = false // as worker.ts: the page has no frame yet with the clock of the latest change of speed
    // Messages in flight. Each way keeps its order, so a message never arrives before an earlier one of the same way.
    const inbox: { at: number; run: () => void }[] = []
    let lastToPage = 0, lastToWorker = 0
    const look = () => {
      const c = clockAt(page, now)
      expect(c).toBeGreaterThanOrEqual(seen - 1e-9)
      if (waiting) expect(c).toBeLessThanOrEqual(1e-9) // the clock of a new run stands until the page is ready
      seen = c
    }
    // As the speed effect of App.tsx: the page clock goes on at the speed from its own time, and the worker follows.
    const send = (ready: boolean, delay: number) => {
      respeed(page, clockAt(page, now), pageModel, now, speed)
      const sent = structuredClone(page) // postMessage copies the clock
      pageSince = now
      lastToWorker = Math.max(lastToWorker, now + delay)
      inbox.push({ at: lastToWorker, run: () => {
        respeed(worker, sent.minute, model, sent.at, sent.perMs); workerSince = sent.at; owed = true
        if (firstFrame && !ready) speedBeforeFirst = true
        if (sent.perMs) lastPerMs = sent.perMs
      } })
    }
    const deliver = (until: number) => {
      inbox.sort((a, b) => a.at - b.at)
      // A look just before each message too: a message can take the clock back from where it has moved since the last look.
      while (inbox.length && inbox[0].at <= until) { const m = inbox.shift()!; now = m.at; look(); m.run(); look() }
    }
    // A callback of the worker.
    const frame = (delay: number) => {
      if (now < loaded) return // the worker sends no frame while the world loads
      worker.minute = clockAt(worker, now); worker.at = now
      // The clock waited during the load, so the first frame of the run is at most the cap ahead of minute 0.
      if (firstFrame && !speedBeforeFirst) expect(worker.minute).toBeLessThanOrEqual(MAX_FRAMES * FRAME_MS * worker.perMs + 1e-9)
      const first = firstFrame
      firstFrame = false
      const step = (worker.perMs || lastPerMs) * FRAME_MS, ahead = worker.minute - model, n = stepsTo(worker.minute, model, step)
      model += n * step
      // On a pause the model goes on to the clock, in steps of the last speed, so the dots and the time agree.
      const last = lastPerMs * FRAME_MS
      if (!worker.perMs) expect(Math.abs(worker.minute - model)).toBeLessThanOrEqual(Math.max(last / 2, ahead - (MAX_FRAMES + 1) * last) + 1e-9)
      // As worker.ts: a frame that makes no step and owes no clock is not sent (the first frame of a run always is).
      if (n === 0 && !owed && !first) return
      owed = false
      const sent = { clock: structuredClone(worker), model, since: workerSince, run: workerRun } // postMessage copies the clock
      lastToPage = Math.max(lastToPage, now + delay)
      inbox.push({ at: lastToPage, run: () => {
        if (sent.run !== pageRun) return // a frame of an earlier run
        gotFrame = true
        // As App.tsx: only minute and at; the page keeps its own perMs.
        pageModel = sent.model; if (sent.since === pageSince) { page.minute = sent.clock.minute; page.at = sent.clock.at }
      } })
    }
    for (const e of es) {
      const due = now + e.gap
      deliver(due)
      now = due
      look()
      if ('speed' in e) {
        speed = e.speed * 60 / 1000
        if (!waiting) send(false, e.delay) // while a new run waits, the page keeps the speed for the start
      } else if ('ready' in e) {
        // No check depends on this gate: it keeps the ready events to those that App.tsx can make.
        if (waiting && (gotFrame || now - startedAt >= READY_MS)) { waiting = false; send(true, e.delay) }
      } else if ('load' in e) {
        // Both clocks of the new run stand at minute 0 until the page is ready.
        respeed(page, 0, 0, now, 0)
        const at = now, run = ++pageRun, load = e.load
        pageModel = 0; pageSince = at; seen = -Infinity; waiting = true; startedAt = now; gotFrame = false
        lastToWorker = Math.max(lastToWorker, now + e.delay)
        inbox.push({ at: lastToWorker, run: () => {
          model = 0; workerRun = run; loaded = now + load; firstFrame = true; speedBeforeFirst = false
          respeed(worker, 0, 0, at, 0); workerSince = at
        } })
      } else frame(e.delay)
    }
    deliver(Infinity)
    // With every message in, one more callback leaves the page clock on the worker clock: a skipped frame must not
    // leave the page with an older clock (for example a pause right after the worker made a step).
    now += FRAME_MS; frame(0); deliver(Infinity)
    expect(Math.abs(clockAt(page, now) - clockAt(worker, now))).toBeLessThanOrEqual(1e-6)
  }), {
    seed: 1,
    // Random cases seldom make these, as the numbers lean to 0.
    examples: [
      // The timeout starts the run while the world still loads, with callbacks all through the load: the worker clock
      // must wait for the world.
      [[{ gap: 0, load: READY_MS + 1000, delay: 0 }, { gap: READY_MS, ready: true, delay: 0 }, ...Array(80).fill({ gap: FRAME_MS, delay: 0 })]],
      // A frame of a new run that waits: the worker clock must stand at minute 0, so the page clock does too.
      [[{ gap: 0, load: 0, delay: 0 }, { gap: FRAME_MS, delay: 0 }]],
      // At 8 simulated hours a second a frame rounds the model to minute 16 and is on its way when the page pauses at minute 12. The frame
      // carries the old since, so it cannot move the page clock: the worker must send a frame after the pause.
      [[{ gap: 20, delay: 10 }, { gap: 5, speed: 0, delay: 0 }, { gap: FRAME_MS, delay: 0 }, { gap: FRAME_MS, delay: 0 }]],
      // A frame message still on its way when the speed changes, which the since check must drop.
      [[{ gap: FRAME_MS, delay: 0 }, { gap: FRAME_MS, delay: 30 }, { gap: 1, speed: 1, delay: 0 }, { gap: FRAME_MS, delay: 0 }, { gap: FRAME_MS, delay: 0 }]],
    ],
  })
})
