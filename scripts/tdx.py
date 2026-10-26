"""How much slower the peaks are than the night, per TDX section: the figures that DATA.md gives for MOST and BETA.

Usage:
  python3 scripts/tdx.py DIR KIND   DIR from scripts/tdx.sh, KIND taipei or freeway

Free flow is the median speed from 01:00 to 04:59 over all days. The peak of a section is the median over the days of
its median speed from 07:00 to 09:59 (am) and from 17:00 to 19:59 (pm). The times of TDX history are UTC. A speed
of 0 (no data source) or -99 is left out, as is a section with fewer than 30 night minutes. It prints the spread of
free / peak (how many times longer a trip takes) and the slowest sections. The speeds are mostly from vehicle
detectors at a point of the road, so they leave out the wait at traffic lights.
"""
import gzip, json, sys, glob, statistics as st, collections

if __name__ == "__main__" and len(sys.argv) != 3:
    sys.exit(__doc__)
d, kind = sys.argv[1], sys.argv[2]
rows = lambda f: (json.loads(line.lstrip("﻿")) for line in gzip.open(f, "rt", encoding="utf-8"))
name = lambda s: s["SectionName"] if isinstance(s.get("SectionName"), str) else (s.get("SectionName") or {}).get("Zh_tw", "")
names = {s["SectionID"]: name(s) for s in rows(sorted(glob.glob(f"{d}/section-{kind}-*.ndjson.gz"))[0])}
night, peak = collections.defaultdict(list), collections.defaultdict(lambda: collections.defaultdict(list))
days = sorted(glob.glob(f"{d}/live-{kind}-*.ndjson.gz"))
for f in days:
    for r in rows(f):
        v = r["TravelSpeed"]
        if v is None or v <= 0: continue
        h = (int(r["DataCollectTime"][11:13]) + 8) % 24
        if 1 <= h < 5: night[r["SectionID"]].append(v)
        elif 7 <= h < 10: peak[(r["SectionID"], "am")][f].append(v)
        elif 17 <= h < 20: peak[(r["SectionID"], "pm")][f].append(v)
out = []
for (sid, p), byday in peak.items():
    # ponytail: a section needs 30 minutes of night speeds (of about 1,440 in 6 days) for a free speed; a guess.
    if len(night[sid]) < 30: continue
    free, pk = st.median(night[sid]), st.median([st.median(v) for v in byday.values()])
    if pk > 0: out.append((free / pk, sid, p, free, pk))
print(kind, "days", len(days))
for p in ("am", "pm"):
    rs = sorted(r[0] for r in out if r[2] == p)
    q = lambda x: rs[min(len(rs) - 1, int(x * len(rs)))]
    print(p, "sections", len(rs), "p50 %.2f p90 %.2f p99 %.2f max %.2f" % (q(.5), q(.9), q(.99), rs[-1]))
for r in sorted(out, reverse=True)[:10]: print("%.2f %s free %.0f peak %.1f km/h %s" % (r[0], r[2], r[3], r[4], names.get(r[1], r[1])))
