import { useEffect, useState, type DependencyList, type RefObject } from 'react'

/** A linked program, or an error that names the failing stage (a driver can reject GLSL that another accepts). */
export const program = (gl: WebGL2RenderingContext, vs: string, fs: string) => {
  const p = gl.createProgram()!
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    gl.attachShader(p, s); gl.deleteShader(s)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  return p
}

/**
 * Runs `setup` with the canvas's WebGL2 context, again when `deps` change, and again when the system
 * gives back a context it took (iOS does this for a tab in the background). The cleanup that `setup`
 * returns must delete its GL objects and stop its frame loop. It must not lose the context: the next run
 * gets the same context from the same canvas, so a lost one would stay blank. Only an unmount loses it.
 * Without WebGL2, or when setup throws, the layer stays empty.
 */
export function useWebGL2(ref: RefObject<HTMLCanvasElement>, options: WebGLContextAttributes,
  setup: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => () => void, deps: DependencyList) {
  // A loss stops the old run while the context is lost (its GL calls do nothing then); a restore starts a new one.
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const canvas = ref.current!
    const onLost = (e: Event) => { e.preventDefault(); setGeneration(n => n + 1) } // preventDefault asks for a restore
    const onRestored = () => setGeneration(n => n + 1)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored)
      // Free the context at once: browsers keep about 16, and when there are more they take the oldest, and a canvas
      // mounted and unmounted many times would leave the map blank.
      // A lost context holds nothing to free. The extension is fetched now, because the spec asks for
      // extensions to be fetched again after a restore.
      const gl = canvas.getContext('webgl2', options)
      if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])
  useEffect(() => {
    const canvas = ref.current!, gl = canvas.getContext('webgl2', options)
    if (!gl || gl.isContextLost()) return
    // A shader the driver rejects, or a context lost during setup, leaves this layer empty, not the page.
    try { return setup(gl, canvas) } catch (err) { console.error(err) }
  }, [...deps, generation])
}

/** Sizes the drawing buffer to the canvas's CSS size in device pixels; returns the width. */
export const fit = (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => {
  const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio)
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h) }
  return w
}
