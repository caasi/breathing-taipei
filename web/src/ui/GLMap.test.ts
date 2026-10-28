import { expect, test, vi } from 'vitest'
import { ease, paint, type Frame, type Layer } from './GLMap.tsx'

const f = { now: 0 } as Frame
const layer = (log: string[], name: string, over: Partial<Layer> = {}) =>
  ({ layer: { dirty: () => false, draw: () => { log.push(name) }, dispose: () => {}, ...over }, order: 0 })

test('a frame with no dirty layer and no force draws nothing', () => {
  const log: string[] = []
  expect(paint([layer(log, 'a')], f, false, () => log.push('reset'), () => log.push('clear')).drawn).toBe(false)
  expect(log).toEqual([])
})

test('one dirty layer clears once and draws every layer in order, each after a reset', () => {
  const log: string[] = []
  const entries = [layer(log, 'a'), layer(log, 'b', { dirty: () => true })]
  expect(paint(entries, f, false, () => log.push('reset'), () => log.push('clear'))).toEqual({ drawn: true, failed: [] })
  expect(log).toEqual(['reset', 'clear', 'reset', 'a', 'reset', 'b'])
})

test('a layer that throws is returned, and the other layers still draw', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const log: string[] = []
  const inDraw = layer(log, 'x', { draw: () => { throw new Error('draw') } })
  const inDirty = layer(log, 'y', { dirty: () => { throw new Error('dirty') } })
  const { failed } = paint([layer(log, 'a'), inDraw, inDirty, layer(log, 'b')], f, true, () => {}, () => {})
  expect(failed).toEqual([inDirty, inDraw])
  expect(log).toEqual(['a', 'b'])
})

test('with a group, the layers from its order up draw between begin and end', () => {
  const log: string[] = []
  const entries = [{ ...layer(log, 'land'), order: -1 }, layer(log, 'a', { dirty: () => true }), { ...layer(log, 'b'), order: 1 }]
  const group = { from: 0, begin: () => log.push('begin'), end: () => log.push('end') }
  paint(entries, f, false, () => {}, () => log.push('clear'), group)
  expect(log).toEqual(['clear', 'land', 'begin', 'a', 'b', 'end'])
})

test('a hidden group draws none of its layers, and calls neither begin nor end', () => {
  const log: string[] = []
  const entries = [{ ...layer(log, 'land'), order: -1 }, layer(log, 'a', { dirty: () => true })]
  paint(entries, f, false, () => {}, () => {}, { from: 0, hide: true, begin: () => log.push('begin'), end: () => log.push('end') })
  expect(log).toEqual(['land'])
})

test('the fade follows CSS ease, and ends on 0 and 1 exactly', () => {
  expect([0, 1].map(ease)).toEqual([0, 1])
  // cubic-bezier(0.25, 0.1, 0.25, 1), solved by a script outside the code
  expect(ease(0.25)).toBeCloseTo(0.4085, 3)
  expect(ease(0.5)).toBeCloseTo(0.8024, 3)
})
