import { expect, test } from 'vitest'
import { changeRate, groupBy, sumBy } from './districts.ts'

test('the villages add up by district, in the order the districts first come', () => {
  const group = groupBy(['台北市大安區', '新北市板橋區', '台北市大安區'])
  expect(group.names).toEqual(['台北市大安區', '新北市板橋區'])
  expect(Array.from(sumBy(group, [3, 5, 4]))).toEqual([7, 5])
})

test('the change rate of a district is its whole change over its whole residents, not a mean of its villages', () => {
  // A small village gains 10 people in an hour; a large one of the same district does not change.
  const group = groupBy(['A', 'A']), residents = [10, 1000], then = [10, 1000], now = [20, 1000]
  expect(Array.from(changeRate(now, then, residents, 60))).toEqual([1, 0])
  const [district] = changeRate(sumBy(group, now), sumBy(group, then), sumBy(group, residents), 60)
  expect(district).toBeCloseTo(10 / 1010, 6) // a mean of the villages would give 0.5
})

test('a loss is negative, and a node with no residents counts as one', () => {
  expect(Array.from(changeRate([0, 3], [5, 0], [5, 0], 30))).toEqual([-2, 6])
})
