/** Map space (the 640 x 640 square of `projectionFor`) to CSS pixels: screen = k * map + (x, y). Zoom and pan change only this. */
export type View = { k: number; x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
/** Where the map layers sit on the page (`box`), and the part of the box the map fits in (`fit`, in box pixels). */
export type Layout = { kind: 'desktop' | 'portrait' | 'landscape'; box: Rect; fit: Rect; view: View }

export const MAP_SIZE = 640
// The event and policy dashboard sits on the right, over the map; the map fits in the rest.
export const DASHBOARD_WIDTH = 360
// Below 1 the fitted square shrinks, so more of 新北 around it shows; the user chose this by eye.
const ZOOM = 0.8
// ponytail: phones told apart by size alone; iPhone landscape is at most 440 px high. Use a pointer media query if tablets land wrong.
const PHONE_LANDSCAPE_HEIGHT = 500

const fitIn = (r: Rect): View => {
  const k = ZOOM * Math.min(r.w, r.h) / MAP_SIZE
  return { k, x: r.x + (r.w - MAP_SIZE * k) / 2, y: r.y + (r.h - MAP_SIZE * k) / 2 }
}

export const layoutFor = (w: number, h: number): Layout => {
  const at = (kind: Layout['kind'], box: Rect, fit: Rect = { ...box, x: 0, y: 0 }) => ({ kind, box, fit, view: fitIn(fit) })
  if (h > w) return at('portrait', { x: 0, y: 0, w, h: w * 3 / 4 })
  if (h < PHONE_LANDSCAPE_HEIGHT) return at('landscape', { x: 0, y: 0, w: h * 4 / 3, h })
  return at('desktop', { x: 0, y: 0, w, h }, { x: 0, y: 0, w: w - DASHBOARD_WIDTH, h })
}

/** The same transform in clip space, for a canvas of width x height CSS pixels: clip = map * (sx, sy) + (tx, ty). */
export const clip = ({ k, x, y }: View, width: number, height: number) =>
  [2 * k / width, -2 * k / height, 2 * x / width - 1, 1 - 2 * y / height]

export const svgTransform = ({ k, x, y }: View) => `matrix(${k} 0 0 ${k} ${x} ${y})`
