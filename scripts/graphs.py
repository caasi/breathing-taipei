"""Build the routing graphs: roads from the bus route shapes of both cities, MRT from OSM lines and station exits.

Usage:
  python3 scripts/graphs.py TPE_SHAPES NTPC_SHAPES OSM_RAIL EXITS_CSV HIGHWAYS STREETS OUT_DIR

  TPE_SHAPES   https://tcgbusfs.blob.core.windows.net/blobbus/GetBusShape.gz
  NTPC_SHAPES  https://tcgbusfs.blob.core.windows.net/ntpcbus/GetBusShape.gz
  OSM_RAIL     Overpass JSON: way["railway"~"^(subway|rail|light_rail|monorail)$"](24.90,121.25,25.20,121.70); out tags geom;
  EXITS_CSV    data.gov.tw 128428 (Big5): https://data.taipei/api/dataset/cfa4778c-62c1-497b-b704-756231de348b/resource/307a7f61-e302-4108-a817-877ccbfca7c1/download
  HIGHWAYS     Overpass JSON of scripts/queries/highways.overpassql (國道, 快速道路 and their ramps, with node ids):
               curl -A <name> --data-urlencode data@scripts/queries/highways.overpassql https://overpass-api.de/api/interpreter
  STREETS      Overpass JSON of scripts/queries/streets.overpassql (named roads; scripts/names.py reads it too)
  OUT_DIR      writes road-graph.json, road-lines.json and mrt-graph.json

Output per graph: kept nodes (degree != 2) and edges whose geometry holds the merged degree-2 points.
road-lines.json has, for each edge of road-graph.json in the same order, the bus shape points that the edge stands
for (lon, lat, ...), not snapped to the grid: the map draws these, and routing uses the snapped graph.
A road edge has a fifth value, its class, when it is not a street: 1 國道, 2 快速道路, 3 a ramp or a link to the streets.
A one-way edge (OSM `oneway`; a 國道 and its ramps are one-way unless tagged otherwise) has a sixth value, 1, and runs
from its first node to its second; its fifth value is then given also for a street (0)."""
import gzip, json, math, re, csv, collections, sys

if __name__ == "__main__" and len(sys.argv) != 8:
    sys.exit(__doc__)

def km(a, b):
    r = math.pi / 180
    x = (b[0] - a[0]) * r * math.cos((a[1] + b[1]) * r / 2); y = (b[1] - a[1]) * r
    return 6371 * math.hypot(x, y)

class Graph:
    def __init__(s, grid): s.grid, s.idx, s.xy, s.adj, s.raw, s.cls, s.one = grid, {}, [], collections.defaultdict(dict), {}, {}, set()
    def add(s, p):
        s.xy.append(p); return len(s.xy) - 1
    def node(s, p):
        k = (round(p[0] / s.grid), round(p[1] / s.grid))
        if k not in s.idx: s.idx[k] = s.add((k[0] * s.grid, k[1] * s.grid))
        return s.idx[k]
    def link(s, a, b, d=None, cls=0, one=False):
        """Joins a and b; with `one`, only a to b may be driven (s.one)."""
        if a == b: return
        d = km(s.xy[a], s.xy[b]) if d is None else d; s.adj[a][b] = s.adj[b][a] = d
        if cls: s.cls[(a, b)] = s.cls[(b, a)] = cls
        if one: s.one.add((a, b))
    def line(s, pts):
        ns = [s.node(p) for p in pts]
        for a, b in zip(ns, ns[1:]): s.link(a, b)
        # The real points from the last one in cell a to the first one in cell b; the first shape that crosses wins.
        for i in range(len(ns) - 1):
            a, b = ns[i], ns[i + 1]
            if a != b and (a, b) not in s.raw: s.raw[(a, b)] = [pts[i], pts[i + 1]]; s.raw[(b, a)] = [pts[i + 1], pts[i]]
        return ns

def contract(g, keep_extra=()):
    """Keep nodes of degree != 2, nodes where the class of the road or its one-way rule changes, and keep_extra; every
    other node becomes geometry inside an edge, so each edge has one class and is one-way or two-way all along."""
    one = lambda v, w: (v, w) in g.one or (w, v) in g.one
    changes = lambda v: len({(g.cls.get((v, w), 0), one(v, w)) for w in g.adj[v]}) > 1
    keep = {v for v in range(len(g.xy)) if len(g.adj[v]) != 2 or changes(v)} | set(keep_extra)
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
                chain = [a, *geom, cur]
                # A chain is one-way when a step of it is; it is turned to run the legal way. ponytail: a chain with
                # steps both ways (bad data) stays two-way, counted in `mixed`.
                ways = {1 if (p, q) in g.one else -1 for p, q in zip(chain, chain[1:]) if (p, q) in g.one or (q, p) in g.one}
                if ways == {-1, 1}: contract.mixed += 1
                if ways == {-1}: chain.reverse()
                edges.append((remap[chain[0]], remap[chain[-1]], d, [g.xy[p] for p in chain[1:-1]], chain, g.cls.get((a, b0), 0), len(ways) == 1))
    nodes = [g.xy[v] for v in sorted(keep)]
    return nodes, edges, remap
contract.mixed = 0

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
    edges = [(a, b, d, simplify(geom, nodes[a], nodes[b]), cls, one) for a, b, d, geom, _, cls, one in edges]
    out = {"lon": [round(p[0], 5) for p in nodes], "lat": [round(p[1], 5) for p in nodes],
           "edges": [[a, b, round(d * 1000), [round(c, 5) for p in geom for c in p]] + ([cls, 1] if one else [cls] if cls else []) for a, b, d, geom, cls, one in edges]}
    if extra: out.update(extra)
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))

# --- roads from bus shapes ---
road = Graph(1.2e-3)  # ~120 m grid; at 640 px for 雙北 a pixel is ~40 m merges the two directions and overlapping routes
for f in sys.argv[1:3]:
    for r in json.loads(gzip.open(f).read().decode("utf-8-sig")):
        for part in re.findall(r"\(([^()]+)\)", r["wkt"]):
            road.line([tuple(map(float, xy.split())) for xy in part.split(",")])

# --- 國道 and 快速道路 from OSM, with their ramps ---
# Their points do not snap to the grid of the streets: a viaduct over a street must not meet it. Ways meet each other
# at shared OSM nodes. They meet the streets at the end of a ramp or of a road that ends among streets, and a 快速道路
# that is not a bridge or a tunnel also meets them at each of its points that falls in a cell of a street.
CLASS = {"motorway": 1, "trunk": 2, "motorway_link": 3, "trunk_link": 3}
def oneway(t):
    """1 when only the way's own order may be driven, -1 when only the reverse, 0 when both."""
    o = t.get("oneway", "yes" if t["highway"] in ("motorway", "motorway_link") else "no")
    return 1 if o in ("yes", "1", "true") else -1 if o == "-1" else 0
ways = [x for x in json.load(open(sys.argv[5]))["elements"] if x["type"] == "way"]
uses, osm = collections.Counter(n for x in ways for n in set(x["nodes"])), {}
def street(p, reach):
    """The street node of the cell of p, or of a cell up to `reach` cells away, nearest first; None when there is none."""
    k = (round(p[0] / road.grid), round(p[1] / road.grid))
    near = [road.idx[c] for c in ((k[0] + i, k[1] + j) for i in range(-reach, reach + 1) for j in range(-reach, reach + 1)) if c in road.idx]
    return min(near, key=lambda v: km(p, road.xy[v]), default=None)
for x in ways:
    t = x["tags"]; pts = [(g["lon"], g["lat"]) for g in x["geometry"]]
    ns = [osm[n] if n in osm else osm.setdefault(n, road.add(p)) for n, p in zip(x["nodes"], pts)]
    way = oneway(t)
    for a, b, pa, pb in zip(ns, ns[1:], pts, pts[1:]):
        if a != b: road.link(*((b, a) if way < 0 else (a, b)), cls=CLASS[t["highway"]], one=way != 0); road.raw.setdefault((a, b), [pa, pb]); road.raw.setdefault((b, a), [pb, pa])
    at_grade = t["highway"] == "trunk" and not t.get("bridge") and not t.get("tunnel")
    for i, (n, p) in enumerate(zip(x["nodes"], pts)):
        end = i in (0, len(pts) - 1) and uses[n] == 1
        # ponytail: a free end looks up to 2 cells (about 240 m) away for a street, and an at-grade point only in its own
        # cell; guesses. A larger reach joins a road to a street that it does not meet.
        v = street(p, 2) if end else street(p, 0) if at_grade else None
        if v is not None: road.link(osm[n], v, cls=3); road.raw.setdefault((osm[n], v), [p, road.xy[v]]); road.raw.setdefault((v, osm[n]), [road.xy[v], p])

# --- one-way streets from OSM ---
# OSM draws a divided road as two one-way ways, but the grid above merges its two carriageways into one edge, so only a
# one-way way with no way of the same name going the other way within PAIR_M is a one-way street. A street step lies
# along such a way when the way passes within NEAR_M of the middle of the step at an angle under 30 degrees; the step
# then runs only the way's way. ponytail: PAIR_M, NEAR_M, the 30 degrees and the 137 degrees (2.4 rad) of "the other
# way" are guesses; a one-way pair of two streets with different
# names closer than a grid cell can still merge into one edge and make it one-way.
PAIR_M, NEAR_M, OWC = 60, 30, 0.0005
def metres(a, b):
    return 1000 * km(a, b)
oneways = []
for x in json.load(open(sys.argv[6]))["elements"]:
    t = x.get("tags", {})
    if x["type"] != "way" or t.get("highway") not in ("primary", "secondary", "tertiary") or not oneway(t): continue
    pts = [(g["lon"], g["lat"]) for g in x["geometry"]]
    oneways += [(a, b, t.get("name")) for a, b in zip(*((pts[::-1], pts[-2::-1]) if oneway(t) < 0 else (pts, pts[1:])))]
cells = collections.defaultdict(list)
mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
cell = lambda p: (math.floor(p[0] / OWC), math.floor(p[1] / OWC))
for k, (a, b, _) in enumerate(oneways): cells[cell(mid(a, b))].append(k)
near = lambda p, reach: [k for i in range(-reach, reach + 1) for j in range(-reach, reach + 1) for k in cells[(cell(p)[0] + i, cell(p)[1] + j)]]
heading = lambda a, b: math.atan2(b[1] - a[1], (b[0] - a[0]) * math.cos(math.radians(a[1])))
turn = lambda h1, h2: abs((h1 - h2 + math.pi) % (2 * math.pi) - math.pi)
def gap(p, a, b):
    """Metres from p to the segment a-b."""
    mx, my = 1000 * km(p, (p[0] + 1, p[1])), 1000 * km(p, (p[0], p[1] + 1))
    ax, ay, bx, by = (a[0] - p[0]) * mx, (a[1] - p[1]) * my, (b[0] - p[0]) * mx, (b[1] - p[1]) * my
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(ax + t * dx, ay + t * dy)
def paired(k):
    """A segment of a divided road: a segment of the same name runs the other way within PAIR_M of its middle."""
    a, b, name = oneways[k]
    # Segments are indexed by their middle; a long one can have its middle far off, so look 4 cells (about 200 m) away.
    return any(oneways[j][2] == name and gap(mid(a, b), *oneways[j][:2]) <= PAIR_M and turn(heading(a, b), heading(*oneways[j][:2])) > 2.4
               for j in near(mid(a, b), 4) if j != k)
alone = {k for k in range(len(oneways)) if not paired(k)}
streets_one = 0
for a in list(road.adj):
    for b in list(road.adj[a]):
        if a > b or road.cls.get((a, b)) or (a, b) in road.one or (b, a) in road.one: continue
        p, h = mid(road.xy[a], road.xy[b]), heading(road.xy[a], road.xy[b])
        best = min(((metres(p, mid(*oneways[k][:2])), k) for k in near(p, 1) if k in alone), default=None)
        if not best or best[0] > NEAR_M: continue
        d = turn(h, heading(*oneways[best[1]][:2]))
        if d < math.pi / 6: road.one.add((a, b)); streets_one += 1
        elif d > 5 * math.pi / 6: road.one.add((b, a)); streets_one += 1
print("one-way streets:", len(alone), "of", len(oneways), "OSM one-way segments alone;", streets_one, "street steps made one-way")

nodes, edges, _ = contract(road)
dump(sys.argv[7] + "/road-graph.json", nodes, edges)
lines = []
for *_, chain, _cls, _one in edges:
    pts = [p for a, b in zip(chain, chain[1:]) for p in road.raw[(a, b)]]
    pts = [pts[0]] + simplify(pts[1:-1], pts[0], pts[-1], 2e-5) + [pts[-1]]  # ~2 m
    lines.append([round(c, 5) for p in pts for c in p])
json.dump(lines, open(sys.argv[7] + "/road-lines.json", "w"), separators=(",", ":"))
print("road:", len(road.xy), "points ->", len(nodes), "nodes,", len(edges), "edges,", sum(e[6] for e in edges), "one-way;", contract.mixed, "with steps both ways")

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
dump(sys.argv[7] + "/mrt-graph.json", nodes, edges, {"stations": {k: remap[v] for k, v in stations.items()}})
lonely = [k for k, v in stations.items() if not mrt.adj[v]]
print("mrt:", len(mrt.xy), "points ->", len(nodes), "nodes,", len(edges), "edges; stations", len(stations), "not on a line:", lonely)
