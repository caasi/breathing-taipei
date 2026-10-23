import { expect, test } from 'vitest'
import fc from 'fast-check'
import { oneOf, setOf, bool, fromBool } from './query.ts'

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

test('setOf keeps known names and gives undefined when names are given but none is known', () => {
  const parse = setOf(['mrt', 'tra', 'highway'])
  expect(parse('mrt,highway')).toEqual(new Set(['mrt', 'highway']))
  expect(parse('mrt,foo')).toEqual(new Set(['mrt']))
  expect(parse('foo')).toBeUndefined()
})

test('an empty list is a valid empty selection, so a link with every layer off reloads with every layer off', () => {
  const parse = setOf(['mrt', 'tra', 'highway']), format = (v: Set<string>) => [...v].join(',')
  expect(parse(format(new Set()))).toEqual(new Set())
  fc.assert(fc.property(fc.subarray(['mrt', 'tra', 'highway']), names => {
    expect(parse(format(new Set(names)))).toEqual(new Set(names))
  }))
})
