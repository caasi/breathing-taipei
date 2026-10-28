// Lines thinner than a pixel cannot be drawn by rasterising their width. So each segment is a quad one device pixel
// wider than the line on each side, and the fragment shader gives each pixel the share of it that the line covers.
// Traffic.tsx and the border layer draw their lines this way.

/**
 * Two triangles per segment of every line (lon, lat, ...), in map space, with the unit normal, the side (+1 or -1), the
 * index of the line and the map units from its start.
 */
export const quads = (lines: number[][], proj: (lonlat: [number, number]) => [number, number] | null) => {
  const xy: number[] = [], normal: number[] = [], across: number[] = [], edge: number[] = [], along: number[] = []
  lines.forEach((lonlat, e) => {
    const pts: [number, number][] = []
    for (let i = 0; i < lonlat.length; i += 2) pts.push(proj([lonlat[i], lonlat[i + 1]])!)
    let run = 0 // map units from the start of the edge
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0)
      if (!l) continue
      const nx = -(y1 - y0) / l, ny = (x1 - x0) / l
      for (const [x, y, s, r] of [[x0, y0, 1, 0], [x0, y0, -1, 0], [x1, y1, 1, l], [x1, y1, 1, l], [x0, y0, -1, 0], [x1, y1, -1, l]]) {
        xy.push(x, y); normal.push(nx * s, ny * s); across.push(s); edge.push(e); along.push(run + r)
      }
      run += l
    }
  })
  const f = (a: number[]) => new Float32Array(a)
  return { xy: f(xy), normal: f(normal), across: f(across), edge: f(edge), along: f(along) }
}

/**
 * GLSL that defines `float coverOf(float d, float w)`: the share of a pixel at `d` device pixels across the line that a
 * line `w` device pixels wide covers. It is the overlap of [|d| - 0.5, |d| + 0.5] with [-w / 2, w / 2].
 */
export const COVER = `
float coverOf(float d, float w) {
  float a = abs(d);
  return max(0.0, min(a + 0.5, w * 0.5) - max(a - 0.5, -w * 0.5));
}`

/**
 * Like `quads`, but each line is one strip, as an SVG stroke is: the two segments at a corner meet on the miter of the
 * corner, so a line with opacity is not darker at its corners, and the outer side of a corner has no notch. A ring
 * whose last point is its first is closed, and its first corner is a corner too. `normal` is the offset of the edge of
 * the strip for a half width of 1.
 * As in SVG, a corner whose miter is longer than `limit` half widths gets a bevel: both segments end square, and one
 * triangle from the corner fills the outer side. A point nearer than `gap` map units to the point before is left out,
 * so that a short segment does not fold the strip: give half the width of the line.
 * Limits: the inner side of a bevel, and a segment that is shorter than the inner offsets of its two miters, still
 * overlap, and alpha there is applied twice.
 */
export const strips = (lines: number[][], proj: (lonlat: [number, number]) => [number, number] | null,
  { gap = 0, limit = 4 } = {}) => {
  const xy: number[] = [], normal: number[] = [], across: number[] = [], along: number[] = []
  const vertex = (p: [number, number], n: number[], s: number, r: number) => {
    xy.push(...p); normal.push(n[0] * s, n[1] * s); across.push(s); along.push(r)
  }
  for (const lonlat of lines) {
    const all: [number, number][] = []
    for (let i = 0; i < lonlat.length; i += 2) all.push(proj([lonlat[i], lonlat[i + 1]])!)
    const first = all[0], last = all[all.length - 1]
    const closed = all.length > 3 && first[0] === last[0] && first[1] === last[1]
    const pts: [number, number][] = []
    for (const p of closed ? all.slice(0, -1) : all) {
      const q = pts[pts.length - 1]
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > gap && (p[0] !== q[0] || p[1] !== q[1])) pts.push(p)
    }
    // The wrap from the last point back to the first is a segment too; some rings repeat their closing point.
    while (closed && pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) <= gap) pts.pop()
    const n = pts.length
    if (n < 2 || closed && n < 3) continue
    // The unit normal of the segment from point i to the next one.
    const side = (i: number) => {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, y1 - y0)
      return [-(y1 - y0) / l, (x1 - x0) / l]
    }
    // At each point: the miter, or the two normals of a bevel and the side (+1 or -1) of its outer half.
    const corners = pts.map((_, i) => {
      const before = closed || i > 0 ? side((i - 1 + n) % n) : undefined, after = closed || i < n - 1 ? side(i) : undefined
      if (!before || !after) return { miter: (before ?? after)! }
      const mx = before[0] + after[0], my = before[1] + after[1], m = Math.hypot(mx, my)
      const cos = m && (mx * after[0] + my * after[1]) / m
      if (cos * limit < 1) return { before, after, outer: before[0] * after[1] - before[1] * after[0] > 0 ? -1 : 1 }
      return { miter: [mx / m / cos, my / m / cos] }
    })
    let run = 0 // map units from the start of the line
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n, l = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]), own = side(i)
      const a = corners[i].miter ?? own, b = corners[j].miter ?? own
      for (const [k, s, r] of [[i, 1, 0], [i, -1, 0], [j, 1, l], [j, 1, l], [i, -1, 0], [j, -1, l]] as const)
        vertex(pts[k], k === i ? a : b, s, run + r)
      if (corners[j].before) {
        const { before, after, outer } = corners[j]
        // A turn back (outer 1 with parallel normals) has no outer side to fill; its triangle has no area.
        vertex(pts[j], [0, 0], 0, run + l); vertex(pts[j], before!, outer!, run + l); vertex(pts[j], after!, outer!, run + l)
      }
      run += l
    }
  }
  const f = (a: number[]) => new Float32Array(a)
  return { xy: f(xy), normal: f(normal), across: f(across), along: f(along) }
}

/**
 * GLSL that defines `float dashCover(float s, vec2 dash, float pxPerUnit)`: the share of a pixel at `s` map units along
 * the line that dashes of `dash.x` on and `dash.y` off cover, over the length of one device pixel along the line (a box
 * filter), so a dash shorter than a pixel still averages to the right tone. A `dash.y` of 0 is a solid line.
 */
export const DASHED = `
// The length of dash from the start of the line to s: whole periods, then the part of the last one.
float dashed(float s, vec2 dash) {
  float p = dash.x + dash.y;
  return floor(s / p) * dash.x + min(mod(s, p), dash.x);
}
float dashCover(float s, vec2 dash, float pxPerUnit) {
  if (dash.y <= 0.0) return 1.0;
  float h = 0.5 / pxPerUnit;
  return (dashed(s + h, dash) - dashed(s - h, dash)) / (2.0 * h);
}`

/** A colour `#rrggbb` as three numbers from 0 to 1. */
export const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
