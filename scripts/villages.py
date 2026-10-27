"""Residents, morning MRT arrivals, known jobs and the centre point of each village of the two cities.

Usage:
  python3 scripts/villages.py VILLAGES_10T TPE_POP NTPC_POP EXITS_CSV OD_CSV COMPANIES OUT_JSON

  VILLAGES_10T  https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/villages-10t.json
  TPE_POP       data.gov.tw 136896 (臺北市各里人口數按年齡分), Big5; the rows of 115年9月 are used:
                https://data.taipei/api/dataset/a6394e3f-3514-4542-87bd-de4310a40db3/resource/c8f5b53d-ef3d-4321-ae8e-58cd2a5ee73c/download
  NTPC_POP      內政部戶政司 ODRP014 (村里戶數、單一年齡人口), New Taipei City, 115年9月:
                https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11509?COUNTY=%E6%96%B0%E5%8C%97%E5%B8%82&page=1
  EXITS_CSV     data.gov.tw 128428 (臺北捷運車站出入口座標), Big5:
                https://data.taipei/api/dataset/cfa4778c-62c1-497b-b704-756231de348b/resource/307a7f61-e302-4108-a817-877ccbfca7c1/download
  OD_CSV        the file for 2026-09 of data.gov.tw 128506 (臺北捷運各站分時進出量統計)
                (the index file https://data.taipei/api/dataset/63f31c7e-7fc3-418b-bd82-b95158755b4d/resource/eb481f58-1238-4cff-8caa-fa7bb20cb4f4/download gives the URL of each month):
                http://tcgmetro.blob.core.windows.net/stationod/%E8%87%BA%E5%8C%97%E6%8D%B7%E9%81%8B%E6%AF%8F%E6%97%A5%E5%88%86%E6%99%82%E5%90%84%E7%AB%99OD%E6%B5%81%E9%87%8F%E7%B5%B1%E8%A8%88%E8%B3%87%E6%96%99_202609.csv
  COMPANIES     臺北市內湖科技園區廠商名錄 (臺北市政府產業發展局, data.taipei), UTF-8 with BOM, TWD97 TM2 coordinates:
                https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=296acfa2-5d93-4706-ad58-e83cc951863c
  OUT_JSON      writes villages2.json: [{"code", "town", "pop", "arrivals", "jobs", "lon", "lat"}], sorted by village code

A village that the 2021 map does not have gives its residents to the mapped villages of its district, in
proportion to their residents. arrivals is the trips that end at the stations in the village from 05:00 to
11:59, summed over all days of the month. A station is at the mean position of its exits. The centre point is
the area centroid of the outer rings. jobs is the employees of 內湖科技園區 (NEIHU_JOBS) spread over the villages of
內湖區 by the number of its companies in each; it is 0 in the other villages."""
import csv, json, math, sys, collections
from od import inside, lookup, station_points

if __name__ == "__main__" and len(sys.argv) != 8:
    sys.exit(__doc__)

def arcs_of(topo):
    (sx, sy), (tx, ty) = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for a in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs

def polygons(arcs, g):
    """Each polygon of a geometry as [outer ring, holes...]."""
    ring = lambda r: [p for i in r for p in (arcs[i] if i >= 0 else arcs[~i][::-1])]
    return [[ring(r) for r in poly] for poly in ([g["arcs"]] if g["type"] == "Polygon" else g["arcs"])]

def centroid(polys):
    A = X = Y = 0
    for poly in polys:
        r = poly[0]
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            c = x1 * y2 - x2 * y1; A += c; X += (x1 + x2) * c; Y += (y1 + y2) * c
    return X / (3 * A), Y / (3 * A)

# 108年底 (end of 2019), 臺北市政府產業發展局 (DATA.md, "Figures in the code"). ponytail: the newest official count found;
# the company list gives where the companies are, not how many people each has, so each company counts the same.
NEIHU_JOBS = 166_322

def tm2(x, y):
    """TWD97 TM2 (central meridian 121°E, scale 0.9999, false easting 250 km, GRS80) to (lon, lat) in degrees."""
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9999
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); n = f / (2 - f)
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    p = mu + (3 * n / 2 - 27 * n ** 3 / 32) * math.sin(2 * mu) + (21 * n ** 2 / 16 - 55 * n ** 4 / 32) * math.sin(4 * mu) \
        + (151 * n ** 3 / 96) * math.sin(6 * mu) + (1097 * n ** 4 / 512) * math.sin(8 * mu)
    c1, t1 = ep2 * math.cos(p) ** 2, math.tan(p) ** 2
    n1 = a / math.sqrt(1 - e2 * math.sin(p) ** 2); r1 = a * (1 - e2) / (1 - e2 * math.sin(p) ** 2) ** 1.5
    d = (x - 250000) / (n1 * k0)
    lat = p - (n1 * math.tan(p) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                          + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(p)
    return 121 + math.degrees(lon), math.degrees(lat)

def residents(tpe_pop, ntpc_pop):
    s = open(tpe_pop, "rb").read().decode("big5", errors="replace")
    pop = {r[2]: int(r[5]) for r in csv.reader(s.splitlines()) if r[0] == "115" and r[1] == "9" and r[4] == "計" and len(r[2]) == 11}
    for r in json.load(open(ntpc_pop, encoding="utf-8"))["responseData"]:
        pop[r["district_code"]] = pop.get(r["district_code"], 0) + int(r["people_total"])
    return pop

def main(villages_10t, tpe_pop, ntpc_pop, exits_csv, od_csv, companies, out):
    topo = json.load(open(villages_10t, encoding="utf-8"))
    arcs = arcs_of(topo)
    geoms = [g for g in topo["objects"]["villages"]["geometries"] if g["properties"].get("COUNTYNAME") in ("台北市", "新北市")]
    shapes = [(g["properties"]["VILLCODE"], polygons(arcs, g)) for g in geoms]
    town_of = {g["properties"]["VILLCODE"]: g["properties"]["COUNTYNAME"] + g["properties"]["TOWNNAME"] for g in geoms}

    pop = residents(tpe_pop, ntpc_pop)
    # ponytail: villages made after the 2021 map give their people to the mapped villages of the district; a newer village map removes this.
    unmapped, by_town = collections.Counter(), collections.defaultdict(list)
    for code, n in pop.items():
        if code not in town_of: unmapped[code[:8]] += n
    for code in town_of: by_town[code[:8]].append(code)
    final = {}
    for town, codes in by_town.items():
        base = sum(pop[c] for c in codes)
        for c in codes: final[c] = pop[c] + unmapped[town] * pop[c] / base

    points = station_points(exits_csv)
    def village(pt):
        return next((code for code, polys in shapes if inside(pt, [r for poly in polys for r in poly])), None)
    morning, stations = collections.Counter(), set()
    with open(od_csv, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for _, hour, a, b, n in r:
            stations.update((a, b))
            if 5 <= int(hour) <= 11: morning[b] += int(n)
    arrivals = collections.Counter()
    for s in sorted(stations):
        pt = lookup(points, s)
        v = pt and village(pt)
        if v is None: sys.exit(f"no village for station {s}")
        arrivals[v] += morning[s]

    neihu = [(code, polys) for code, polys in shapes if town_of[code] == "台北市內湖區"]
    firms = collections.Counter()
    with open(companies, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pt = tm2(float(row["ADDR_X"]), float(row["ADDR_Y"]))
            v = next((code for code, polys in neihu if inside(pt, [r for poly in polys for r in poly])), None)
            if v: firms[v] += 1
    total = sum(firms.values())
    jobs = {v: round(NEIHU_JOBS * n / total) for v, n in firms.items()}
    print("內科 companies by village:", dict(firms.most_common()), "outside 內湖區:", sum(1 for _ in open(companies, encoding="utf-8-sig")) - 1 - total)

    centre = {code: centroid(polys) for code, polys in shapes}
    rows = [{"code": c, "town": town_of[c], "pop": round(final[c]), "arrivals": arrivals.get(c, 0), "jobs": jobs.get(c, 0),
             "lon": round(centre[c][0], 5), "lat": round(centre[c][1], 5)} for c in sorted(town_of)]
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False)

if __name__ == "__main__":
    main(*sys.argv[1:])
