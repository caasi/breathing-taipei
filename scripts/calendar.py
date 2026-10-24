"""One entry per day from 2026-01-01 to 2034-12-31: the kind of day, the holiday, the lunar date and the solar term.

Usage:
  python3 scripts/calendar.py OFFICE_115 OFFICE_116 LUNAR_CSV TERMS_CSV OUT_JSON

  OFFICE_115, OFFICE_116  data.gov.tw 14718 (中華民國政府行政機關辦公日曆表), the files for 2026 and 2027
  LUNAR_CSV   中央氣象署 A-A0087-001 (國農曆日期對照, data.gov.tw 157677), 2022 to 2050:
              https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/A-A0087-001?Authorization=rdec-key-123-45678-011121314&format=CSV
  TERMS_CSV   中央氣象署 A-A0087-003 (節氣發生日期及時刻資料, data.gov.tw 157677), 2026 to 2028:
              https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/A-A0087-003?Authorization=rdec-key-123-45678-011121314&format=CSV
  OUT_JSON    writes calendar.json: {"start": "2026-01-01", "kinds": [...], "days": [[kind, lunar month, lunar day, term, holiday], ...]}

The kind of day is 0 (a workday), 1 (a Saturday off) or 2 (another day off: a Sunday or a holiday).
A lunar month below 0 is a leap month. term is the solar term that starts that day, or "".

2026 and 2027 come from the office calendars. Later years are a guess by rule(), the rule of 2026 and 2027;
the script stops when rule() does not give those two years exactly. Solar terms after 2028 are a guess:
each term keeps its 2028 date."""
import csv, datetime, json, sys

if __name__ == "__main__" and len(sys.argv) != 6:
    sys.exit(__doc__)

START, END = datetime.date(2026, 1, 1), datetime.date(2034, 12, 31)
FIXED = {(1, 1): "開國紀念日", (2, 28): "和平紀念日", (4, 4): "兒童節", (5, 1): "勞動節", (9, 28): "孔子誕辰紀念日/教師節",
         (10, 10): "國慶日", (10, 25): "臺灣光復暨金門古寧頭大捷紀念日", (12, 25): "行憲紀念日"}
LUNAR = {(5, 5): "端午節", (8, 15): "中秋節"}

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
        if qingming == datetime.date(year, 4, 4):  # 兒童節 on the day of 清明 moves to the day before
            names[datetime.date(year, 4, 3)] = "兒童節"
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
        kind = 0 if not is_off else 1 if d.weekday() == 5 else 2
        table.append([kind, *lunar[d], terms.get(d, ""), name])
    json.dump({"start": START.isoformat(), "kinds": ["workday", "saturday", "holiday"], "days": table},
              open(out, "w"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main(*sys.argv[1:])
