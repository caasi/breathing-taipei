import { mulberry32 } from './rng.ts'

/** people.json from scripts/people.py: surnames by district and sex, and the national ranking for the rest. */
export type People = {
  national: [string, number][]
  districts: Record<string, { male: [string, number][]; female: [string, number][]; rest: [number, number] }>
}

// The share of residents named by a nickname with no title, a person outside the binary (DATA.md, "Figures in the code").
// ponytail: a U.S. upper bound; use a figure for Taiwan when one exists.
export const NICKNAME_SHARE = 0.016
export const MALE = 0, FEMALE = 1, NICKNAME = 2

// ponytail: gender-neutral nickname patterns, guessed on 2026-10-24 (no source gives Chinese names for non-binary
// people): 阿 or 小 with one character, a doubled character, a food or a thing, an English name.
const NICKNAMES = [
  ...'凱寶仁丁安樂宇晨'.split('').flatMap(c => [`阿${c}`, `小${c}`]),
  ...'豆圓寶毛球'.split('').map(c => c + c),
  '麻糬', '豆花', '小蝦米', '米糕', '布丁', '湯圓',
  'Sam', 'Alex', 'Jamie', 'Kai', 'Robin', 'Ash',
]

/** Each agent's name: sex[i] is MALE, FEMALE or NICKNAME; name[i] indexes `names`. */
export type Identity = { sex: Uint8Array; name: Uint16Array; names: string[] }

const cumulative = (weights: number[]) => { let s = 0; return Float64Array.from(weights, w => (s += w)) }
/** Index drawn in proportion to the weights behind a cumulative array, by binary search. */
const drawFrom = (cum: Float64Array, r: number) => {
  let lo = 0, hi = cum.length - 1
  const x = r * cum[hi]
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1 }
  return lo
}

/**
 * Draws a name for every agent from the surnames of its home district. A surname outside the district's top 20
 * comes from the national ranking without those 20. Its own random numbers, so the names do not change the run.
 */
export const drawNames = (people: People, districtOf: ArrayLike<string>, seed: number): Identity => {
  const names = [...people.national.map(([s]) => s), ...NICKNAMES]
  const index = new Map(names.map((s, k) => [s, k]))
  const rng = mulberry32(seed), n = districtOf.length
  const sex = new Uint8Array(n), name = new Uint16Array(n)
  // Per district and sex: the names it can give and their cumulative weights, its top 20 first, then the national rest.
  const tables = new Map<string, { sexes: Float64Array; names: number[][]; cum: Float64Array[] }>()
  const table = (d: string) => tables.get(d) ?? tables.set(d, (() => {
    const t = people.districts[d], top = new Set([...t.male, ...t.female].map(([s]) => s))
    const rest = people.national.filter(([s]) => !top.has(s)), restTotal = rest.reduce((a, [, k]) => a + k, 0)
    const lists = [t.male, t.female].map((list, s) => [...list, ...rest.map(([r, k]): [string, number] => [r, k * t.rest[s] / restTotal])])
    return { sexes: cumulative(lists.map(l => l.reduce((a, [, k]) => a + k, 0))), names: lists.map(l => l.map(([s]) => index.get(s)!)),
      cum: lists.map(l => cumulative(l.map(([, k]) => k))) }
  })()).get(d)!
  for (let i = 0; i < n; i++) {
    if (rng() < NICKNAME_SHARE) { sex[i] = NICKNAME; name[i] = people.national.length + Math.floor(rng() * NICKNAMES.length); continue }
    const t = table(districtOf[i]), s = drawFrom(t.sexes, rng())
    sex[i] = s
    name[i] = t.names[s][drawFrom(t.cum[s], rng())]
  }
  return { sex, name, names }
}

export const nameOf = ({ sex, name, names }: Identity, i: number) =>
  sex[i] === NICKNAME ? names[name[i]] : `${names[name[i]]}${sex[i] === MALE ? '先生' : '小姐'}`
