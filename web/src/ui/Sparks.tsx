import type { GeoProjection } from 'd3-geo'
import { program } from './gl.ts'
import { LAYER, useLayer } from './GLMap.tsx'
import { COVER, strips } from './lines.ts'

/** A path that the worker found while the run routes (sparks.ts): its edges, their directions, and the time it came. */
export type Spark = { edges: Uint16Array; back: Uint8Array; at: number }

// The look, as the author chose on the dev server: a spark runs along its path in RUN_MS, with a flash that trails
// FLASH_MS behind its head, a flicker, and a trace that goes out in LIVE_MS. A pale blue, apart from the warm map.
const RUN_MS = 900, FLASH_MS = 250, LIVE_MS = 1000
/** The time after which a spark draws nothing; the last FADE_MS of it go to 0. */
export const SPARK_MS = RUN_MS + LIVE_MS
const FADE_MS = 400
const WIDTH = 1 // CSS px
// The brightness of a spark, as the author chose: the light only adds now, and at 1 it was brighter than the spike.
const GAIN = 0.6

/**
 * The points of a path (lon, lat, ...) from the shapes of its edges (road-lines.json), each run in the direction of the
 * path (`back`). The shapes of two edges do not meet, so the line jumps the gap between them.
 */
export const pathLine = (edges: ArrayLike<number>, back: ArrayLike<number>, lines: number[][]) => {
  const out: number[] = []
  for (let k = 0; k < edges.length; k++) {
    const l = lines[edges[k]]
    if (!l) continue
    const n = l.length / 2
    for (let j = 0; j < n; j++) { const i = back[k] ? n - 1 - j : j; out.push(l[2 * i], l[2 * i + 1]) }
  }
  return out
}

const VS = `#version 300 es
in vec2 xy; in vec2 normal; in float across; in float share; in float at;
uniform vec4 view; uniform vec2 devicePx; uniform float w;
out float d; out float s; out float t0;
void main() {
  float reach = w * 0.5 + 1.0;
  d = across * reach; s = share; t0 = at;
  // The map is scaled the same on both axes and y points down on the screen, so the normal on the screen is (x, -y).
  gl_Position = vec4(xy * view.xy + view.zw + vec2(normal.x, -normal.y) * reach * devicePx, 0, 1);
}`
// The age is taken for each fragment, so the head moves along a segment, and the part not reached yet is not drawn.
// The light only adds (ONE, ONE, and GLMap adds the group), so the land under a spark is not darkened. The alpha is the
// largest channel, so the colour stays premultiplied (no channel above alpha) also where the canvas is transparent.
const FS = `#version 300 es
precision highp float;
in float d; in float s; in float t0; uniform float w; uniform float now; out vec4 o;
${COVER}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float age = now - t0, behind = age - s * ${RUN_MS.toFixed(1)};
  if (behind < 0.0 || age > ${SPARK_MS.toFixed(1)}) discard;
  // A flicker that changes every 40 ms, the same along one spark.
  float flicker = 0.45 + 0.55 * step(0.35, hash(vec2(t0, floor(now / 40.0))));
  float a = max(exp(-behind / ${FLASH_MS.toFixed(1)}), 0.35 * exp(-behind / ${LIVE_MS.toFixed(1)}) * flicker);
  a *= coverOf(d, w) * (1.0 - smoothstep(${(SPARK_MS - FADE_MS).toFixed(1)}, ${SPARK_MS.toFixed(1)}, age));
  if (a <= 0.0) discard;
  vec3 c = vec3(0.75, 0.9, 1.0) * ${GAIN.toFixed(2)} * a;
  o = vec4(c, max(c.r, max(c.g, c.b)));
}`

const NAMES = ['xy', 'normal', 'across', 'share', 'at'] as const
const WIDTHS = [2, 2, 1, 1, 1]

type Props = { sparks: { current: Spark[] }; lines: number[][]; proj: GeoProjection }

/**
 * The paths that the worker finds while the run routes, as sparks that run along them and go out: the page shows the
 * work that it waits for, and a sample of the real paths. A layer of the map (GLMap.tsx) over all others; while the
 * map loads, GLMap puts it over the blurred map with less blur.
 */
export function Sparks({ sparks, lines, proj }: Props) {
  useLayer(LAYER.sparks, gl => {
    const prog = program(gl, VS, FS)
    const u = Object.fromEntries(['view', 'devicePx', 'w', 'now'].map(n => [n, gl.getUniformLocation(prog, n)]))
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    const buffers = NAMES.map((name, i) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b)
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, WIDTHS[i], gl.FLOAT, false, 0, 0)
      return b
    })
    // The geometry of a spark is built once, when it comes, and added after the others in the buffers; a spark that is
    // out draws nothing (the shader), and its vertices go only when the buffers are full and are built again.
    type Part = { spark: Spark; data: Float32Array[] }
    const geometry = (spark: Spark): Part => {
      const g = strips([pathLine(spark.edges, spark.back, lines)], proj, { gap: WIDTH / 2 })
      const total = g.along.reduce((m, v) => Math.max(m, v), 0) || 1
      return { spark, data: [g.xy, g.normal, g.across, g.along.map(v => v / total), new Float32Array(g.along.length).fill(spark.at)] }
    }
    let parts: Part[] = [], seen = new Set<Spark>(), used = 0, room = 0
    const upload = (now: number) => {
      const fresh = sparks.current.filter(s => !seen.has(s) && now - s.at < SPARK_MS)
      if (!fresh.length) return
      const added = fresh.map(geometry), more = added.reduce((n, p) => n + p.data[4].length, 0)
      fresh.forEach(s => seen.add(s))
      if (used + more > room) {
        // Full: built again from the sparks that still draw, with room for twice as many.
        parts = [...parts.filter(p => now - p.spark.at < SPARK_MS), ...added]
        // Every spark of the ref is built or out, so none is taken as new again.
        seen = new Set(sparks.current)
        used = parts.reduce((n, p) => n + p.data[4].length, 0); room = Math.max(4096, 2 * used)
        NAMES.forEach((_, i) => {
          const all = new Float32Array(room * WIDTHS[i])
          parts.reduce((o, p) => (all.set(p.data[i], o), o + p.data[i].length), 0)
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]); gl.bufferData(gl.ARRAY_BUFFER, all, gl.DYNAMIC_DRAW)
        })
        return
      }
      for (const p of added) {
        NAMES.forEach((_, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]); gl.bufferSubData(gl.ARRAY_BUFFER, used * WIDTHS[i] * 4, p.data[i]) })
        used += p.data[4].length; parts.push(p)
      }
    }
    const last = () => sparks.current.reduce((m, s) => Math.max(m, s.at), -Infinity)
    return {
      // While a spark draws, and when one comes.
      dirty: ({ now }) => now - last() < SPARK_MS,
      draw: ({ now, clip, width, height, cssWidth }) => {
        upload(now)
        if (!used) return
        gl.useProgram(prog); gl.bindVertexArray(vao)
        gl.uniform4fv(u.view, clip); gl.uniform2f(u.devicePx, 2 / width, 2 / height)
        gl.uniform1f(u.w, WIDTH * width / cssWidth); gl.uniform1f(u.now, now)
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)
        gl.drawArrays(gl.TRIANGLES, 0, used)
      },
      dispose: () => { buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); gl.deleteProgram(prog) },
    }
  }, [lines, proj])
  return null
}
