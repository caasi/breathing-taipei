import { GONE, PLAY, STAY } from './core.ts'
import { isoAt, kindAt, type Calendar } from './calendar.ts'

/**
 * One event: t in minutes since 00:00 of day 0. A personal event follows one agent (a character: 10 people at the
 * app's scale), from its plan; a public event comes from the calendar. id is unique in a run and is used only as
 * the key of a list row.
 */
export type SimEvent =
  // back: the way home of the same plan, at the minute the character leaves work or the day-off place.
  | { id: string; t: number; kind: 'personal'; name: string; home: number; to: number; dest: number; mode: number; group: string; back?: boolean }
  | { id: string; t: number; kind: 'public'; text: string }

/** What a place is called: the district, and the village at village level. */
export type PlaceOf = (node: number) => { town: string; village: string }

// How a character travels, in the order of MODES in city.ts.
const BY = ['搭捷運', '搭公車', '騎機車', '開車', '走路', '騎自行車']
// What the night-time groups and short trips go out for (the kind names of city.ts).
const PURPOSE: Record<string, string> = {
  short: '出門辦事', early: '去早餐店上早班', evening: '去餐廳上晚班', overnight: '去上大夜班', nightlife: '去夜店上班',
  dinner: '出門吃晚餐', 'night-out': '出門找朋友玩',
}

/** The sentence after the name: where the character goes, and how. */
export const actionOf = (e: Extract<SimEvent, { kind: 'personal' }>, placeOf: PlaceOf) => {
  const by = BY[e.mode], there = placeOf(e.to), here = placeOf(e.home)
  const place = there.town === here.town ? (there.village || there.town) : there.town
  if (e.back) return e.dest === PLAY ? `${by}從${place}回家` : e.group ? `${by}回家` : `${by}下班回家`
  if (e.dest === STAY) return '今天在家休息'
  if (e.dest === GONE) return '今天出遠門，離開雙北'
  if (e.dest === PLAY) return `${by}去${place}走走`
  if (e.group) return `${by}${PURPOSE[e.group] ?? '出門'}`
  return `${by}到${place}上班`
}

// The 2026 local election (中選會, 115年11月28日) and the day the new mayors take office (12月25日 in 2018 and 2022;
// ponytail: 2026 is a guess from those two elections). DATA.md, "Figures in the code", gives the sources.
const CIVIC: Record<string, string> = {
  '2026-11-28': '今天是選舉日，大家記得出門投票（08:00 到 16:00）',
  '2026-12-25': '今天新的市長上任了',
}

// A greeting of the city at fixed times, for the feel of the day. Most times follow the model: breakfast shops leave
// at 04:00 to 05:00 (SHIFTS), the first buses at 05:00 and trains at 06:00, the workday peak at 08:00 (od2.json),
// dinner at 18:00 to 19:00, nights out at 21:00 to 22:00 and overnight shifts at 22:00 (VISITS, SHIFTS), the last
// trains at 00:00 (shown at 23:59, so they stay with their own day). ponytail: the wording, and 03:00 and 12:00, are by eye.
const WORKDAY_GREETINGS: [number, string][] = [
  [3, '早餐店的人陸續起床，準備備料'], [5, '公車首班車陸續發車'], [6, '捷運首班車發車，城市醒來了'],
  [7.5, '上班時間快到了，路上的人越來越多'], [8, '通勤尖峰，捷運月台上滿是人'], [12, '午休時間，附近的餐廳忙了起來'],
  [17.5, '下班時間到了'], [18, '晚餐時間，夜市和餐廳開始熱鬧'], [21, '夜生活開始了'], [22, '大夜班的人準備交接'], [23 + 59 / 60, '捷運收班，城市慢慢安靜下來'],
]
const DAY_OFF_GREETINGS: [number, string][] = [
  [3, '早餐店的人陸續起床，準備備料'], [6, '捷運首班車發車，假日的早晨比平日安靜'], [10, '出門走走的人多了起來'],
  [12, '午餐時間，熱門的店開始排隊'], [15, '午後，公園和商圈人來人往'], [18, '晚餐時間，夜市和餐廳開始熱鬧'],
  [21, '夜生活開始了'], [22, '大夜班的人準備交接'], [23 + 59 / 60, '捷運收班，城市慢慢安靜下來'],
]

/** The public events of one simulated day: holidays, commemorations, solar terms, civic days, and greetings. */
export const publicEvents = (cal: Calendar, startDay: number, day: number): SimEvent[] => {
  const i = startDay + day, d = cal.days[i], t = day * 24 * 60, iso = isoAt(cal, i)
  const out: { t: number; text: string }[] = []
  // Past the end of the table there are no holidays or terms, but the city still greets its days.
  if (d && d[4] && d[4] !== '補假') out.push({ t, text: `今天是${d[4]}，放假一天` })
  if (d && d[4] === '補假') out.push({ t, text: '今天補假，放假一天' })
  for (const name of d?.[5] ? d[5].split('、') : []) out.push({ t, text: `今天是${name}` })
  if (d?.[3]) out.push({ t, text: `今天${d[3]}` })
  if (CIVIC[iso]) out.push({ t, text: CIVIC[iso] })
  for (const [hour, text] of kindAt(cal, i) ? DAY_OFF_GREETINGS : WORKDAY_GREETINGS) out.push({ t: t + Math.round(hour * 60), text })
  // The same day gives the same ids, so a list that is built again keeps its rows.
  return out.map((e, k): SimEvent => ({ ...e, kind: 'public', id: `d${day}-${k}` }))
}

/**
 * The personal events and the public events of enough days back that the newest `limit` up to now are all there:
 * days are added from today back until the events from that day on reach `limit`, or day 0.
 */
export const withPublic = (personal: SimEvent[], cal: Calendar, startDay: number, now: number, limit: number) => {
  const today = Math.floor(now / 1440)
  const out = [...personal]
  for (let day = today; day >= 0; day--) {
    out.push(...publicEvents(cal, startDay, day))
    // Count only what the list can show: the greetings later today and the plans made ahead are after now.
    if (out.filter(e => e.t >= day * 1440 && e.t <= now).length >= limit) break
  }
  return out
}

/** The time of the first event after `now`, or Infinity: until the clock passes it, the shown list stays the same. */
export const nextAfter = (events: SimEvent[], now: number) => events.reduce((t, e) => (e.t > now && e.t < t ? e.t : t), Infinity)

/**
 * Picks the plans that the stream shows: about rates[kind] of the plans of each kind, but by error diffusion instead of
 * one draw for each plan, so a viewer sees fewer groups and long gaps (#10).
 */
export const evenPick = (rates: number[], rand: () => number) => {
  const sums = rates.map(() => rand())
  return (kind: number) => {
    sums[kind] += rates[kind]
    if (sums[kind] < 1) return false
    sums[kind] -= 1
    return true
  }
}
