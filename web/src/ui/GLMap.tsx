import { createContext, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react'
import { fit, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

/** What a layer gets for each frame. `clip` maps map space to clip space (view.ts). */
export type Frame = { now: number; view: View; clip: number[]; width: number; height: number; cssWidth: number; cssHeight: number }

/**
 * One layer of the map. When any layer is dirty, or the view or the size changes, the map clears the canvas and draws
 * every layer in order. So `draw` must draw the whole layer.
 * The setup of a layer and each `draw` start from the same GL state (`reset` in GLMap): the default framebuffer and the
 * full viewport, no VAO, texture unit 0, no blend, face culling, scissor, depth or stencil test, the blend function
 * (ONE, ONE_MINUS_SRC_ALPHA), and all colour channels written. Only this state is set: a layer can change any of it,
 * and sets what else it needs (the pixel store, for example); the map sets the listed state back before the next layer.
 * A layer must not clear the default framebuffer: the map clears it once, and a clear in a layer erases the layers
 * under it.
 * A layer over another one writes premultiplied colour, and enables blend with the function of the baseline. That is
 * how the browser composited each WebGL canvas over the one under it, so a layer that had its own canvas keeps its look
 * only with this blend. The context has antialias on, which a layer that had `antialias: false` did not have: compare a screenshot
 * before and after the move.
 * `dispose` can run twice: when the layer fails, and again when its component cleans up. Deleting a GL object twice does
 * nothing, so a dispose that only deletes is safe.
 */
export type Layer = { dirty: (f: Frame) => boolean; draw: (f: Frame) => void; dispose: () => void }

/** The order of the layers, from the bottom. One list, so that a new layer finds its place among all the others. */
export const LAYER = { fills: 0, borders: 1 } as const

type Entry = { order: number; layer: Layer }
type MapCtx = { gl: WebGL2RenderingContext; add: (e: Entry) => () => void; reset: () => void }
const Ctx = createContext<MapCtx | undefined>(undefined)

/**
 * One frame: asks every layer whether it is dirty, and when one is (or `force`), clears and draws every layer in order,
 * with `reset` before the clear and before each layer. A layer that throws is returned in `failed` and draws no more in
 * this frame, so that one bad layer does not stop the map.
 */
export const paint = (entries: Entry[], f: Frame, force: boolean, reset: () => void, clear: () => void) => {
  const failed: Entry[] = []
  const run = (e: Entry, step: () => unknown) => {
    try { return step() } catch (err) { console.error(err); failed.push(e) }
  }
  const dirty = entries.map(e => run(e, () => e.layer.dirty(f))).some(Boolean)
  if (!dirty && !force) return { drawn: false, failed }
  reset(); clear()
  for (const e of entries) if (!failed.includes(e)) { reset(); run(e, () => e.layer.draw(f)) }
  return { drawn: true, failed }
}

/**
 * The one WebGL canvas of the map. Layers are components under it that call `useLayer`; they draw in `order`, the lowest
 * first. The canvas is mounted once: an unmount loses its context (gl.ts), and then every layer stays blank.
 */
export function GLMap({ view, children }: { view: View; children: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const view$ = useRef(view)
  view$.current = view
  const [map, setMap] = useState<MapCtx>()
  useWebGL2(ref, { antialias: true }, (gl, canvas) => {
    let entries: Entry[] = [], changed = true
    const add = (e: Entry) => {
      entries = [...entries, e].sort((a, b) => a.order - b.order); changed = true
      return () => { entries = entries.filter(x => x !== e); changed = true }
    }
    const reset = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height)
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0)
      for (const cap of [gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.DEPTH_TEST, gl.STENCIL_TEST]) gl.disable(cap)
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.colorMask(true, true, true, true)
    }
    const clear = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
    let raf = 0, drawn = ''
    const draw = () => {
      const now = performance.now(), w = fit(gl, canvas), v = view$.current, key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y}`
      const f: Frame = { now, view: v, clip: clip(v, canvas.clientWidth, canvas.clientHeight), width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight }
      // Every layer is asked, also after one is dirty: a layer can keep its state up to date in `dirty`.
      const done = paint(entries, f, changed || key !== drawn, reset, clear)
      if (done.drawn) { drawn = key; changed = false }
      // A layer that failed stays out, and frees its GL objects, until it is set up again; the frame after draws the map
      // without it.
      if (done.failed.length) {
        entries = entries.filter(e => !done.failed.includes(e)); changed = true
        for (const e of done.failed) { try { e.layer.dispose() } catch (err) { console.error(err) } }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    setMap({ gl, add, reset })
    return () => { cancelAnimationFrame(raf); setMap(undefined) }
  }, [])
  return <>
    <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
    <Ctx.Provider value={map}>{children}</Ctx.Provider>
  </>
}

/**
 * Adds a layer to the map at `order`, made by `setup` again when `deps` change and when the context comes back after a
 * loss. A layer that throws, in setup or later (a driver can reject GLSL that another accepts), leaves only this layer
 * empty.
 */
export function useLayer(order: number, setup: (gl: WebGL2RenderingContext) => Layer, deps: DependencyList) {
  const map = useContext(Ctx)
  useEffect(() => {
    if (!map) return
    let layer: Layer
    // A setup runs between frames, so it gets the same state as a draw, and leaves no VAO bound for the next layer.
    map.reset()
    try { layer = setup(map.gl) } catch (err) { console.error(err); return } finally { map.reset() }
    const remove = map.add({ order, layer })
    return () => { remove(); layer.dispose() }
  }, [map, order, ...deps])
}
