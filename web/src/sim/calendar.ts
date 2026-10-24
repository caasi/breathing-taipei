/**
 * calendar.json from scripts/calendar.py: one entry per day from `start`, [kind of day, lunar month (below 0: leap), lunar day,
 * solar term that starts that day, holiday (a day off), observances (commemorative days and festivals that are not days off)].
 */
export type Calendar = { start: string; kinds: string[]; days: [number, number, number, string, string, string][] }

export const WORKDAY = 0, SATURDAY = 1, HOLIDAY = 2

const DAY_MS = 864e5
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Today in Taiwan (UTC+8, no daylight saving time), as YYYY-MM-DD. */
export const todayInTaipei = (ms = Date.now()) => isoOf(ms + 8 * 3600e3)

/** Index into cal.days of a date; out of range when the date is outside the table. */
export const indexOf = (cal: Calendar, iso: string) => Math.round((utc(iso) - utc(cal.start)) / DAY_MS)

/**
 * The kind of day at an index. Outside the table, a Saturday or a Sunday is a day off and every other day is a
 * workday (ponytail: no holidays there; the table covers 2026 to 2034, which DATA.md explains).
 */
export const kindAt = (cal: Calendar, i: number) => {
  const d = cal.days[i]
  if (d) return d[0]
  const weekday = new Date(utc(cal.start) + i * DAY_MS).getUTCDay()
  return weekday === 6 ? SATURDAY : weekday === 0 ? HOLIDAY : WORKDAY
}

const WEEKDAYS = '日一二三四五六'
const DIGITS = '〇一二三四五六七八九十'
const lunarMonth = (m: number) => `${m < 0 ? '閏' : ''}${['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][Math.abs(m) - 1]}月`
const lunarDay = (d: number) =>
  d <= 10 ? `初${DIGITS[d]}` : d < 20 ? `十${DIGITS[d - 10]}` : d === 20 ? '二十' : d < 30 ? `廿${DIGITS[d - 20]}` : '三十'

/** The solar term in effect at an index: the last one that started on or before that day. */
const termAt = (cal: Calendar, i: number) => {
  for (let k = Math.min(i, cal.days.length - 1); k >= 0; k--) if (cal.days[k][3]) return cal.days[k][3]
  return ''
}

/** The date line of the clock: 民國, the Gregorian date and weekday; then the lunar date, the solar term and the holiday. */
export const dateText = (cal: Calendar, i: number) => {
  const date = new Date(utc(cal.start) + i * DAY_MS)
  const roc = `民國${date.getUTCFullYear() - 1911}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${WEEKDAYS[date.getUTCDay()]}）`
  const d = cal.days[i]
  return { roc, lunar: d ? `農曆${lunarMonth(d[1])}${lunarDay(d[2])}` : '', term: d ? termAt(cal, i) : '', holiday: d?.[4] ?? '', observances: d?.[5] ?? '' }
}
