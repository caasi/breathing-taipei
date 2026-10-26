"""Build the routing graphs: roads from the bus route shapes of both cities, MRT from OSM lines and station exits.

Usage:
  python3 scripts/graphs.py TPE_SHAPES NTPC_SHAPES OSM_RAIL EXITS_CSV OUT_DIR

  TPE_SHAPES   https://tcgbusfs.blob.core.windows.net/blobbus/GetBusShape.gz
  NTPC_SHAPES  https://tcgbusfs.blob.core.windows.net/ntpcbus/GetBusShape.gz
  OSM_RAIL     Overpass JSON: way["railway"~"^(subway|rail|light_rail|monorail)$"](24.90,121.25,25.20,121.70); out tags geom;
  EXITS_CSV    data.gov.tw 128428 (Big5): https://data.taipei/api/dataset/cfa4778c-62c1-497b-b704-756231de348b/resource/307a7f61-e302-4108-a817-877ccbfca7c1/download
  OUT_DIR      writes road-graph.json, road-lines.json and mrt-graph.json

Output per graph: kept nodes (degree != 2) and edges whose geometry holds the merged degree-2 points.
road-lines.json has, for each edge of road-graph.json in the same order, the bus shape points that the edge stands
for (lon, lat, ...), not snapped to the grid: the map draws these, and routing uses the snapped graph."""
import gzip, json, math, re, csv, collections, sys

if __name__ == "__main__" and len(sys.argv) != 6:
    sys.exit(__doc__)

def km(a, b):
    r = math.pi / 180
    x = (b[0] - a[0]) * r * math.cos((a[1] + b[1]) * r / 2); y = (b[1] - a[1]) * r
    return 6371 * math.hypot(x, y)

class Graph:
    def __init__(s, grid): s.grid, s.idx, s.xy, s.adj, s.raw = grid, {}, [], collections.defaultdict(dict), {}
    def add(s, p):
        s.xy.append(p); return len(s.xy) - 1
    def node(s, p):
        k = (round(p[0] / s.grid), round(p[1] / s.grid))
        if k not in s.idx: s.idx[k] = s.add((k[0] * s.grid, k[1] * s.grid))
        return s.idx[k]
    def link(s, a, b, d=None):
        if a != b: d = km(s.xy[a], s.xy[b]) if d is None else d; s.adj[a][b] = s.adj[b][a] = d
    def line(s, pts):
        ns = [s.node(p) for p in pts]
        for a, b in zip(ns, ns[1:]): s.link(a, b)
        # The real points from the last one in cell a to the first one in cell b; the first shape that crosses wins.
        for i in range(len(ns) - 1):
            a, b = ns[i], ns[i + 1]
            if a != b and (a, b) not in s.raw: s.raw[(a, b)] = [pts[i], pts[i + 1]]; s.raw[(b, a)] = [pts[i + 1], pts[i]]
        return ns

def contract(g, keep_extra=()):
    """Keep nodes of degree != 2 (and keep_extra); every other node becomes geometry inside an edge."""
    keep = {v for v in range(len(g.xy)) if len(g.adj[v]) != 2} | set(keep_extra)
    # A component made only of degree-2 nodes (a loop) has no kept node; keep one node of it,
    # or the walk below never starts there and the whole loop is lost.
    reached = set()
    for v in sorted(keep):
        stack = [v]
        while stack:
            u = stack.pop()
            if u in reached: continue
            reached.add(u); stack.extend(g.adj[u])
    for v in range(len(g.xy)):
        if v in reached or not g.adj[v]: continue
        keep.add(v)
        stack = [v]
        while stack:
            u = stack.pop()
            if u in reached: continue
            reached.add(u); stack.extend(g.adj[u])
    seen, edges = set(), []
    remap = {}
    for v in sorted(keep): remap[v] = len(remap)
    for a in sorted(keep):
        for b0 in g.adj[a]:
            if (a, b0) in seen: continue
            geom, d, prev, cur = [], g.adj[a][b0], a, b0
            while cur not in keep:
                geom.append(cur)
                nxt = next(w for w in g.adj[cur] if w != prev)
                d += g.adj[cur][nxt]; prev, cur = cur, nxt
            seen.add((a, b0)); seen.add((cur, geom[-1] if geom else a))
            if a < cur or (a == cur and geom):
                edges.append((remap[a], remap[cur], d, [g.xy[p] for p in geom], [a, *geom, cur]))
    nodes = [g.xy[v] for v in sorted(keep)]
    return nodes, edges, remap

def simplify(pts, a, b, tol=2e-4):
    """Douglas-Peucker on the in-between points of an edge running from a to b (tol in degrees, ~20 m)."""
    full = [a] + pts + [b]
    keep = [False] * len(full); keep[0] = keep[-1] = True
    stack = [(0, len(full) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = full[i], full[j]
        best, bk = 0, -1
        for k in range(i + 1, j):
            x, y = full[k]; dx, dy = x2 - x1, y2 - y1
            t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy or 1)))
            d = math.hypot(x - x1 - t * dx, y - y1 - t * dy)
            if d > best: best, bk = d, k
        if best > tol: keep[bk] = True; stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(full, keep) if k][1:-1]

def dump(path, nodes, edges, extra=None):
    edges = [(a, b, d, simplify(geom, nodes[a], nodes[b])) for a, b, d, geom, _ in edges]
    out = {"lon": [round(p[0], 5) for p in nodes], "lat": [round(p[1], 5) for p in nodes],
           "edges": [[a, b, round(d * 1000), [round(c, 5) for p in geom for c in p]] for a, b, d, geom in edges]}
    if extra: out.update(extra)
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))

# --- roads from bus shapes ---
road = Graph(1.2e-3)  # ~120 m grid; at 640 px for 雙北 a pixel is ~40 m merges the two directions and overlapping routes
for f in sys.argv[1:3]:
    for r in json.loads(gzip.open(f).read().decode("utf-8-sig")):
        for part in re.findall(r"\(([^()]+)\)", r["wkt"]):
            road.line([tuple(map(float, xy.split())) for xy in part.split(",")])
nodes, edges, _ = contract(road)
dump(sys.argv[5] + "/road-graph.json", nodes, edges)
lines = []
for *_, chain in edges:
    pts = [p for a, b in zip(chain, chain[1:]) for p in road.raw[(a, b)]]
    pts = [pts[0]] + simplify(pts[1:-1], pts[0], pts[-1], 2e-5) + [pts[-1]]  # ~2 m
    lines.append([round(c, 5) for p in pts for c in p])
json.dump(lines, open(sys.argv[5] + "/road-lines.json", "w"), separators=(",", ":"))
print("road:", len(road.xy), "points ->", len(nodes), "nodes,", len(edges), "edges")

# --- MRT: OSM lines (Taipei Metro and Circular line), joined through station nodes ---
LINE = {"文湖": "BR", "淡水信義": "R", "新北投": "R", "松山新店": "G", "小碧潭": "G", "中和新蘆": "O", "板南": "BL", "環狀": "Y"}
mrt = Graph(1e-4)
by_line = collections.defaultdict(set)
for x in json.load(open(sys.argv[3]))["elements"]:
    t = x["tags"]
    if t.get("service") or t["railway"] != "subway" or "geometry" not in x: continue
    code = next((c for k, c in LINE.items() if k in t.get("name", "")), None)
    if not code: continue
    for n in mrt.line([(p["lon"], p["lat"]) for p in x["geometry"]]): by_line[code].add(n)
acc = collections.defaultdict(list)
for row in list(csv.reader(open(sys.argv[4], encoding="big5", errors="replace")))[1:]:
    st = re.sub(r"(站?出口.*|M\d+)$", "", row[1]).replace("臺", "台").removesuffix("站")
    acc[st].append((float(row[3]), float(row[4])))
stations = {}
for name, pts in acc.items():
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    s = mrt.add(c); stations[name] = s
    for code, ns in by_line.items():
        best = min(ns, key=lambda n: km(c, mrt.xy[n]))
        if km(c, mrt.xy[best]) < 0.35: mrt.link(s, best, 0.3)  # boarding or changing line costs ~300 m
nodes, edges, remap = contract(mrt, stations.values())
dump(sys.argv[5] + "/mrt-graph.json", nodes, edges, {"stations": {k: remap[v] for k, v in stations.items()}})
lonely = [k for k, v in stations.items() if not mrt.adj[v]]
print("mrt:", len(mrt.xy), "points ->", len(nodes), "nodes,", len(edges), "edges; stations", len(stations), "not on a line:", lonely)
