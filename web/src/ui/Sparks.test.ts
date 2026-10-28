import { expect, test } from 'vitest'
import { pathLine } from './Sparks.tsx'

// Three edges of a path from (0, 0) to (3, 0); the middle one is stored from its far end.
const lines = [[0, 0, 1, 0], [2, 0, 1, 0], [2, 0, 3, 0]]

test('a path line runs each edge in the direction of the path', () => {
  expect(pathLine([0, 1, 2], [0, 1, 0], lines)).toEqual([0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 3, 0])
  expect(pathLine([2, 1, 0], [1, 0, 1], lines)).toEqual([3, 0, 2, 0, 2, 0, 1, 0, 1, 0, 0, 0])
})

test('an edge with no shape drops out', () => {
  expect(pathLine([0, 9, 1], [0, 0, 1], lines)).toEqual([0, 0, 1, 0, 1, 0, 2, 0])
  expect(pathLine([9, 0], [1, 0], lines)).toEqual([0, 0, 1, 0])
})
