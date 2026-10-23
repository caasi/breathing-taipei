import { expect, test } from 'vitest'
import fc from 'fast-check'
import { record, since, KEEP, type Entry } from './history.ts'

const snap = (t: number): Entry => ({ t, counts: new Uint32Array([t]) })

test('a paused clock (same time again and again) keeps one entry for that time', () => {
  let h: Entry[] = []
  for (let i = 0; i < 1000; i++) h = record(h, snap(42), 30)
  expect(h.length).toBe(1)
})

test('history covers at least the window and never much more, whatever the window was before', () => {
  fc.assert(fc.property(fc.constantFrom(15, 30, 60, 120), fc.constantFrom(15, 30, 60, 120), fc.integer({ min: 1, max: 8 }), (before, after, step) => {
    let h: Entry[] = []
    let t = 0
    for (; t < 300; t += step) h = record(h, snap(t), before)
    for (const end = t + 300; t < end; t += step) h = record(h, snap(t), after)
    const span = h[h.length - 1].t - h[0].t
    expect(span).toBeGreaterThanOrEqual(after)
    expect(span).toBeLessThan(after + step + 1)
  }))
})

test('after the window grows, the rate spans the new window at once when the history is old enough', () => {
  fc.assert(fc.property(fc.constantFrom(15, 30, 60, 120), fc.constantFrom(15, 30, 60, 120), fc.integer({ min: 1, max: 8 }), (_before, after, step) => {
    let h: Entry[] = []
    let t = 0
    for (; t < 300; t += step) h = record(h, snap(t), KEEP)
    const now = h[h.length - 1].t, from = since(h, after)
    expect(now - from.t).toBeGreaterThanOrEqual(after)
    expect(now - from.t).toBeLessThan(after + step)
  }))
})
