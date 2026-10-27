import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import fc from 'fast-check'
import { actionOf, evenPick, jamOf, publicEvents, withPublic, type Mood, type SimEvent } from './events.ts'
import { mulberry32 } from './rng.ts'
import { indexOf, type Calendar } from './calendar.ts'
import { GONE, PLAY, STAY, WORK } from './core.ts'

const cal: Calendar = JSON.parse(readFileSync(new URL('../../public/calendar.json', import.meta.url), 'utf8'))
// The day's notices at 00:00, without the greetings of the later hours.
const texts = (iso: string) => publicEvents(cal, indexOf(cal, iso), 0).filter(e => e.t === 0).map(e => (e.kind === 'public' ? e.text : ''))

test('public events: holidays, 補假, observances, solar terms and the civic days', () => {
  expect(texts('2026-10-25')).toEqual(['今天是臺灣光復暨金門古寧頭大捷紀念日，放假一天'])
  expect(texts('2026-10-26')).toEqual(['今天補假，放假一天'])
  expect(texts('2026-03-12')).toEqual(['今天是國父逝世紀念日', '今天是植樹節'])
  expect(texts('2026-10-23')).toEqual(['今天霜降'])
  expect(texts('2026-11-28')).toContain('今天是選舉日，大家記得出門投票（08:00 到 16:00）')
  expect(texts('2026-12-25')).toEqual(['今天是行憲紀念日，放假一天', '今天新的市長上任了'])
})

test('a personal event says where the character goes and how', () => {
  const places = [{ town: '大安區', village: '學府里' }, { town: '大安區', village: '錦安里' }, { town: '中山區', village: '朱崙里' }]
  const e = (dest: number, to: number, mode: number, group = ''): Extract<SimEvent, { kind: 'personal' }> =>
    ({ id: 'a1', t: 0, kind: 'personal', name: '林先生', home: 0, to, dest, mode, group })
  const at = (n: number) => places[n]
  expect(actionOf(e(WORK, 2, 0), at)).toBe('搭捷運到中山區上班')
  expect(actionOf(e(WORK, 1, 4), at)).toBe('走路到錦安里上班') // inside the home district: the village
  expect(actionOf(e(PLAY, 2, 3), at)).toBe('開車去中山區走走')
  expect(actionOf(e(GONE, 0, 0), at)).toBe('今天出遠門，離開雙北')
  expect(actionOf(e(STAY, 0, 0), at)).toBe('今天在家休息')
  expect(actionOf(e(WORK, 1, 2, 'early'), at)).toBe('騎機車去早餐店上早班')
  expect(actionOf({ ...e(WORK, 2, 0), back: true }, at)).toBe('搭捷運下班回家')
  expect(actionOf({ ...e(PLAY, 2, 3), back: true }, at)).toBe('開車從中山區回家')
  expect(actionOf({ ...e(WORK, 1, 2, 'early'), back: true }, at)).toBe('騎機車回家')
  expect(actionOf({ ...e(WORK, 2, 3), back: true, late: 25, mood: 'angry' }, at)).toBe('路上塞車晚到，晚了25分鐘才開車下班回家，一肚子火')
  expect(actionOf({ ...e(PLAY, 2, 3), back: true, late: 5, mood: 'blank' }, at)).toBe('路上塞車晚到，晚了5分鐘才開車從中山區回家，算了，明天早點出門')
})

test('greetings follow the kind of day', () => {
  const at = (iso: string) => publicEvents(cal, indexOf(cal, iso), 0).filter(e => e.t > 0).map(e => [e.t, e.kind === 'public' ? e.text : ''])
  expect(at('2026-10-27')).toContainEqual([450, '上班時間快到了，路上的人越來越多']) // a Tuesday, 07:30
  expect(at('2026-10-25').map(([, s]) => s)).not.toContain('上班時間快到了，路上的人越來越多') // a holiday
  expect(at('2026-10-25')).toContainEqual([180, '早餐店的人陸續起床，準備備料'])
})

test('the public events passed to the list hold all of the newest 100 up to now, at any time of day and around a holiday break', () => {
  // 2028-01-31 is in the 春節 break, where nine days have fewer than 100 public events. Personal events made ahead of
  // now (t after now) must not count, and a sparse stream of them must not hide a day.
  for (const iso of ['2026-10-24', '2028-01-01'])
    for (const now of [10 * 1440, 30 * 1440, 30 * 1440 + 120, 45 * 1440, 45 * 1440 + 719, 120 * 1440 + 1439]) {
      const start = indexOf(cal, iso), today = Math.floor(now / 1440)
      const personal: SimEvent[] = Array.from({ length: 40 }, (_, k) => ({ id: `a${k}`, t: now - 300 * k + 600, kind: 'personal', name: '', home: 0, to: 0, dest: 0, mode: 0, group: '' }))
      const all = [...personal, ...Array.from({ length: today + 1 }, (_, d) => publicEvents(cal, start, d)).flat()]
      const newest = (es: SimEvent[]) => es.filter(e => e.t <= now).sort((a, b) => b.t - a.t || a.id.localeCompare(b.id)).slice(0, 100).map(e => e.id)
      expect(newest(withPublic(personal, cal, start, now, 100))).toEqual(newest(all))
    }
})

test('past the end of the calendar table the city still greets its days, by the weekday', () => {
  const end = cal.days.length, at = (k: number) => publicEvents(cal, end + k, 0).map(e => (e.kind === 'public' ? e.text : ''))
  expect(at(0)).toContain('上班時間快到了，路上的人越來越多') // 2035-01-01, a Monday: no holidays past the table
  expect(at(5)).toContain('出門走走的人多了起來') // a Saturday
})

test('evenPick shows each kind at its rate, with no gap longer than one step of the rate, when the kinds come mixed', () => {
  fc.assert(fc.property(fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), { minLength: 1, maxLength: 4 }), fc.integer(), fc.integer(), (rates, seed, order) => {
    const pick = evenPick(rates, mulberry32(seed)), next = mulberry32(order), n = rates.map(() => 0), shown: number[][] = rates.map(() => [])
    // The worker calls the kinds in the order of the plans: each kind keeps its own sum, whatever comes between.
    for (let i = 0; i < 1000 * rates.length; i++) {
      const kind = Math.floor(next() * rates.length)
      if (pick(kind)) shown[kind].push(n[kind])
      n[kind]++
    }
    rates.forEach((rate, kind) => {
      expect(Math.abs(shown[kind].length - rate * n[kind])).toBeLessThanOrEqual(1)
      for (let k = 1; k < shown[kind].length; k++) expect(shown[kind][k] - shown[kind][k - 1]).toBeLessThanOrEqual(Math.ceil(1 / rate))
    })
  }))
})

test('a jam names the road, or the village near it, for every mood and road mode', () => {
  const placeOf = () => ({ town: '內湖區', village: '港墘里' })
  const jam = (mood: Mood, mode: number, road?: string): Extract<SimEvent, { kind: 'jam' }> =>
    ({ id: 'j', t: 0, kind: 'jam', name: '林先生', home: 0, mode, road, near: 0, mood })
  for (const mood of ['angry', 'stuck', 'blank', 'work', 'leave'] as const) for (const mode of [1, 2, 3]) {
    expect(jamOf(jam(mood, mode, '堤頂大道一段'), placeOf)).toContain('堤頂大道一段')
    expect(jamOf(jam(mood, mode), placeOf)).toContain('港墘里附近')
  }
  expect(jamOf(jam('stuck', 1, '承德路四段'), placeOf)).toBe('坐的公車卡在承德路四段，車上的人都在看錶')
  expect(jamOf(jam('angry', 2, '華中橋'), placeOf)).toBe('騎機車塞在華中橋，半天沒前進，氣到想罵人')
})
