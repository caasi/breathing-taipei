import { expect, test } from 'vitest'
import { quads, strips } from './lines.ts'

test('each segment of a line is two triangles, with the length run so far along it', () => {
  // An L of two segments, 3 then 4 units long, and a second line that is one point only.
  const q = quads([[0, 0, 3, 0, 3, 4], [9, 9]], p => p)
  expect(q.xy.length / 2).toBe(12)
  expect([...q.along]).toEqual([0, 0, 3, 3, 0, 3, 3, 3, 7, 7, 3, 7])
  expect(new Set(q.edge)).toEqual(new Set([0]))
  expect([...q.across.slice(0, 6)]).toEqual([1, -1, 1, 1, -1, -1])
})

test('a closed ring is one strip: each corner is a miter that the two segments share', () => {
  const q = strips([[0, 0, 1, 0, 1, 1, 0, 1, 0, 0]], p => p)
  expect(q.xy.length / 2).toBe(24)
  // The corner at (0, 0) between the left side and the bottom side reaches out to (1, 1) times the half width.
  expect(q.normal[0]).toBeCloseTo(1); expect(q.normal[1]).toBeCloseTo(1)
  // The bottom side ends at (1, 0) with the miter of that corner, which the right side starts with.
  expect([q.normal[4], q.normal[5]]).toEqual([q.normal[12 + 0], q.normal[12 + 1]])
  expect(q.along[q.along.length - 1]).toBe(4)
})

test('a turn sharper than the miter limit of SVG, 4, gets a bevel: square ends and one triangle on the outer side', () => {
  const q = strips([[0, 0, 10, 0, 0, 1]], p => p)
  expect(q.xy.length / 2).toBe(2 * 6 + 3)
  for (let i = 0; i < q.normal.length; i += 2) expect(Math.hypot(q.normal[i], q.normal[i + 1])).toBeLessThanOrEqual(1.0001)
  // After the first segment, the triangle starts at the corner itself, in the middle of the line.
  expect([q.xy[12], q.xy[13], q.across[6]]).toEqual([10, 0, 0])
})

test('points nearer than the gap to the point before are left out', () => {
  const q = strips([[0, 0, 0.1, 0, 5, 0]], p => p, { gap: 0.5 })
  expect(q.xy.length / 2).toBe(6)
  expect(q.along[q.along.length - 1]).toBe(5)
})

test('a ring that repeats its closing point, or ends near its first point, has no closing segment shorter than the gap', () => {
  // 民生里 (65000100019) in villages2-topo.json ends with its first point twice.
  const q = strips([[0, 0, 10, 0, 10, 10, 0, 10, 0, 0.1, 0, 0, 0, 0]], p => p, { gap: 0.2 })
  expect([...q.normal].every(Number.isFinite)).toBe(true)
  expect(q.xy.length / 2).toBe(4 * 6)
})
