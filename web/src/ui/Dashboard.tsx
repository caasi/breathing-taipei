import { memo } from 'react'
import { KEY } from '../sim/policy.ts'
import { useQuery, bool, fromBool, oneOf, onSteps } from '../query.ts'
import type { Scenario } from '../sim/route.ts'
import { hhmm, H2 } from './format.ts'

import { actionOf, jamOf, notesOf, type PlaceOf, type SimEvent } from '../sim/events.ts'

// The kind of an event shows by the colour of its text, not by a label; a bad event (an accident) gets its own colour when it comes.
const COLOUR = { personal: '#eee', public: '#c9a7ff', jam: '#ff8a65' } as const
// Where a character lives: two tones of one cool hue, apart from the warm names and from the data colours of the map
// (no official colour per district was found). ponytail: chosen by eye.
export const PLACE = { town: '#8ecae6', village: '#b9dcee' } as const

// `who` is the candidate whose platform has the policy; the page shows it as a tag after the name (docs/platforms/).
type Policy = { id: string; label: string; who: string } & ({ type: 'toggle' } | { type: 'range'; min: number; max: number; step: number; unit: string; start: number })
// Grouped by the HEART idea of puma.taipei, as the user set. The ids are the keys of policy.ts (KEY).
const SHEN = '沈伯洋'
const POLICIES: [string, Policy[]][] = [
  ['空間', [
    { id: KEY.bridge, label: '迎風—港墘自行車橋', who: SHEN, type: 'toggle' },
    { id: KEY.straight, label: '河濱進內科取直', who: SHEN, type: 'toggle' },
    { id: KEY.hub, label: '運動驛站', who: SHEN, type: 'toggle' },
    // Not a policy: a what-if of how many people the bridge moves to the bicycle; it needs the bridge.
    { id: KEY.bikeShift, label: '過橋改騎自行車（需開橋）', who: '假設', type: 'range', min: 0, max: 100, step: 10, unit: '%', start: 0 },
  ]],
  ['時間', [
    { id: KEY.stagger, label: '內科錯峰分流', who: SHEN, type: 'range', min: 0, max: 50, step: 10, unit: '%', start: 0 },
    { id: KEY.ebike, label: 'YouBike 2.0E 尖峰免費', who: SHEN, type: 'toggle' },
  ]],
]
// A note under an event that a policy changed: the words of the platform, the candidate and a link to the page. The
// credit of CC BY 4.0 for the words is in the info panel (App.tsx), with the other sources.
const Note = ({ note }: { note: ReturnType<typeof notesOf>[number] }) =>
  <p style={{ margin: '4px 0 0 44px', padding: '2px 8px', borderLeft: '2px solid #6a4a3d', fontSize: 12, color: '#bbb' }}>
    {note.quote}<Who who={note.who} /> <a href={note.url} target="_blank" rel="noopener noreferrer" style={{ color: '#e8c9b8' }}>{note.page}</a></p>
const Who = ({ who }: { who: string }) =>
  <span style={{ fontSize: 11, color: '#e8c9b8', border: '1px solid #6a4a3d', borderRadius: 3, padding: '0 4px', marginLeft: 6, whiteSpace: 'nowrap' }}>{who}</span>
const ALL_POLICIES = POLICIES.flatMap(([, ps]) => ps)

// The roads of the 松山機場 plan of 蔣萬安 (route.ts PROFILES). The new roads are guesses from the news (DATA.md).
const SCENARIOS: [Scenario, string][] = [['now', '現況'], ['works', '施工期（示意）'], ['future', '遷移後（示意）']]

export type PolicyValues = {
  values: Map<string, number>; set: (id: string, value: number) => void
  scenario: Scenario; setScenario: (s: Scenario) => void
}
/** Policies are the scenario, so each one is a key in the query string: a link reproduces it. */
export function usePolicies(): PolicyValues {
  // One hook per policy, always the same list in the same order, as the rules of hooks require.
  const settings = ALL_POLICIES.map(p => p.type === 'toggle'
    ? useQuery<number>(p.id, 0, s => { const b = bool(s); return b === undefined ? undefined : b ? 1 : 0 }, v => fromBool(v === 1))
    : useQuery(p.id, p.start, onSteps(p.min, p.max, p.step)))
  const [scenario, setScenario] = useQuery<Scenario>('scenario', 'now', oneOf(SCENARIOS.map(([k]) => k)))
  return {
    values: new Map(ALL_POLICIES.map((p, i) => [p.id, settings[i][0]])),
    set: (id, value) => settings[ALL_POLICIES.findIndex(p => p.id === id)][1](value),
    scenario, setScenario,
  }
}

const NOTE = { fontSize: 12, color: '#888', margin: '0 0 8px' }

export const MAX_EVENTS = 100

/** The latest events up to `now` (minutes since 00:00 of day 0), newest first, at most `limit`. */
export const recent = (events: SimEvent[], now: number, limit = MAX_EVENTS) =>
  events.filter(e => e.t <= now).sort((a, b) => b.t - a.t).slice(0, limit)

type EventsProps = { events: SimEvent[]; now: number; dayLabel: (day: number) => string; placeOf: PlaceOf }

// Memoized: the page also renders on state that the list does not use (routing progress), and the props of the list
// change only with a new minute, a new event or a new day, so while the clock stands the list does not render again.
export const Events = memo(function Events({ events, now, dayLabel, placeOf }: EventsProps) {
  const happened = recent(events, now), dayOf = (e: SimEvent) => Math.floor(e.t / 1440)
  return <>
    <h2 style={H2}>事件</h2>
    <p style={NOTE}>雙北的人們的日常。只留最新 {MAX_EVENTS} 則。</p>
    {happened.length ? <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {happened.map((e, i) => <li key={e.id} style={{ padding: '6px 0', borderTop: '1px solid #3a3333', fontSize: 14 }}>
        {(i === 0 || dayOf(happened[i - 1]) !== dayOf(e)) && <p style={{ margin: '0 0 6px', fontSize: 12, color: '#888' }}>{dayLabel(dayOf(e))}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#aaa' }}>{hhmm(e.t % 1440)}</span>
          <span style={{ color: COLOUR[e.kind] }}>{e.kind === 'public' ? e.text : <><span style={{ color: PLACE.town }}>{placeOf(e.home).town}</span><span style={{ color: PLACE.village }}>{placeOf(e.home).village}</span>的<span style={{ color: '#ffd9a0' }}>{e.name}</span>{e.kind === 'jam' ? jamOf(e, placeOf) : actionOf(e, placeOf)}</>}</span></div>
        {notesOf(e).map(n => <Note key={n.quote} note={n} />)}</li>)}
    </ol> : <p style={{ fontSize: 14, color: '#aaa' }}>還沒有事件。</p>}
  </>
})

export function Policies({ values, set, scenario, setScenario }: PolicyValues) {
  return <>
    <h2 style={H2}>政策</h2>
    <p style={NOTE}>調整後從每個人的下一趟通勤開始生效。標籤是提出政策的候選人；數字多半是推估，見 DATA.md。</p>
    <fieldset style={{ border: 0, borderTop: '1px solid #3a3333', margin: 0, padding: '6px 0' }}>
      <legend style={{ fontSize: 13, color: '#db6a41', padding: 0 }}>松山機場遷移<Who who="蔣萬安" /></legend>
      {SCENARIOS.map(([k, label]) => <label key={k} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>
        <input type="radio" name="scenario" checked={scenario === k} onChange={() => setScenario(k)} />{label}</label>)}
      <p style={{ ...NOTE, margin: '4px 0 0' }}>切換後模擬從午夜重新開始。新道路的位置是依新聞推估的示意。</p>
    </fieldset>
    {POLICIES.map(([group, ps]) => <fieldset key={group} style={{ border: 0, borderTop: '1px solid #3a3333', margin: 0, padding: '6px 0' }}>
      <legend style={{ fontSize: 13, color: '#db6a41', padding: 0 }}>{group}</legend>
      {ps.map(p => p.type === 'toggle'
        ? <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>
          <input type="checkbox" checked={values.get(p.id) === 1} onChange={e => set(p.id, e.target.checked ? 1 : 0)} />{p.label}<Who who={p.who} /></label>
        : <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>{p.label}<Who who={p.who} />
          <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{values.get(p.id)}{p.unit}</span>
          <input type="range" min={p.min} max={p.max} step={p.step} value={values.get(p.id)} onChange={e => set(p.id, Number(e.target.value))}
            style={{ display: 'block', width: '100%', accentColor: '#db6a41' }} /></label>)}
    </fieldset>)}
  </>
}
