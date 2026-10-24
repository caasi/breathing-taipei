"""Count the businesses of the night-time groups in each village, from the national business tax registry.

Usage:
  python3 scripts/night.py REGISTRY_CSV VILLAGES_TOPO VILLAGES_JSON OUT_JSON

  REGISTRY_CSV   https://eip.fia.gov.tw/data/BGMOPEN1.csv (data.gov.tw 9400, 全國營業(稅籍)登記資料集)
  VILLAGES_TOPO  web/public/villages2-topo.json (village names and codes)
  VILLAGES_JSON  web/public/villages2.json (the village order of the model, and residents)
  OUT_JSON       writes night.json: {"date": registry date, "kinds": [...], "counts": [[per kind] per village]}

A business goes to a village by the 里 in its address. An address with no 里, or with a 里 that the
2021 boundaries do not have, counts for its district only; those businesses are spread over the villages
of the district in proportion to the businesses that matched, or to residents when none matched."""
import csv, json, re, collections, sys

if __name__ == "__main__" and len(sys.argv) != 5:
    sys.exit(__doc__)

KINDS = ["early", "food", "convenience", "hotel", "nightlife"]
# Variant characters that the registry and the 2021 map write differently (羣賢里/群賢里, 五峰里/五峯里, 富臺里/富台里).
SAME = str.maketrans("羣峯臺", "群峰台")

def kind(code):
    if code == "561111": return "early"  # 早餐店
    if code.startswith("5611") or code in ("561200", "563112", "563113", "563115", "563199", "563200"): return "food"
    if code in ("471112", "471113", "471114"): return "convenience"
    if code in ("551011", "551012"): return "hotel"
    # 飲酒店, 三溫暖, 視唱與視聽中心, 有侍者陪伴之茶室、酒家、酒吧、視唱中心
    if code in ("563114", "969012") or code.startswith("9322") or code.startswith("9323"): return "nightlife"

def main(reg, topo, vjson, out):
    t = json.load(open(topo))
    code_of, names = {}, collections.defaultdict(list)
    for g in t["objects"]["villages"]["geometries"]:
        p = g["properties"]
        town = p["COUNTYNAME"].replace("臺", "台") + p["TOWNNAME"]
        name = p["VILLNAME"].translate(SAME)
        code_of[(town, name)] = p["VILLCODE"]
        names[town].append(name)
    villages = json.load(open(vjson))
    index = {v["code"]: i for i, v in enumerate(villages)}
    towns = {v["town"] for v in villages}
    by_village = [[0.0] * len(KINDS) for _ in villages]
    by_town = collections.defaultdict(lambda: [0] * len(KINDS))
    address = re.compile(r"^(臺北市|台北市|新北市)(.{1,3}?區)")
    with open(reg, encoding="utf-8", errors="replace") as f:
        rows = csv.reader(f)
        next(rows)
        date = next(rows)[0]  # the second line holds only the extract date
        for row in rows:
            m = len(row) > 9 and address.match(row[0])
            k = m and kind(row[8])
            if not k: continue
            town = m.group(1).replace("臺", "台") + m.group(2)
            if town not in towns: continue
            # Match whole village names: a first-里 cut would make 萬里里, 仁里里 and 草里里 into 萬里, 仁里 and 草里.
            rest = row[0][m.end():].translate(SAME)
            li = max((n for n in names[town] if rest.startswith(n)), key=len, default=None)
            v = index.get(code_of.get((town, li), ""))
            if v is None: by_town[town][KINDS.index(k)] += 1
            else: by_village[v][KINDS.index(k)] += 1
    for town, extra in by_town.items():
        members = [i for i, v in enumerate(villages) if v["town"] == town]
        for k, n in enumerate(extra):
            w = [by_village[i][k] for i in members]
            if not sum(w): w = [villages[i]["pop"] for i in members]
            for i, x in zip(members, w): by_village[i][k] += n * x / sum(w)
    counts = [[round(x, 2) for x in c] for c in by_village]
    json.dump({"date": date, "kinds": KINDS, "counts": counts}, open(out, "w"), separators=(",", ":"))
    print(date, {k: round(sum(c[i] for c in counts)) for i, k in enumerate(KINDS)})

if __name__ == "__main__":
    main(*sys.argv[1:])
