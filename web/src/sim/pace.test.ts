import { expect, test } from 'vitest'
import fc from 'fast-check'
import { clockAt, FRAME_MS, MAX_FRAMES, pacer } from './pace.ts'
import { mulberry32 } from './rng.ts'

// The steps of each callback, for callbacks that come the given number of ms apart.
const run = (gaps: number[]) => {
  let now = 0
  const pace = pacer(now)
  return gaps.map(gap => pace(now += gap).steps)
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

test('steps plus lead is the real time in frames, with each gap capped at MAX_FRAMES frames', () => {
  const gaps = fc.array(fc.double({ min: 0, max: 10 * FRAME_MS, noNaN: true }), { maxLength: 200 })
  fc.assert(fc.property(gaps, gs => {
    let now = 0, steps = 0, lead = 0
    const pace = pacer(now)
    for (const g of gs) { const p = pace(now += g); steps += p.steps; lead = p.lead }
    expect(steps + lead).toBeCloseTo(sum(gs.map(g => Math.min(g, MAX_FRAMES * FRAME_MS))) / FRAME_MS, 6)
    expect(Math.abs(lead)).toBeLessThanOrEqual(0.5)
  }), { seed: 1 })
})

test('the clock of the page never goes back, for any timing of callbacks and of the messages that reach the page', () => {
  const minutesPerMs = 8 * 60 / 1000, step = minutesPerMs * FRAME_MS // 8x
  // Each callback: the gap since the last one, and how long its message takes to reach the page.
  const callbacks = fc.array(fc.tuple(fc.double({ min: 0, max: 10 * FRAME_MS, noNaN: true }), fc.double({ min: 0, max: 50, noNaN: true })), { maxLength: 200 })
  fc.assert(fc.property(callbacks, cs => {
    let now = 0, model = 0, arrived = 0, shown = { minute: 0, at: 0 }, seen = 0
    const pace = pacer(now)
    for (const [gap, delay] of cs) {
      const p = pace(now += gap)
      model += p.steps * step
      // The page reads the clock up to the arrival, then takes the new message. Messages keep their order.
      const arrival = Math.max(arrived, now + delay)
      for (const t of [arrived, (arrived + arrival) / 2, arrival]) {
        const c = clockAt(shown.minute, shown.at, minutesPerMs, t)
        expect(c).toBeGreaterThanOrEqual(seen - 1e-9); seen = c
      }
      shown = { minute: model + p.lead * step, at: now }
      arrived = arrival
      const c = clockAt(shown.minute, shown.at, minutesPerMs, arrival)
      expect(c).toBeGreaterThanOrEqual(seen - 1e-9); seen = c
    }
  }), { seed: 1 })
})
