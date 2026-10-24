import { useEffect, useMemo, useRef, useState } from 'react'
import { HeatMap, projectionFor, taipeiIn, type Transit } from './ui/HeatMap.tsx'
import { Travellers, MODE_COLOURS, addBatches, type Track } from './ui/Travellers.tsx'
import { MODES } from './sim/city.ts'
import type { FromWorker, WorkerError, ToWorker, Level, Trips } from './sim/worker.ts'
import { getJson } from './load.ts'
import type { Batch } from './sim/paths.ts'
import { useQuery, oneOf, setOf, bool, fromBool } from './query.ts'
import { record, since, KEEP, type Entry } from './history.ts'
import { layoutFor } from './ui/view.ts'

const SPEEDS = [0, 1, 2, 4, 8]
const EVERY = [2, 5, 10, 20, 50]
const LAYERS: [string, string][] = [['mrt', '捷運'], ['lrt', '輕軌'], ['tra', '台鐵'], ['hsr', '高鐵'], ['airport', '機場'], ['highway', '國道與快速道路']]
const PER_AGENT = 10
// The English subtitle at this share of the title size is a little narrower than 台北鼓動; the user chose it by eye.
const SUBTITLE_SCALE = 0.46
const WINDOWS = [15, 30, 60, KEEP] // simulated minutes the change rate can look back; history keeps the longest
// A node is a village code (台北市 is county 63000) or a district name.
const inTaipei = (node: string) => node.startsWith('63000') || node.startsWith('台北市')
const H2 = { fontSize: 14, color: '#aaa', margin: '12px 0 4px' }
const ALERT = { position: 'absolute', top: 72, left: 16, right: 16, margin: 0, color: '#ff8b6b' } as const
const ICON_BUTTON = { width: 40, height: 40, marginRight: 8, padding: 8, border: 0, borderRadius: 20, color: '#fff', cursor: 'pointer' }
const InfoIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
  <path d="M12 11v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.5" fill="currentColor" /></svg>
// The teeth are the dashes of one thick stroke: 8 dashes on a circle of length 2πr.
const GearIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={`${Math.PI * 9 / 8} ${Math.PI * 9 / 8}`} />
  <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
// Figures that change every frame keep their width: zero-padded to a fixed number of digits, in tabular figures.
const padded = (n: number, digits: number, decimals = 0) => {
  const [whole, part] = Math.max(0, n).toFixed(decimals).split('.')
  return whole.padStart(digits, '0').replace(/\B(?=(\d{3})+$)/g, ',') + (part ? '.' + part : '')
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`

export function App() {
  const [towns, setTowns] = useState<any>()
  const [villages, setVillages] = useState<any>()
  const [transit, setTransit] = useState<Transit>()
  const [nodes, setNodes] = useState<string[]>([])
  const [coords, setCoords] = useState<[number, number][]>([])
  const [trips, setTrips] = useState<Trips>()
  const tripsRef = useRef<Trips>()
  const [s, setS] = useState<FromWorker>()
  // Every setting below can be set in the query string, for example ?speed=4&dot=20&color=density&layers=mrt,highway
  const [speed, setSpeed] = useQuery('speed', 1, oneOf(SPEEDS))
  const [level, setLevel] = useQuery<Level>('level', 'village', oneOf(['district', 'village'] as const))
  const [dot, setDot] = useQuery('dot', 50, oneOf(EVERY.map(e => e * PER_AGENT)))
  const every = dot / PER_AGENT
  const [rateWindow, setRateWindow] = useQuery('window', 30, oneOf(WINDOWS))
  const [routed, setRouted] = useState(0)
  const tracks = useRef<(Track | undefined)[]>([])
  const unplaced = useRef<Batch[]>([])
  const [dots, setDots] = useQuery('dots', true, bool, fromBool)
  const [byMode, setByMode] = useQuery('mode', false, bool, fromBool)
  const [colourBy, setColourBy] = useQuery<'density' | 'rate'>('color', 'rate', oneOf(['density', 'rate'] as const))
  const history = useRef<Entry[]>([])
  const homes = useRef(new Uint32Array(0))
  const [fps, setFps] = useState(0)
  // A file the page loads once stays failed until reload; a run error belongs to the current run.
  const [loadError, setLoadError] = useState<string>()
  const [open, setOpen] = useState<'info' | 'settings'>()
  const [runError, setRunError] = useState<string>()
  // Highways are for orientation only and compete with the area colours, so they start hidden.
  const [show, setShow] = useQuery('layers', new Set(LAYERS.map(l => l[0]).filter(k => k !== 'highway')),
    setOf(LAYERS.map(l => l[0])), v => [...v].join(','))
  const worker = useRef<Worker>()
  const last = useRef({ minute: 0, at: 0, speed: 1 }) // minute since 00:00 of day 0
  const toggle = (k: string) => setShow(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const post = (m: ToWorker) => worker.current?.postMessage(m)

  useEffect(() => {
    getJson('towns.json').then(setTowns).catch(err => setLoadError(String(err)))
    getJson('villages2-topo.json').then(setVillages).catch(err => setLoadError(String(err)))
    getJson('transit.json').then(setTransit).catch(err => setLoadError(String(err)))
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<FromWorker | WorkerError>) => {
      if ('error' in e.data) { setRunError(e.data.error); return }
      const m = e.data
      if (m.nodes) setNodes(m.nodes)
      if (m.coords) setCoords(m.coords)
      if (m.homes) homes.current = m.homes
      if (m.coords) { tracks.current = []; history.current = []; unplaced.current = [] }
      history.current = record(history.current, { t: m.day * 1440 + m.minute, counts: m.counts }, KEEP)
      if (m.trips) { tripsRef.current = m.trips; setTrips(m.trips) }
      // The dots read the arrays every frame, so new plans are written into them in place.
      const t = tripsRef.current, r = m.replans
      if (t && r) r.k.forEach((k, j) => { t.dep[k] = r.dep[j]; t.dur1[k] = r.dur1[j]; t.ret[k] = r.ret[j]; t.dur2[k] = r.dur2[j] })
      // The worker sends each batch once; keep the ones that arrive before the map projection exists.
      if (m.paths?.length) proj.current ? addBatches(tracks.current, m.paths, proj.current) : unplaced.current.push(...m.paths)
      if (m.routed !== undefined) setRouted(m.routed)
      last.current = { ...last.current, minute: m.day * 1440 + m.minute, at: performance.now() }
      setS(m)
    }
    // A throw in the worker's frame loop (routing, counting) reaches the page through onerror.
    w.onerror = e => setRunError(e.message || 'worker error')
    worker.current = w
    return () => w.terminate()
  }, [])
  useEffect(() => { setS(undefined); setRunError(undefined); post({ type: 'init', perAgent: PER_AGENT, seed: 42, level, every }) }, [level, every])
  useEffect(() => { last.current.speed = speed; post({ type: 'speed', hoursPerSec: speed }) }, [speed])

  const projection = useMemo(() => towns && projectionFor(towns), [towns])
  // The worker handler is set once, so it reads the projection through a ref.
  const proj = useRef(projection)
  proj.current = projection
  useEffect(() => {
    if (projection && unplaced.current.length) { addBatches(tracks.current, unplaced.current, projection); unplaced.current = [] }
  }, [projection])
  // The worker posts about 30 times a second; between posts the dots move on the extrapolated clock.
  const clock = () => { const l = last.current; return l.minute + (performance.now() - l.at) / 1000 * l.speed * 60 }
  // Change per hour over the last rateWindow minutes, as a share of the node's residents.
  const rate = useMemo(() => {
    const h = history.current
    if (colourBy !== 'rate' || !s || !h.length) return undefined
    const last = h[h.length - 1], first = since(h, rateWindow)
    if (last.t === first.t) return undefined
    const out = new Float32Array(s.counts.length), perHour = 60 / (last.t - first.t)
    for (let i = 0; i < out.length; i++) out[i] = (last.counts[i] - first.counts[i]) * perHour / Math.max(1, homes.current[i])
    return out
  }, [s, colourBy, rateWindow])
  const ready = projection && villages && s && nodes.length === s.counts.length
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => { const on = () => setSize({ w: innerWidth, h: innerHeight }); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  const taipei = useMemo(() => projection && taipeiIn(towns, projection), [projection])
  const { kind, box, fit, view } = useMemo(() => layoutFor(size.w, size.h, taipei), [size, taipei]), phone = kind !== 'desktop', titleSize = phone ? 20 : 28
  const road = s ? Array.from(s.road) : []
  const people = (pick: (node: string) => boolean) => padded(s ? nodes.reduce((sum, n, i) => pick(n) ? sum + s.counts[i] : sum, 0) * PER_AGENT : 0, 7)
  const settings = <>
    <h2 style={H2}>顯示</h2>
    <p>{SPEEDS.map(v => <button key={v} onClick={() => setSpeed(v)} style={{ marginRight: 4, fontWeight: v === speed ? 'bold' : 'normal' }}>{v === 0 ? '暫停' : `${v}x`}</button>)}
      <span style={{ marginLeft: 12 }}>{(['district', 'village'] as Level[]).map(l => <button key={l} onClick={() => setLevel(l)}
        style={{ marginRight: 4, fontWeight: l === level ? 'bold' : 'normal' }}>{l === 'district' ? '區' : '里'}</button>)}</span></p>
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
    <p>台北市 {people(inTaipei)} 人，新北市 {people(n => !inTaipei(n))} 人，路上 {padded(road.reduce((a, b) => a + b, 0) * PER_AGENT, 6)} 人</p>
    <p style={{ fontSize: 13 }}>{MODES.map((m, k) => <span key={m} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
      <span style={{ color: MODE_COLOURS[k] }}>●</span> {m} {padded((road[k] ?? 0) * PER_AGENT, 6)}</span>)}</p>
    {trips && <p>{padded(trips.home.length, 6)} 點{routed < trips.home.length ? `，路網計算中 ${padded(Math.floor(100 * routed / trips.home.length), 2)}%` : ''}</p>}
    <p>模擬每幀 {padded(s?.ms ?? 0, 2, 1)} ms，畫面 {padded(fps, 3)} fps</p>
    </div>
  </>
  const info = <>
    <p>台北鼓動模擬台北市與新北市的一個平日：早上人們湧入各里，傍晚離開。這是個人的業餘專案，起於 2026-10-24 的市政 debug 松，但沒有報名參賽。</p>
    <p style={{ fontSize: 12, color: '#aaa' }}>人口密度：現在每平方公里的人數（對數，300 到 100,000）。人口變化率：最近 {rateWindow} 分鐘、每小時的人數變化除以居民數，橘色是流入，藍綠色是流出，滿格是 ±30%。區名下是現在的人數。新北調淡。點：路上的人。捷運沿捷運線，公車、機車、汽車沿公車路線，步行和自行車走直線。1x = 每秒 1 小時。</p>
    <p style={{ fontSize: 12, color: '#aaa' }}>
      {/* ODbL and the Open Government Data License both ask for credit where people see the map. */}
      地圖資料：© <a href="https://www.openstreetmap.org/copyright" style={{ color: '#ccc' }}>OpenStreetMap contributors</a>（ODbL）；
      臺北捷運、臺北市政府、內政部等機關的政府開放資料（政府資料開放授權條款）；
      邊界來自 <a href={`${import.meta.env.BASE_URL}licenses/taiwan-atlas-MIT.txt`} style={{ color: '#ccc' }}>taiwan-atlas</a>（MIT，© 2020 Daniel Kao）。
      完整來源見 <a href="https://github.com/caasi/breathing-taipei/blob/main/DATA.md" style={{ color: '#ccc' }}>DATA.md</a>。</p>
  </>
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#211d1d' }}>
      <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden' }}>
      {ready && <>
        <HeatMap towns={towns} villages={villages} level={level} nodes={nodes} counts={s.counts} perAgent={PER_AGENT} proj={projection} transit={transit} show={show} rate={rate} speed={speed} view={view} />
        {dots && trips && <Travellers tracks={tracks} trips={trips} clock={clock} onFps={setFps} byMode={byMode} view={view} />}
      </>}
      <header style={{ position: 'absolute', top: 16, left: 16, pointerEvents: 'none' }}>
        <h1 style={{ margin: 0, fontSize: titleSize, fontWeight: 'bold', color: '#fff' }}>台北鼓動</h1>
        {/* Centred on the Chinese title alone: a flex row with no width of its own overflows evenly to both sides. */}
        <p style={{ margin: 0, width: 0, minWidth: '100%', display: 'flex', justifyContent: 'center', whiteSpace: 'nowrap',
          fontSize: titleSize * SUBTITLE_SCALE, fontVariantCaps: 'small-caps', letterSpacing: '0.05em', color: '#ccc' }}>Breathing Taipei</p>
      </header>
      {/* A phone's map is too narrow for the clock between the title and the edge, so it moves to the right. */}
      <p style={{ position: 'absolute', top: 16, left: fit.x + 16, width: fit.w - 32, margin: 0, textAlign: phone ? 'right' : 'center', fontSize: phone ? 18 : 24, color: '#fff', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>
        第 {s?.day ?? 0} 天 {hhmm(s?.minute ?? 0)}</p>
      </div>
      {loadError && <p role="alert" style={ALERT}>無法載入地圖資料：{loadError}</p>}
      {runError && <p role="alert" style={ALERT}>模擬無法執行：{runError}</p>}
      {/* On a desktop the panel opens over the map, above the icons; on a phone it opens beside or below the map, never over it. */}
      <div style={phone
        ? { position: 'absolute', left: kind === 'landscape' ? box.w : 0, top: kind === 'portrait' ? box.h : 0, right: 0, bottom: 0, overflowY: 'auto', padding: 12 }
        : { position: 'absolute', left: 16, bottom: 16, display: 'flex', flexDirection: 'column-reverse' }}>
        <div>{([['info', '專案說明與授權', <InfoIcon />], ['settings', '顯示設定與模擬狀況', <GearIcon />]] as const).map(([k, label, icon]) =>
          <button key={k} aria-label={label} title={label} aria-expanded={open === k} aria-controls="panel" onClick={() => setOpen(open === k ? undefined : k)}
            style={{ ...ICON_BUTTON, background: open === k ? '#db6a41' : 'rgba(33, 29, 29, 0.85)' }}>{icon}</button>)}</div>
        {open && <div id="panel" style={phone ? { marginTop: 8 }
          : { width: 536, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', marginBottom: 8, padding: '4px 12px', background: 'rgba(33, 29, 29, 0.85)', borderRadius: 4 }}>
          {open === 'info' ? info : settings}</div>}
      </div>
    </div>
  )
}
