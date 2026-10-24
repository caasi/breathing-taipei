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
| `od2.json` | Average weekday trips per hour between the 41 districts of Taipei City and New Taipei City | A, B, F | Open Government Data License |
| `villages2.json` | Residents, morning MRT arrivals, and center point of each village | A, B, C, D, F | Open Government Data License (source D not confirmed) |
| `signal.json` | Weekday daytime (07:00 to 13:00) and night population of each district | E | Open Government Data License |
| `road-graph.json` | Road graph built from bus route shapes | G | Open Government Data License (Taipei file not confirmed) |
| `mrt-graph.json` | MRT graph built from OpenStreetMap lines and station positions | B, H | ODbL 1.0 (lines) and Open Government Data License (station positions) |
| `transit.json` | MRT, light rail, railway, high speed rail, motorway and trunk lines, stations, and airport | H | ODbL 1.0 |
| `night.json` | Businesses of the night-time groups in each village | J, F | Open Government Data License |
| `towns.json`, `villages2-topo.json` | District and village boundaries (TopoJSON) | F, I | MIT (package) and Open Government Data License (boundaries) |

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

**H.** © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Queried with the Overpass API on 2026-10-24.

**I.** 內政部國土測繪中心, 村里界圖(TWD97經緯度) (data.gov.tw 7438) and 鄉鎮市區界線(TWD97經緯度) (data.gov.tw 7441), through source F.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

**J.** 財政部財政資訊中心, 全國營業(稅籍)登記資料集 (data.gov.tw 9400, https://eip.fia.gov.tw/data/BGMOPEN1.csv), extract of 2026-10-23.
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

## Figures in the code

`web/src/sim/city.ts` also uses figures that are not data files:

- Mode share of Taipei residents, 2024 (bus 13.7%, scooter 16.3%, car 20.1%, walk 20.8%, bike 3.8%, MRT 16.0%): 交通部統計處「民眾日常使用運具狀況調查」, as published in 臺北市政府主計處 市政統計週報 第1341號 (2025-07-16).
- Bus service hours, 05:00 to 24:00: most first buses leave at 05:00 or later and most last buses before 24:00, in the route files of Taipei (`https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz`) and New Taipei (`https://tcgbusfs.blob.core.windows.net/ntpcbus/GetRoute.gz`), read on 2026-10-24 (same provider as source G).
- YouBike rentals in Taipei, 234,000 a day on average in the first half of 2026 (市區公共自行車 平均每日租借 23.4 萬次): 臺北市政府主計處 市政統計週報, 2026-07-29, from data of 臺北市政府交通局.

## Processing

- `od2.json`: Weekday rows of source A. Each station goes to a district by the mean position of its exits (source B) and the district boundaries (source F). Trips are added up per district and divided by the number of weekdays.
- `villages2.json`: Residents from sources C and D. New Taipei has 30 villages that source F does not show. Their residents go to the other villages of the same district, in proportion to residents. Arrivals are the morning (05:00 to 11:59) trips that end at the stations in each village, summed over all 30 days of September 2026 (weekdays and weekends). The model divides them by 30 to get a daily number.
- `signal.json`: The columns `DAY_WORK(0700~1300)` and `NIGHT_WORK` of source E for the 41 districts.
- `road-graph.json` and `mrt-graph.json`: Built by `scripts/graphs.py`. Points snap to a grid of about 120 m (roads) or 10 m (MRT), and the points in one grid cell become one node. Nodes with exactly two neighbors become points inside an edge, except stations and one node of each separate loop (a component in which every node has two neighbors). The points inside each edge are simplified (Douglas-Peucker, about 20 m). Each station is a node at the mean position of its exits. It links to the nearest point of each MRT line within 350 m, at a cost of 300 m for boarding or changing lines.
- `night.json`: Built by `scripts/night.py`. Each business of source J with an address in Taipei or New Taipei goes to a group by its industry code: early (561111 breakfast shops), food (other 5611 restaurants, 561200 food stalls, 563112, 563113, 563115 and 563199 drink shops, 563200 drink stalls), convenience (471112 to 471114), hotel (551011, 551012), and nightlife (563114 bars, 9322 karaoke, 9323 places with hostesses, 969012 saunas). It goes to a village by the 里 in its address, with 羣, 峯 and 臺 read as 群, 峰 and 台 on both sides. A business without a 里, with a 里 that source F does not have, or with a 里 written in private-use characters, is spread over the villages of its district in proportion to the businesses of its group that matched. If none of its group matched in that district, it is spread in proportion to residents (this occurs for a few small groups in some districts of New Taipei, mostly on the north coast, for example 金山區 and 萬里區, and also 五股區 and 平溪區).
- Only `scripts/graphs.py` and `scripts/night.py` are in the repository. Their docstrings list the input files and the commands. The other files came from one-off steps that are not in the repository yet.

## Estimates

The README lists the parts of the model that are estimates, not data.
