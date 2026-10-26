# Known issues

> Note: Claude Opus 5.5 wrote this file. It lists data that exists but that this project cannot get, what the model does instead, and how each fact was checked. DATA.md gives the data that the project uses.

"Checked" means that an agent opened the source. "Not checked" means that the fact comes from a search snippet or from memory.

## Data that exists but that the project cannot get

### Employees by village (里)

- **What:** 110年工業及服務業普查村里檔 (the industry and commerce census of 2021, by village), at the Survey Research Data Archive (SRDA) of Academia Sinica: AA300009, released on 2024-08-15 (https://srda.sinica.edu.tw/search/metadata/detail/AA300009). AA300008 is the same file for 2016. Fields: `sh7` (village code), `ind` (industry), `v1` (establishments), `v2` (employees). A cell with 3 or fewer units shows (D).
- **Why the project cannot get it:** only members of Academia Sinica can download it, only for academic research, and the data must not go to other people. A script cannot download it. Not checked: the agent read the metadata page, not the terms of the application.
- **What the model does instead:** it spreads the jobs of a district over its villages, half by MRT arrivals and half by residents (`web/src/sim/city.ts`). Only 內湖科技園區 has its jobs placed by data (`jobs` in `villages2.json`, from its company list and a count of 108年底), because it is the one job centre with a free company list with coordinates. Every other job centre, for example 南港軟體園區 or 信義計畫區, is spread by the rule above.
- **Free data that is near it:** 臺北市內湖科技園區廠商名錄 (the company list of 內科, with coordinates and no employees), on data.taipei. 108年底: 166,322 employees in 內科, from 臺北市產業發展局 (checked).

### Telecom population by village

- **What:** 電信信令人口統計資料 (telecom signalling population statistics) of 內政部, by village, on SEGIS (https://segis.moi.gov.tw/STATCloud/).
- **Why the project cannot get it:** data by village needs a paid application. The free data is by district (the project uses the district file of 112年11月), and a sample of 21 villages (data.gov.tw 166178), of which only 大屯里 of 北投區 is in Taipei. Not checked: from the report of an agent search on 2026-10-26.
- **What the model does instead:** it fits the daytime population of each district only (`web/public/signal.json`).

### Employees of 內湖科技園區 after 108年底

- **What:** 臺北市政府主計處 lists an indicator 「內湖科技園區員工人數」 in its important statistics. The agent found the name of the indicator, but not the figures. It can be in the statistics database (https://tsis.dbas.gov.taipei/statis/webMain.aspx?k=tpemain). Not checked.
- **What the project uses instead:** 166,322 employees at the end of 108 (2019), from 臺北市產業發展局 (checked).

## Limits of the model that are known

- **A dot goes home along its way there, reversed.** The road load of a trip home follows its own path, which the one-way 國道, 快速道路 and ramps can make different (`roadUse` in `web/src/sim/traffic.ts`). The dot of that trip on the map draws the way there backwards. At the scale of the map the two ways are usually the two carriageways of one road, about 30 m apart. Not measured: how many dots take another ramp or road home.

- **A car that takes another route draws its usual one.** The paths of the dots are made before a run, with the fastest variant for a car (`tripPaths` in `web/src/sim/paths.ts`). When the trip starts, 60% of the drivers choose by the live traffic (`NAV`). Of all the car legs to work and home from work in one day, 6.7% take another variant (2026-10-27). Their road load and jam events follow the variant they took; their dots draw the fastest one.
- **A long edge counts in one cell.** The load of an edge goes to the bucket of the cell of its middle (`gridOf` in `web/src/sim/traffic.ts`), but a dot reads the cell where it is (`Travellers.tsx`). On an edge longer than a cell (about 500 m), such as a 國道 between interchanges, a dot outside the middle cell reads another bucket, or none, and can show a free road on a jammed edge. Not measured: how many edges are longer than a cell.
- **瑞光路 does not jam.** At 08:45 on 2026-10-27, 2,765 agents were on the road to the 6 villages of 內湖科技園區, and 250 of them were in the buckets of 內湖區 (measured by a Fable review on 2026-10-27, before the later changes of the traffic, and not measured again). A traveller is placed along its whole path by its free time, so the last 500 m hold a small share of a long trip, and nothing waits at the end. That is a queue at a bottleneck: https://github.com/caasi/breathing-taipei/issues/25. Do not change `CAPACITY`, `ACROSS` or `LANES` to make it jam: these apply to every road.
- **The evening is too free.** The trips home from work in 台北市 are 30.5% slower than with no jam, against 92% in the TomTom Traffic Index. VALIDATION.md gives this and the other comparisons with measured traffic.
- **The commuters from other counties are missing**, also on the roads into the city: https://github.com/caasi/breathing-taipei/issues/21.

## Sources that the project cites but did not read

- **The 1964 *Traffic Assignment Manual* of the Bureau of Public Roads**, the usual source of the BPR values 0.15 and 4 (`web/src/sim/traffic.ts`). It was not found online. DATA.md ("Figures in the code") gives what the secondary sources say, and where they do not agree.
- **The definition of "rush hour" in the TomTom Traffic Index.** The page of 台北市 gives the morning and evening levels, but not the hours. `scripts/traffic.ts` uses 07:00 to 09:59 and 17:00 to 19:59, which are guesses.
