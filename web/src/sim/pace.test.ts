import { expect, test } from 'vitest'
import fc from 'fast-check'
import { MAX_FRAMES, pacer } from './pace.ts'
import { mulberry32 } from './rng.ts'

const FRAME = 1000 / 30
// The steps of each callback, for callbacks that come the given number of ms apart.
const run = (gaps: number[]) => {
  let now = 0
  const pace = pacer(FRAME, now)
  return gaps.map(gap => pace(now += gap))
}

test('a fast device makes one step per callback, also when each callback is up to 15 ms early or late', () => {
  // setInterval keeps a schedule: callback k is due at k frames, so an early or late callback does not move the next one.
  const r = mulberry32(1)
  const times = Array.from({ length: 10_001 }, (_, k) => k * FRAME + (k ? (r() * 2 - 1) * 15 : 0))
  expect(new Set(run(times.slice(1).map((t, k) => t - times[k])))).toEqual(new Set([1]))
})

test('a device at half the frame rate makes two steps per callback', () => {
  expect(new Set(run(Array(100).fill(2 * FRAME)))).toEqual(new Set([2]))
})

test('the time that one callback does not use goes to the next one', () => {
  const steps = run(Array(100).fill(50)) // 1.5 frames each
  expect(new Set(steps)).toEqual(new Set([1, 2]))
  expect(steps.reduce((a, b) => a + b)).toBe(150)
})

test('a long gap (a tab back from the background) makes at most MAX_FRAMES steps, and the rest of it is lost', () => {
  expect(run([10_000, FRAME, FRAME])).toEqual([MAX_FRAMES, 1, 1])
})

test('without a long gap, the steps stay within half a frame of the real time', () => {
  const gaps = fc.array(fc.double({ min: 0, max: MAX_FRAMES * FRAME, noNaN: true }), { maxLength: 200 })
  fc.assert(fc.property(gaps, gs => {
    const steps = run(gs).reduce((a, b) => a + b, 0), frames = gs.reduce((a, b) => a + b, 0) / FRAME
    expect(Math.abs(steps - frames)).toBeLessThanOrEqual(0.5 + 1e-9)
  }), { seed: 1 })
})
