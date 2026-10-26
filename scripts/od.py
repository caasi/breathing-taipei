"""Average MRT trips per hour between the 41 districts, for each kind of day, from one month of station OD.

Usage:
  python3 scripts/od.py OD_CSV EXITS_CSV TOWNS_TOPO OFFICE_CSV OUT_JSON

  OD_CSV      the file for 2026-09 of data.gov.tw 128506 (臺北捷運各站分時進出量統計), columns 日期,時段,進站,出站,人次
              (the index file https://data.taipei/api/dataset/63f31c7e-7fc3-418b-bd82-b95158755b4d/resource/eb481f58-1238-4cff-8caa-fa7bb20cb4f4/download gives the URL of each month):
              http://tcgmetro.blob.core.windows.net/stationod/%E8%87%BA%E5%8C%97%E6%8D%B7%E9%81%8B%E6%AF%8F%E6%97%A5%E5%88%86%E6%99%82%E5%90%84%E7%AB%99OD%E6%B5%81%E9%87%8F%E7%B5%B1%E8%A8%88%E8%B3%87%E6%96%99_202609.csv
  EXITS_CSV   data.gov.tw 128428 (臺北捷運車站出入口座標), Big5:
              https://data.taipei/api/dataset/cfa4778c-62c1-497b-b704-756231de348b/resource/307a7f61-e302-4108-a817-877ccbfca7c1/download
  TOWNS_TOPO  web/public/towns.json (district boundaries, TopoJSON)
  OFFICE_CSV  the 115 file of data.gov.tw 14718 (中華民國政府行政機關辦公日曆表), for the days off of the month:
              https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv&nfix=&name=115.csv
  OUT_JSON    writes od2.json: {"districts": [...], "od": workday, "saturday": ..., "holiday": ...}, each [hour][from][to]

A station goes to the district that holds the mean position of its exits. The kinds of day are those of
scripts/days.py: a workday, a Saturday off with no holiday, and any other day off (a Sunday, a holiday, or a Saturday
that is a holiday).
Each value is the mean over the days of that kind, rounded to a whole trip."""
import csv, json, sys, collections

if __name__ == "__main__" and len(sys.argv) != 6:
    sys.exit(__doc__)

# The OD file puts the line before the name of a station that two lines share (BL板橋, Y板橋), and some names
# end in 站 (台北車站) where the exit file has the name without it.
PREFIXES = "BLYGO"

def rings(topo, geometry):
    """The rings of one TopoJSON polygon or multipolygon, in longitude and latitude."""
    scale, shift = topo["transform"]["scale"], topo["transform"]["translate"]
    def arc(i):
        pts, x, y = [], 0, 0
        for dx, dy in topo["arcs"][i if i >= 0 else ~i]:
            x += dx; y += dy
            pts.append((x * scale[0] + shift[0], y * scale[1] + shift[1]))
        return pts if i >= 0 else pts[::-1]
    polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
    return [[p for i in ring for p in arc(i)] for polygon in polygons for ring in polygon]

def inside(pt, ring_list):
    """Even-odd rule over all rings, so a hole is outside."""
    x, y, n = pt[0], pt[1], 0
    for ring in ring_list:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                n += 1
    return n % 2 == 1

def station_points(exits_csv):
    """Station name (as lookup() gives it) -> the mean position of its exits."""
    pts = collections.defaultdict(list)
    with open(exits_csv, encoding="big5") as f:
        r = csv.reader(f); next(r)
        for row in r:
            pts[row[1].removesuffix(row[2]).removesuffix("出口").removesuffix("站")].append((float(row[3]), float(row[4])))
    return {name: (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps)) for name, ps in pts.items()}

def lookup(points, name):
    return points.get(name.lstrip(PREFIXES).removesuffix("站"))

def districts_of(exits_csv, topo):
    towns = [(g["properties"]["COUNTYNAME"] + g["properties"]["TOWNNAME"], rings(topo, g))
             for g in topo["objects"]["towns"]["geometries"] if g["properties"]["COUNTYNAME"] in ("台北市", "新北市")]
    station = {name: next((t for t, rs in towns if inside(mean, rs)), None) for name, mean in station_points(exits_csv).items()}
    return station, sorted(t for t, _ in towns)

def kinds_of(office_csv):
    """Date (YYYY-MM-DD) -> 'od', 'saturday' or 'holiday'."""
    kinds = {}
    with open(office_csv, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for day, weekday, off, note in r:
            date = f"{day[:4]}-{day[4:6]}-{day[6:]}"
            kinds[date] = "od" if off == "0" else "saturday" if weekday == "六" and not note.strip() else "holiday"
    return kinds

def main(od_csv, exits_csv, towns_topo, office_csv, out):
    station, districts = districts_of(exits_csv, json.load(open(towns_topo, encoding="utf-8")))
    kind_of = kinds_of(office_csv)
    G, ix = len(districts), {d: i for i, d in enumerate(districts)}
    sums = {k: [[[0] * G for _ in range(G)] for _ in range(24)] for k in ("od", "saturday", "holiday")}
    days = {k: set() for k in sums}
    with open(od_csv, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for date, hour, a, b, n in r:
            k = kind_of[date]
            days[k].add(date)
            da, db = lookup(station, a), lookup(station, b)
            if da is None or db is None:
                sys.exit(f"no district for station {a if da is None else b}")
            sums[k][int(hour)][ix[da]][ix[db]] += int(n)
    result = {"districts": districts}
    for k, s in sums.items():
        result[k] = [[[round(v / len(days[k])) for v in row] for row in hour] for hour in s]
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print({k: len(v) for k, v in days.items()}, file=sys.stderr)

if __name__ == "__main__":
    main(*sys.argv[1:])
