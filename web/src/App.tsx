import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HeatMap, Land, Outline, SEA, projectionFor, taipeiIn, type Transit } from './ui/HeatMap.tsx'
import { Travellers, MODE_COLOURS, addBatches, type Track } from './ui/Travellers.tsx'
import type { GraphJson } from './sim/route.ts'
import { MODES } from './sim/city.ts'
import type { FromWorker, WorkerError, ToWorker, Level, Trips } from './sim/worker.ts'
import { getJson } from './load.ts'
import type { Batch } from './sim/paths.ts'
import { useStored, oneOf, setOf, bool, fromBool } from './query.ts'
import { record, since, KEEP, type Entry } from './history.ts'
import { layoutFor, PANEL } from './ui/view.ts'
import { dateText, indexOf, todayInTaipei, type Calendar } from './sim/calendar.ts'
import { Events, Policies, usePolicies, MAX_EVENTS } from './ui/Dashboard.tsx'
import { withPublic, type SimEvent } from './sim/events.ts'
import { clockAt, respeed, READY_MS, type Clock } from './sim/pace.ts'
import { hhmm, H2 } from './ui/format.ts'

const SPEEDS = [0, 1, 2, 4, 8]
const EVERY = [2, 5, 10, 20, 50]
const LAYERS: [string, string][] = [['traffic', '路況'], ['mrt', '捷運'], ['lrt', '輕軌'], ['tra', '台鐵'], ['hsr', '高鐵'], ['airport', '機場'], ['highway', '國道與快速道路']]
const PER_AGENT = 10
// Plans are made ahead of their departure, so the newest events are not all shown yet: keep more than the list shows.
const KEEP_EVENTS = 3 * MAX_EVENTS
// On a phone the clock sits right of the title, and a long holiday name wraps instead of running under it.
const TITLE_ROOM = 116
// The English subtitle at this share of the title size is a little narrower than 台北鼓動; the user chose it by eye.
const SUBTITLE_SCALE = 0.46
const WINDOWS = [15, 30, 60, KEEP] // simulated minutes the change rate can look back; history keeps the longest
// A node is a village code (台北市 is county 63000) or a district name.
const inTaipei = (node: string) => node.startsWith('63000') || node.startsWith('台北市')
const ALERT = { position: 'absolute', top: 72, left: 16, margin: 0, color: '#ff8b6b' } as const
const SIDE_PANEL = { position: 'absolute', top: 16, bottom: 16, overflowY: 'auto', padding: '0 12px', boxSizing: 'border-box', background: 'rgba(33, 29, 29, 0.85)', borderRadius: 4 } as const
// Turns in a CSS animation of an HTML box (index.html), which the browser can run while the main thread builds a run.
const SpinnerIcon = () => <span className="spin" style={{ display: 'inline-block', width: 24, height: 24 }}>
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" style={{ display: 'block' }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${Math.PI * 9 * 1.5} ${Math.PI * 9 * 0.5}`} /></svg></span>
const HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as const
const ICON_BUTTON = { width: 40, height: 40, marginRight: 8, padding: 8, border: 0, borderRadius: 20, color: '#fff', cursor: 'pointer' }
const InfoIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
  <path d="M12 11v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.5" fill="currentColor" /></svg>
const SlidersIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  {/* The line stops at each knob, and the knob has no fill, so the background of the button (orange when open) shows. */}
  {[[6, 15], [12, 7], [18, 12]].map(([y, x]) => <g key={y}><path d={`M3 ${y}H${x - 3.5}M${x + 3.5} ${y}H21`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx={x} cy={y} r="2.5" fill="none" stroke="currentColor" strokeWidth="2" /></g>)}</svg>
// The teeth are the dashes of one thick stroke: 8 dashes on a circle of length 2πr.
const GitHubIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z" /></svg>
const GearIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={`${Math.PI * 9 / 8} ${Math.PI * 9 / 8}`} />
  <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
// Figures that change every frame keep their width: zero-padded to a fixed number of digits, in tabular figures.
const padded = (n: number, digits: number, decimals = 0) => {
  const [whole, part] = Math.max(0, n).toFixed(decimals).split('.')
  return whole.padStart(digits, '0').replace(/\B(?=(\d{3})+$)/g, ',') + (part ? '.' + part : '')
}

export function App() {
  const [towns, setTowns] = useState<any>()
  const [villages, setVillages] = useState<any>()
  const [transit, setTransit] = useState<Transit>()
  const [roads, setRoads] = useState<GraphJson>()
  const [traffic, setTraffic] = useState<Uint8Array>()
  const [cal, setCal] = useState<Calendar>()
  // Day 0 of the run is the day the page opens, in Taiwan.
  const startDay = useMemo(() => cal && indexOf(cal, todayInTaipei()), [cal])
  // A switch of level starts a new model, on the day that the clock shows, so the date goes on.
  const [dayOffset, setDayOffset] = useState(0)
  const runStart = startDay === undefined ? undefined : startDay + dayOffset
  // The run whose frames are on the screen. After a switch of level the old picture stays (frozen) until the first
  // frame of the new run comes, so the map does not go black while the new run loads.
  const [onScreen, setOnScreen] = useState<{ level: Level; runStart: number }>()
  const [pop, setPop] = useState<Map<string, number>>()
  // The run that loads; the frozen dots (the dots of one run, at one minute).
  const next = useRef<{ level: Level; runStart: number }>(), frozen = useRef<{ run: number; minute: number }>()
  const [nodes, setNodes] = useState<string[]>([])
  // The dot trips by id, each with the tracks of its dots. Replans and routes write into them in place, so they are a
  // ref; a new id asks for a render. Render reads the entry of the committed id, so it never pairs trips with the
  // tracks of other trips, also when a click renders before the update of a new id.
  // run: the start of the run that made the trips.
  const dotRuns = useRef(new Map<number, { trips: Trips; tracks: { current: (Track | undefined)[] }; run: number }>()), lastDots = useRef(0)
  const [tripsId, setTripsId] = useState(0)
  const [s, setS] = useState<FromWorker>()
  // Display settings belong to this viewer, so they stay in this browser; the policies (usePolicies) are in the URL.
  const policies = usePolicies()
  // A pause is not restored: a viewer who comes back to a stopped page at 00:00 sees nothing move.
  const [speed, setSpeed] = useStored('speed', 1, s => (s === '0' ? undefined : oneOf(SPEEDS)(s)))
  const [level, setLevel] = useStored<Level>('level', 'village', oneOf(['district', 'village'] as const))
  const [dot, setDot] = useStored('dot', 50, oneOf(EVERY.map(e => e * PER_AGENT)))
  const every = dot / PER_AGENT
  const [rateWindow, setRateWindow] = useStored('window', 30, oneOf(WINDOWS))
  const [routed, setRouted] = useState(0)
  const unplaced = useRef<Batch[]>([])
  const [dots, setDots] = useStored('dots', true, bool, fromBool)
  const [byMode, setByMode] = useStored('mode', false, bool, fromBool)
  const [colourBy, setColourBy] = useStored<'density' | 'rate'>('color', 'rate', oneOf(['density', 'rate'] as const))
  const [history, setHistory] = useState<Entry[]>([])
  const [personal, setPersonal] = useState<SimEvent[]>([]) // the personal events from the worker; the newest KEEP_EVENTS stay
  const [homes, setHomes] = useState(new Uint32Array(0))
  const [fps, setFps] = useState(0)
  // A file the page loads once stays failed until reload; a run error belongs to the current run.
  const [loadError, setLoadError] = useState<string>()
  const [open, setOpen] = useState<'info' | 'settings' | 'policies'>()
  const [runError, setRunError] = useState<string>()
  // Highways are for orientation only and compete with the area colours, so they start hidden.
  const [show, setShow] = useStored('layers', new Set(LAYERS.map(l => l[0]).filter(k => k !== 'highway')),
    setOf(LAYERS.map(l => l[0])), v => [...v].join(','))
  const worker = useRef<Worker>()
  const started = useRef(0), shown = useRef(0) // the latest start posted, and the start of the frames on the page
  // The start of a new run whose clock stands until the page is ready: state for the icon, a ref for the logic, so a
  // click between a start and its render does not read an old value. deadline: when the run starts anyway.
  const [waiting, setWaiting] = useState<number>()
  const waitRef = useRef<number>(), deadline = useRef(0), speedRef = useRef(speed)
  // The clock of the dots (pace.ts), the model minute of the last message, and the change of speed that the clock uses.
  const last = useRef<Clock & { model: number; since: number }>({ minute: 0, at: 0, perMs: 0, model: 0, since: 0 })
  const toggle = (k: string) => setShow(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const post = (m: ToWorker) => worker.current?.postMessage(m)

  useEffect(() => {
    getJson('towns.json').then(setTowns).catch(err => setLoadError(String(err)))
    getJson('calendar.json').then(setCal).catch(err => setLoadError(String(err)))
    getJson('villages2-topo.json').then(setVillages).catch(err => setLoadError(String(err)))
    getJson('transit.json').then(setTransit).catch(err => setLoadError(String(err)))
    // The worker loads the same file, so it is usually in the cache. Without it, only the traffic is missing.
    getJson('road-graph.json').then(setRoads).catch(() => {})
    // Residents by town for the labels of the outline; the worker loads the same file, so it is usually in the cache.
    getJson('villages2.json').then((vs: { town: string; pop: number }[]) => {
      const m = new Map<string, number>()
      for (const v of vs) m.set(v.town, (m.get(v.town) ?? 0) + v.pop)
      setPop(m)
    }).catch(() => {}) // only the outline labels miss it
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<FromWorker | WorkerError>) => {
      if ('error' in e.data) { if (e.data.start === started.current) setRunError(e.data.error); return }
      const m = e.data
      // Frames of an earlier run can still be on their way after a start (also the first frame of a run that a quick
      // second switch replaced); their day and nodes would be read with the new start and level.
      if (m.start !== undefined) { if (m.start !== started.current) return; shown.current = m.start; setOnScreen(next.current) }
      else if (shown.current !== started.current) return
      if (m.nodes) setNodes(m.nodes)
      // The first frame of a run (it has coords) starts the history and the events again. The updaters keep only
      // these values, not the message.
      const fresh = m.coords !== undefined, events = m.events, entry = { t: m.day * 1440 + m.minute, counts: m.counts }
      if (m.homes) setHomes(m.homes)
      if (fresh || m.traffic) setTraffic(m.traffic)
      if (m.trips) { dotRuns.current.set(++lastDots.current, { trips: m.trips, tracks: { current: [] }, run: shown.current }); setTripsId(lastDots.current); unplaced.current = [] }
      if (fresh || events?.length) setPersonal(p => [...(fresh ? [] : p), ...(events ?? [])].slice(-KEEP_EVENTS))
      setHistory(h => record(fresh ? [] : h, entry, KEEP))
      // The dots read the arrays every frame, so new plans are written into them in place.
      // New plans and routes are for the newest trips, also before a render shows them.
      const dots = dotRuns.current.get(lastDots.current), t = dots?.trips, r = m.replans
      if (t && r) r.k.forEach((k, j) => { t.dest[k] = r.dest[j]; t.dep[k] = r.dep[j]; t.dur1[k] = r.dur1[j]; t.ret[k] = r.ret[j]; t.dur2[k] = r.dur2[j] })
      // The worker sends each batch once; keep the ones that arrive before the map projection exists.
      if (dots && m.paths?.length) proj.current ? addBatches(dots.tracks.current, m.paths, proj.current) : unplaced.current.push(...m.paths)
      if (m.routed !== undefined) setRouted(m.routed)
      // A clock from before the latest change of speed would take the clock of the page back.
      const l = last.current, model = m.day * 1440 + m.minute
      if (m.since === l.since) { l.minute = m.clock; l.at = m.at - performance.timeOrigin }
      l.model = model
      setS(m)
    }
    // A throw in the worker's frame loop (routing, counting) reaches the page through onerror.
    w.onerror = e => setRunError(e.message || 'worker error')
    worker.current = w
    return () => w.terminate()
  }, [])
  // Declared before the start, so the first start draws with the stored density.
  useEffect(() => post({ type: 'sample', every }), [every])
  useEffect(() => {
    if (runStart === undefined) return
    // The new world starts at minute 0, and both clocks stand there until the page has drawn the first frame. The page
    // is busy while it builds the new run; a clock that ran then would jump when the page draws again.
    const l = last.current, now = performance.now(), since = performance.timeOrigin + now
    // The dots of the old run stay where they are; a second switch before the new run shows keeps the same picture.
    // The dots on the screen freeze at the time of the frame on the screen, so they agree with the map and the clock. A
    // second switch before the new run shows keeps the same freeze.
    const on = dotRuns.current.get(tripsId)
    if (on && frozen.current?.run !== on.run) frozen.current = { run: on.run, minute: l.model }
    respeed(l, 0, 0, now, 0); l.model = 0; l.since = since
    waitRef.current = ++started.current; deadline.current = now + READY_MS
    next.current = { level, runStart }
    setRunError(undefined); setWaiting(started.current)
    post({ type: 'init', perAgent: PER_AGENT, seed: 42, level, startDay: runStart, start: started.current, at: since })
  }, [level, runStart])
  // The page clock goes on at the speed from now, and the worker clock follows it from the same time.
  const startClock = (hours: number) => {
    const l = last.current, now = performance.now(), since = performance.timeOrigin + now
    respeed(l, clockAt(l, now), l.model, now, hours * 60 / 1000); l.since = since
    post({ type: 'speed', hoursPerSec: hours, minute: l.minute, at: since })
  }
  // The clock runs at the chosen speed, but stands while the tab is hidden: a hidden page draws nothing, and a run that
  // goes on would only use the battery.
  const resume = () => startClock(document.hidden ? 0 : speedRef.current)
  // While a new run waits, a change of speed is kept for its start.
  useEffect(() => { speedRef.current = speed; if (waitRef.current === undefined) resume() }, [speed])
  useEffect(() => {
    const on = () => { if (waitRef.current === undefined) resume() }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const projection = useMemo(() => towns && projectionFor(towns), [towns])
  // The worker handler is set once, so it reads the projection through a ref.
  const proj = useRef(projection)
  proj.current = projection
  useEffect(() => {
    const dots = dotRuns.current.get(lastDots.current)
    if (projection && dots && unplaced.current.length) { addBatches(dots.tracks.current, unplaced.current, projection); unplaced.current = [] }
  }, [projection])
  // The worker posts up to 30 times a second while the clock runs; between posts the dots move on the extrapolated clock.
  // Dots of a frozen run stand at its minute; the dots of the next run, once shown, follow the clock.
  const clock = () => { const f = frozen.current; return f && dotRun?.run === f.run ? f.minute : clockAt(last.current, performance.now()) }
  // Change per hour over the last rateWindow minutes, as a share of the node's residents.
  const rate = useMemo(() => {
    const h = history
    if (colourBy !== 'rate' || !h.length) return undefined
    const last = h[h.length - 1], first = since(h, rateWindow)
    if (last.t === first.t) return undefined
    const out = new Float32Array(last.counts.length), perHour = 60 / (last.t - first.t)
    for (let i = 0; i < out.length; i++) out[i] = (last.counts[i] - first.counts[i]) * perHour / Math.max(1, homes[i])
    return out
  }, [history, homes, colourBy, rateWindow])
  const ready = projection && villages && s && nodes.length === s.counts.length
  // The map fades in from the blurred outline at its first frame; one animation frame later, so the start state paints.
  const [revealed, setRevealed] = useState(false), [faded, setFaded] = useState(false)
  useEffect(() => {
    if (!ready || revealed) return
    const raf = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(raf)
  }, [!!ready, revealed])
  // The outline goes when the fade ends: the cells of 里 do not cover every part of the towns, and the blurs would
  // stay. The time is the transition in index.html; with reduced motion there is no fade, so it goes at once.
  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setFaded(true), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600)
    return () => clearTimeout(timer)
  }, [revealed])
  // After the render that shows new trips (a new run or a new dot density), the older ones go.
  useEffect(() => { for (const id of dotRuns.current.keys()) if (id < tripsId) dotRuns.current.delete(id) }, [tripsId])
  // The new run starts when the map of its first frame is on the screen, or at the deadline. The effect depends on
  // whether the map is ready, not on each frame.
  const drawn = !!ready && shown.current === waiting
  useEffect(() => {
    if (waiting === undefined) return
    const go = () => { waitRef.current = undefined; setWaiting(undefined); resume() }
    // Two animation frames: the browser paints the new run before the first one ends, and the clock starts after it.
    if (drawn) { let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(go) }); return () => cancelAnimationFrame(raf) }
    const timer = setTimeout(go, Math.max(0, deadline.current - performance.now()))
    return () => clearTimeout(timer)
  }, [waiting, drawn])
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => { const on = () => setSize({ w: innerWidth, h: innerHeight }); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  const taipei = useMemo(() => projection && taipeiIn(towns, projection), [projection])
  const { kind, box, fit, view } = useMemo(() => layoutFor(size.w, size.h, taipei), [size, taipei]), phone = kind !== 'desktop', titleSize = phone ? 20 : 28
  const road = s ? Array.from(s.road) : []
  // Before the first frame no run is on the screen, and its day is 0 of the selected start.
  const shownStart = onScreen?.runStart ?? runStart
  const date = cal && shownStart !== undefined ? dateText(cal, shownStart + (s?.day ?? 0)) : undefined
  const dayLabel = useMemo(() => (day: number) => (cal && shownStart !== undefined ? dateText(cal, shownStart + day).roc : ''), [cal, shownStart])
  const dotRun = dotRuns.current.get(tripsId), dotTrips = dotRun?.trips
  const nowMinute = s ? s.day * 1440 + Math.floor(s.minute) : 0
  const list = useMemo(() => {
    const events = cal && shownStart !== undefined && s ? withPublic(personal, cal, shownStart, nowMinute, MAX_EVENTS) : personal
    return { now: nowMinute, events }
  }, [cal, shownStart, personal, !s, nowMinute])
  const placeOf = useMemo(() => {
    const byCode = new Map<string, { town: string; village: string }>()
    for (const g of villages?.objects.villages.geometries ?? []) byCode.set(g.properties.VILLCODE, { town: g.properties.TOWNNAME, village: g.properties.VILLNAME })
    // At district level a node is named 台北市大安區; at village level it is a code, shown blank until the villages load.
    return (node: number) => byCode.get(nodes[node]) ?? { town: /^(台北|新北)市/.test(nodes[node] ?? '') ? nodes[node].slice(3) : '', village: '' }
  }, [villages, nodes])
  // A desktop always shows the policies and has no icon to close them, so a phone's open policy panel closes when the window turns into a desktop.
  useEffect(() => { if (!phone && open === 'policies') setOpen(undefined) }, [phone])
  const people = (pick: (node: string) => boolean) => padded(s ? nodes.reduce((sum, n, i) => pick(n) ? sum + s.counts[i] : sum, 0) * PER_AGENT : 0, 7)
  const settings = <>
    <h2 style={H2}>顯示</h2>
    <p>{SPEEDS.map(v => <button key={v} onClick={() => setSpeed(v)} style={{ marginRight: 4, fontWeight: v === speed ? 'bold' : 'normal' }}>{v === 0 ? '暫停' : `${v}x`}</button>)}
      <span style={{ marginLeft: 12 }}>{(['district', 'village'] as Level[]).map(l => <button key={l} onClick={() => { if (l !== level) { if (onScreen && startDay !== undefined) setDayOffset(onScreen.runStart - startDay + (s?.day ?? 0)); setLevel(l) } }}
        style={{ marginRight: 4, fontWeight: l === level ? 'bold' : 'normal' }}>{l === 'district' ? '區' : '里'}</button>)}</span>
      <br /><small>切換區、里會從當天 00:00 重新模擬。</small></p>
    <p><label><input type="checkbox" checked={dots} onChange={() => setDots(!dots)} />路上的人</label>，1 點 = {every * PER_AGENT} 人：
      {EVERY.map(v => <button key={v} onClick={() => setDot(v * PER_AGENT)} style={{ marginLeft: 4, fontWeight: v === every ? 'bold' : 'normal' }}>{v * PER_AGENT}</button>)}
      <label style={{ marginLeft: 8 }}><input type="checkbox" checked={byMode} onChange={() => setByMode(!byMode)} />依交通方式上色</label></p>
    <p>顏色：{(['density', 'rate'] as const).map(c => <button key={c} onClick={() => setColourBy(c)}
      style={{ marginRight: 4, fontWeight: c === colourBy ? 'bold' : 'normal' }}>{c === 'density' ? '人口密度' : '人口變化率'}</button>)}
      {colourBy === 'rate' && <span style={{ marginLeft: 8 }}>變化區間：{WINDOWS.map(v => <button key={v} onClick={() => setRateWindow(v)}
        style={{ marginRight: 4, fontWeight: v === rateWindow ? 'bold' : 'normal' }}>{v} 分</button>)}</span>}</p>
    <p>{LAYERS.map(([k, label]) => <label key={k} style={{ marginRight: 12 }}><input type="checkbox" checked={show.has(k)} onChange={() => toggle(k)} />{label}</label>)}</p>
    <h2 style={H2}>模擬</h2>
    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
    <p>台北市 {people(inTaipei)} 人，新北市 {people(n => !inTaipei(n))} 人，路上 {padded(road.reduce((a, b) => a + b, 0) * PER_AGENT, 6)} 人，外地 {padded((s?.away ?? 0) * PER_AGENT, 6)} 人</p>
    <p style={{ fontSize: 13 }}>{MODES.map((m, k) => <span key={m} style={{ marginRight: 10, whiteSpace: 'nowrap', display: 'inline-block' }}>
      <span style={{ color: MODE_COLOURS[k] }}>●</span> {m} {padded((road[k] ?? 0) * PER_AGENT, 6)}</span>)}</p>
    {dotTrips && <p>{padded(dotTrips.home.length, 6)} 點{routed < 2 * dotTrips.home.length ? `，路網計算中 ${padded(Math.floor(50 * routed / dotTrips.home.length), 2)}%` : ''}</p>}
    <p>模擬每幀 {padded(s?.ms ?? 0, 2, 1)} ms，畫面 {padded(fps, 3)} fps</p>
    </div>
  </>
  const info = <>
    <p>台北鼓動模擬台北市與新北市的日子，從你打開頁面的這一天起：平日早上人們湧入各里、傍晚離開，假日則出門走走或離開雙北。這是個人的業餘專案，起於 2026-10-24 的市政 debug 松，但沒有報名參賽。</p>
    <p style={{ fontSize: 12, color: '#aaa' }}>人口密度：現在每平方公里的人數（對數，300 到 100,000）。人口變化率：最近 {rateWindow} 分鐘、每小時的人數變化除以居民數，橘色是流入，藍綠色是流出，滿格是 ±30%。區名下是現在的人數。新北調淡。點：路上的人。捷運沿捷運線，公車、機車、汽車沿公車路線，步行和自行車走直線。1x = 每秒 1 小時。</p>
    <p style={{ fontSize: 12, color: '#aaa' }}>
      {/* ODbL and the Open Government Data License both ask for credit where people see the map. */}
      地圖資料：© <a href="https://www.openstreetmap.org/copyright" style={{ color: '#ccc' }}>OpenStreetMap contributors</a>（ODbL）；
      臺北捷運、臺北市政府、內政部等機關的政府開放資料（政府資料開放授權條款）；
      邊界來自 <a href={`${import.meta.env.BASE_URL}licenses/taiwan-atlas-MIT.txt`} style={{ color: '#ccc' }}>taiwan-atlas</a>（MIT，© 2020 Daniel Kao）。
      完整來源見 <a href="https://github.com/caasi/breathing-taipei/blob/main/DATA.md" style={{ color: '#ccc' }}>DATA.md</a>。</p>
    <p style={{ fontSize: 12, color: '#888' }}>v{__VERSION__} <a href={`https://github.com/caasi/breathing-taipei/commit/${__COMMIT__}`} style={{ color: '#aaa' }}>{__COMMIT__.slice(0, 7)}</a></p>
  </>
  // A desktop always shows the policies; a phone shows the events below the map and opens the policies only when asked.
  const button = (k: NonNullable<typeof open>, label: string, icon: ReactNode) =>
    <button aria-label={label} title={label} aria-expanded={open === k} aria-controls={open !== k ? undefined : k === 'policies' ? 'policies' : 'panel'} onClick={() => setOpen(open === k ? undefined : k)}
      style={{ ...ICON_BUTTON, background: open === k ? '#db6a41' : 'rgba(33, 29, 29, 0.85)' }}>{icon}</button>
  const icons = <>
    {button('info', '專案說明與授權', <InfoIcon />)}
    <a href="https://github.com/caasi/breathing-taipei" target="_blank" rel="noopener noreferrer" aria-label="GitHub 原始碼" title="GitHub 原始碼"
      style={{ ...ICON_BUTTON, display: 'inline-block', boxSizing: 'border-box', verticalAlign: 'top', background: 'rgba(33, 29, 29, 0.85)' }}><GitHubIcon /></a>
    {button('settings', '顯示設定與模擬狀況', <GearIcon />)}
    {phone && button('policies', '政策', <SlidersIcon />)}
  </>
  // On a desktop the panel stays inside the map area, so the event panel never covers it.
  const panel = (open === 'info' || open === 'settings') && <div id="panel" role="region" aria-label={open === 'info' ? '專案說明與授權' : '顯示設定與模擬狀況'} style={phone ? undefined
    : { width: Math.min(536, fit.w - 32), maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', marginBottom: 8, padding: '4px 12px', background: 'rgba(33, 29, 29, 0.85)', borderRadius: 4 }}>
    {open === 'info' ? info : settings}</div>
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#211d1d' }}>
      <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', background: SEA }}>
      {towns && projection && <Land towns={towns} proj={projection} view={view} />}
      {/* The blurred outline is under the map until the map has faded in, once, at the first frame. */}
      {!faded && towns && projection && <Outline towns={towns} proj={projection} view={view} pop={pop} />}
      <div className="reveal" style={{ position: 'absolute', inset: 0, opacity: revealed ? 1 : 0, filter: revealed ? 'none' : 'blur(8px)' }}>
      {ready && <>
        <HeatMap towns={towns} villages={villages} level={onScreen?.level ?? level} nodes={nodes} counts={s.counts} perAgent={PER_AGENT} proj={projection} transit={transit} show={show} rate={rate} road={roads} traffic={traffic} speed={speed} view={view} />
        {dots && dotTrips && <Travellers tracks={dotRun!.tracks} trips={dotTrips} clock={clock} onFps={setFps} byMode={byMode} view={view} />}
      </>}
      </div>
      {/* Always there, so a screen reader reads the change. */}
      {/* In the bottom right of the map, left of the panels on a desktop. It shows from the first paint until the
          run of the selected level and day is on the screen and started, also in the paint right after a click. */}
      <div role="status" style={{ position: 'absolute', right: box.w - fit.x - fit.w + 16, bottom: 16, color: '#fff', pointerEvents: 'none' }}>
        {(waiting !== undefined || onScreen?.level !== level || onScreen.runStart !== runStart) && !runError && !loadError && <><SpinnerIcon /><span style={HIDDEN}>準備中</span></>}
      </div>
      <header style={{ position: 'absolute', top: 16, left: 16, pointerEvents: 'none' }}>
        <h1 style={{ margin: 0, fontSize: titleSize, fontWeight: 'bold', color: '#fff' }}>台北鼓動</h1>
        {/* Centred on the Chinese title alone: a flex row with no width of its own overflows evenly to both sides. */}
        <p style={{ margin: 0, width: 0, minWidth: '100%', display: 'flex', justifyContent: 'center', whiteSpace: 'nowrap',
          fontSize: titleSize * SUBTITLE_SCALE, fontVariantCaps: 'small-caps', letterSpacing: '0.05em', color: '#ccc' }}>Breathing Taipei</p>
      </header>
      {/* A phone's map is too narrow for the clock between the title and the edge, so it moves to the right. */}
      <div style={{ position: 'absolute', top: 16, left: fit.x + (phone ? TITLE_ROOM : 16), width: fit.w - (phone ? TITLE_ROOM + 16 : 32), textAlign: phone ? 'right' : 'center', color: '#fff', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>
        <p style={{ margin: 0, fontSize: phone ? 16 : 24 }}>{date?.roc}{s && ` ${hhmm(s.minute)}`}</p>
        <p style={{ margin: 0, fontSize: phone ? 12 : 14, color: '#ccc' }}>{date && [date.lunar, date.term].filter(Boolean).join('　')}
          {date?.holiday && <span style={{ color: '#db6a41' }}>　{date.holiday}</span>}
          {/* Blue: commemorated, not a day off; orange: a day off. */}
          {date?.observances && <span style={{ color: '#8fb8de' }}>　{date.observances}</span>}</p>
      </div>
      </div>
      {loadError && <p role="alert" style={{ ...ALERT, width: fit.w - 32 }}>無法載入地圖資料：{loadError}</p>}
      {runError && <p role="alert" style={{ ...ALERT, width: fit.w - 32 }}>模擬無法執行：{runError}</p>}
      {/* On a desktop the panel opens over the map, above the icons. On a phone the icons sit on the map, and the panel opens beside or below it, never over it,
          in the place of the dashboard until it is closed. */}
      {phone
        ? <>
          <div style={{ position: 'absolute', left: box.x + 12, top: box.y + box.h - 52 }}>{icons}</div>
          <div style={{ position: 'absolute', left: kind === 'landscape' ? box.w : 0, top: kind === 'portrait' ? box.h : 0, right: 0, bottom: 0, overflowY: 'auto', padding: '0 12px' }}>{panel || (open === 'policies'
            ? <div id="policies" role="region" aria-label="政策"><Policies {...policies} /></div>
            : <section aria-label="事件"><Events events={list.events} now={list.now} dayLabel={dayLabel} placeOf={placeOf} /></section>)}</div>
        </>
        : <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', flexDirection: 'column-reverse' }}>
          <div>{icons}</div>{panel}</div>}
      {!phone && <>
        <aside aria-label="事件" style={{ ...SIDE_PANEL, right: 2 * PANEL.gap + PANEL.policies, width: PANEL.events }}><Events events={list.events} now={list.now} dayLabel={dayLabel} placeOf={placeOf} /></aside>
        <aside aria-label="政策" style={{ ...SIDE_PANEL, right: PANEL.gap, width: PANEL.policies }}><Policies {...policies} /></aside>
      </>}
    </div>
  )
}
