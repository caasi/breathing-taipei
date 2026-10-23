import { expect, test } from 'vitest'
import fc from 'fast-check'
import { oneOf, bool, fromBool } from './query.ts'

test('oneOf accepts exactly the listed options, anything else is undefined', () => {
  const parse = oneOf([1, 2, 4, 8, 16])
  expect([1, 2, 4, 8, 16].map(v => parse(String(v)))).toEqual([1, 2, 4, 8, 16])
  fc.assert(fc.property(fc.string(), s => {
    expect(parse(s) === undefined || ['1', '2', '4', '8', '16'].includes(s)).toBe(true)
  }))
})

test('bool round-trips and rejects other strings', () => {
  expect([true, false].map(b => bool(fromBool(b)))).toEqual([true, false])
  fc.assert(fc.property(fc.string().filter(s => s !== '0' && s !== '1'), s => { expect(bool(s)).toBeUndefined() }))
})
