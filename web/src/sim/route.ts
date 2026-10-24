/** Shortest paths on a contracted graph whose edges carry their in-between points. */
export type GraphJson = { lon: number[]; lat: number[]; edges: [number, number, number, number[]][]; stations?: Record<string, number> }
export type Graph = {
  lon: Float64Array; lat: Float64Array
  start: Int32Array; to: Int32Array; w: Float64Array; edge: Int32Array; owner: Int32Array // adjacency (CSR); owner = node a slot belongs to
  geom: number[][]; from: Int32Array; end: Int32Array // per edge: in-between points (lon, lat, ...) listed from `from` to `end`
}

export const graphFrom = (j: GraphJson): Graph => {
  const n = j.lon.length, deg = new Int32Array(n + 1)
  for (const [a, b] of j.edges) { deg[a + 1]++; deg[b + 1]++ }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i]
  const fill = deg.slice(0, n), m = deg[n]
  const to = new Int32Array(m), w = new Float64Array(m), edge = new Int32Array(m), owner = new Int32Array(m)
  j.edges.forEach(([a, b, d], e) => {
    owner[fill[a]] = a; to[fill[a]] = b; w[fill[a]] = d; edge[fill[a]++] = e
    owner[fill[b]] = b; to[fill[b]] = a; w[fill[b]] = d; edge[fill[b]++] = e
  })
  return { lon: Float64Array.from(j.lon), lat: Float64Array.from(j.lat), start: deg, to, w, edge, owner,
    geom: j.edges.map(e => e[3]), from: Int32Array.from(j.edges.map(e => e[0])), end: Int32Array.from(j.edges.map(e => e[1])) }
}

/** FNV-1a over the whole graph (nodes, edge ends, weights, geometry), to tie data made from it to it. */
export const graphHash = (g: Graph) => {
  let h = 0x811c9dc5
  const add = (x: number) => { h = Math.imul(h ^ (Math.round(x) | 0), 0x01000193) >>> 0 }
  add(g.lon.length); add(g.geom.length)
  for (let v = 0; v < g.lon.length; v++) { add(g.lon[v] * 1e6); add(g.lat[v] * 1e6) }
  for (let e = 0; e < g.geom.length; e++) { add(g.from[e]); add(g.end[e]); for (const p of g.geom[e]) add(p * 1e6) }
  for (let k = 0; k < g.w.length; k++) add(g.w[k] * 1e3)
  return h
}

export const nearest = (g: Graph, lon: number, lat: number, ok: (v: number) => boolean = () => true) => {
  let best = -1, bd = Infinity
  const c = Math.cos(lat * Math.PI / 180)
  for (let v = 0; v < g.lon.length; v++) {
    const dx = (g.lon[v] - lon) * c, dy = g.lat[v] - lat, d = dx * dx + dy * dy
    if (d < bd && ok(v)) { bd = d; best = v }
  }
  return best
}

/** Dijkstra from src: distance to every node, and the adjacency slot each node was reached through (-1 if none). */
export const tree = (g: Graph, src: number) => {
  const n = g.lon.length, dist = new Float64Array(n).fill(Infinity), via = new Int32Array(n).fill(-1)
  const heap: number[] = [], key: number[] = []
  const push = (v: number, d: number) => {
    heap.push(v); key.push(d)
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1
      if (key[p] <= key[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; [key[p], key[i]] = [key[i], key[p]]; i = p
    }
  }
  const pop = () => {
    const v = heap[0], d = key[0], lv = heap.pop()!, lk = key.pop()!
    if (heap.length) {
      heap[0] = lv; key[0] = lk
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let s = i
        if (l < heap.length && key[l] < key[s]) s = l
        if (r < heap.length && key[r] < key[s]) s = r
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; [key[s], key[i]] = [key[i], key[s]]; i = s
      }
    }
    return [v, d]
  }
  dist[src] = 0; push(src, 0)
  while (heap.length) {
    const [u, d] = pop()
    if (d > dist[u]) continue
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const v = g.to[k], nd = d + g.w[k]
      if (nd < dist[v]) { dist[v] = nd; via[v] = k; push(v, nd) }
    }
  }
  return { via, dist }
}

/** Edge ids of the path from the tree's source to dst, in order. */
export const edgesTo = (g: Graph, via: Int32Array, dst: number): number[] => {
  const out: number[] = []
  for (let v = dst; via[v] >= 0; v = g.owner[via[v]]) out.push(g.edge[via[v]])
  return out.reverse()
}

/** Points (lon, lat, ...) along `edges` from node src, edge geometry included. */
export const pathAlong = (g: Graph, src: number, edges: ArrayLike<number>): number[] => {
  const out = [g.lon[src], g.lat[src]]
  let p = src
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k], pts = g.geom[e], forward = g.from[e] === p, q = forward ? g.end[e] : g.from[e]
    if (forward) for (let i = 0; i < pts.length; i += 2) out.push(pts[i], pts[i + 1])
    else for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1])
    out.push(g.lon[q], g.lat[q])
    p = q
  }
  return out
}

/** Points (lon, lat, ...) of the path from the tree's source to dst, edge geometry included. */
export const pathTo = (g: Graph, via: Int32Array, dst: number): number[] => {
  let src = dst
  while (via[src] >= 0) src = g.owner[via[src]]
  return pathAlong(g, src, edgesTo(g, via, dst))
}
