"""Weekday daytime and night population of each district, from telecom signal counts.

Usage:
  python3 scripts/telecom.py SEGIS_ZIP OUT_JSON

  SEGIS_ZIP  內政部統計處 112年11月行政區電信信令人口統計資料_鄉鎮市區, from the SEGIS page
             https://segis.moi.gov.tw/STATCloud/QueryInterfaceView?COL=zVTg8Fn91RUFg2R9uBdHTA%3d%3d
             (the page has a download button and no direct link: download the CSV zip in a browser)
  OUT_JSON   writes signal.json: {district: {"day": DAY_WORK(0700~1300), "night": NIGHT_WORK}}"""
import csv, io, json, sys, zipfile

if __name__ == "__main__" and len(sys.argv) != 3:
    sys.exit(__doc__)

def main(segis_zip, out):
    z = zipfile.ZipFile(segis_zip)
    name = next(n for n in z.namelist() if n.endswith(".csv"))
    rows = csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))
    signal = {r["COUNTY"].replace("臺", "台") + r["TOWN"]: {"day": int(r["DAY_WORK(0700~1300)"]), "night": int(r["NIGHT_WORK"])}
              for r in rows if r["COUNTY"] in ("臺北市", "新北市")}
    json.dump(signal, open(out, "w", encoding="utf-8"), ensure_ascii=False)

if __name__ == "__main__":
    main(*sys.argv[1:])
