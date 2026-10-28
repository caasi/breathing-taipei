import { useMemo } from 'react'
import { geoArea, geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import { Fills } from './Fills.tsx'
import { Borders } from './Borders.tsx'
import { Rails } from './Rails.tsx'
import { R, SPACING, Stations, signsOf, stationScale } from './Stations.tsx'
import { Traffic, type RoadLines } from './Traffic.tsx'
import { Labels, type Text } from './Labels.tsx'
import { Land as LandLayer } from './Land.tsx'
import { MAP_SIZE, type Rect, type View } from './view.ts'

const NO_TRAFFIC = new Uint8Array(0)

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
// The colour of the land, and the colour that the fills of 新北 are faded toward, so a faded cell shows almost no edge
// against the land around it.
const BACKGROUND = [0x21, 0x1d, 0x1d]
// The background of the map box. Much darker than the land, so that the sea does not look like land.
export const SEA = '#0c0f13'
// 新北 is drawn faded so the eye stays on Taipei.
const NEW_TAIPEI_OPACITY = 0.45

const EARTH_KM2 = 6371 * 6371
const features = (topo: any, key: string) =>
  (feature(topo, topo.objects[key]) as unknown as FeatureCollection<Geometry, any>).features
const VIEW = new Set(['台北市', '新北市板橋區', '新北市三重區', '新北市中和區', '新北市永和區', '新北市新莊區', '新北市新店區', '新北市蘆洲區'])
const CITIES = ['台北市', '新北市']
const cityTowns = (towns: any) => features(towns, 'towns').filter(f => CITIES.includes(f.properties.COUNTYNAME))

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
  towns: any; villages: any; level: 'district' | 'village'; nodes: string[]; perAgent: number
  // The people of each node by the run; before its first frame there is none, and the map draws no fills, and the
  // district counts are `pop`, the registered residents by town (villages2.json), which differ a little.
  counts?: Uint32Array; pop?: Map<string, number>
  proj: GeoProjection; transit?: Transit; show: Set<string>; districtLabels: boolean
  signs: Set<string> // the kinds of station whose badge and name show
  rate?: Float32Array // when given, colour by change per hour / residents instead of density
  speed: number // simulated hours per second
  roads?: RoadLines; traffic?: Uint8Array // the road network and its slow edges, over the lines and under the labels
  view: View
}

export function HeatMap({ towns, villages, level, nodes, counts, pop, perAgent, proj, transit, show, signs, districtLabels, rate, speed, view, roads, traffic }: Props) {
  // The fade runs in real time; scale it so it always spans about 30 simulated minutes, or it shows a past hour. Half an
  // hour a second is the slowest speed (1x); a pause (0) keeps the fade of 1x.
  const fadeSeconds = 0.5 / Math.max(0.5, speed)
  // Geometry is fixed per level; only the fills and the label counts change each frame.
  // The cells and the districts do not depend on transit, so a late transit.json does not rebuild a WebGL layer. The
  // shapes do not depend on the nodes either, which come with the first frame of the run: the borders draw before it.
  const shapes = useMemo(() => {
    const fs = level === 'village' ? features(villages, 'villages') : cityTowns(towns)
    return fs.map(f => ({
      geometry: f.geometry, km2: geoArea(f) * EARTH_KM2, taipei: f.properties.COUNTYNAME === '台北市',
      town: f.properties.COUNTYNAME + f.properties.TOWNNAME,
      code: level === 'village' ? f.properties.VILLCODE : f.properties.COUNTYNAME + f.properties.TOWNNAME,
    }))
  }, [towns, villages, level])
  const cells = useMemo(() => shapes.map(s => ({ ...s, node: nodes.indexOf(s.code) })), [shapes, nodes])
  const districts = useMemo(() => cityTowns(towns).map(f => ({ geometry: f.geometry, taipei: f.properties.COUNTYNAME === '台北市' })), [towns])
  const geo = useMemo(() => {
    const path = geoPath(proj)
    const allTowns = cityTowns(towns)
    const labels = allTowns.filter(f => f.properties.COUNTYNAME === '台北市').map(f => ({ xy: path.centroid(f), name: f.properties.TOWNNAME, town: f.properties.COUNTYNAME + f.properties.TOWNNAME }))
    return { cells, labels }
  }, [cells, towns, proj])
  // A railway and a high speed rail station in one building (臺北, 南港) are one marker with both kinds: two
  // half-transparent markers on top of each other looked darker and printed the name twice. Apart from the cells, so a
  // change of level does not build the station layer again.
  const points = useMemo(() => {
    const points: { kinds: string[]; name: string; xy: [number, number] }[] = []
    for (const p of transit?.points ?? []) {
      const xy = proj([p.lon, p.lat])!, near = points.find(q => Math.hypot(q.xy[0] - xy[0], q.xy[1] - xy[1]) < 3)
      if (near) near.kinds.push(p.kind)
      else points.push({ kinds: [p.kind], name: p.name, xy })
    }
    return points
  }, [proj, transit])

  // A name moves out with its signs when they grow past their size in map units (stationScale); the view changes the
  // scale only when the window does.
  const scale = stationScale(view.k)
  // The names keep the opacity of the SVG markers: they are for orientation, so the eye follows the area colours. A
  // name follows the last sign of its station (Stations.tsx).
  const names = useMemo(() => points.map(p => [p, signsOf(p, signs).length] as const).filter(([, n]) => n > 0).map(([p, n]): Text => ({
    xy: [p.xy[0] + (R + 3 + (n - 1) * SPACING) * scale, p.xy[1] + (-R - 1 + (n - 1) * SPACING) * scale], dy: 0,
    text: p.name, style: 'station', anchor: 'start', alpha: 0.6,
  })), [points, signs, scale])

  const byTown = new Map<string, number>()
  // A cell with no node (-1) counts as empty.
  if (counts) geo.cells.forEach(c => byTown.set(c.town, (byTown.get(c.town) ?? 0) + (counts[c.node] ?? 0) * perAgent))
  const colours = counts && new Uint8Array(geo.cells.length * 3)
  if (counts) geo.cells.forEach((c, k) => {
    const rgb = rate ? rateColour(rate[c.node] ?? 0) : color((counts[c.node] ?? 0) * perAgent / c.km2), a = c.taipei ? 1 : NEW_TAIPEI_OPACITY
    for (let i = 0; i < 3; i++) colours![3 * k + i] = Math.round(BACKGROUND[i] + (rgb[i] - BACKGROUND[i]) * a)
  })
  const people = counts ? byTown : pop
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {colours && <Fills cells={geo.cells} proj={proj} colours={colours} fadeSeconds={fadeSeconds} />}
      <Borders cells={shapes} districts={districts} proj={proj} />
      {transit && <Rails lines={transit.lines} proj={proj} show={show} />}
      <Stations points={points} show={signs} />
      {/* Until the first take of a run, it draws the network with no traffic, and before the first frame its dashes stand
          still, so the blurred map is not drawn again in each frame. */}
      {roads && <Traffic lines={roads} proj={proj} levels={traffic ?? NO_TRAFFIC} fadeSeconds={fadeSeconds} running={speed > 0 && !!counts} shown={show.has('traffic')} />}
      {/* The names of the stations, then over them the names of the districts with their counts, as two lines 14 units
          apart: the SVG had the district labels over the station names. */}
      <Labels texts={[...names, ...(districtLabels ? geo.labels : []).flatMap((l): Text[] => [
        { xy: l.xy, dy: 0, text: l.name, style: 'district', anchor: 'middle', alpha: 1 },
        ...people ? [{ xy: l.xy, dy: 14, text: (people.get(l.town) ?? 0).toLocaleString(), style: 'district', anchor: 'middle', alpha: 1 } as const] : [],
      ])]} />
    </div>
  )
}

/** All counties of Taiwan as land, a layer under the map (Land.tsx); only the borders of the other counties show. */
export function Land({ towns, proj }: { towns: any; proj: GeoProjection }) {
  const { counties, borders } = useMemo(() => {
    const city = (g: any) => CITIES.includes(g.properties.COUNTYNAME)
    // One line for all borders, so an edge that two counties share is not drawn twice and darker than the coast. No edge
    // of the two cities: the town borders of the map draw those.
    const lines = mesh(towns, towns.objects.counties, (a: any, b: any) => !(city(a) || city(b))).coordinates
    return { counties: features(towns, 'counties'), borders: lines.map(l => l.flat()) }
  }, [towns])
  return <LandLayer counties={counties} borders={borders} colour={BACKGROUND} proj={proj} />
}
