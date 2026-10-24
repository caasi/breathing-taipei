import { readFileSync } from 'node:fs'
import { init, advance, counts } from './core.ts'
import { cityFrom, MODES } from './city.ts'

const pub = (f: string) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8'))
const data = { ...pub('od2.json'), villages: pub('villages2.json'), signal: pub('signal.json'), night: pub('night.json') }
const level = (process.argv[2] ?? 'village') as 'district' | 'village'
let t = performance.now()
const { city } = cityFrom(data, 10, level)
const w = init(city, 42)
console.log(`${level}: ${city.homes.length} nodes, ${w.home.length} agents, init ${(performance.now() - t).toFixed(0)} ms`)
// One frame at 8x (the fastest speed) and 30 fps: advance 16 minutes and count everyone.
const FRAMES = 45 * 7
t = performance.now()
for (let f = 0; f < FRAMES; f++) { advance(w, 16); counts(w, MODES.length) }
console.log(`frame ${((performance.now() - t) / FRAMES).toFixed(2)} ms (advance 16 min + counts), over ${w.day} simulated days`)
