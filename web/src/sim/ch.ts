/**
 * A contraction hierarchy of the road graph (Geisberger et al., WEA 2008; REFERENCES.md, "Shortest
 * paths"). `contract` orders the nodes and adds a shortcut for each shortest path through a node it removes; a query
 * searches up the order from both ends, and each shortcut unpacks into its two arcs, down to the edges of the graph.
 * The paths are exact shortest paths, and any pair of nodes can be queried.
 */
import type { Graph } from './route.ts'

/**
 * The arcs of one weighting: first every slot of the graph with a finite weight (in slot order, so the script and the
 * page number them the same), then the shortcuts, each made of two arcs before it.
 */
export type Hierarchy = {
  rank: Uint16Array
  from: Int32Array; to: Int32Array; w: Float64Array; edge: Int32Array; left: Int32Array; right: Int32Array // edge -1 and left, right for a shortcut
  upStart: Int32Array; up: Int32Array // per node, the arcs out of it to a higher rank
  downStart: Int32Array; down: Int32Array // per node, the arcs into it from a higher rank
}

class Heap {
  v: number[] = []; k: number[] = []
  get size() { return this.v.length }
  push(v: number, k: number) {
    const { v: vs, k: ks } = this
    vs.push(v); ks.push(k)
    for (let i = vs.length - 1; i > 0;) {
      const p = (i - 1) >> 1
      if (ks[p] <= ks[i]) break
      this.swap(p, i); i = p
    }
  }
  swap(a: number, b: number) { const { v, k } = this; [v[a], v[b]] = [v[b], v[a]]; [k[a], k[b]] = [k[b], k[a]] }
  /** Removes the least; its node is `top` and its key `key` before the call. */
  pop() {
    const { v, k } = this, lv = v.pop()!, lk = k.pop()!
    if (!v.length) return
    v[0] = lv; k[0] = lk
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1
      let s = i
      if (l < v.length && k[l] < k[s]) s = l
      if (r < v.length && k[r] < k[s]) s = r
      if (s === i) break
      this.swap(s, i); i = s
    }
  }
  get top() { return this.v[0] }
  get key() { return this.k[0] }
}

const originals = (g: Graph, slotW: ArrayLike<number>) => {
  const slots: number[] = []
  for (let k = 0; k < slotW.length; k++) if (Number.isFinite(slotW[k]) && g.owner[k] !== g.to[k]) slots.push(k)
  return slots
}

// ponytail: a witness search settles at most this many nodes. A search cut short adds a shortcut that a longer one
// would have found unneeded: the paths stay exact, the file grows (all three weightings about 1 MB at 200, 2026-10-27).
const WITNESS_LIMIT = 200

/** The node order and the shortcuts, as [left arc, right arc] pairs in the order they were added. For scripts/routes.ts. */
export const contract = (g: Graph, slotW: ArrayLike<number>) => {
  const n = g.lon.length, from: number[] = [], to: number[] = [], w: number[] = [], shortcuts: number[] = []
  const out: number[][] = Array.from({ length: n }, () => []), into: number[][] = Array.from({ length: n }, () => [])
  const add = (a: number, b: number, d: number) => { out[a].push(from.length); into[b].push(from.length); from.push(a); to.push(b); w.push(d) }
  for (const k of originals(g, slotW)) add(g.owner[k], g.to[k], slotW[k])
  const done = new Uint8Array(n), rank = new Uint16Array(n), removed = new Int32Array(n)
  const dist = new Float64Array(n).fill(Infinity), touched: number[] = []
  const witness = (u: number, skip: number, max: number) => {
    for (const t of touched) dist[t] = Infinity
    touched.length = 0
    const h = new Heap()
    dist[u] = 0; touched.push(u); h.push(u, 0)
    for (let settled = 0; h.size && settled < WITNESS_LIMIT; settled++) {
      const x = h.top, d = h.key
      h.pop()
      if (d > dist[x]) continue
      if (d > max) break
      for (const a of out[x]) {
        const y = to[a], nd = d + w[a]
        if (done[y] || y === skip || nd >= dist[y]) continue
        if (dist[y] === Infinity) touched.push(y)
        dist[y] = nd; h.push(y, nd)
      }
    }
  }
  // The shortcuts that removing v needs, as [arc into v, arc out of v], with the cheapest arc for each neighbour.
  const needed = (v: number) => {
    const ins = new Map<number, number>(), outs = new Map<number, number>()
    const cheapest = (map: Map<number, number>, u: number, a: number) => {
      const was = map.get(u)
      if (!done[u] && (was === undefined || w[a] < w[was])) map.set(u, a)
    }
    for (const a of into[v]) cheapest(ins, from[a], a)
    for (const a of out[v]) cheapest(outs, to[a], a)
    let longest = 0
    for (const a of outs.values()) longest = Math.max(longest, w[a])
    const pairs: [number, number][] = []
    for (const [u, ai] of ins) {
      witness(u, v, w[ai] + longest)
      for (const [x, ao] of outs) if (x !== u && dist[x] > w[ai] + w[ao]) pairs.push([ai, ao])
    }
    return { pairs, degree: ins.size + outs.size }
  }
  // The edge difference with the removed neighbours, a common priority (REFERENCES.md); updated lazily.
  const priority = (v: number) => { const { pairs, degree } = needed(v); return pairs.length - degree + removed[v] }
  const queue = new Heap()
  for (let v = 0; v < n; v++) queue.push(v, priority(v))
  for (let r = 0; queue.size;) {
    const v = queue.top
    queue.pop()
    const p = priority(v)
    if (queue.size && p > queue.key) { queue.push(v, p); continue }
    for (const [ai, ao] of needed(v).pairs) { shortcuts.push(ai, ao); add(from[ai], to[ao], w[ai] + w[ao]) }
    done[v] = 1; rank[v] = r++
    for (const a of out[v]) removed[to[a]]++
    for (const a of into[v]) removed[from[a]]++
  }
  return { rank, shortcuts: Uint32Array.from(shortcuts) }
}

const csr = (n: number, arcs: number[], node: (a: number) => number) => {
  const start = new Int32Array(n + 1), list = new Int32Array(arcs.length)
  for (const a of arcs) start[node(a) + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const fill = start.slice(0, n)
  for (const a of arcs) list[fill[node(a)]++] = a
  return { start, list }
}

/** The hierarchy that `contract` made, rebuilt from the graph, its weighting, the order and the shortcuts. */
export const hierarchyOf = (g: Graph, slotW: ArrayLike<number>, rank: Uint16Array, shortcuts: Uint32Array): Hierarchy => {
  const slots = originals(g, slotW), m = slots.length + shortcuts.length / 2, n = g.lon.length
  const from = new Int32Array(m), to = new Int32Array(m), w = new Float64Array(m), edge = new Int32Array(m).fill(-1)
  const left = new Int32Array(m).fill(-1), right = new Int32Array(m).fill(-1)
  slots.forEach((k, a) => { from[a] = g.owner[k]; to[a] = g.to[k]; w[a] = slotW[k]; edge[a] = g.edge[k] })
  for (let s = 0, a = slots.length; s < shortcuts.length; s += 2, a++) {
    const l = shortcuts[s], r = shortcuts[s + 1]
    if (l >= a || r >= a) throw new Error('a shortcut refers to a later arc')
    left[a] = l; right[a] = r; from[a] = from[l]; to[a] = to[r]; w[a] = w[l] + w[r]
  }
  const all = Array.from({ length: m }, (_, a) => a)
  const up = csr(n, all.filter(a => rank[to[a]] > rank[from[a]]), a => from[a])
  const down = csr(n, all.filter(a => rank[from[a]] > rank[to[a]]), a => to[a])
  return { rank, from, to, w, edge, left, right, upStart: up.start, up: up.list, downStart: down.start, down: down.list }
}

/**
 * The nodes that a search up the order reaches from one node (nodes[0]), with their distance, the arc that reached
 * each, and the index in nodes of the node that arc came from (-1 for nodes[0]).
 */
export type Space = { nodes: Int32Array; dist: Float64Array; arc: Int32Array; prev: Int32Array }

/**
 * Searches of one hierarchy, on scratch arrays that each search clears after it. A node that a higher node reaches by
 * a shorter way is stalled (Geisberger et al. 2008, "stall-on-demand"): its arcs are not searched. Its distance can be
 * too long, so it is never the best meeting node; the paths stay exact (paths.test.ts).
 */
export const searcher = (h: Hierarchy) => {
  const n = h.rank.length, dist = new Float64Array(n).fill(Infinity), arc = new Int32Array(n), pos = new Int32Array(n)
  const seen = new Int32Array(n), heap = new Heap()
  /** forward: along the arcs up from src; else back along the arcs into src from above. */
  return (src: number, forward: boolean): Space => {
    const start = forward ? h.upStart : h.downStart, list = forward ? h.up : h.down, end = forward ? h.to : h.from
    // The arcs between a node and the nodes above it, the other way: a shorter way to the node from above stalls it.
    const otherStart = forward ? h.downStart : h.upStart, other = forward ? h.down : h.up, near = forward ? h.from : h.to
    let count = 1
    seen[0] = src; dist[src] = 0; arc[src] = -1; pos[src] = 0; heap.push(src, 0)
    while (heap.size) {
      const x = heap.top, d = heap.key
      heap.pop()
      if (d > dist[x]) continue
      let stalled = false
      for (let k = otherStart[x]; k < otherStart[x + 1] && !stalled; k++) stalled = dist[near[other[k]]] + h.w[other[k]] < d
      if (stalled) continue
      for (let k = start[x]; k < start[x + 1]; k++) {
        const a = list[k], y = end[a], nd = d + h.w[a]
        if (nd >= dist[y]) continue
        if (dist[y] === Infinity) { pos[y] = count; seen[count++] = y }
        dist[y] = nd; arc[y] = a; heap.push(y, nd)
      }
    }
    const back = forward ? h.from : h.to, nodes = seen.slice(0, count), out: Space = {
      nodes, dist: new Float64Array(count), arc: new Int32Array(count), prev: new Int32Array(count) }
    for (let i = 0; i < count; i++) {
      const x = nodes[i]
      out.dist[i] = dist[x]; out.arc[i] = arc[x]; out.prev[i] = arc[x] < 0 ? -1 : pos[back[arc[x]]]
      dist[x] = Infinity
    }
    return out
  }
}

const unpack = (h: Hierarchy, a: number, out: number[]) => {
  const stack = [a]
  while (stack.length) {
    const x = stack.pop()!
    if (h.edge[x] >= 0) out.push(h.edge[x])
    else stack.push(h.right[x], h.left[x])
  }
}

/**
 * Writes the forward space f into dense arrays, for `join` with many backward spaces; `clear` undoes it.
 */
export const dense = (n: number) => {
  const dist = new Float64Array(n).fill(Infinity), index = new Int32Array(n)
  return {
    dist, index,
    set: (f: Space) => f.nodes.forEach((x, i) => { dist[x] = f.dist[i]; index[x] = i }),
    clear: (f: Space) => f.nodes.forEach(x => (dist[x] = Infinity)),
  }
}

/**
 * The edges of the shortest path from the source of f to the target of b (b searched backward), or undefined when
 * the two searches do not meet. f must be set in d (dense).
 */
export const join = (h: Hierarchy, f: Space, d: ReturnType<typeof dense>, b: Space) => {
  let best = Infinity, fi = -1, bi = -1
  for (let j = 0; j < b.nodes.length; j++) {
    const x = b.nodes[j], cost = d.dist[x] + b.dist[j]
    if (cost < best) { best = cost; fi = d.index[x]; bi = j }
  }
  if (fi < 0) return undefined
  const ups: number[] = [], out: number[] = []
  for (let i = fi; i > 0; i = f.prev[i]) ups.push(f.arc[i])
  for (let k = ups.length - 1; k >= 0; k--) unpack(h, ups[k], out)
  for (let j = bi; j > 0; j = b.prev[j]) unpack(h, b.arc[j], out)
  return out
}
