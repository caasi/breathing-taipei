import { expect, test } from 'vitest'
import { tail } from './Metrics.tsx'

test('the 1% low and top are the fps of the mean frame of the slowest and fastest 1%, at least one frame', () => {
  // 200 frames: 198 of 10 ms, one of 50 ms and one of 5 ms. 1% of 200 is 2 frames.
  const sorted = [5, ...new Array(198).fill(10), 50]
  expect(tail(sorted, true)).toBeCloseTo(1000 / 30)
  expect(tail(sorted, false)).toBeCloseTo(1000 / 7.5)
  expect(tail([20], true)).toBe(50)
})
