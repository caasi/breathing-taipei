import { useState } from 'react'

// ponytail: placeholder events and policies for the layout only; nothing here reaches the simulation. Replace with the event model.
// A wide event touches an area; a personal one follows one resident. A resident is 先生 or 小姐, or, for a person outside the binary,
// a nickname with no title. ponytail: the share of nicknames is not set yet; here it is 2 of 7 by hand.
type Event = { at: number; kind: string; text: string; who?: { town: string; village: string; name: string } }
const EVENTS: Event[] = [
  { at: 6 * 60 + 50, kind: '交通', text: '板南線忠孝復興站號誌異常，班距拉長到 8 分鐘' },
  { at: 7 * 60 + 5, kind: '個人', who: { town: '大安區', village: '學府里', name: '林先生' }, text: '搭捷運上班，在忠孝復興站遇到延誤，晚 12 分鐘到公司' },
  { at: 7 * 60 + 20, kind: '天氣', text: '大雨特報：信義、大安時雨量 40 mm' },
  { at: 7 * 60 + 45, kind: '個人', who: { town: '板橋區', village: '溪洲里', name: '陳小姐' }, text: '因為大雨，不騎機車，改搭公車' },
  { at: 8 * 60 + 5, kind: '交通', text: '國道一號五股北上事故，回堵 3 公里' },
  { at: 8 * 60 + 30, kind: '個人', who: { town: '三重區', village: '五谷里', name: '阿凱' }, text: '錯過公車，走路到捷運站' },
  { at: 9 * 60 + 30, kind: '活動', text: '南港展覽館開展，預估 2 萬人入場' },
  { at: 11 * 60 + 20, kind: '個人', who: { town: '中山區', village: '朱崙里', name: '黃小姐' }, text: '午休時到隔壁里買午餐' },
  { at: 12 * 60, kind: '公共', text: '中正區 3 個里停水' },
  { at: 17 * 60 + 40, kind: '交通', text: '台北車站月台擁擠，捷運管制進站' },
  { at: 18 * 60 + 10, kind: '個人', who: { town: '內湖區', village: '週美里', name: '張先生' }, text: '加班，晚 2 小時回家' },
  { at: 19 * 60, kind: '活動', text: '小巨蛋演唱會散場，約 1 萬人' },
  { at: 20 * 60 + 15, kind: '個人', who: { town: '萬華區', village: '華中里', name: '小雨' }, text: '下班後去逛夜市' },
  { at: 21 * 60 + 30, kind: '個人', who: { town: '新莊區', village: '光華里', name: '王小姐' }, text: '看完演唱會，搭捷運回家' },
  { at: 22 * 60 + 30, kind: '公共', text: '萬華夜市延長營業到 01:00' },
]
const KIND_COLOURS: Record<string, string> = { 交通: '#9ad0ff', 天氣: '#7ec8a5', 活動: '#ffd166', 公共: '#c9a7ff', 個人: '#f5f0e8' }

type Policy = { label: string } & ({ type: 'toggle' } | { type: 'range'; min: number; max: number; step: number; unit: string; start: number })
// Grouped by the HEART idea of puma.taipei, as the user set.
const POLICIES: [string, Policy[]][] = [
  ['空間', [{ label: '公車專用道延伸', type: 'toggle' }, { label: '人行道拓寬', type: 'toggle' }]],
  ['機會', [{ label: '彈性上班比例', type: 'range', min: 0, max: 50, step: 5, unit: '%', start: 10 }]],
  ['陪伴', [{ label: '社區共餐據點', type: 'toggle' }]],
  ['韌性', [{ label: '捷運尖峰班距', type: 'range', min: 2, max: 8, step: 0.5, unit: ' 分', start: 4 }, { label: '大雨時停班停課', type: 'toggle' }]],
  ['時間', [{ label: '錯峰上班（提早）', type: 'range', min: 0, max: 60, step: 15, unit: ' 分', start: 0 }]],
]

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const H2 = { fontSize: 14, color: '#aaa', margin: '12px 0 4px' }
const NOTE = { fontSize: 12, color: '#888', margin: '0 0 8px' }

export const MAX_EVENTS = 100

/** The latest events up to `now` (minutes since 00:00 of day 0), newest first; the placeholder day repeats every day. */
export const recent = (now: number, limit = MAX_EVENTS) => {
  const out: { day: number; e: Event }[] = []
  for (let day = Math.floor(now / 1440); day >= 0 && out.length < limit; day--)
    for (let i = EVENTS.length - 1; i >= 0 && out.length < limit; i--)
      if (day * 1440 + EVENTS[i].at <= now) out.push({ day, e: EVENTS[i] })
  return out
}

export function Events({ now }: { now: number }) {
  const happened = recent(now)
  return <>
    <h2 style={H2}>事件</h2>
    <p style={NOTE}>示意資料，還沒有接上模擬。只留最新 {MAX_EVENTS} 則。</p>
    {happened.length ? <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {happened.map(({ day, e }, i) => <li key={day * 1440 + e.at} style={{ padding: '6px 0', borderTop: '1px solid #3a3333', fontSize: 14 }}>
        {(i === 0 || happened[i - 1].day !== day) && <p style={{ margin: '0 0 6px', fontSize: 12, color: '#888' }}>第 {day} 天</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#aaa' }}>{hhmm(e.at)}</span>
          <span style={{ color: KIND_COLOURS[e.kind], whiteSpace: 'nowrap' }}>{e.kind}</span>
          <span>{e.who && <><span style={{ color: '#aaa' }}>{e.who.town}{e.who.village}</span>的{e.who.name}</>}{e.text}</span></div></li>)}
    </ol> : <p style={{ fontSize: 14, color: '#aaa' }}>還沒有事件。</p>}
  </>
}

export function Policies() {
  const [values, setValues] = useState(() => new Map(POLICIES.flatMap(([, ps]) => ps.map(p => [p.label, p.type === 'range' ? p.start : 0]))))
  const set = (label: string, v: number) => setValues(m => new Map(m).set(label, v))
  return <>
    <h2 style={H2}>政策</h2>
    <p style={NOTE}>示意資料，調整後不會改變模擬。</p>
    {POLICIES.map(([group, ps]) => <fieldset key={group} style={{ border: 0, borderTop: '1px solid #3a3333', margin: 0, padding: '6px 0' }}>
      <legend style={{ fontSize: 13, color: '#db6a41', padding: 0 }}>{group}</legend>
      {ps.map(p => p.type === 'toggle'
        ? <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>
          <input type="checkbox" checked={values.get(p.label) === 1} onChange={e => set(p.label, e.target.checked ? 1 : 0)} />{p.label}</label>
        : <label key={p.label} style={{ display: 'block', fontSize: 14, margin: '4px 0' }}>{p.label}
          <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{values.get(p.label)}{p.unit}</span>
          <input type="range" min={p.min} max={p.max} step={p.step} value={values.get(p.label)} onChange={e => set(p.label, Number(e.target.value))}
            style={{ display: 'block', width: '100%', accentColor: '#db6a41' }} /></label>)}
    </fieldset>)}
  </>
}
