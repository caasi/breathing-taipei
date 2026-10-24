/** Map space (the 640 x 640 square of `projectionFor`) to CSS pixels: screen = k * map + (x, y). Zoom and pan change only this. */
export type View = { k: number; x: number; y: number }

export const MAP_SIZE = 640
// The event and policy dashboard sits on the right, over the map; the map fits in the rest.
export const DASHBOARD_WIDTH = 360

// ponytail: desktop layout only; mobile (map on top or left, 4:3) is the next step.
export const viewFor = (width: number, height: number): View => {
  const free = width - DASHBOARD_WIDTH, k = Math.min(free, height) / MAP_SIZE
  return { k, x: (free - MAP_SIZE * k) / 2, y: (height - MAP_SIZE * k) / 2 }
}

/** The same transform in clip space, for a canvas of width x height CSS pixels: clip = map * (sx, sy) + (tx, ty). */
export const clip = ({ k, x, y }: View, width: number, height: number) =>
  [2 * k / width, -2 * k / height, 2 * x / width - 1, 1 - 2 * y / height]

export const svgTransform = ({ k, x, y }: View) => `matrix(${k} 0 0 ${k} ${x} ${y})`

export const sameView = (a: View, b: View) => a.k === b.k && a.x === b.x && a.y === b.y
