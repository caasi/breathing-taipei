"""Name each road edge after the nearest named OSM road, for the jam events.

Usage:
  python3 scripts/names.py STREETS PUBLIC_DIR

  STREETS     Overpass JSON of scripts/queries/streets.overpassql (named roads from 國道 down to tertiary):
              curl -A <name> --data-urlencode data@scripts/queries/streets.overpassql https://overpass-api.de/api/interpreter
  PUBLIC_DIR  reads road-graph.json and road-lines.json, writes road-names.json

road-names.json: {"names": [...], "edge": [...]}, where edge[e] is the index of the name of edge e of road-graph.json,
or -1 when no named road of its class lies within MAX_M of the middle of the edge (a lane, or a road with no name).
A street edge takes only a street name, so a viaduct over it does not name it; a 國道 edge takes only a 國道. A
快速道路 that is a bridge, a viaduct or a tunnel (or on a layer above 0) names only 快速道路 edges: a street under
市民大道高架道路 or beside 象山隧道 is not that road. A river bridge of a street (華中橋) still names the street.
"""
import json, math, sys, collections

if __name__ == "__main__" and len(sys.argv) != 3:
    sys.exit(__doc__)

# ponytail: the farthest that a named road can be from the middle of an edge and still name it; a guess. A larger value
# names more edges, and more wrongly at a crossing.
MAX_M = 30
# The OSM highway kinds that may name an edge of each class (scripts/graphs.py: 0 street, 1 國道, 2 快速道路, 3 ramp).
KINDS = {
    0: {"trunk", "primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"},
    1: {"motorway"}, 2: {"trunk", "trunk-raised"}, 3: {"motorway_link", "trunk_link", "motorway", "trunk", "trunk-raised"},
}
CELL = 0.001  # degrees, about 100 m: wider than MAX_M, so the 3 x 3 cells around a point hold every candidate

def label(t):
    """國道 by number (國道1號, 國道3甲), others by name."""
    if t["highway"] == "motorway" and t.get("ref"):
        ref = t["ref"].split(";")[0]
        return f"國道{ref}" if ref.endswith("甲") else f"國道{ref}號"
    return t["name"]

def metres(lat):
    """Metres per degree of longitude and of latitude near lat."""
    return 111_320 * math.cos(math.radians(lat)), 110_574

def middle(flat):
    """The point at half the length of a polyline (lon, lat, ...)."""
    pts = list(zip(flat[0::2], flat[1::2]))
    mx, my = metres(pts[0][1])
    steps = [math.hypot((b[0] - a[0]) * mx, (b[1] - a[1]) * my) for a, b in zip(pts, pts[1:])]
    left = sum(steps) / 2
    for (a, b), s in zip(zip(pts, pts[1:]), steps):
        if left <= s and s:
            f = left / s
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
        left -= s
    return pts[-1]

def gap(p, a, b):
    """Metres from p to the segment a-b."""
    mx, my = metres(p[1])
    ax, ay, bx, by = (a[0] - p[0]) * mx, (a[1] - p[1]) * my, (b[0] - p[0]) * mx, (b[1] - p[1]) * my
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(ax + t * dx, ay + t * dy)

ways = [x for x in json.load(open(sys.argv[1]))["elements"] if x["type"] == "way" and "geometry" in x]

def kind(t):
    """The highway kind, with "trunk-raised" for a 快速道路 off the ground, which may not name a street edge."""
    raised = t.get("bridge") or t.get("tunnel") or int(t.get("layer", "0").split(";")[0] or 0) > 0
    return "trunk-raised" if t["highway"] == "trunk" and raised else t["highway"]
grid = collections.defaultdict(list)  # cell -> (segment start, end, kind, label)
for x in ways:
    pts = [(g["lon"], g["lat"]) for g in x["geometry"]]
    for a, b in zip(pts, pts[1:]):
        seg = (a, b, kind(x["tags"]), label(x["tags"]))
        # Every cell along the segment: a segment can be over 1 km long, much longer than a cell.
        n = math.ceil(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / CELL) + 1
        for c in {(math.floor((a[0] + (b[0] - a[0]) * k / n) / CELL), math.floor((a[1] + (b[1] - a[1]) * k / n) / CELL)) for k in range(n + 1)}:
            grid[c].append(seg)

graph = json.load(open(sys.argv[2] + "/road-graph.json"))
lines = json.load(open(sys.argv[2] + "/road-lines.json"))
names, index, edge = [], {}, []
for e, flat in zip(graph["edges"], lines):
    p, kinds = middle(flat), KINDS[e[4] if len(e) > 4 else 0]
    cx, cy = math.floor(p[0] / CELL), math.floor(p[1] / CELL)
    near = [(gap(p, a, b), name) for i in (-1, 0, 1) for j in (-1, 0, 1) for a, b, kind, name in grid[(cx + i, cy + j)] if kind in kinds]
    d, name = min(near, default=(math.inf, None))
    if d > MAX_M: edge.append(-1); continue
    if name not in index: index[name] = len(names); names.append(name)
    edge.append(index[name])
json.dump({"names": names, "edge": edge}, open(sys.argv[2] + "/road-names.json", "w"), ensure_ascii=False, separators=(",", ":"))
named = sum(1 for i in edge if i >= 0)
print(f"road names: {named} of {len(edge)} edges named, {len(names)} names")
