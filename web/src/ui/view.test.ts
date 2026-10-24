import { expect, test } from 'vitest'
import fc from 'fast-check'
import { clip, viewFor, DASHBOARD_WIDTH, MAP_SIZE } from './view.ts'

const screens = fc.record({ w: fc.integer({ min: DASHBOARD_WIDTH + 100, max: 4000 }), h: fc.integer({ min: 100, max: 3000 }) })

test('the map fits left of the dashboard, centred in that space', () => fc.assert(fc.property(screens, ({ w, h }) => {
  const { k, x, y } = viewFor(w, h)
  expect(x).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeGreaterThanOrEqual(-1e-9)
  expect(x + MAP_SIZE * k).toBeLessThanOrEqual(w - DASHBOARD_WIDTH + 1e-9); expect(y + MAP_SIZE * k).toBeLessThanOrEqual(h + 1e-9)
  expect(x + MAP_SIZE * k / 2).toBeCloseTo((w - DASHBOARD_WIDTH) / 2); expect(y + MAP_SIZE * k / 2).toBeCloseTo(h / 2)
})))

test('clip space puts a map point where the CSS transform puts it', () => fc.assert(fc.property(screens,
  fc.double({ min: 0, max: MAP_SIZE, noNaN: true }), fc.double({ min: 0, max: MAP_SIZE, noNaN: true }), ({ w, h }, mx, my) => {
    const v = viewFor(w, h), [sx, sy, tx, ty] = clip(v, w, h)
    expect((mx * sx + tx + 1) / 2 * w).toBeCloseTo(v.k * mx + v.x)
    expect((1 - (my * sy + ty)) / 2 * h).toBeCloseTo(v.k * my + v.y)
  })))
