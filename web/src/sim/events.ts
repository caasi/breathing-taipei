import { GONE, PLAY, STAY } from './core.ts'
import type { Calendar } from './calendar.ts'

/**
 * One event: t in minutes since 00:00 of day 0. A personal event follows one agent (a character: 10 people at the
 * app's scale), from its plan; a public event comes from the calendar.
 */
export type SimEvent =
  | { t: number; kind: 'personal'; name: string; home: number; to: number; dest: number; mode: number; group: string }
  | { t: number; kind: 'public'; text: string }

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
  if (e.dest === STAY) return '今天在家休息'
  if (e.dest === GONE) return '今天出遠門，離開雙北'
  if (e.dest === PLAY) return `${by}去${place}走走`
  if (e.group) return `${by}${PURPOSE[e.group] ?? '出門'}`
  return `${by}到${place}上班`
}

// The 2026 local election (中選會, 115年11月28日) and the day the new mayors take office (12月25日 in 2018 and 2022;
// ponytail: 2026 is a guess from those two elections). DATA.md gives the sources.
const CIVIC: Record<string, string> = {
  '2026-11-28': '今天是選舉日，大家記得出門投票（08:00 到 16:00）',
  '2026-12-25': '今天新的市長上任了',
}

/** The public events of one simulated day: holidays, commemorations, solar terms, and civic days. */
export const publicEvents = (cal: Calendar, startDay: number, day: number): SimEvent[] => {
  const i = startDay + day, d = cal.days[i], t = day * 24 * 60
  if (!d) return []
  const iso = new Date(Date.parse(`${cal.start}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10)
  const out: SimEvent[] = []
  if (d[4] && d[4] !== '補假') out.push({ t, kind: 'public', text: `今天是${d[4]}，放假一天` })
  if (d[4] === '補假') out.push({ t, kind: 'public', text: '今天補假，放假一天' })
  for (const name of d[5] ? d[5].split('、') : []) out.push({ t, kind: 'public', text: `今天是${name}` })
  if (d[3]) out.push({ t, kind: 'public', text: `今天${d[3]}` })
  if (CIVIC[iso]) out.push({ t, kind: 'public', text: CIVIC[iso] })
  return out
}
