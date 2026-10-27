import { expect, test } from 'vitest'
import fc from 'fast-check'
import { freeTime, graphFrom, graphHash, tree, pathTo, SIGNAL, type GraphJson } from './route.ts'

// Random connected-or-not graphs of 2-12 nodes; some edges carry in-between points.
const graphArb = fc.integer({ min: 2, max: 12 }).chain(n => fc.record({
  lon: fc.array(fc.double({ min: 121, max: 122, noNaN: true }), { minLength: n, maxLength: n }),
  lat: fc.array(fc.double({ min: 25, max: 26, noNaN: true }), { minLength: n, maxLength: n }),
  edges: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1), fc.integer({ min: 1, max: 100 }),
    fc.array(fc.double({ min: 121, max: 122, noNaN: true }), { maxLength: 3 }).map(xs => xs.flatMap(x => [x, 25.5])))),
}).map((j): GraphJson => ({ ...j, edges: j.edges.filter(([a, b]) => a !== b) })))

test('Dijkstra distances equal brute-force shortest paths', () => {
  fc.assert(fc.property(graphArb, fc.nat(), (j, s) => {
    const n = j.lon.length, src = s % n, g = graphFrom(j)
    const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, k) => (i === k ? 0 : Infinity)))
    // Routing weighs an edge by its free time (length, speed of its class, traffic lights), not by its length alone.
    const time = freeTime(j)
    j.edges.forEach(([a, b], e) => { d[a][b] = Math.min(d[a][b], time[e]); d[b][a] = Math.min(d[b][a], time[e]) })
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let m = 0; m < n; m++) d[i][m] = Math.min(d[i][m], d[i][k] + d[k][m])
    // The free times are not whole numbers, so the order of the sums can change the last bit.
    Array.from(tree(g, src).dist).forEach((x, k) => (Number.isFinite(x) ? expect(x).toBeCloseTo(d[src][k], 9) : expect(d[src][k]).toBe(Infinity)))
  }))
})

test('a path starts at the source, ends at the destination and walks through edge geometry', () => {
  fc.assert(fc.property(graphArb, fc.nat(), fc.nat(), (j, s, t) => {
    const n = j.lon.length, src = s % n, dst = t % n, g = graphFrom(j)
    const { via, dist } = tree(g, src)
    if (!Number.isFinite(dist[dst])) return
    const p = pathTo(g, via, dst)
    expect([p[0], p[1]]).toEqual([j.lon[src], j.lat[src]])
    expect([p.at(-2), p.at(-1)]).toEqual([j.lon[dst], j.lat[dst]])
    // Every edge on the path adds its in-between points plus one node.
    let hops = 0, points = 0
    for (let v = dst; via[v] >= 0; v = g.owner[via[v]]) { hops++; points += g.geom[g.edge[via[v]]].length / 2 }
    expect(p.length / 2).toBe(1 + hops + points)
  }))
})

test('edge points run from the node the path comes from', () => {
  fc.assert(fc.property(graphArb, fc.nat(), fc.nat(), (j, s, t) => {
    const n = j.lon.length, src = s % n, dst = t % n, g = graphFrom(j)
    const { via, dist } = tree(g, src)
    if (!Number.isFinite(dist[dst])) return
    const hops: [number, number][] = []
    for (let v = dst; via[v] >= 0; v = g.owner[via[v]]) hops.unshift([g.owner[via[v]], g.edge[via[v]]])
    const expected = [j.lon[src], j.lat[src]]
    for (const [p, e] of hops) {
      const [a, b, , pts] = j.edges[e], pairs: number[][] = []
      for (let i = 0; i < pts.length; i += 2) pairs.push([pts[i], pts[i + 1]])
      if (a !== p) pairs.reverse()
      const other = a === p ? b : a
      expected.push(...pairs.flat(), j.lon[other], j.lat[other])
    }
    expect(pathTo(g, via, dst)).toEqual(expected)
  }))
})

test('the graph hash changes when one coordinate, edge end, geometry point or weight changes', () => {
  const j = { lon: [121.5, 121.51, 121.52], lat: [25.0, 25.01, 25.02], edges: [[0, 1, 1, []], [1, 2, 1, [121.515, 25.015]]] as [number, number, number, number[]][] }
  const h = graphHash(graphFrom(j))
  expect(graphHash(graphFrom({ ...j, lon: [121.5, 121.51, 121.520001] }))).not.toBe(h)
  expect(graphHash(graphFrom({ ...j, edges: [[0, 2, 1, []], [1, 2, 1, [121.515, 25.015]]] }))).not.toBe(h)
  expect(graphHash(graphFrom({ ...j, edges: [[0, 1, 1, []], [1, 2, 1, [121.515, 25.016]]] }))).not.toBe(h)
  expect(graphHash(graphFrom({ ...j, edges: [[0, 1, 2, []], [1, 2, 1, [121.515, 25.015]]] }))).not.toBe(h)
  expect(graphHash(graphFrom(j))).toBe(h)
})

test('traffic lights add half a wait at each end where 3 or more streets meet, and only with lights', () => {
  // A star: node 0 meets 1, 2 and 3; edge 3-4 is a 國道 (class 1), which never has lights.
  const j: GraphJson = { lon: [0, 0, 0, 0, 0], lat: [0, 0, 0, 0, 0], edges: [[0, 1, 100, []], [0, 2, 100, []], [0, 3, 100, []], [3, 4, 320, [], 1]] }
  expect(Array.from(freeTime(j))).toEqual([100, 100, 100, 100])
  expect(Array.from(freeTime(j, true))).toEqual([100 + SIGNAL / 2, 100 + SIGNAL / 2, 100 + SIGNAL / 2, 100])
})
