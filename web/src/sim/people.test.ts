import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { drawNames, nameOf, NICKNAME, NICKNAME_SHARE, MALE, type People } from './people.ts'

const people: People = JSON.parse(readFileSync(new URL('../../public/people.json', import.meta.url), 'utf8'))
const share = (xs: boolean[]) => xs.filter(Boolean).length / xs.length

test('names follow the surnames of the district and the sex split, with nicknames at their share', () => {
  const n = 200_000, d = '台北市大安區', id = drawNames(people, new Array(n).fill(d), 1)
  const t = people.districts[d], men = t.male.reduce((a, [, k]) => a + k, 0) + t.rest[0], women = t.female.reduce((a, [, k]) => a + k, 0) + t.rest[1]
  const all = Array.from({ length: n }, (_, i) => i)
  expect(share(all.map(i => id.sex[i] === NICKNAME))).toBeCloseTo(NICKNAME_SHARE, 2)
  const named = all.filter(i => id.sex[i] !== NICKNAME)
  expect(share(named.map(i => id.sex[i] === MALE))).toBeCloseTo(men / (men + women), 2)
  const chenMen = t.male.find(([s]) => s === '陳')![1]
  const male = named.filter(i => id.sex[i] === MALE)
  expect(share(male.map(i => id.names[id.name[i]] === '陳'))).toBeCloseTo(chenMen / men, 2)
})

test('a surname outside the district top 20 is never one of them, and a name reads as surname and title', () => {
  const d = '新北市板橋區', id = drawNames(people, new Array(50_000).fill(d), 2), t = people.districts[d]
  const top = new Set([...t.male, ...t.female].map(([s]) => s)), names = new Set<string>()
  for (let i = 0; i < 50_000; i++) if (id.sex[i] !== NICKNAME) names.add(id.names[id.name[i]])
  expect([...names].filter(s => !top.has(s)).length).toBeGreaterThan(20)
  const first = Array.from({ length: 50 }, (_, i) => nameOf(id, i))
  expect(first.every(s => /^.+(先生|小姐)$/.test(s) || !/(先生|小姐)$/.test(s))).toBe(true)
  expect(first.some(s => s.endsWith('先生')) && first.some(s => s.endsWith('小姐'))).toBe(true)
})

test('the same seed gives the same names', () => {
  const towns = Object.keys(people.districts), districtOf = Array.from({ length: 50_000 }, (_, i) => towns[i % towns.length])
  const a = drawNames(people, districtOf, 3)
  const b = drawNames(people, districtOf, 3)
  // toEqual on long typed arrays takes seconds; the bytes say the same.
  expect(Buffer.compare(Buffer.from(a.name.buffer), Buffer.from(b.name.buffer))).toBe(0)
  expect(Buffer.compare(Buffer.from(a.sex.buffer), Buffer.from(b.sex.buffer))).toBe(0)
})
