"""The 基隆河 and the places where a bicycle can cross it, for the bicycle trips of the model.

Usage:
  python3 scripts/river.py OSM_KEELUNG OUT_JSON

  OSM_KEELUNG  the JSON of scripts/queries/keelung.overpassql (Overpass API, https://overpass-api.de/api/interpreter),
               made on 2026-11-05: the ways of the river and every bridge way with a highway tag.
  OUT_JSON     writes river.json: {"river": [[[lon, lat], ...], ...], "crossings": [{"name", "lon", "lat"}, ...]}

A crossing is a bridge way that crosses a way of the river and that a bicycle can use: not a motorway or a trunk road
(or their ramps) unless OSM allows bicycles on it, and not tagged bicycle=no. Crossings closer than MERGE_M are one
crossing (a bridge often has a way for each direction and one for its footpath)."""
import json, math, sys

if __name__ == "__main__" and len(sys.argv) != 3:
    sys.exit(__doc__)

FAST = {"motorway", "motorway_link", "trunk", "trunk_link"}
MERGE_M = 250


def segments(points):
    return zip(points, points[1:])


def crosses(p, q):
    def side(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    (a, b), (c, d) = p, q
    return side(a, b, c) * side(a, b, d) < 0 and side(c, d, a) * side(c, d, b) < 0


def metres(a, b):
    dx = (b[0] - a[0]) * 111_320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dx, (b[1] - a[1]) * 110_570)


def by_bicycle(tags):
    bicycle = tags.get("bicycle", "")
    if "designated" in bicycle or bicycle == "yes":
        return True
    return tags["highway"] not in FAST and not bicycle.startswith("no")


def main(src, out):
    ways = json.load(open(src, encoding="utf-8"))["elements"]
    river = [[(round(p["lon"], 5), round(p["lat"], 5)) for p in w["geometry"]]
             for w in ways if w["tags"].get("waterway") == "river"]
    river_segments = [s for r in river for s in segments(r)]
    crossings = []
    for w in ways:
        tags = w["tags"]
        if "bridge" not in tags or not by_bicycle(tags):
            continue
        points = [(p["lon"], p["lat"]) for p in w["geometry"]]
        hit = next((s for s in segments(points) if any(crosses(s, r) for r in river_segments)), None)
        if not hit:
            continue
        at = ((hit[0][0] + hit[1][0]) / 2, (hit[0][1] + hit[1][1]) / 2)
        name = tags.get("name", "")
        near = next((c for c in crossings if metres(at, (c["lon"], c["lat"])) < MERGE_M), None)
        if near:
            near["name"] = near["name"] or name
        else:
            crossings.append({"name": name, "lon": round(at[0], 5), "lat": round(at[1], 5)})
    crossings.sort(key=lambda c: c["lon"])
    json.dump({"river": river, "crossings": crossings}, open(out, "w", encoding="utf-8"), ensure_ascii=False,
              separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:])
