import { expect, test } from 'vitest'
import fc from 'fast-check'
import { recent, MAX_EVENTS } from './Dashboard.tsx'
import type { SimEvent } from '../sim/events.ts'

test('the event list holds the latest events up to now, newest first, at most MAX_EVENTS', () => fc.assert(fc.property(
  fc.array(fc.integer({ min: 0, max: 10 * 1440 }), { maxLength: 300 }), fc.integer({ min: 0, max: 10 * 1440 }), (times, now) => {
    const events: SimEvent[] = times.map((t, k) => ({ id: `${k}`, t, kind: 'public', text: '' }))
    const got = recent(events, now).map(e => e.t)
    expect(got.length).toBeLessThanOrEqual(MAX_EVENTS)
    got.forEach((t, i) => { expect(t).toBeLessThanOrEqual(now); if (i) expect(t).toBeLessThanOrEqual(got[i - 1]) })
    expect(recent(events, now, MAX_EVENTS + 1).slice(0, MAX_EVENTS).map(e => e.t)).toEqual(got) // the ones dropped are the oldest
  })))
