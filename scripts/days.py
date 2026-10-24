"""One entry per day from 2026-01-01 to 2034-12-31: the kind of day, the holiday, the lunar date and the solar term.

Usage:
  python3 scripts/days.py OFFICE_115 OFFICE_116 LUNAR_CSV TERMS_CSV OUT_JSON

  OFFICE_115, OFFICE_116  data.gov.tw 14718 (中華民國政府行政機關辦公日曆表), the files for 2026 and 2027
  LUNAR_CSV   中央氣象署 A-A0087-001 (國農曆日期對照, data.gov.tw 157677), 2022 to 2050:
              https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/A-A0087-001?Authorization=rdec-key-123-45678-011121314&format=CSV
  TERMS_CSV   中央氣象署 A-A0087-003 (節氣發生日期及時刻資料, data.gov.tw 157677), 2026 to 2028:
              https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/A-A0087-003?Authorization=rdec-key-123-45678-011121314&format=CSV
  OUT_JSON    writes calendar.json: {"start": "2026-01-01", "kinds": [...], "days": [[kind, lunar month, lunar day, term, holiday, observances], ...]}

The kind of day is 0 (a workday), 1 (a Saturday off with no holiday) or 2 (another day off: a Sunday, a holiday, or a
Saturday that is a holiday or 補假). scripts/od.py sorts the days of its month by the same rule.
A lunar month below 0 is a leap month. term is the solar term that starts that day, or "". observances names the
commemorative days and festivals of that day that are not days off for everyone (紀念日及節日實施條例, §3, §5, §6).

2026 and 2027 come from the office calendars. Later years are a guess by rule(), which follows §4, §6 and §8 of
紀念日及節日實施條例; the script stops when rule() does not give the office calendars of 2026 and 2027 exactly. Solar terms after 2028 are a guess:
each term keeps its 2028 date."""
import csv, datetime, json, sys

if __name__ == "__main__" and len(sys.argv) != 6:
    sys.exit(__doc__)

START, END = datetime.date(2026, 1, 1), datetime.date(2034, 12, 31)
FIXED = {(1, 1): "開國紀念日", (2, 28): "和平紀念日", (4, 4): "兒童節", (5, 1): "勞動節", (9, 28): "孔子誕辰紀念日/教師節",
         (10, 10): "國慶日", (10, 25): "臺灣光復暨金門古寧頭大捷紀念日", (12, 25): "行憲紀念日"}
LUNAR = {(5, 5): "端午節", (8, 15): "中秋節"}
# 紀念日及節日實施條例 (民國114年5月28日), §3 and §5: the days that are not days off (§4, §6). Some of them are days
# off for some people only (§6: 消防節, 警察節, 軍人節, 海巡節); the model treats them as workdays for everyone.
OBSERVE = {(1, 19): "消防節", (3, 8): "婦女節", (3, 12): "國父逝世紀念日、植樹節", (3, 14): "反侵略日", (3, 21): "民族平等紀念日",
           (3, 29): "革命先烈紀念日、青年節", (3, 30): "國際醫師節", (4, 7): "言論自由日", (5, 12): "國際護理師節", (6, 5): "環境日",
           (6, 8): "國家海洋日", (6, 15): "警察節", (6, 26): "原住民族抵抗日", (7, 1): "漁民節", (7, 15): "解嚴紀念日", (8, 1): "原住民族日",
           (8, 8): "父親節", (8, 15): "終戰紀念日", (8, 23): "八二三紀念日", (9, 3): "軍人節", (9, 9): "國民體育日", (9, 21): "國家防災日",
           (10, 24): "臺灣聯合國日", (11, 8): "海巡節", (11, 12): "國父誕辰紀念日、中華文化復興節", (12, 3): "身心障礙者日",
           (12, 10): "人權日", (12, 18): "移民日", (12, 28): "全國客家日"}
OBSERVE_LUNAR = {(1, 1): "道教節", (1, 15): "元宵節", (4, 8): "佛陀誕辰日", (7, 15): "中元節", (9, 9): "重陽節"}

def observances(d, lunar, terms):
    names = [OBSERVE.get((d.month, d.day)), OBSERVE_LUNAR.get(lunar[d]), "農民節" if terms.get(d) == "立春" else None]
    if d.month == 5 and d.weekday() == 6 and 8 <= d.day <= 14: names.append("母親節")
    if d.month == 8 and d.weekday() == 6 and 22 <= d.day <= 28: names.append("祖父母節")
    return "、".join(n for n in names if n)

def days(a, b):
    while a <= b:
        yield a
        a += datetime.timedelta(1)

def read_lunar(path):
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for date, _, _, month, day, _ in r:
            if not date:  # the file ends with an empty row
                continue
            out[datetime.date.fromisoformat(date)] = (-int(month[1:]) if month.startswith("閏") else int(month), int(day))
    return out

def read_terms(path):
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for date, term, _ in r:
            if date and term != "-":
                out[datetime.date.fromisoformat(date)] = term
    return out

def read_office(path):
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        r = csv.reader(f); next(r)
        for day, _, off, note in r:
            out[datetime.date(int(day[:4]), int(day[4:6]), int(day[6:]))] = (off == "2", note)
    return out

def rule(first, last, lunar, terms):
    """Days off and holiday names from the start of year first to the end of year last: weekends, the holidays,
    and a 補假 for a holiday on a weekend (on the Friday before a Saturday, on the first free workday after a
    Sunday; for 春節 after the whole break). A 補假 can fall in the year before (2027-12-31 for 2028-01-01)."""
    a, b = datetime.date(first, 1, 1), datetime.date(last, 12, 31)
    names = {}
    for year in range(first, last + 1):
        for (m, d), name in FIXED.items():
            names[datetime.date(year, m, d)] = name
        qingming = next(d for d, t in terms.items() if t == "清明" and d.year == year)
        if qingming == datetime.date(year, 4, 4):  # §6: on the day of 清明, 兒童節 moves to the day before, or after it when that is a Thursday
            before = datetime.date(year, 4, 3)
            names[before if before.weekday() != 3 else datetime.date(year, 4, 5)] = "兒童節"
        names[qingming] = "清明節"
    for d in days(a, b):
        if (lunar[d][0], lunar[d][1]) in LUNAR:
            names[d] = LUNAR[lunar[d]]
        nxt = d + datetime.timedelta(1)
        if lunar[nxt] == (1, 1):  # 除夕 is the day before 正月初一, whether the month has 29 or 30 days
            names[d - datetime.timedelta(1)] = "小年夜"
            names[d] = "農曆除夕"
            for k in (1, 2, 3):
                names[d + datetime.timedelta(k)] = "春節"
    off = {d for d in days(a, b) if d.weekday() >= 5} | set(names)
    for d, name in sorted(names.items()):
        if d.weekday() < 5:
            continue
        if name in ("小年夜", "農曆除夕", "春節"):
            moved = d
            while names.get(moved) in ("小年夜", "農曆除夕", "春節") or moved in off:
                moved += datetime.timedelta(1)
        elif d.weekday() == 5:
            moved = d - datetime.timedelta(1)
        else:
            moved = d + datetime.timedelta(1)
            while moved in off:
                moved += datetime.timedelta(1)
        if moved not in off:
            off.add(moved)
            names[moved] = "補假"
    return off, names

def main(office115, office116, lunar_csv, terms_csv, out):
    lunar, terms = read_lunar(lunar_csv), read_terms(terms_csv)
    office = read_office(office115) | read_office(office116)
    # ponytail: solar terms after 2028 keep their 2028 date (a guess, off by about a day); use a term table when one exists.
    by_2028 = {(d.month, d.day): t for d, t in terms.items() if d.year == 2028}
    for d in days(datetime.date(2029, 1, 1), datetime.date(END.year + 1, 12, 31)):
        if (d.month, d.day) in by_2028:
            terms[d] = by_2028[(d.month, d.day)]
    # The year after END only feeds a 補假 that moves back into END's year.
    off, names = rule(START.year, END.year + 1, lunar, terms)
    guessed = {d: (d in off, names.get(d, "")) for d in days(START, END)}
    for d, want in office.items():
        if guessed[d] != want:
            sys.exit(f"rule() differs from the office calendar on {d}: {guessed[d]} vs {want}")
    table = []
    for d in days(START, END):
        is_off, name = office.get(d) or guessed[d]
        kind = 0 if not is_off else 1 if d.weekday() == 5 and not name else 2
        table.append([kind, *lunar[d], terms.get(d, ""), name, observances(d, lunar, terms)])
    json.dump({"start": START.isoformat(), "kinds": ["workday", "saturday", "holiday"], "days": table},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main(*sys.argv[1:])
