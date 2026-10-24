import { useQuery, bool, fromBool, onSteps } from '../query.ts'
import { hhmm, H2 } from './format.ts'

import { actionOf, type PlaceOf, type SimEvent } from '../sim/events.ts'

// ponytail: placeholder policies for the layout only; nothing here reaches the simulation yet.
// The kind of an event shows by the colour of its text, not by a label; a bad event (an accident) gets its own colour when it comes.
const COLOUR = { personal: '#eee', public: '#c9a7ff' } as const

type Policy = { id: string; label: string } & ({ type: 'toggle' } | { type: 'range'; min: number; max: number; step: number; unit: string; start: number })
// Grouped by the HEART idea of puma.taipei, as the user set.
const POLICIES: [string, Policy[]][] = [
  ['空間', [{ id: 'bus-lane', label: '公車專用道延伸', type: 'toggle' }, { id: 'sidewalk', label: '人行道拓寬', type: 'toggle' }]],
  ['機會', [{ id: 'flex', label: '彈性上班比例', type: 'range', min: 0, max: 50, step: 5, unit: '%', start: 10 }]],
  ['陪伴', [{ id: 'meals', label: '社區共餐據點', type: 'toggle' }]],
  ['韌性', [{ id: 'headway', label: '捷運尖峰班距', type: 'range', min: 2, max: 8, step: 0.5, unit: ' 分', start: 4 }, { id: 'rain-off', label: '大雨時停班停課', type: 'toggle' }]],
  ['時間', [{ id: 'stagger', label: '錯峰上班（提早）', type: 'range', min: 0, max: 60, step: 15, unit: ' 分', start: 0 }]],
]
const ALL_POLICIES = POLICIES.flatMap(([, ps]) => ps)

export type PolicyValues = { values: Map<string, number>; set: (id: string, value: number) => void }
/** Policies are the scenario, so each one is a key in the query string: a link reproduces it. */
export function usePolicies(): PolicyValues {
  // One hook per policy, always the same list in the same order, as the rules of hooks require.
  const settings = ALL_POLICIES.map(p => p.type === 'toggle'
    ? useQuery<number>(p.id, 0, s => { const b = bool(s); return b === undefined ? undefined : b ? 1 : 0 }, v => fromBool(v === 1))
    : useQuery(p.id, p.start, onSteps(p.min, p.max, p.step)))
  return {
    values: new Map(ALL_POLICIES.map((p, i) => [p.id, settings[i][0]])),
    set: (id, value) => settings[ALL_POLICIES.findIndex(p => p.id === id)][1](value),
  }
}

const NOTE = { fontSize: 12, color: '#888', margin: '0 0 8px' }

export const MAX_EVENTS = 100

/** The latest events up to `now` (minutes since 00:00 of day 0), newest first, at most `limit`. */
export const recent = (events: SimEvent[], now: number, limit = MAX_EVENTS) =>
  events.filter(e => e.t <= now).sort((a, b) => b.t - a.t).slice(0, limit)

export function Events({ events, now, dayLabel, placeOf }: { events: SimEvent[]; now: number; dayLabel: (day: number) => string; placeOf: PlaceOf }) {
  const happened = recent(events, now), dayOf = (e: SimEvent) => Math.floor(e.t / 1440)
  return <>
    <h2 style={H2}>事件</h2>
    <p style={NOTE}>雙北的人們的日常。只留最新 {MAX_EVENTS} 則。</p>
    {happened.length ? <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {happened.map((e, i) => <li key={`${e.t} ${i} ${e.kind === 'public' ? e.text : e.name}`} style={{ padding: '6px 0', borderTop: '1px solid #3a3333', fontSize: 14 }}>
        {(i === 0 || dayOf(happened[i - 1]) !== dayOf(e)) && <p style={{ margin: '0 0 6px', fontSize: 12, color: '#888' }}>{dayLabel(dayOf(e))}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#aaa' }}>{hhmm(e.t % 1440)}</span>
          <span style={{ color: COLOUR[e.kind] }}>{e.kind === 'public' ? e.text : <><span style={{ color: '#aaa' }}>{placeOf(e.home).town}{placeOf(e.home).village}</span>的<span style={{ color: '#ffd9a0' }}>{e.name}</span>{actionOf(e, placeOf)}</>}</span></div></li>)}
    </ol> : <p style={{ fontSize: 14, color: '#aaa' }}>還沒有事件。</p>}
  </>
}

export function Policies({ values, set }: PolicyValues) {
  return <>
    <h2 style={H2}>政策</h2>
    <p style={NOTE}>示意資料，調整後不會改變模擬。</p>
    {POLICIES.map(([group, ps]) => <fieldset key={group} style={{ border: 0, borderTop: '1px solid #3a3333', margin: 0, padding: '6px 0' }}>
      <legend style={{ fontSize: 13, color: '#db6a41', padding: 0 }}>{group}</legend>
      {ps.map(p => p.type === 'toggle'
        ? <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>
          <input type="checkbox" checked={values.get(p.id) === 1} onChange={e => set(p.id, e.target.checked ? 1 : 0)} />{p.label}</label>
        : <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>{p.label}
          <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{values.get(p.id)}{p.unit}</span>
          <input type="range" min={p.min} max={p.max} step={p.step} value={values.get(p.id)} onChange={e => set(p.id, Number(e.target.value))}
            style={{ display: 'block', width: '100%', accentColor: '#db6a41' }} /></label>)}
    </fieldset>)}
  </>
}
