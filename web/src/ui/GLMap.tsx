import { createContext, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react'
import { gaussian } from './blur.ts'
import { fit, useWebGL2 } from './gl.ts'
import { clip, type View } from './view.ts'

/**
 * What a layer gets for each frame. `clip` maps map space to clip space (view.ts). `target` is the framebuffer that the
 * layer draws on: the canvas, or the texture of the map while it fades in.
 */
export type Frame = { now: number; view: View; clip: number[]; width: number; height: number; cssWidth: number; cssHeight: number; target: WebGLFramebuffer | null }

/**
 * One layer of the map. When any layer is dirty, or the view or the size changes, the map clears the canvas and draws
 * every layer in order. So `draw` must draw the whole layer.
 * The setup of a layer and each `draw` start from the same GL state (`reset` in GLMap): the framebuffer `target` and the
 * full viewport, no VAO, texture unit 0, no blend, face culling, scissor, depth or stencil test, the blend function
 * (ONE, ONE_MINUS_SRC_ALPHA), and all colour channels written. Only this state is set: a layer can change any of it,
 * and sets what else it needs (the pixel store, for example); the map sets the listed state back before the next layer.
 * A layer that binds its own framebuffer binds `target` again to draw on the map. A layer must not clear `target`: the
 * map clears it once, and a clear in a layer erases the layers under it.
 * A layer over another one writes premultiplied colour, and enables blend with the function of the baseline. That is
 * how the browser composited each WebGL canvas over the one under it, so a layer that had its own canvas keeps its look
 * only with this blend. The context has antialias on, which a layer that had `antialias: false` did not have: compare a screenshot
 * before and after the move.
 * `dispose` can run twice: when the layer fails, and again when its component cleans up. Deleting a GL object twice does
 * nothing, so a dispose that only deletes is safe.
 */
export type Layer = { dirty: (f: Frame) => boolean; draw: (f: Frame) => void; dispose: () => void }

/** The order of the layers, from the bottom. One list, so that a new layer finds its place among all the others. */
export const LAYER = { fills: 0, borders: 1, rails: 2, stations: 3, traffic: 4, labels: 5 } as const

/** How far the map has faded in: its opacity, and its blur in CSS pixels, as CSS `filter: blur()`. */
export type Reveal = { opacity: number; blur: number }
const CLEAR: Reveal = { opacity: 1, blur: 0 }
// The time of a change of `reveal`, as the CSS transition of the map had; none with reduced motion.
const REVEAL_MS = 600
/** CSS `ease`, cubic-bezier(0.25, 0.1, 0.25, 1), the curve of the transition before, which the dots still fade with. */
export const ease = (x: number) => {
  // 0 and 1 exactly, so that a fade ends on its aim and the map draws straight on the canvas again.
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bezier = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  let lo = 0, hi = 1
  for (let i = 0; i < 30; i++) { const t = (lo + hi) / 2; if (bezier(0.25, 0.25, t) < x) lo = t; else hi = t }
  return bezier(0.1, 1, (lo + hi) / 2)
}

type Entry = { order: number; layer: Layer }
type MapCtx = { gl: WebGL2RenderingContext; add: (e: Entry) => () => void; reset: () => void }
const Ctx = createContext<MapCtx | undefined>(undefined)

/**
 * One frame: asks every layer whether it is dirty, and when one is (or `force`), clears and draws every layer in order,
 * with `reset` before the clear and before each layer. A layer that throws is returned in `failed` and draws no more in
 * this frame, so that one bad layer does not stop the map.
 * With `group`, the layers from the order `group.from` up draw between `group.begin` and `group.end`; with
 * `group.hide`, they do not draw.
 */
export const paint = (entries: Entry[], f: Frame, force: boolean, reset: () => void, clear: () => void,
  group?: { from: number; hide?: boolean; begin: () => void; end: () => void }) => {
  const failed: Entry[] = []
  const run = (e: Entry, step: () => unknown) => {
    try { return step() } catch (err) { console.error(err); failed.push(e) }
  }
  const dirty = entries.map(e => run(e, () => e.layer.dirty(f))).some(Boolean)
  if (!dirty && !force) return { drawn: false, failed }
  reset(); clear()
  let grouped = false
  for (const e of entries) {
    if (group && !grouped && e.order >= group.from) { grouped = true; if (!group.hide) group.begin() }
    if (failed.includes(e) || (grouped && group!.hide)) continue
    reset(); run(e, () => e.layer.draw(f))
  }
  if (grouped && !group!.hide) group!.end()
  return { drawn: true, failed }
}

/**
 * The one WebGL canvas of the map. Layers are components under it that call `useLayer`; they draw in `order`, the lowest
 * first. The canvas is mounted once: an unmount loses its context (gl.ts), and then every layer stays blank.
 * `reveal` fades the layers from the fills up, as one picture: while it is not clear, they draw into a texture, which
 * goes onto the canvas blurred and faded. A change of `reveal` moves to it over REVEAL_MS.
 */
export function GLMap({ view, reveal = CLEAR, children }: { view: View; reveal?: Reveal; children: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const view$ = useRef(view), reveal$ = useRef(reveal)
  view$.current = view; reveal$.current = reveal
  const [map, setMap] = useState<MapCtx>()
  useWebGL2(ref, { antialias: true }, (gl, canvas) => {
    let entries: Entry[] = [], changed = true
    const add = (e: Entry) => {
      entries = [...entries, e].sort((a, b) => a.order - b.order); changed = true
      return () => { entries = entries.filter(x => x !== e); changed = true }
    }
    // The texture of the map while it fades in; `target` is where the layers draw now. The layers draw into a
    // multisampled buffer, as the canvas has antialias on, which goes into the texture before the blur: without it the
    // edges are jagged at the end of the fade, and smooth again at once when the map draws on the canvas.
    // A blur that the driver rejects leaves the map without its fade, not blank.
    let blur: ReturnType<typeof gaussian> | undefined
    try { blur = gaussian(gl) } catch (err) { console.error(err) }
    const frame = gl.createFramebuffer(), samples = gl.createRenderbuffer(), sampled = gl.createFramebuffer()
    const pictureOf = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      for (const [k, v] of [[gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
        gl.texParameteri(gl.TEXTURE_2D, k, v)
      gl.bindTexture(gl.TEXTURE_2D, null)
      return t
    }
    let picture = pictureOf()
    gl.bindFramebuffer(gl.FRAMEBUFFER, sampled)
    gl.bindRenderbuffer(gl.RENDERBUFFER, samples)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, samples)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const sampleCount = Math.min(4, gl.getParameter(gl.MAX_SAMPLES))
    let target: WebGLFramebuffer | null = null, pictureSize = ''
    let from = { ...reveal$.current }, shown = { ...reveal$.current }, aim = reveal$.current, start = -Infinity
    const reset = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.viewport(0, 0, canvas.width, canvas.height)
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0)
      for (const cap of [gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.DEPTH_TEST, gl.STENCIL_TEST]) gl.disable(cap)
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.colorMask(true, true, true, true)
    }
    const clear = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
    const group = {
      from: LAYER.fills, hide: false,
      begin: () => {
        // The levels of the mip chain go with the size, so a new size makes the texture again.
        if (pictureSize !== `${canvas.width} ${canvas.height}`) {
          gl.bindTexture(gl.TEXTURE_2D, picture)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
          gl.bindTexture(gl.TEXTURE_2D, null)
          gl.bindRenderbuffer(gl.RENDERBUFFER, samples)
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, sampleCount, gl.RGBA8, canvas.width, canvas.height)
          pictureSize = `${canvas.width} ${canvas.height}`
        }
        target = sampled; reset(); clear()
      },
      end: () => {
        // The state that the last layer left, a scissor for example, would cut the blit.
        reset()
        gl.bindFramebuffer(gl.FRAMEBUFFER, frame)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, picture, 0)
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sampled)
        gl.blitFramebuffer(0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
        // Attached only for the blit: a framebuffer that is not bound keeps a deleted texture alive.
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0)
        target = null; reset()
        blur!.run(picture!, canvas.width, canvas.height, shown.blur * canvas.width / Math.max(1, canvas.clientWidth), shown.opacity, null)
      },
    }
    let raf = 0, drawn = ''
    const draw = () => {
      // The next frame first, and the canvas as the target: a throw in the fade must not stop the map.
      raf = requestAnimationFrame(draw); target = null
      const now = performance.now(), w = fit(gl, canvas), v = view$.current
      if (reveal$.current.opacity !== aim.opacity || reveal$.current.blur !== aim.blur) {
        aim = reveal$.current; from = { ...shown }
        start = matchMedia('(prefers-reduced-motion: reduce)').matches ? -Infinity : now
      }
      const t = ease(Math.min(1, (now - start) / REVEAL_MS))
      shown = { opacity: from.opacity + (aim.opacity - from.opacity) * t, blur: from.blur + (aim.blur - from.blur) * t }
      const key = `${w} ${canvas.height} ${v.k} ${v.x} ${v.y} ${shown.opacity} ${shown.blur}`
      const f: Frame = { now, view: v, clip: clip(v, canvas.clientWidth, canvas.clientHeight), width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, target: null }
      // A clear map draws straight on the canvas; only a fade pays for the texture and the blur.
      const fading = shown.opacity !== 1 || shown.blur !== 0
      group.hide = shown.opacity === 0
      // Every layer is asked, also after one is dirty: a layer can keep its state up to date in `dirty`.
      const done = paint(entries, f, changed || key !== drawn, () => { f.target = target; reset() }, clear, fading && (blur || group.hide) ? group : undefined)
      // The fade runs once for each page, so its textures go when it ends.
      if (!fading && pictureSize) {
        // A new texture: a smaller level 0 would keep the other levels of the mip chain.
        reset(); gl.deleteTexture(picture); picture = pictureOf()
        gl.bindRenderbuffer(gl.RENDERBUFFER, samples); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, sampleCount, gl.RGBA8, 1, 1)
        pictureSize = ''; blur?.free()
      }
      if (done.drawn) { drawn = key; changed = false }
      // A layer that failed stays out, and frees its GL objects, until it is set up again; the frame after draws the map
      // without it.
      if (done.failed.length) {
        entries = entries.filter(e => !done.failed.includes(e)); changed = true
        for (const e of done.failed) { try { e.layer.dispose() } catch (err) { console.error(err) } }
      }
    }
    raf = requestAnimationFrame(draw)
    setMap({ gl, add, reset })
    return () => { cancelAnimationFrame(raf); setMap(undefined); blur?.dispose(); gl.deleteTexture(picture); gl.deleteFramebuffer(frame); gl.deleteRenderbuffer(samples); gl.deleteFramebuffer(sampled) }
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
