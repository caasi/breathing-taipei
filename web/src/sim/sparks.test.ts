import { expect, test } from 'vitest'
import { directions, sampler } from './sparks.ts'

test('the sampler keeps a share of the paths, and past its cap a new one takes a place by chance', () => {
  // A draw below 0.5 passes the rate; once full, the next draw picks the place (0.2 of 3 seen: place 0).
  const draws = [0.1, 0.9, 0.1, 0.1, 0.2, 0.1]
  const s = sampler(0.5, 2, () => draws.shift()!)
  const p = (e: number) => Uint16Array.of(e)
  for (const e of [1, 2, 3, 4]) s.offer(p(e))
  expect(s.take().map(x => x[0])).toEqual([4, 3])
  expect(s.take()).toEqual([])
  s.offer(p(5))
  expect(s.take().map(x => x[0])).toEqual([5])
})

test('the direction of each edge follows the shared node', () => {
  // Edges: 0 = 1-2, 1 = 3-2 (run backwards), 2 = 3-4; a path 1, 2, 3, 4.
  const ends = (e: number) => ([[1, 2], [3, 2], [3, 4]] as [number, number][])[e]
  expect([...directions(Uint16Array.of(0, 1, 2), ends)]).toEqual([0, 1, 0])
  // The first edge backwards: edge 0 run 2-1, then an edge 1-5.
  const ends2 = (e: number) => ([[1, 2], [1, 5]] as [number, number][])[e]
  expect([...directions(Uint16Array.of(0, 1), ends2)]).toEqual([1, 0])
  expect([...directions(Uint16Array.of(0), ends)]).toEqual([0])
})
