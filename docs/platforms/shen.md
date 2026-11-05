# 沈伯洋: policy platform

> Note: Claude Opus 5.5 collected this list on 2026-11-05 for https://github.com/caasi/breathing-taipei/issues/11. This first version has the traffic policies only. The user asked for this scope, because the model of the traffic is the most complete part of the simulation.

## Sources

- The pages of the campaign site under https://puma.taipei/policies. Each page states "本頁圖文採用 CC BY 4.0 授權" in its footer. The quotes below come from these pages, word for word.
- The HEART policy islands (https://puma.taipei/heart-island) use the data file `policies.json`. That file states no license, so git does not keep it. Its short texts (`plain`) are not the words of the pages: for 6 of the 7 transport policies, the text of `plain` is not on the page. The names of the policies below come from this file, and the quotes do not.
- The page 交通政策 links to a PDF of slides, https://media.puma.taipei/files/141/01M2KZHJ2GFQPFYZ5XXPGNS7XG.pdf (21 pages, made on 2026-09-14). The PDF states no license, and pages 15 and 16 use Google Earth images, so git does not keep it. This list gives its facts, not its images.
- `sh scripts/platforms.sh` downloads the file, the 15 pages and the PDF into `data/platforms/shen/`. `SHA256SUMS` gives the version that this list comes from (downloaded on 2026-11-05, `verifiedAt` 2026-10-29 in the file).
- The election bulletin (選舉公報) was not checked for this version.

Attribution for the quotes: 沈伯洋台北市長競選總部, https://puma.taipei, CC BY 4.0.

## Policies

Each policy gives the quote, the source page with its dates (`datePublished` / `dateModified` of the page), the HEART group of the island, and what the simulation can show.

### 交通政策 (island 03, HEART H and T)

Source: https://puma.taipei/policies/交通政策, published 2026-09-16, changed 2026-10-08.

| id | Quote | In the simulation |
|----|-------|-------------------|
| `transport-school` | 「以學校四周 150 公尺為原則，制定全市統一工程規格（車道縮減、抬升行穿線、減速丘、行人庇護島、轉彎半徑縮小、路口淨空）。」「採上下學時段性速限」 | Partly. A lower speed near schools at the school hours. The model has no schools and no accidents yet (#2). |
| `transport-bus` | 「精算各站運量，推動公車與捷運分工，低運量路段改以 DRTS 或小型巴士替代」 | Partly. The bus routes are fixed data. A change of the network needs a source for the new routes. |
| `transport-bridge` | 「興建迎風—港墘跨基隆河自行車專用橋，直接銜接民生社區與內湖科技園區。」 | Yes. A bicycle way that crosses the river goes through the crossing that makes it shortest, and the bridge is one more crossing. The PDF draws the bridge on page 14 and gives its size on page 15: 「跨河約220M+跨越堤頂大道120M；總長340M」, 8 m wide, 「工程經費：9.57億」, 「工期：1年10個月」, with a 鐵馬驛站 (lift and bicycle service) at the 內湖 end. |
| `transport-bike` | 「提供 YouBike 2.0E 尖峰時段（08:00-10:00 / 17:00-19:00）前 30 分鐘免費」 | Yes. More bicycle trips in the two peak windows, and fewer road trips. See "Candidates". |
| `transport-hub` | 「設置「運動驛站」提供盥洗、置物與租借服務，並以綠建築與容積獎勵鼓勵大樓增設淋浴設施。」 | No. It can raise the share of bicycle trips, but no figure for that was found. |
| `transport-scooter` | 「持記名 TPASS 市民享每日前 10 分鐘免費（市府出資試辦 3 個月，後續與中央協商常態化）。」「媒合公有（含委外）及私人路外停車場提供定型化契約，引導共享機車離開路邊格位。」 | Partly. The model has no shared scooters and no parking. |
| `transport-maintain` | 「以鋪面平整度、標線、照明、指標與越堤動線 5 項指標每季評分公開，維護預算與評分連動。」 | No. |

The timeline of the page: 「第一階段（短期）：1–2 年 啟動記名TPASS共享機車前10 分鐘免費3 個月試辦；……開辦YouBike 2.0E尖峰免費試辦。」 「第二階段（中期）：3–4 年 完工啟用迎風—港墘跨基隆河自行車專用橋」

### Other pages that touch the traffic

| id | Source | Quote | In the simulation |
|----|--------|-------|-------------------|
| `civil-flex` | https://puma.taipei/policies/公務員政策, published 2026-06-23, changed 2026-10-08 | 「在每日總工時不變前提下，擴大彈性上下班適用的範圍與時段。」 | Partly. It moves the hours of the staff of the city. The model has no group for this staff. |
| `sport-bus` | https://puma.taipei/policies/運動政策, published 2026-07-16, changed 2026-10-22 | 「將建立延伸到各地的「社區運動小巴」主動配合市民」 | No. |
| `trails-shuttle` | https://puma.taipei/policies/台北文化徑×山林徑, published 2026-09-08, changed 2026-10-08 | 「從捷運站到登山口補上「最後一哩路」，增開接駁服務」 | No. The model has no trips to the mountains. |
| `ai-cluster` | https://puma.taipei/policies/AI政策, published 2026-10-25 | 「以園區為中心，規劃捷運路網、接駁巴士、舒適人行動線、自行車專用道與彈性上下班制度」 | No. It gives no figures. |

### Pages not read for this version

公務員政策 (except `civil-flex`), 教育政策, 營養午餐, 家庭一站通, 親子同行卡, 社福政策, 運動政策 (except `sport-bus`), 都市微森林, 青年政策, 城市外交, 客家政策, 水域政策, AI政策 (except `ai-cluster`). `scripts/platforms.sh` downloads all of them.

## Figures in the PDF for later

The PDF has figures that can change the simulation or start events later. They are not in the model yet.

- Page 6: 「6,539 上午7-9點死傷人數，全日最高峰(2024年)」, from the 臺北市交通局 statistics office (《臺北市道路交通事故分析》), and 「全市150多所國小，市府做了4個通學區」.
- Page 9: the bus accidents for which the driver is at fault, 「公車有責肇事率(件/百萬公里)」, 2.15 and 4.02, for 2024 and 2025.
- Page 12: YouBike rides grew 55%, and the bicycle network grew less than 5%. The targets are 2,000 stations and 27,500 bicycles.

## Candidates

`transport-bike` is the first candidate:

- The page gives the hours (08:00 to 10:00 and 17:00 to 19:00) and the free time (30 minutes).
- The model already has bicycle trips (`BIKE` in `web/src/sim/city.ts`) and a road load, so a change of mode changes the jams.
- Media reports give a figure for a similar change: 臺北市 made the first 30 minutes of YouBike 2.0 free again on 2024-02-28. The rides were 46,125,019 in 2023 and 65,396,344 in 2024 (a city councillor in the council, reported by the media; not checked against a source of the city). The change of 2024 also includes new stations and the 2.0E bicycles, so the policy alone gave less than this change.
