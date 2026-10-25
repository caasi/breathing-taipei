import { useMemo } from 'react'
import { geoArea, geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import { Fills } from './Fills.tsx'
import { MAP_SIZE, svgTransform, type Rect, type View } from './view.ts'

export type Transit = {
  lines: { kind: string; name: string; colour: string; coords: [number, number][] }[]
  points: { kind: string; name: string; lon: number; lat: number }[]
}

// People per km² on a log scale from 300 to 100,000: almost empty -> background, crowded -> 洋流橘 -> light.
// Colours are from puma.taipei (theme-color #db6a41, background #211d1d).
const STOPS: [number, number[]][] = [[0, [0x2b, 0x23, 0x21]], [0.5, [0x7a, 0x3a, 0x26]], [0.8, [0xdb, 0x6a, 0x41]], [1, [0xff, 0xc0, 0x80]]]
const color = (perKm2: number) => {
  const t = Math.max(0, Math.min(1, Math.log10(Math.max(perKm2, 1) / 300) / Math.log10(100_000 / 300)))
  const k = STOPS.findIndex(([s]) => s >= t)
  if (k <= 0) return STOPS[0][1]
  const [t0, a] = STOPS[k - 1], [t1, b] = STOPS[k], f = (t - t0) / (t1 - t0)
  return a.map((v, i) => v + (b[i] - v) * f)
}

// Change per hour as a share of residents, from -0.3 to +0.3: no change is the background,
// people arriving glow 洋流橘, people leaving glow teal (a hue the density scale never uses).
const BASE = [0x2b, 0x23, 0x21], IN = [0xff, 0x8b, 0x41], OUT = [0x3f, 0xc1, 0xb0]
const rateColour = (perHour: number) => {
  const t = Math.max(-1, Math.min(1, perHour / 0.3)), to = t > 0 ? IN : OUT, f = Math.sqrt(Math.abs(t))
  return BASE.map((v, i) => v + (to[i] - v) * f)
}
const BACKGROUND = [0x21, 0x1d, 0x1d]
// 新北 is drawn faded so the eye stays on Taipei.
const NEW_TAIPEI_OPACITY = 0.45

// Lines and stations are for orientation; kept faint so the eye follows the area colours.
const LINE_OPACITY = { rail: 0.35, highway: 0.3 }
const STATION_OPACITY = 0.6
const SVG = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } as const

const EARTH_KM2 = 6371 * 6371
const features = (topo: any, key: string) =>
  (feature(topo, topo.objects[key]) as unknown as FeatureCollection<Geometry, any>).features
const VIEW = new Set(['台北市', '新北市板橋區', '新北市三重區', '新北市中和區', '新北市永和區', '新北市新莊區', '新北市新店區', '新北市蘆洲區'])
const cityTowns = (towns: any) => features(towns, 'towns').filter(f => ['台北市', '新北市'].includes(f.properties.COUNTYNAME))

export const projectionFor = (towns: any): GeoProjection => {
  const fit = cityTowns(towns).filter(f => VIEW.has(f.properties.COUNTYNAME) || VIEW.has(f.properties.COUNTYNAME + f.properties.TOWNNAME))
  return geoMercator().fitSize([MAP_SIZE, MAP_SIZE], { type: 'FeatureCollection', features: fit })
}

/** The bounds of 台北市 in map space, which a phone's small map box zooms to. */
export const taipeiIn = (towns: any, proj: GeoProjection): Rect => {
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds({ type: 'FeatureCollection', features: cityTowns(towns).filter(f => f.properties.COUNTYNAME === '台北市') })
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

type Props = {
  towns: any; villages: any; level: 'district' | 'village'; nodes: string[]; counts: Uint32Array; perAgent: number
  proj: GeoProjection; transit?: Transit; show: Set<string>
  rate?: Float32Array // when given, colour by change per hour / residents instead of density
  speed: number // simulated hours per second
  view: View
}

export function HeatMap({ towns, villages, level, nodes, counts, perAgent, proj, transit, show, rate, speed, view }: Props) {
  // The fade runs in real time; scale it so it always spans about 30 simulated minutes, or it shows a past hour.
  const fadeSeconds = 0.5 / Math.max(1, speed)
  // Geometry is fixed per level; only the fills and the label counts change each frame.
  // The cells do not depend on transit, so a late transit.json does not rebuild the WebGL fills.
  const cells = useMemo(() => {
    const path = geoPath(proj)
    const fs = level === 'village' ? features(villages, 'villages') : cityTowns(towns)
    return fs.map(f => ({
      d: path(f) ?? '', geometry: f.geometry, km2: geoArea(f) * EARTH_KM2, taipei: f.properties.COUNTYNAME === '台北市',
      town: f.properties.COUNTYNAME + f.properties.TOWNNAME,
      node: nodes.indexOf(level === 'village' ? f.properties.VILLCODE : f.properties.COUNTYNAME + f.properties.TOWNNAME),
    }))
  }, [towns, villages, level, nodes, proj])
  const geo = useMemo(() => {
    const path = geoPath(proj)
    const allTowns = cityTowns(towns)
    const borders = allTowns.map(f => ({ d: path(f) ?? '', taipei: f.properties.COUNTYNAME === '台北市' }))
    const labels = allTowns.filter(f => f.properties.COUNTYNAME === '台北市').map(f => ({ xy: path.centroid(f), name: f.properties.TOWNNAME, town: f.properties.COUNTYNAME + f.properties.TOWNNAME }))
    const lines = transit?.lines.map(l => ({ ...l, d: path({ type: 'LineString', coordinates: l.coords }) ?? '' })) ?? []
    // A railway and a high speed rail station in one building (臺北, 南港) are one marker with both kinds:
    // two half-transparent markers on top of each other looked darker and printed the name twice.
    const points: { kinds: string[]; name: string; xy: [number, number] }[] = []
    for (const p of transit?.points ?? []) {
      const xy = proj([p.lon, p.lat])!, near = points.find(q => Math.hypot(q.xy[0] - xy[0], q.xy[1] - xy[1]) < 3)
      if (near) near.kinds.push(p.kind)
      else points.push({ kinds: [p.kind], name: p.name, xy })
    }
    return { cells, borders, labels, lines, points }
  }, [cells, towns, proj, transit])

  // Cell edges, borders, lines and stations never change during a run, so they are one SVG whose paths are built once.
  const fixed = useMemo(() => <>
      {geo.cells.map((c, k) => <path key={'c' + k} d={c.d} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={0.4} />)}
      {geo.borders.map((b, k) => <path key={'b' + k} d={b.d} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={b.taipei ? 1.8 : 1} />)}
      {geo.lines.filter(l => show.has(l.kind)).map((l, k) =>
        <path key={'l' + k} d={l.d} fill="none" stroke={l.colour} strokeWidth={l.kind === 'mrt' ? 1.8 : l.kind === 'highway' ? 1 : 1.5}
          strokeDasharray={l.kind === 'tra' ? '6 3' : undefined} opacity={l.kind === 'highway' ? LINE_OPACITY.highway : LINE_OPACITY.rail} />)}
      {geo.points.filter(p => p.kinds.some(k => show.has(k))).map(p => {
        const has = (k: string) => p.kinds.includes(k) && show.has(k)
        return <g key={p.kinds.join() + p.name} opacity={STATION_OPACITY}>
          <circle cx={p.xy[0]} cy={p.xy[1]} r={has('airport') ? 7 : 5} fill={has('hsr') ? '#f47321' : has('airport') ? '#fff' : '#ccc'} stroke="#000" />
          <text x={p.xy[0] + 8} y={p.xy[1] - 6} fontSize={11} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke">{has('airport') ? '✈ ' : ''}{p.name}</text></g>
      })}
  </>, [geo, show])

  const byTown = new Map<string, number>()
  // A cell with no node (-1) counts as empty.
  geo.cells.forEach(c => byTown.set(c.town, (byTown.get(c.town) ?? 0) + (counts[c.node] ?? 0)))
  const colours = new Uint8Array(geo.cells.length * 3)
  geo.cells.forEach((c, k) => {
    const rgb = rate ? rateColour(rate[c.node] ?? 0) : color((counts[c.node] ?? 0) * perAgent / c.km2), a = c.taipei ? 1 : NEW_TAIPEI_OPACITY
    for (let i = 0; i < 3; i++) colours[3 * k + i] = Math.round(BACKGROUND[i] + (rgb[i] - BACKGROUND[i]) * a)
  })
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Fills cells={geo.cells} proj={proj} colours={colours} fadeSeconds={fadeSeconds} view={view} />
      {/* The view is outside the memo, so a zoom or pan step changes one attribute and leaves the paths alone. */}
      <svg style={SVG}><g transform={svgTransform(view)}>{fixed}</g></svg>
      <svg style={SVG}><g transform={svgTransform(view)}>
        {geo.labels.map(l => <text key={l.town} x={l.xy[0]} y={l.xy[1]} textAnchor="middle" fontSize={12} fill="#fff" stroke="#211d1d" strokeWidth={3} paintOrder="stroke">
          {l.name}<tspan x={l.xy[0]} dy={14}>{((byTown.get(l.town) ?? 0) * perAgent).toLocaleString()}</tspan></text>)}
      </g></svg>
    </div>
  )
}

