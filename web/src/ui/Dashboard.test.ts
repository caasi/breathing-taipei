import { expect, test } from 'vitest'
import fc from 'fast-check'
import { recent, MAX_EVENTS } from './Dashboard.tsx'

test('the event list holds the latest events up to now, newest first, at most MAX_EVENTS', () => fc.assert(fc.property(fc.integer({ min: 0, max: 60 * 1440 }), now => {
  const got = recent(now), times = got.map(({ day, e }) => day * 1440 + e.at)
  expect(got.length).toBeLessThanOrEqual(MAX_EVENTS)
  times.forEach((t, i) => { expect(t).toBeLessThanOrEqual(now); if (i) expect(t).toBeLessThan(times[i - 1]) })
  expect(recent(now, MAX_EVENTS + 1).slice(0, MAX_EVENTS)).toEqual(got) // the ones dropped are the oldest
})))
