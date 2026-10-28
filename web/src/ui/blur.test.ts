import { expect, test } from 'vitest'
import { planOf } from './blur.ts'

test('a blur takes at most 12 texels on each side, at the mip level it needs', () => {
  expect(planOf(0)).toMatchObject({ lod: 0, taps: 0 })
  expect(planOf(4)).toMatchObject({ lod: 0, taps: 12 })
  expect(planOf(4.01)).toMatchObject({ lod: 1, scale: 2 })
  for (const sigma of [0.5, 3, 8, 24, 100]) expect(planOf(sigma).taps).toBeLessThanOrEqual(12)
})
