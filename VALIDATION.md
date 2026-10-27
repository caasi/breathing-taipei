# Validation

> Note: Claude Opus 5.5 wrote this file. It compares the model with measured traffic: what the model matches, what it does not match, and how to get each figure again. DATA.md gives the sources and the constants; KNOWN-ISSUES.md gives the limits of the model.

The model aims to be reasonable, not exact: the present state must match what people in Taipei know, so that a policy has a believable baseline. A policy run keeps the constants of the baseline and does not refit them (DATA.md, "Figures in the code").

All model figures below are from the app's run: seed 42, 10 people per agent, village level, the workday 2026-10-27, a take of the traffic every 15 minutes from 00:15. They were measured on 2026-10-27 with `BETA` 1, `MOST` 4, `CAPACITY` 10.9, buckets of at least 0.1 km (`SHORTEST`), and the one-way streets of OSM.

## How to get the figures again

Run these from the repository root (Node 24), after `pnpm routes` in `web/`:

1. `node --experimental-strip-types scripts/traffic.ts` gives the extra time of the trips against TomTom.
2. `node --experimental-strip-types scripts/validate.ts` gives the spread of the slowness of the roads and the hotspots.
3. `python3 scripts/tdx.py DIR taipei` gives the same spread for the TDX sections. `DIR` is the output of `scripts/tdx.sh`, which is not in the repository (DATA.md, source P).

## Extra time of a trip

The extra time is the time on the road over the time on the road with no jam, summed over the bus, scooter and car trips to and from work in 台北市. TomTom gives the same kind of figure, per 10 km trip, in the TomTom Traffic Index 2025.

| Peak | TomTom | Model | |
|---|---|---|---|
| Morning, trips that leave from 07:00 to 09:59 | 64.6% | 64.3% | The fit target of `CAPACITY` |
| Evening, trips that leave from 17:00 to 19:59 | 92% | 33.0% | Not matched |

TomTom does not give the hours of its rush hours (KNOWN-ISSUES.md). The other sources also say that the evening is slower than the morning. 聯合報 gave the mean speed of 34 main roads of 台北市 in the spring of 2026: 21.6 km/h at the morning peak and 18.4 km/h at the evening peak ([聯合報, 2026-09-09](https://udn.com/news/story/7323/9744004)). In the model, the evening is faster than the morning.

## Spread of the slowness of the roads

For a road section, the slowness at a peak is the median of its speed at night (01:00 to 04:59) over the median of its speed at the peak. It is the number of times longer a trip on that section takes. TDX gives it for 684 sections of 臺北市 over 6 weekdays of 2026-10 (DATA.md, source P). The model gives it for the named buckets of 台北市 in one day that have a traveller at one take of the peak or more; the median is over all the takes of the peak, a take with no traveller counting as free, as a detector gives a speed at every minute. So the two sets of roads are not chosen the same way: TDX takes the sections with a detector, and the model the named roads in use.

| Peak | Source | Median | 90th percentile | 99th percentile | Most |
|---|---|---|---|---|---|
| Morning | TDX | 1.06 | 1.41 | 2.49 | 3.62 |
| Morning | Model | 1.01 | 1.54 | 2.82 | 3.74 |
| Evening | TDX | 1.10 | 1.49 | 2.81 | 3.71 |
| Evening | Model | 1.00 | 1.40 | 2.30 | 3.59 |

In the morning the slowest 10% and 1% of the roads in the model are slower than in TDX; in the evening the model is a little freer. `BETA` and `MOST` were chosen to make these spreads match (DATA.md). The TDX speeds are mostly from vehicle detectors at one point of a road, so they leave out the wait at traffic lights. The slowness of a bucket in the model has no term for the lights either: they are in the free time of a trip.

## Hotspots

These roads jam at the peaks in the news of 2026. The table gives the slowness of the slowest bucket of the road at the peak in the model (the median over the takes of the peak, as above), and its rank among the named roads of 台北市 in use (1 is the slowest).

| Road | News | Model, morning | Model, evening |
|---|---|---|---|
| 堤頂大道 | 內科, [自由時報, 2026-08-16](https://news.ltn.com.tw/news/politics/breakingnews/5542049) | 1.67 (76 of 497) | 1.49 (81 of 522) |
| 國道1號 | 內湖 to 東湖, [壹蘋, 2024-12-17](https://news.nextapple.com/life/20241217/8739F70DC238E402DB822D8E3B2BDAFB) | 1.55 (90) | 2.89 (4) |
| 承德路 | Afternoon peak, 臺北市政府交通局, report of 115年7月 | 1.44 (109) | 1.54 (72) |
| 洲美快速道路 | Entry ramp, 臺北市政府交通局, report of 115年7月 | 1.15 (230) | 1.12 (221) |
| 舊宗路 | 內科, [Entropy Clinic, 重新檢討「內湖很塞」](https://entropyclinic.substack.com/p/9a2) | 1.71 (72) | 1.79 (43) |
| 環東大道 | 國3 at 環東大道, a jam of the 2026 Lunar New Year (a search result; no weekday source) | 1.08 (260) | 1.11 (227) |
| 中興橋 | [自由時報, 2026-10-15](https://news.ltn.com.tw/news/life/breakingnews/5606731) | 1.61 (81) | 1.69 (52) |
| 港墘路 | 內科, 自由時報, 2026-08-16 | 1.95 (50) | 1.61 (63) |
| 重慶北路四段 | To 國1, 臺北市政府交通局, report of 115年7月 | 1.23 (183) | 1.16 (202) |
| 中華路二段 | [聯合報, 2026-01-20](https://udn.com/news/story/7323/9276593) | 1.43 (113) | 1.41 (97) |
| 木柵路 | 臺北市道安會報, 2026-06 (a search result; the record was not read) | 1.92 (52) | 1.75 (48) |
| 瑞光路 | 臺北市道安會報, 2026-06 | 1.33 (140) | 1.19 (179) |
| 中正路 | 臺北市道安會報, 2026-06; the model has many roads of this name, and the table takes the slowest | 1.25 (173) | 1.19 (181) |
| 至善路 | 臺北市道安會報, 2026-06 | 1.31 (146) | 1.27 (133) |
| 華翠大橋 | 聯合報, 2026-01-20 | 1.40 (115) | 1.03 (296) |
| 民權東路六段 | 內科, Entropy Clinic | 1.21 (195) | 1.19 (183) |
| 重陽橋 | 自由時報, 2026-10-15 | 1.08 (270) | 1.00 (328) |
| 艋舺大道 | 聯合報, 2026-01-20 | 1.00 (322) | 1.00 (319) |
| 台北橋 | 自由時報, 2026-10-15 | Not found | Not found |

- 港墘路, 木柵路, 舊宗路 and 堤頂大道 jam in the model in the morning. 國道1號 jams in the evening, but only a little in the morning: since a 國道 bucket counts the whole length of its edges, the load of the 國道 is spread over more km than before (DATA.md). 承德路 and 環東大道 are slow at part of the peak only, so their median over the whole peak is low.
- The bridges from 新北 to the west are almost free (重陽橋, 台北橋, and 華翠大橋 in the evening); so is 艋舺大道. The model has no commuters from other counties ([#21](https://github.com/caasi/breathing-taipei/issues/21)), but it has those of 三重, 蘆洲, 新莊 and 板橋, and at 08:00 重陽橋 carried only 1 to 2 car agents (measured by a review on 2026-10-27). Not checked: why so few of them take these bridges.
- 中正路 and 至善路, near the works of the MRT 環狀線, are only a little slow: the model has no road works.
- 瑞光路 is only a little slow. A trip is placed along its whole path, so nothing waits at the end of the trip; that needs a queue model ([#25](https://github.com/caasi/breathing-taipei/issues/25)).
- 台北橋 has no name of its own in `road-names.json`. Not checked: the OSM way of the bridge probably carries the name of its road.

## Not compared yet

- **Section by section.** The spreads above compare the two sets of roads as a whole. A comparison of each TDX section with the bucket on it can show which slow roads the model misses. The 6 weekdays of TDX are enough for it.
- **New Taipei.** TDX has no section speeds of the city roads of 新北市, only of the 國道.
- **Days off.** TDX has them; the downloads hold weekdays only.
- **Volumes at junctions.** 臺北市政府交通局 publishes counts in PCU at junctions, for example 港墘路 and 瑞光路 on 114/09/11: 1,968 PCU from 08:00 to 09:00 in one direction ([NI008](https://online.bote.gov.taipei/botedata/%E4%BA%A4%E9%80%9A%E6%B5%81%E9%87%8F/114%E5%B9%B4%E5%BA%A6/PDF/NI008.pdf)). The model does not count vehicles at a junction.
