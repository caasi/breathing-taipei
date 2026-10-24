import { expect, test } from 'vitest'
import fc from 'fast-check'
import { clip, layoutFor, DASHBOARD_WIDTH, MAP_SIZE } from './view.ts'

const screens = fc.record({ w: fc.integer({ min: 320, max: 4000 }), h: fc.integer({ min: 300, max: 3000 }) })

const rects = fc.record({ x: fc.integer({ min: 0, max: 300 }), y: fc.integer({ min: 0, max: 300 }), w: fc.integer({ min: 50, max: 340 }), h: fc.integer({ min: 50, max: 340 }) })

test('the focus (the map square on a desktop, 台北市 on a phone) sits inside the fit area, centred', () => fc.assert(fc.property(screens, rects, ({ w, h }, taipei) => {
  const { kind, box, fit, view: { k, x, y } } = layoutFor(w, h, taipei), f = kind === 'desktop' ? { x: 0, y: 0, w: MAP_SIZE, h: MAP_SIZE } : taipei, e = 1e-9
  expect(fit.x).toBeGreaterThanOrEqual(0); expect(fit.x + fit.w).toBeLessThanOrEqual(box.w + e); expect(fit.y + fit.h).toBeLessThanOrEqual(box.h + e)
  const left = k * f.x + x, top = k * f.y + y
  expect(left).toBeGreaterThanOrEqual(fit.x - e); expect(top).toBeGreaterThanOrEqual(fit.y - e)
  expect(left + k * f.w).toBeLessThanOrEqual(fit.x + fit.w + e); expect(top + k * f.h).toBeLessThanOrEqual(fit.y + fit.h + e)
  expect(left + k * f.w / 2).toBeCloseTo(fit.x + fit.w / 2); expect(top + k * f.h / 2).toBeCloseTo(fit.y + fit.h / 2)
})))

test('the map never shrinks to nothing or turns over: a desktop too narrow for it takes the landscape layout', () => {
  expect(layoutFor(600, 550).kind).toBe('landscape'); expect(layoutFor(1024, 768).kind).toBe('landscape') // iPad landscape
  fc.assert(fc.property(screens, ({ w, h }) => {
    const { kind, fit, view } = layoutFor(w, h)
    expect(view.k).toBeGreaterThan(0)
    if (kind === 'desktop') expect(fit.w).toBeGreaterThanOrEqual(h * 3 / 4)
  }))
})

test('each device gets the layout the user set', () => {
  const desktop = layoutFor(1440, 900), portrait = layoutFor(430, 932), landscape = layoutFor(932, 430)
  expect(desktop.kind).toBe('desktop'); expect(desktop.box).toEqual({ x: 0, y: 0, w: 1440, h: 900 }); expect(desktop.fit.w).toBe(1440 - DASHBOARD_WIDTH)
  expect(portrait.kind).toBe('portrait'); expect(portrait.box.w / portrait.box.h).toBeCloseTo(4 / 3); expect(portrait.box.w).toBe(430)
  expect(landscape.kind).toBe('landscape'); expect(landscape.box.w / landscape.box.h).toBeCloseTo(3 / 4); expect(landscape.box.h).toBe(430)
  expect(layoutFor(1280, 800).kind).toBe('desktop')
})

test('clip space puts a map point where the CSS transform puts it', () => fc.assert(fc.property(screens,
  fc.double({ min: 0, max: MAP_SIZE, noNaN: true }), fc.double({ min: 0, max: MAP_SIZE, noNaN: true }), ({ w, h }, mx, my) => {
    const { box, view: v } = layoutFor(w, h), [sx, sy, tx, ty] = clip(v, box.w, box.h)
    expect((mx * sx + tx + 1) / 2 * box.w).toBeCloseTo(v.k * mx + v.x)
    expect((1 - (my * sy + ty)) / 2 * box.h).toBeCloseTo(v.k * my + v.y)
  })))
