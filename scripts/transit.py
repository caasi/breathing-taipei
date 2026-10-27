"""The lines and points that the map draws: MRT, light rail, railway, high speed rail, stations and the airport.

Usage:
  python3 scripts/transit.py OSM_RAIL OSM_STATIONS OSM_AIRPORT OUT_JSON

  Each input is the JSON of one Overpass API query (https://overpass-api.de/api/interpreter), made on 2026-10-24:
  OSM_RAIL      [out:json][timeout:120];(way["railway"~"^(subway|rail|light_rail|monorail)$"](24.90,121.25,25.20,121.70););out tags geom;
  OSM_STATIONS  [out:json][timeout:90];area["name"="臺北市"]["admin_level"="4"]->.tp;(node["railway"="station"](area.tp);
                node["public_transport"="station"](area.tp);node["aeroway"="aerodrome"](area.tp);way["aeroway"="aerodrome"](area.tp);
                node["highway"="motorway_junction"](area.tp););out center tags;
  OSM_AIRPORT   [out:json][timeout:60];(nwr["aeroway"="aerodrome"]["iata"="TSA"];);out center tags;
  OUT_JSON      writes transit.json: {"lines": [{kind, name, colour, coords}], "points": [{kind, name, lon, lat}]}

The 國道 and 快速道路 are not here: the traffic layer draws them (road-lines.json). From OSM_STATIONS, only the
nodes with station=train go into "points", so the map shows the railway stations of Taipei City only. The query
stays as it was made, so that the output is the same as the file in git."""
import json, sys

if __name__ == "__main__" and len(sys.argv) != 5:
    sys.exit(__doc__)

MRT = {"文湖": "#c48c31", "淡水信義": "#e3002c", "松山新店": "#008659", "小碧潭": "#008659", "中和新蘆": "#f8b61c",
       "板南": "#0070bd", "環狀": "#ffdb00", "機場": "#8246af", "新北投": "#fd92a3"}

def elements(path):
    return json.load(open(path, encoding="utf-8"))["elements"]

def coords(way):
    return [[round(p["lon"], 5), round(p["lat"], 5)] for p in way["geometry"]]

def rail(way):
    """(kind, colour) of a rail way, or None for a way that the map does not draw."""
    t, name = way["tags"], way["tags"].get("name", "")
    if t.get("service") or "geometry" not in way:
        return None
    if t["railway"] == "rail" and t.get("highspeed") == "yes":
        return "hsr", "#f47321"
    if t["railway"] == "rail" and t.get("usage") == "main":
        return "tra", "#cccccc"
    if t["railway"] == "subway":
        colour = next((c for k, c in MRT.items() if k in name), None)
        return ("mrt", colour) if colour else None
    if t["railway"] == "light_rail":
        return "lrt", "#7ec8a5"
    return None

def main(osm_rail, osm_stations, osm_airport, out):
    lines = []
    for x in elements(osm_rail):
        if k := rail(x):
            lines.append({"kind": k[0], "name": x["tags"].get("name", ""), "colour": k[1], "coords": coords(x)})
    points = []
    for x in elements(osm_stations):
        t = x.get("tags", {})
        if t.get("station") == "train":
            hsr = "高鐵" in t.get("operator", "") or "高速" in t.get("operator", "")
            points.append({"kind": "hsr" if hsr else "tra", "name": t.get("name"), "lon": x["lon"], "lat": x["lat"]})
    a = elements(osm_airport)[0]
    points.append({"kind": "airport", "name": a["tags"]["name"], "lon": a["center"]["lon"], "lat": a["center"]["lat"]})
    json.dump({"lines": lines, "points": points}, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main(*sys.argv[1:])
