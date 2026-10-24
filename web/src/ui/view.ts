/** Map space (the 640 x 640 square of `projectionFor`) to CSS pixels: screen = k * map + (x, y). Zoom and pan change only this. */
export type View = { k: number; x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
/** Where the map layers sit on the page (`box`), and the part of the box the map fits in (`fit`, in box pixels). */
export type Layout = { kind: 'desktop' | 'portrait' | 'landscape'; box: Rect; fit: Rect; view: View }

export const MAP_SIZE = 640
// The event and policy panels sit side by side on the right, over the map; the map fits in the rest.
export const PANEL = { gap: 16, events: 300, policies: 280 }
export const DASHBOARD_WIDTH = PANEL.events + PANEL.policies + 3 * PANEL.gap
// Below 1 the fitted area shrinks, so more of 新北 around it shows; the user chose these by eye.
// A desktop fits the whole map square; a phone's box is small, so it fits 台北市 alone.
const ZOOM = { desktop: 0.8, portrait: 1, landscape: 1 }
const SQUARE: Rect = { x: 0, y: 0, w: MAP_SIZE, h: MAP_SIZE }
// ponytail: the layout follows the window shape alone. Every portrait window (also an iPad) gets the phone portrait
// layout, and a landscape window whose map would be narrower than a 3:4 box beside the panels (an iPhone, an iPad,
// a small desktop window) gets the landscape layout. Add a tablet layout if these look wrong on a device.

/** Fits `focus` (map space) into `r` (pixels), centred. */
export const fitIn = (focus: Rect, r: Rect, zoom: number): View => {
  const k = zoom * Math.min(r.w / focus.w, r.h / focus.h)
  return { k, x: r.x + r.w / 2 - k * (focus.x + focus.w / 2), y: r.y + r.h / 2 - k * (focus.y + focus.h / 2) }
}

export const layoutFor = (w: number, h: number, taipei: Rect = SQUARE): Layout => {
  const at = (kind: Layout['kind'], box: Rect, fit: Rect = { ...box, x: 0, y: 0 }) =>
    ({ kind, box, fit, view: fitIn(kind === 'desktop' ? SQUARE : taipei, fit, ZOOM[kind]) })
  if (h > w) return at('portrait', { x: 0, y: 0, w, h: w * 3 / 4 })
  if (w - DASHBOARD_WIDTH < h * 3 / 4) return at('landscape', { x: 0, y: 0, w: h * 3 / 4, h })
  return at('desktop', { x: 0, y: 0, w, h }, { x: 0, y: 0, w: w - DASHBOARD_WIDTH, h })
}

/** The same transform in clip space, for a canvas of width x height CSS pixels: clip = map * (sx, sy) + (tx, ty). */
export const clip = ({ k, x, y }: View, width: number, height: number) =>
  [2 * k / width, -2 * k / height, 2 * x / width - 1, 1 - 2 * y / height]

export const svgTransform = ({ k, x, y }: View) => `matrix(${k} 0 0 ${k} ${x} ${y})`
