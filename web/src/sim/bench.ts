import { readFileSync } from 'node:fs'
import { init, advance, counts } from './core.ts'
import { cityFrom, MODES } from './city.ts'
import { kindAt, indexOf, type Calendar } from './calendar.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
// The app's days: from 2026-10-24, so the frames below run a Saturday and two days off, as the page does on that day.
const cal: Calendar = pub('calendar.json'), start = indexOf(cal, '2026-10-24')
const level = (process.argv[2] ?? 'village') as 'district' | 'village'
let t = performance.now()
const { city } = cityFrom(data, 10, level, day => kindAt(cal, start + day))
const w = init(city, 42)
console.log(`${level}: ${city.homes.length} nodes, ${w.home.length} agents, init ${(performance.now() - t).toFixed(0)} ms`)
// One frame at 8x (the fastest speed, 4 simulated hours a second) and 30 fps: advance 8 minutes and count everyone.
const FRAMES = 45 * 7
t = performance.now()
for (let f = 0; f < FRAMES; f++) { advance(w, 8); counts(w, MODES.length) }
console.log(`frame ${((performance.now() - t) / FRAMES).toFixed(2)} ms (advance 8 min + counts), over ${w.day} simulated days`)
