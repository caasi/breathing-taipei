"""Surnames by district and sex, for the names of the characters: the page draws each agent's surname from them.

Usage:
  python3 scripts/people.py TOP20_CSV RANKING_CSV VILLAGES_JSON OUT_JSON

  TOP20_CSV      data.gov.tw 42518 (全國各鄉鎮市區前二十大姓人口數按性別分), the file for 112年6月 (11206):
                 https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/54BED408-2A7D-49D2-A247-FC63C156A8BB/resource/55A47BF4-F21F-4429-AC34-03581DA45B02/download
  RANKING_CSV    data.gov.tw 126774 (姓氏排名與人數按三階段年齡分), the file for 112:
                 https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/5D318346-EDFF-42C7-B914-946665D483F5/resource/E4A6518E-FF4C-4925-8D59-48ECE4401820/download
  VILLAGES_JSON  web/public/villages2.json (the residents of each district)
  OUT_JSON       writes people.json: {"national": [[surname, people], ...],
                 "districts": {district: {"male": [[surname, people], ...], "female": [...], "rest": [male, female]}}}

A district lists its top 20 surnames for each sex. rest is the people of each sex outside them; the page draws
their surname from the national ranking, without the district's top 20. The sex split of a district's residents
is that of its top 20 (the residents file has no split by sex)."""
import csv, json, sys, collections

if __name__ == "__main__" and len(sys.argv) != 5:
    sys.exit(__doc__)

NATIONAL = 300  # the most common surnames; together they hold almost every person (the script prints the share)

def main(top20_csv, ranking_csv, villages_json, out):
    top = collections.defaultdict(lambda: {"男": [], "女": []})
    with open(top20_csv, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            district = r["site_id"].replace("臺", "台")
            if district.startswith(("台北市", "新北市")):
                top[district][r["gender"]].append([r["family_name"], int(r["people_total"])])
    national = collections.Counter()
    with open(ranking_csv, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            national[r["lastname"]] += int(r["人口數"])
    residents = collections.Counter()
    for v in json.load(open(villages_json, encoding="utf-8")):
        residents[v["town"]] += v["pop"]
    if set(top) != set(residents):
        sys.exit(f"districts differ: {sorted(set(top) ^ set(residents))}")
    districts = {}
    for d, by in sorted(top.items()):
        listed = [sum(n for _, n in by[s]) for s in ("男", "女")]
        # ponytail: the sex split of the residents is that of the top 20; use the residents by sex when a file has them.
        rest = [max(0, round(residents[d] * k / sum(listed)) - k) for k in listed]
        districts[d] = {"male": by["男"], "female": by["女"], "rest": rest}
    common = national.most_common(NATIONAL)
    print(f"the {NATIONAL} most common surnames hold {sum(n for _, n in common) / sum(national.values()):.1%} of the people", file=sys.stderr)
    json.dump({"national": [[s, n] for s, n in common], "districts": districts},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main(*sys.argv[1:])
