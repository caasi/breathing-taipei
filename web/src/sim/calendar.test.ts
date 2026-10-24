import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import fc from 'fast-check'
import { dateText, indexOf, kindAt, todayInTaipei, HOLIDAY, SATURDAY, WORKDAY, type Calendar } from './calendar.ts'

const cal: Calendar = JSON.parse(readFileSync(new URL('../../public/calendar.json', import.meta.url), 'utf8'))

test('the table covers eight years from the first simulated day, one entry per day', () => {
  expect(cal.start).toBe('2026-01-01')
  expect(indexOf(cal, '2034-12-31')).toBe(cal.days.length - 1)
  expect(indexOf(cal, '2026-10-24') + 8 * 365).toBeLessThan(cal.days.length)
})

test('known days: the office calendar, the 中央氣象署 lunar table and its solar terms', () => {
  const at = (iso: string) => ({ ...dateText(cal, indexOf(cal, iso)), kind: kindAt(cal, indexOf(cal, iso)) })
  expect(at('2026-10-24')).toEqual({ roc: '民國115年10月24日（六）', lunar: '農曆九月十五', term: '霜降', holiday: '', observances: '臺灣聯合國日', kind: SATURDAY })
  expect(at('2026-03-12')).toMatchObject({ holiday: '', observances: '國父逝世紀念日、植樹節', kind: WORKDAY }) // 只紀念不放假
  expect(at('2026-10-25')).toMatchObject({ holiday: '臺灣光復暨金門古寧頭大捷紀念日', kind: HOLIDAY })
  expect(at('2026-10-26')).toMatchObject({ holiday: '補假', kind: HOLIDAY })
  expect(at('2026-10-27')).toMatchObject({ kind: WORKDAY })
  expect(at('2027-02-06')).toMatchObject({ lunar: '農曆正月初一', holiday: '春節' }) // ICU's Chinese calendar gives 臘月30
  expect(at('2027-02-04').term).toBe('立春')
})

test('the lunar date counts up one day at a time, and a month starts at 初一', () => fc.assert(fc.property(fc.integer({ min: 1, max: cal.days.length - 1 }), i => {
  const [, , prev] = cal.days[i - 1], [, , day] = cal.days[i]
  expect(day === prev + 1 || (day === 1 && (prev === 29 || prev === 30))).toBe(true)
})))

test('outside the table, weekends are days off', () => {
  const end = cal.days.length // 2035-01-01 is a Monday
  expect([0, 1, 2, 3, 4, 5, 6].map(k => kindAt(cal, end + k))).toEqual([WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, SATURDAY, HOLIDAY])
})

test('the date in Taiwan turns at 16:00 UTC', () => {
  expect(todayInTaipei(Date.parse('2026-10-24T15:59:59Z'))).toBe('2026-10-24')
  expect(todayInTaipei(Date.parse('2026-10-24T16:00:00Z'))).toBe('2026-10-25')
})

test('a day with a holiday name is a day off: observances that are workdays (植樹節, 母親節) must not show as holidays', () => {
  const named = cal.days.flatMap(([kind, , , , holiday], i) => (holiday && kind === WORKDAY ? [i] : []))
  expect(named).toEqual([])
  expect(cal.days.some(d => /植樹|青年|母親|父親|軍人|婦女/.test(d[4]))).toBe(false)
})
