import { expect, test, vi } from 'vitest'
import { paint, type Frame, type Layer } from './GLMap.tsx'

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
