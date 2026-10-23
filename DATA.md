# Data sources

> Note: Claude Opus 5.5 wrote this file.

The app reads the files in `web/public/`. This file lists the source, the license, and the processing of each file.

## Licenses

- **Open Government Data License, version 1.0** (政府資料開放授權條款－第1版, https://data.gov.tw/license). You can use, change, and share the data. You must keep the attribution statements below. The license is compatible with CC BY 4.0.
- **Open Database License (ODbL) 1.0** (https://opendatacommons.org/licenses/odbl/). Data from OpenStreetMap. © OpenStreetMap contributors. Changed versions of these files are also under ODbL 1.0.
- **MIT** for the `taiwan-atlas` package.

## Files

| File | Content | Source | License |
|---|---|---|---|
| `od2.json` | Average weekday trips per hour between the 41 districts of Taipei City and New Taipei City | A, B, F | Open Government Data License |
| `villages2.json` | Residents, morning MRT arrivals, and center point of each village | A, B, C, D, F | Open Government Data License |
| `signal.json` | Weekday daytime (07:00 to 13:00) and night population of each district | E | Open Government Data License |
| `road-graph.json` | Road graph built from bus route shapes | G | Open Government Data License |
| `mrt-graph.json` | MRT graph built from OpenStreetMap lines and station positions | B, H | ODbL 1.0 |
| `transit.json` | MRT, light rail, railway, high speed rail, motorway and trunk lines, stations, and airport | H | ODbL 1.0 |
| `towns.json`, `villages2-topo.json` | District and village boundaries (TopoJSON) | F | MIT (package), data from the Ministry of the Interior |

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

**F.** `taiwan-atlas` 2021.9.20 (https://github.com/dkaoster/taiwan-atlas), MIT, with data from the Ministry of the Interior. The model uses `towns-10t.json` and `villages-10t.json`.

**G.** 臺北市公共運輸處, bus route shapes for Taipei (`https://tcgbusfs.blob.core.windows.net/blobbus/GetBusShape.gz`) and New Taipei (`https://tcgbusfs.blob.core.windows.net/ntpcbus/GetBusShape.gz`). data.gov.tw lists the New Taipei bus data under the Open Government Data License, for example dataset 129022.
Note: The data.gov.tw entry for the Taipei shape file was not found. The license is probably the same. This is not confirmed.

**H.** © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Queried with the Overpass API on 2026-10-24.

## Processing

- `od2.json`: Weekday rows of source A. Each station goes to a district by the mean position of its exits (source B) and the district boundaries (source F). Trips are added up per district and divided by the number of weekdays.
- `villages2.json`: Residents from sources C and D. New Taipei has 30 villages that source F does not show. Their residents go to the other villages of the same district, in proportion to residents. Arrivals are the morning (05:00 to 11:59) trips that end at the stations in each village.
- `signal.json`: The columns `DAY_WORK(0700~1300)` and `NIGHT_WORK` of source E for the 41 districts.
- `road-graph.json` and `mrt-graph.json`: Built by `scripts/graphs.py`. Points closer than about 120 m (roads) or 10 m (MRT) become one node. Nodes with exactly two neighbors become points inside an edge. MRT lines connect through station nodes.
- Only `scripts/graphs.py` is in the repository. The other files came from one-off steps that are not in the repository yet.

## Estimates

The README lists the parts of the model that are estimates, not data.
