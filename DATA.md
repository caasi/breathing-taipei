# Data sources

> Note: Claude Opus 5.5 wrote this file.

The app reads the files in `web/public/`. This file lists the source, the license, and the processing of each file.

## Licenses

- **Open Government Data License, version 1.0** (政府資料開放授權條款－第1版, https://data.gov.tw/license). You can use, change, and share the data. You must keep the attribution statements below. The license is compatible with CC BY 4.0.
- **Open Database License (ODbL) 1.0** (https://opendatacommons.org/licenses/odbl/). Data from OpenStreetMap. © OpenStreetMap contributors. Changed versions of these files are also under ODbL 1.0.
- **MIT** for the `taiwan-atlas` package. Copyright (c) 2020 Daniel Kao. The full license text is in [web/public/licenses/taiwan-atlas-MIT.txt](web/public/licenses/taiwan-atlas-MIT.txt), so the built site serves it next to the data.

## Files

| File | Content | Source | License |
|---|---|---|---|
| `od2.json` | Average MRT trips per hour between the 41 districts of Taipei City and New Taipei City, for a workday, a Saturday off, and a Sunday or holiday | A, B, F, K | Open Government Data License |
| `villages2.json` | Residents, morning MRT arrivals, and center point of each village | A, B, C, D, F | Open Government Data License (source D not confirmed) |
| `signal.json` | Weekday daytime (07:00 to 13:00) and night population of each district | E | Open Government Data License |
| `road-graph.json` | Road graph built from bus route shapes | G | Open Government Data License (Taipei file not confirmed) |
| `road-lines.json` | The real shape of each edge of `road-graph.json`, for the map | G | Open Government Data License (Taipei file not confirmed) |
| `road-names.json` | The name of each edge of `road-graph.json`, for the jam events | H | ODbL |
| `mrt-graph.json` | MRT graph built from OpenStreetMap lines and station positions | B, H | ODbL 1.0 (lines) and Open Government Data License (station positions) |
| `transit.json` | MRT, light rail, railway, high speed rail, motorway and trunk lines, stations, and airport | H | ODbL 1.0 |
| `night.json` | Businesses of the night-time groups in each village | J, F | Open Government Data License |
| `road-routes.bin` (not in git, about 53.6 MB, 9.9 MB with `gzip -6`, on 2026-10-27) | Road paths of the app's run, made by `pnpm routes` before dev and build | G, and A to F and J through the model | Open Government Data License (Taipei shape file of G and source D not confirmed) |
| `calendar.json` | Each day from 2026-01-01 to 2034-12-31: workday, Saturday off or other day off, holiday name, lunar date, the solar term that starts that day, and the commemorative days and festivals that are not days off | K, L, M | Open Government Data License |
| `people.json` | The top 20 surnames of each district by sex, and the 300 most common surnames of Taiwan | N, O, C, D | Open Government Data License |
| `towns.json`, `villages2-topo.json` | District, county and village boundaries (TopoJSON). `towns.json` holds the 41 districts of the two cities from the `towns` object of `towns-10t.json`, and its whole `counties` object | F, I | MIT (package) and Open Government Data License (boundaries) |

## Sources and attribution statements

**A.** 臺北大眾捷運股份有限公司, 臺北捷運各站分時進出量統計 (data.gov.tw 128506), file for 2026-09.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**B.** 臺北大眾捷運股份有限公司, 臺北捷運車站出入口座標 (data.gov.tw 128428).
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**C.** 臺北市政府民政局, 臺北市各里人口數按年齡分 (data.gov.tw 136896), 2026-09 (民國 115 年 9 月).
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**D.** 內政部戶政司, 村里戶數、單一年齡人口 (open data API `ODRP014`, https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11509), New Taipei City, 2026-09.
Note: The license text for this API was not found on its page. The data is probably under the Open Government Data License. This is not confirmed.

**E.** 內政部統計處, 112年11月行政區電信信令人口統計資料_鄉鎮市區, 社會經濟資料服務平台 (SEGIS, https://segis.moi.gov.tw/STATCloud/). The SEGIS terms of use put open data that needs no application under the government open data license.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**F.** `taiwan-atlas` 2021.9.20 (https://github.com/dkaoster/taiwan-atlas), Copyright (c) 2020 Daniel Kao, MIT License (full text in `web/public/licenses/taiwan-atlas-MIT.txt`). The model uses `towns-10t.json` and `villages-10t.json`. The package builds them from the boundary data of source I.

**G.** 臺北市公共運輸處, bus route shapes for Taipei (`https://tcgbusfs.blob.core.windows.net/blobbus/GetBusShape.gz`) and New Taipei (`https://tcgbusfs.blob.core.windows.net/ntpcbus/GetBusShape.gz`). data.gov.tw lists the New Taipei bus data under the Open Government Data License, for example dataset 129022.
Note: The data.gov.tw entry for the Taipei shape file was not found. The license is probably the same. This is not confirmed.

**H.** © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Queried with the Overpass API on 2026-10-24, and `osm-hw/highways.json` on 2026-10-26 (OSM data of 2026-10-26T15:45:02Z).

**I.** 內政部國土測繪中心, 村里界圖(TWD97經緯度) (data.gov.tw 7438) and 鄉鎮市區界線(TWD97經緯度) (data.gov.tw 7441), through source F.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**J.** 財政部財政資訊中心, 全國營業(稅籍)登記資料集 (data.gov.tw 9400, https://eip.fia.gov.tw/data/BGMOPEN1.csv), extract of 2026-10-23.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**K.** 行政院人事行政總處, 中華民國政府行政機關辦公日曆表 (data.gov.tw 14718), the files for 115 (2026) and 116 (2027).
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**L.** 交通部中央氣象署, 日曆資料 (data.gov.tw 157677): 國農曆日期對照 (A-A0087-001, 2022 to 2050) and 節氣發生日期及時刻資料 (A-A0087-003, 2026 to 2028).
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**M.** 紀念日及節日實施條例 (全國法規資料庫, pcode D0020095, 民國114年5月28日公布), §3 to §6 and §8: the commemorative days and festivals, which of them are days off, and the 補假 rule. A law is not under copyright in Taiwan (著作權法 §9).

**N.** 內政部戶政司, 全國各鄉鎮市區前二十大姓人口數按性別分 (data.gov.tw 42518), 112年6月.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**O.** 內政部戶政司, 姓氏排名與人數按三階段年齡分 (data.gov.tw 126774), 112年.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

## Figures in the code

`web/src/sim/city.ts` also uses these figures:

- Mode share of the weekday trips of Taipei residents, 2024 (bus 13.7%, scooter 16.3%, car 20.1%, walk 20.8%, bike 3.8%, MRT 16.0%): 交通部統計處「民眾日常使用運具狀況調查」, as published in 臺北市政府主計處 市政統計週報 第1341號 (2025-07-16).
- Bus service hours, 05:00 to 24:00: most first buses leave at 05:00 or later and most last buses before 24:00, in the route files of Taipei (`https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz`) and New Taipei (`https://tcgbusfs.blob.core.windows.net/ntpcbus/GetRoute.gz`), read on 2026-10-24 (same provider as source G).
- MRT service hours, 06:00 to 24:00: on a workday `od2.json` has 43 trips in hour 05, 36,483 in hour 06, and 10,471 in hour 00 (the last trains). The model counts hour 00 as closed.
- YouBike rentals in Taipei, 234,000 a day on average in the first half of 2026 (市區公共自行車 平均每日租借 23.4 萬次): 臺北市政府主計處 市政統計週報, 2026-07-29, from data of 臺北市政府交通局.

`web/src/sim/people.ts` uses this figure and these guesses:

- Share of residents named by a nickname with no title (a person outside the binary), 1.6%: Pew Research Center, 2022-06-07, "About 5% of young adults in the U.S. say their gender is different from their sex assigned at birth". 1.6% of U.S. adults are transgender or nonbinary. The report does not give the share of nonbinary adults alone for all ages (it gives 3.0% for adults younger than 30), so 1.6% is an upper bound. It is a U.S. figure: no figure for Taiwan was found (searched on 2026-10-24). The user chose it as a placeholder.
- The nickname patterns (阿 or 小 with one character, a doubled character, a food or a thing, an English name) are a guess. A search on 2026-10-24 found no commonly used Chinese names or titles for non-binary people.
- The sex split of a district's residents is that of its top 20 surnames (source N); `villages2.json` has no split by sex.

`web/src/sim/events.ts` and `web/src/sim/worker.ts` use these figures and guesses for the events:

- The 2026 local election is on 115年11月28日 (Saturday), voting from 08:00 to 16:00: 中央社, 2026-08-20, on the notice of 中央選舉委員會 (https://cna.com.tw/news/aipl/202608200078.aspx).
- The new mayors take office on 12月25日: 蔣萬安 on 2022-12-25 (Taiwan News, https://www.taiwannews.com.tw/ch/news/4761550) and 柯文哲 on 2018-12-25 (公視, https://news.pts.org.tw/article/417381). 2026-12-25 is a guess from those two elections; 2014 was not confirmed.
- About 48 personal events a day as the base (`EVENTS_PER_DAY`), with the weights `SHOWN`: 0.25 for a plan to work, 0.05 for a day at home, 1 for an outing on a day off, 3 for a day away. The user chose the weights by eye, and raised the weight of a plan to work from 0.05 on 2026-10-24, because a workday showed 2 to 5 personal events against 11 public ones. Measured at village level, seed 42, from 2026-10-24 (a one-off script that runs the filter of `worker.ts` on the model for 14 days): 27, 24 and 21 personal events on the days off 10-24 to 10-26, 19, 13, 11 and 8 on the workdays 10-27 to 10-30, 21 and 24 on 10-31 and 11-01, and 17, 18, 9, 12 and 8 on the workdays 11-02 to 11-06. With the weight 0.05 the same days gave 17, 14, 16, then 5, 2, 3, 2, then 14, 16, then 3, 5, 4, 2, 2. The public events are 9 to 11 a day.
- Since 2026-10-24 (#10), the stream picks the plans by error diffusion (`evenPick` in `web/src/sim/events.ts`) instead of one draw for each plan, and a shown trip to work or to a day-off place also shows its way home. Measured as above for 14 days: 44, 43 and 40 personal events on 10-24 to 10-26, 24 on each workday, 45 and 42 on 10-31 and 11-01. The longest time with no personal event between 06:00 and 24:00 is 1.3 to 3.7 hours (it was 4.7 to 12.8 hours with one draw for each plan and no way home). About 16 % of the personal events have the home district of one of the 3 events before them on the panel; a rule that skipped the last 3 districts brought this only to 10 % and moved the shows of day 0 to the first village of each district, so it was dropped.
- A day-off departure falls between 05:00 and 17:00 (`DAYTIME` in `core.ts`), weighted by that day's OD. The window is a guess.
- A day at home shows as an event at 09:00 of that day. The hour is by eye.
- The greetings of the city: most of their times follow the model (the breakfast shifts, the first buses and trains, the workday peak, dinner, nights out, the overnight shift, the last trains). Their wording, and the 03:00 and 12:00 greetings, are by eye.

`scripts/days.py` and `web/src/sim/calendar.ts` use these guesses for the days that no source covers:

- Days off from 2028 to 2034 follow source M, and the script stops when this rule does not give 2026 and 2027 as source K does: weekends; 開國紀念日, 和平紀念日, 兒童節, 清明節 (the day of the solar term 清明), 勞動節, 教師節, 國慶日, 臺灣光復暨金門古寧頭大捷紀念日 and 行憲紀念日; 小年夜 to 春節 初三, 端午節 and 中秋節 on their lunar dates. A holiday on a Saturday gives a 補假 on the Friday before, and a holiday on a Sunday on the first free workday after; for 春節 the 補假 comes after the whole break. 兒童節 on the day of 清明 moves to the day before, or to the day after when the day before is a Thursday. When a 補假 would fall on a day that is already off (in 2031, 兒童節 is moved to Saturday 4/5 and the Friday before is 清明), there is no 補假: source M does not say where it goes. The user asked to reuse the last year with data. A change in the law after 2026-10-24 is not in it.
- Solar terms from 2029 to 2034 keep their 2028 date. A real term can be one day earlier or later.
- After 2034-12-31 the table ends: a Saturday or a Sunday is a day off, there are no holidays, and the clock shows no lunar date. The greetings of the city go on, by the weekday.
- The first simulated day is the day the page opens, in Taiwan (UTC+8).

`web/src/sim/city.ts` and `web/src/sim/core.ts` use these guesses for days off (the user agreed on 2026-10-24):

- The share of commuters away from Taipei and New Taipei for the day: 5% on a Saturday off, 8% on a Sunday or holiday, also a Saturday that is a holiday (`AWAY_SHARE`). The user said that many people go abroad or to another county; no source gives a share.
- The share of commuters who go out on a day off is the district's trips on that kind of day over its workday trips, from the MRT data only.
- On a day off, the trips that are not MRT trips keep the workday ratio to MRT trips for each pair of districts. Only the workday has telecom data.
- Each commuter has one day-off place, drawn once from all trips of both kinds of day off.
- 20 districts have no MRT trips at all in source A (三峽, 三芝, 五股, 八里, 坪林, 平溪, 林口, 樹林, 汐止, 泰山, 深坑, 烏來, 瑞芳, 石碇, 石門, 萬里, 貢寮, 金山, 雙溪, 鶯歌; 1,119,795 of the 6,453,427 residents). For a pair of districts with no MRT trips, a day off takes the workday trips of all modes times the city's day-off ratio (MRT trips of that kind of day over workday MRT trips: 0.853 on a Saturday off, 0.699 on a Sunday or holiday), spread over the hours of the city's day-off MRT trips. A district with no MRT trips goes out at the same city ratio. The user chose this guess on 2026-10-24.
- The night-time groups (`SHIFTS`, `VISITS`) make the same trips on every day.
- A commuter who is away for the day leaves and comes back at the hours of the day-off trips inside its home district. No source gives the hours of trips out of the two cities.

`scripts/villages.py` and `web/src/sim/city.ts` use these figures and guesses for the jobs of 內湖科技園區:

- 166,322 employees at the end of 108 (2019): 臺北市政府產業發展局, 「建構臺北科技走廊，提升園區發展機能」 (https://doed.gov.taipei/News_Content.aspx?n=7A86CE12E01A9E9E&sms=F6E4BC790FC874BE&s=1183BAE25BBFB9CB), checked on 2026-10-27. No newer official count was found (KNOWN-ISSUES.md).
- The employees are spread over the villages of 內湖區 by the number of companies of the company list in each: 2,154 in 港墘里 (63000100005), 1,600 in 63000100001, 1,365 in 63000100030, 568 in 63000100002, 3 in two other villages, and 2 outside 內湖區 (left out). Each company counts the same, which is a guess: the list has no employees. Not checked: the license of the company list. An agent search saw only 「公開」 on its data.taipei page, with no named license; `villages2.json` keeps only the counts by village.
- The road load of a trip to work ends at one of up to 4 street nodes of the village (`ENDS` in `web/src/sim/jobs.ts`, a guess), fixed by the agent; each street node belongs to the nearest village centre. The same rule holds for every village, so that the trips go into the streets of a village and not only to the node nearest its centre. The dots still go to the road node of the village.
- The dots of scooters take the streets-only variant, like their road load. The dots of cars and buses take the fastest variant, also when a car driver chose another one by the live traffic (the dots do not follow that choice). A trip that the routes file does not hold is routed in the page on the fastest path, also for a scooter.
- In a district with known jobs, the known jobs take their share of the morning arrivals of the district (the OD of 05:00 to 11:59), at most all of them; the rest of the arrivals are spread as before. The model has 120,125 morning arrivals in 內湖區, fewer than 166,322, so all of them go to the villages of the park, and the other villages of 內湖區 get no commuters. Day-off places do not use the known jobs: they keep the spread of MRT arrivals and residents (`toPlay`).
- 台塑企業 moved about 4,600 employees to its head office at 南京東路六段380號 in 2023 (工商時報, 2023-10-23). They are not in the model: the village of the address is not known yet.

`web/src/sim/traffic.ts` (the traffic layer) uses these figures and guesses:

- The travel time on a road comes from the BPR function (Bureau of Public Roads): free time x (1 + 0.15 (volume / capacity)^4). The values 0.15 and 4 are the usual defaults. They are the same for every road.
- The source of 0.15 and 4 is not confirmed. Only secondary sources were found (searched on 2026-10-26), and they do not agree:
  - Most sources give the year 1964 and the *Traffic Assignment Manual* of the Bureau of Public Roads. The manual itself was not found.
  - A report of the U.S. Department of Transportation says that the Bureau fitted a polynomial to the speed-flow curves of freeways in the *Highway Capacity Manual* of 1965 (https://rosap.ntl.bts.gov/view/dot/40540/dot_40540_DS1.pdf). This does not agree with the year 1964.
  - One source says that the Bureau used road surveys and regression. It does not say how the two values were chosen.
  - With 0.15, the travel time at capacity is 1.15 times the free time (a speed of about 87% of the free speed). So 0.15 can be a value that was set, not a value that was fitted.
  - To confirm the source, read the *Traffic Assignment Manual* (1964), or the reviews by Sheffi or Branston that cite it.
- Later work changed the curve: the *Highway Capacity Manual* of 1994 made the speed-flow curve flatter, and one source gives 0.05 and 10 for urban trunk roads (MDPI Applied Sciences 13(24):13318).
- `CAPACITY`, 184 people per km of street in a bucket: fitted by `scripts/traffic.ts`. On the workday 2026-10-27 (seed 42, 10 people per agent, village level), the extra travel time of the people on the roads of the cells of 台北市, from 07:00 to 09:45, is 64.6% within 0.5 points. This is the morning congestion level of 台北市 in the TomTom Traffic Index 2025 (https://www.tomtom.com/traffic-index/city/taipei/, read on 2026-10-26). It is a scale factor, not a physical capacity: the road graph has the shapes of bus routes and the 國道 and 快速道路 of OSM, the lanes of each class are guesses (below), and the load holds only the agents of the model.
- With this capacity, the evening level (17:00 to 19:45) is 61.7% and the morning level is 64.8% (2026-10-27). The routes follow the traffic, so `scripts/traffic.ts` bisects the capacity instead of one BPR step.
- A named road of a cell (road-names.json) is a bucket of its own, and counts at most 0.55 km (`ACROSS`, about the width of a cell; a guess): the edges of 瑞光路 in one cell added up to 7.9 km, from many bus shapes and from small roads near it that took its name. The roads with no name of each class in a cell are one bucket.
- The travel time of a bucket is at most 4 times the free time (`MOST`, a guess). BPR grows without limit past capacity, and a few ramps at 10 to 25 times the free time carried the mean that the fit matches.
- The roads of each class in a cell are taken apart (a bucket), with a capacity of `CAPACITY` times `LANES`: 1 for a street, 3 for a 國道, 2 for a 快速道路 and 0.5 for a ramp. These are guesses for the lanes. Before, one capacity for all roads of a cell made a cell with an interchange look free, as its many km of 國道 and ramps thinned out the load. TomTom gives 92% for the evening. The model has fewer people on the road in the evening than in the morning, and it has no trips such as school runs or shopping.
- The cell of the road load (`CELL`, 0.005 degrees, about 500 m; it was 0.01 degrees until 2026-10-27): a guess. Each trip takes one shortest path, so on single edges only about 3,000 of the 29,404 edges had any load, and a few of them showed 14 to 25 times the free time (measured on 2026-10-26). The people per km of road in a cell stand in for the flow of BPR.
- Jam events (`web/src/sim/worker.ts`), all by eye: at most one each take of the traffic, at most one each day for each character, from a road at red or worse (2 times the free time or more; colour level 0.43 in `traffic.ts` `cellLevels`). A character's temper is fixed by its index: about 55% go by the jam (angry from 2.75 times the free time, colour level 0.75, else stuck), 20% go blank, and on the way to work 17% work by phone and 8% take leave before noon (after noon they work by phone). Taking leave does not change the plan.
- The traffic is taken at each boundary of 15 simulated minutes (`JAM_MINUTES` in `web/src/sim/worker.ts`, a guess), whatever the speed of the run, so a seed gives the same run at any speed; the jam events are picked with a seeded random number too. Before the routes file has loaded, no traffic is taken, so the first minutes of a run depend on how fast the file loads.
- A jam makes a trip longer: when a road trip is first seen on the road, the leg it is on takes the travel time of its path over the free time as many times longer (at most 4 times, from `MOST`; `slowDown` in `core.ts`), so a jam keeps more people on the road. A jam on the way there can make a trip arrive after its planned leaving time; the character then leaves later, and its way home in the event list moves with it. A jam on a day-off outing can bring the character home after midnight, though the plan made the outing end on its own day. The user accepted this on 2026-10-27: it matches what they remember.
- Route choice (`web/src/sim/traffic.ts`), guesses: 60% of car drivers follow the live traffic; a bus keeps its fixed route (the fastest variant stands in for it), and a jam still slows it. When their trip is first seen on the road, they take the variant with the least free time times the slowness of each bucket at the last take; the others take the fastest variant.
- The colours of the map are chosen by eye: a free road is a faint white line, and a slow road turns orange at 1/0.7, red at 1/0.5 and dark red at 1/0.3 times the free time, with the colours between them blended (`STOPS` in `web/src/ui/Traffic.tsx`). The other constants of the traffic layer are also by eye: the width of a road (`WIDTH_PX`), the glow of slow roads (`GLOW_FROM`, `GLOW_LEVELS`, `GLOW_GAIN`) and the moving dashes on roads in use (`FLOW_PERIOD`, `FLOW_FAST`, `FLOW_SLOW`). The borders of the villages and districts are in the blue of the place names of the event list, so that they stay apart from the roads.

## Processing

- `od2.json`: Built by `scripts/od.py` from source A, with the exit positions of source B, the district boundaries of source F, and the days off of source K. Each station goes to the district that holds the mean position of its exits. Each day of the month is a workday (20 days in September 2026), a Saturday off with no holiday (4 days), or a Sunday or holiday (6 days: the Sundays, 中秋 on 9/25 and 教師節 on 9/28). A Saturday that is a holiday (2027-02-06, 春節) counts as a holiday; September 2026 has none, so `od2.json` is the same either way. Trips are added up per district and divided by the number of days of that kind. Until 2026-10-24 the file had only the workday, and it counted 9/25 and 9/28 as workdays (the mean of all 22 Monday-to-Friday days).
- `towns.json` and `villages2-topo.json`: Built by `scripts/atlas.py`. The arcs and the transform of source F stay whole. Only the objects are cut to the two cities, and `towns.json` keeps the `counties` object of all of Taiwan.
- `villages2.json`: Built by `scripts/villages.py`. Residents from sources C and D. New Taipei has 30 villages that source F does not show. Their residents go to the other villages of the same district, in proportion to residents. Arrivals are the morning (05:00 to 11:59) trips that end at the stations in each village, summed over all 30 days of September 2026 (weekdays and weekends). The model divides them by 30 to get a daily number.
- `signal.json`: Built by `scripts/telecom.py`. The columns `DAY_WORK(0700~1300)` and `NIGHT_WORK` of source E for the 41 districts.
- `transit.json`: Built by `scripts/transit.py` from four Overpass responses (source H). Its docstring gives the queries and the colour of each line.
- `road-graph.json` and `mrt-graph.json`: Built by `scripts/graphs.py`. Points snap to a grid of about 120 m (roads) or 10 m (MRT), and the points in one grid cell become one node. Nodes with exactly two neighbors become points inside an edge, except stations and one node of each separate loop (a component in which every node has two neighbors). The points inside each edge are simplified (Douglas-Peucker, about 20 m). The 國道, 快速道路 and their ramps of `osm-hw/highways.json` do not snap to the grid: they meet each other at shared OSM nodes, and the streets at the free end of a ramp or a road (the nearest street node within 2 cells), and, for a 快速道路 that is not a bridge or a tunnel, at each of its points that falls in a cell of a street. Each of these road edges has a class (1 國道, 2 快速道路, 3 ramp or link). An edge whose OSM way is one-way (the `oneway` tag; a 國道 and its ramps are one-way when the tag is missing) runs only from its first node to its second: 2,191 of 32,550 road edges on 2026-10-27. Before, routing drove these edges both ways, and at 08:45 on 2026-10-27, 5,602 of 11,657 road trips (48%) took a ramp against its direction. Routing weighs an edge by its time: street 25, 國道 80, 快速道路 60 and ramp 40 km/h, and a wait of 30 s at a traffic light at each street node where 3 or more edges meet, half of it on each edge that ends there (`SIGNAL` in `web/src/sim/route.ts`). All of these are guesses. A road traveller is placed along its path by this time, so it stays longer where streets meet. Trips start and end only on street nodes. `scripts/routes.ts` writes up to three variants of each path: the fastest, on streets only, and the shortest in metres. A scooter takes the streets-only variant (in Taiwan a scooter cannot take a 國道 or a 快速道路), unless no streets-only path exists. Each station is a node at the mean position of its exits. It links to the nearest point of each MRT line within 350 m, at a cost of 300 m for boarding or changing lines.
- `night.json`: Built by `scripts/night.py`. Each business of source J with an address in Taipei or New Taipei goes to a group by its industry code: early (561111 breakfast shops), food (other 5611 restaurants, 561200 food stalls, 563112, 563113, 563115 and 563199 drink shops, 563200 drink stalls), convenience (471112 to 471114), hotel (551011, 551012), and nightlife (563114 bars, 9322 karaoke, 9323 places with hostesses, 969012 saunas). It goes to a village by the 里 in its address, with 羣, 峯 and 臺 read as 群, 峰 and 台 on both sides. A business without a 里, with a 里 that source F does not have, or with a 里 written in private-use characters, is spread over the villages of its district in proportion to the businesses of its group that matched. If none of its group matched in that district, it is spread in proportion to residents (this occurs for a few small groups in some districts of New Taipei, mostly on the north coast, for example 金山區 and 萬里區, and also 五股區 and 平溪區).
- `road-lines.json`: Built by `scripts/graphs.py` with `road-graph.json`, in the same order of edges. For each edge it holds the bus shape points that the edge stands for, not snapped to the grid: from each grid cell to the next, the points of the first shape that crosses between the two cells. The points are simplified (Douglas-Peucker, about 2 m). Routing uses `road-graph.json`; the map draws this file.
- `road-names.json`: Built by `scripts/names.py` from the named roads of OSM (source H) and `road-lines.json`. Each edge takes the name of the nearest named road of a kind that its class may take, within 30 m of the middle of the edge (`MAX_M`, a guess), else no name. A street edge takes only a street name, and a 快速道路 that is a bridge, a viaduct or a tunnel names only 快速道路 edges.
- `road-routes.bin`: Built by `scripts/routes.ts` from `road-graph.json` and the model (seed 42, 10 people per agent, village and district level). It holds the road path between every pair of road nodes that a bus, scooter or car trip of that run uses and that the road graph connects, and the path back when it is not the path there reversed. The one-way roads make most paths back differ, so the file is about twice the size it had with paths back as reversed paths.
- `people.json`: Built by `scripts/people.py` from sources N and O, with the residents of `villages2.json`. A district's people outside its top 20 take the national ranking without those 20. The 300 most common surnames hold 99.6% of the people of Taiwan.
- `calendar.json`: Built by `scripts/days.py` from sources K and L. Its docstring lists the input files and their addresses.
- Each file in `web/public/` has a script in `scripts/`, except `og.png` (the preview image for shared links) and the license texts. The docstring of each script gives its inputs, their URLs and the command.

## Raw downloads

The raw downloads are in `data/`, which git ignores (678 MB on 2026-10-24). Only the machine of the user has them. To get a file again, use the URL in the docstring of the script that reads it. A new download can give different data, because most sources change: OpenStreetMap, the registry of source J, and the latest month of sources A, C and D.

| Path in `data/` | Source | Read by |
|---|---|---|
| `atlas/towns-10t.json` | F | `atlas.py` |
| `atlas/villages-10t.json` | F | `atlas.py`, `villages.py` |
| `pop/vage.csv` | C | `villages.py` |
| `ris/ODRP014.json` | D | `villages.py` |
| `dt/exits.csv` | B | `villages.py`, `od.py`, `graphs.py` |
| `dt/od-202609.csv` | A (the URL of each month is in `dt/index.csv`) | `villages.py`, `od.py` |
| `signal/segis_112Y11M_town.zip` | E (download it in a browser: the page has no direct link) | `telecom.py` |
| `osm/rail.json` | H | `transit.py`, `graphs.py` |
| `osm/stations.json`, `osm/airport.json`, `osm-hw/hw.json` | H | `transit.py` |
| `osm-hw/highways.json` (query: `scripts/queries/highways.overpassql`) | H | `graphs.py` |
| `osm/streets.json` (query: `scripts/queries/streets.overpassql`, OSM data of 2026-10-26T15:55:11Z) | H | `names.py` |
| `jobs/neihu-companies.csv` (臺北市內湖科技園區廠商名錄, 臺北市政府產業發展局, data.taipei, downloaded on 2026-10-27; the URL is in the docstring of `villages.py`) | (data.taipei) | `villages.py` |
| `bus/tpe_GetBusShape.gz`, `ntpc-transit/ntpc_GetBusShape.gz` | G | `graphs.py` |
| `calendar/office-115.csv` | K | `days.py`, `od.py` |
| `calendar/office-116.csv` | K | `days.py` |
| `calendar/cwa-A-A0087-001.csv`, `calendar/cwa-A-A0087-003.csv` | L | `days.py` |
| `people/top20-11206.csv` | N | `people.py` |
| `people/ranking-112.csv` | O | `people.py` |
| `night/BGMOPEN1.csv` | J | `night.py` |

No script reads the other files in `data/`. They are the Overpass queries (`osm/q*.txt`, `osm-hw/q.txt`), responses that no file uses (`osm/tpe.json`, and `osm/mrt.json`, which is a 504 error page), intermediate files of the first one-off steps, and the pages and PDFs that the figures of the code come from.

## Dependencies

Some scripts read a file that another script writes into `web/public/`:

| File | Made by | Reads from `web/public/` |
|---|---|---|
| `towns.json`, `villages2-topo.json` | `atlas.py` | (none) |
| `villages2.json` | `villages.py` | (none) |
| `signal.json` | `telecom.py` | (none) |
| `transit.json` | `transit.py` | (none) |
| `road-graph.json`, `road-lines.json`, `mrt-graph.json` | `graphs.py` | (none) |
| `road-names.json` | `names.py` | `road-graph.json`, `road-lines.json` |
| `calendar.json` | `days.py` | (none) |
| `od2.json` | `od.py` | `towns.json` |
| `people.json` | `people.py` | `villages2.json` |
| `night.json` | `night.py` | `villages2-topo.json`, `villages2.json` |
| `road-routes.bin` | `routes.ts` | `od2.json`, `villages2.json`, `signal.json`, `night.json`, `road-graph.json`, `mrt-graph.json` |

So after you change a file, run again each script that reads it. Then run the scripts that read their output. For example, a change to `villages2.json` changes `people.json`, `night.json` and `road-routes.bin`.

`villages.py` also imports `station_points`, `lookup` and `inside` from `od.py`, so that both scripts put a station at the same point.

To rebuild every file in git, run `pnpm data` in `web/`. It runs `scripts/data.sh`, which runs the scripts in this order and then fails if a file in `web/public/` is different from git. The scripts write over the files in `web/public/`, so `data.sh` does not start when `web/public/` has a change that is not in git. Commit or stash the change first. In a git worktree, set `DATA` to the `data/` directory of the main checkout. `pnpm dev` and `pnpm build` run `routes.ts`, so `pnpm data` does not make `road-routes.bin`. On 2026-10-26 the run took 28 s and gave the files in git byte for byte.

## Estimates

The README lists the parts of the model that are estimates, not data.
