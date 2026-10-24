import { useEffect, useMemo, useRef, useState } from 'react'
import { HeatMap, projectionFor, type Transit } from './ui/HeatMap.tsx'
import { Travellers, MODE_COLOURS, addBatches, type Track } from './ui/Travellers.tsx'
import { MODES } from './sim/city.ts'
import type { FromWorker, WorkerError, ToWorker, Level, Trips } from './sim/worker.ts'
import { getJson } from './load.ts'
import type { Batch } from './sim/paths.ts'
import { useQuery, oneOf, setOf, bool, fromBool } from './query.ts'
import { record, since, KEEP, type Entry } from './history.ts'

const SPEEDS = [0, 1, 2, 4, 8, 16]
const EVERY = [2, 5, 10, 20, 50]
const LAYERS: [string, string][] = [['mrt', '捷運'], ['lrt', '輕軌'], ['tra', '台鐵'], ['hsr', '高鐵'], ['airport', '機場'], ['highway', '國道與快速道路']]
const PER_AGENT = 10
const WINDOWS = [15, 30, 60, KEEP] // simulated minutes the change rate can look back; history keeps the longest
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
  // Change per hour over the last RATE_WINDOW minutes, as a share of the node's residents.
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
  const road = s ? Array.from(s.road) : []
  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>台北鼓動：雙北 {s ? ((Array.from(s.counts).reduce((a, b) => a + b, 0) + road.reduce((a, b) => a + b, 0)) * PER_AGENT).toLocaleString() : ''} 人</h1>
      {loadError && <p role="alert" style={{ color: '#ff8b6b' }}>無法載入地圖資料：{loadError}</p>}
      {runError && <p role="alert" style={{ color: '#ff8b6b' }}>模擬無法執行：{runError}</p>}
      <p>第 {s?.day ?? 0} 天 {hhmm(s?.minute ?? 0)}，模擬每幀 {s?.ms.toFixed(1)} ms，畫面 {fps.toFixed(0)} fps</p>
      <p>{SPEEDS.map(v => <button key={v} onClick={() => setSpeed(v)} style={{ marginRight: 4, fontWeight: v === speed ? 'bold' : 'normal' }}>{v === 0 ? '暫停' : `${v}x`}</button>)}
        <span style={{ marginLeft: 12 }}>{(['district', 'village'] as Level[]).map(l => <button key={l} onClick={() => setLevel(l)}
          style={{ marginRight: 4, fontWeight: l === level ? 'bold' : 'normal' }}>{l === 'district' ? '區' : '里'}</button>)}</span></p>
      <p><label><input type="checkbox" checked={dots} onChange={() => setDots(!dots)} />路上的人</label>，1 點 = {every * PER_AGENT} 人：
        {EVERY.map(v => <button key={v} onClick={() => setDot(v * PER_AGENT)} style={{ marginLeft: 4, fontWeight: v === every ? 'bold' : 'normal' }}>{v * PER_AGENT}</button>)}
        <label style={{ marginLeft: 8 }}><input type="checkbox" checked={byMode} onChange={() => setByMode(!byMode)} />依交通方式上色</label>
        {trips && <span style={{ marginLeft: 8, color: '#aaa' }}>（{trips.home.length} 點{routed < trips.home.length ? `，路網計算中 ${Math.floor(100 * routed / trips.home.length)}%` : ''}）</span>}</p>
      <p style={{ fontSize: 13 }}>{MODES.map((m, k) => <span key={m} style={{ marginRight: 10 }}>
        <span style={{ color: MODE_COLOURS[k] }}>●</span> {m} {((road[k] ?? 0) * PER_AGENT).toLocaleString()}</span>)}</p>
      <p>顏色：{(['density', 'rate'] as const).map(c => <button key={c} onClick={() => setColourBy(c)}
        style={{ marginRight: 4, fontWeight: c === colourBy ? 'bold' : 'normal' }}>{c === 'density' ? '人口密度' : '人口變化率'}</button>)}
        {colourBy === 'rate' && <span style={{ marginLeft: 8 }}>變化區間：{WINDOWS.map(v => <button key={v} onClick={() => setRateWindow(v)}
          style={{ marginRight: 4, fontWeight: v === rateWindow ? 'bold' : 'normal' }}>{v} 分</button>)}</span>}</p>
      <p>{LAYERS.map(([k, label]) => <label key={k} style={{ marginRight: 12 }}><input type="checkbox" checked={show.has(k)} onChange={() => toggle(k)} />{label}</label>)}</p>
      {ready && <div style={{ position: 'relative' }}>
        <HeatMap towns={towns} villages={villages} level={level} nodes={nodes} counts={s.counts} perAgent={PER_AGENT} proj={projection} transit={transit} show={show} rate={rate} speed={speed} />
        {dots && trips && <Travellers tracks={tracks} trips={trips} clock={clock} onFps={setFps} byMode={byMode} />}
      </div>}
      <p style={{ fontSize: 12, color: '#aaa' }}>
        {/* ODbL and the Open Government Data License both ask for credit where people see the map. */}
        地圖資料：© <a href="https://www.openstreetmap.org/copyright" style={{ color: '#ccc' }}>OpenStreetMap contributors</a>（ODbL）；
        臺北捷運、臺北市政府、內政部等機關的政府開放資料（政府資料開放授權條款）；
        邊界來自 <a href={`${import.meta.env.BASE_URL}licenses/taiwan-atlas-MIT.txt`} style={{ color: '#ccc' }}>taiwan-atlas</a>（MIT，© 2020 Daniel Kao）。
        完整來源見 <a href="https://github.com/caasi/breathing-taipei/blob/main/DATA.md" style={{ color: '#ccc' }}>DATA.md</a>。</p>
      <p style={{ fontSize: 12, color: '#aaa' }}>人口密度：現在每平方公里的人數（對數，300 到 100,000）。人口變化率：最近 {rateWindow} 分鐘、每小時的人數變化除以居民數，橘色是流入，藍綠色是流出，滿格是 ±30%。區名下是現在的人數。新北調淡。點：路上的人。捷運沿捷運線，公車、機車、汽車沿公車路線，步行和自行車走直線。1x = 每秒 1 小時。</p>
    </div>
  )
}
