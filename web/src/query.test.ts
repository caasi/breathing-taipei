import { expect, test } from 'vitest'
import fc from 'fast-check'
import { oneOf, setOf, bool, fromBool, onSteps } from './query.ts'

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

test('setOf leaves out retired names, so a list of only retired names is empty, not unknown', () => {
  const parse = setOf(['mrt', 'tra'], ['airport'])
  expect(parse('airport')).toEqual(new Set())
  expect(parse('mrt,airport')).toEqual(new Set(['mrt']))
  expect(parse('bus')).toBeUndefined()
  expect(parse(',')).toBeUndefined()
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

test('onSteps accepts exactly the values a range input can take', () => {
  const parse = onSteps(2, 8, 0.5)
  expect(['2', '3.5', '8'].map(parse)).toEqual([2, 3.5, 8])
  expect(['1.5', '8.5', '3.2', '', ' ', 'x', 'NaN', 'Infinity'].map(parse)).toEqual(Array(8).fill(undefined))
  fc.assert(fc.property(fc.integer({ min: 0, max: 12 }), k => { expect(parse(String(2 + k * 0.5))).toBe(2 + k * 0.5) }))
})
