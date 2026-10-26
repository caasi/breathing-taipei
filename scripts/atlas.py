"""The district, county and village boundaries of the map, cut from the taiwan-atlas package.

Usage:
  python3 scripts/atlas.py TOWNS_10T VILLAGES_10T OUT_DIR

  TOWNS_10T     https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json
  VILLAGES_10T  https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/villages-10t.json
  OUT_DIR       writes towns.json (the towns of the two cities, and every county of Taiwan)
                and villages2-topo.json (the villages of the two cities)

Only the objects change: the arcs and the transform stay whole, so the files keep every arc of Taiwan."""
import json, sys

if __name__ == "__main__" and len(sys.argv) != 4:
    sys.exit(__doc__)

CITIES = ("台北市", "新北市")

def collection(geometries):
    return {"type": "GeometryCollection", "geometries": geometries}

def main(towns_10t, villages_10t, out_dir):
    t = json.load(open(towns_10t, encoding="utf-8"))
    t["objects"] = {"towns": collection([g for g in t["objects"]["towns"]["geometries"] if g["properties"]["COUNTYNAME"] in CITIES]),
                    "counties": t["objects"]["counties"]}
    json.dump(t, open(f"{out_dir}/towns.json", "w", encoding="utf-8"), ensure_ascii=False)
    v = json.load(open(villages_10t, encoding="utf-8"))
    v["objects"] = {"villages": collection([g for g in v["objects"]["villages"]["geometries"] if g["properties"].get("COUNTYNAME") in CITIES])}
    json.dump(v, open(f"{out_dir}/villages2-topo.json", "w", encoding="utf-8"), ensure_ascii=False)

if __name__ == "__main__":
    main(*sys.argv[1:])
