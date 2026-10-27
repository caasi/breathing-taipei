# 台北鼓動 (Breathing Taipei)

> Note: Claude Opus 5.5 wrote this README and the code in this repository, with Isaac Huang.

台北鼓動 (Breathing Taipei) shows the days in Taipei City and New Taipei City, from the day you open the page, with the workdays, the days off and the holidays of the office calendar.
The map shows how people move into the villages (里) in the morning and out of them in the evening.

This is a personal side project.
It started next to the 市政 debug 松 (Taipei City debug-thon) on 2026-10-24.
The author did not register for the event, so this is not an entry.

## What you see

- **The map.** It shows 1,465 villages (41 districts). By default, the color shows the change rate: the change of people per hour, divided by the residents.
  - Orange: people arrive.
  - Teal: people leave.
  - Dark: no change.
- **The dots.** Each dot is a sample of the commuters who travel at that time.
  - MRT riders move on the MRT lines.
  - Bus, scooter, and car commuters move on the road network: the shapes of the bus routes, and the 國道 and 快速道路 of OpenStreetMap (OSM). A scooter does not take a 國道 or a 快速道路, unless no path on streets only exists (rare, DATA.md).
  - People who walk or ride a bicycle move in a straight line.
- **The clock.** It shows the 民國 date and the time, then the lunar date, the solar term, a holiday (orange) and the days that are commemorated but not off (blue).
- **The event panel.** It shows the newest 100 events: a few of the characters' plans, and the public events of each day. On a phone it is below or beside the map.
- **The policy panel.** It holds placeholder policy settings; they do not change the simulation yet. On a phone it opens from the third icon.
- **The info and settings panels.** The ⓘ icon opens the project text, the credits and the version. The gear opens the display settings and the figures of the run: the people of each city, on the road and away, and the frame time and frame rate.

## Run it

You need Node.js 24, pnpm and a git clone: the build reads the commit with `git rev-parse HEAD`, so `pnpm dev`, `pnpm build` and `pnpm test` do not run in a ZIP from GitHub.

```sh
cd web
pnpm install
pnpm dev
```

Open the URL that Vite shows.

To run the tests and the type check:

```sh
pnpm test
pnpm typecheck
```

## Settings

There are two kinds of settings:

- **Display settings** belong to one viewer and one device. The browser keeps them (local storage), so they are not in a shared link. When the browser cannot keep them (for example in a private window), they go back to the defaults when the page loads again.
- **Policy settings** are the scenario. A setting that you change goes into the query string, so a link shows the same scenario. A setting that you did not change stays out of the link. The policy panel is a placeholder for now: its settings do not change the simulation.

An unknown value goes back to the default.

Display settings:

| Key | Values | Default |
|---|---|---|
| `speed` | `1`, `2`, `4`, `8`: 1 is half a simulated hour per second, 8 is 4 hours. The play and pause button is apart from it, and a pause is not kept | `1` |
| `metrics` | `1` shows at the top of the map the time of the model in each frame of the worker, the frame rate, and the frame rate of the slowest and the fastest 1% of the frames of the last 10 s. `0` hides it | `0` |
| `level` | `village`, `district`. A switch starts a new run at 00:00 of the day on the clock | `village` |
| `color` | `rate`, `density` | `rate` |
| `window` | `15`, `30`, `60`, `120` simulated minutes for the change rate | `30` |
| `dot` | `20`, `50`, `100`, `200`, `500` people for each dot. A switch draws other agents as dots, and the run goes on | `50` |
| `dots` | `1` shows the dots, `0` hides them | `1` |
| `mode` | `1` colors the dots by mode | `0` |
| `layers` | Comma list of `mrt`, `lrt`, `tra`, `hsr`, `airport`. Unknown names are ignored (`highway` too: the 國道 and 快速道路 are now in `traffic`), and a list with no known name goes back to the default. An empty list hides all layers | All |
| `traffic` | `1` shows the road network with the slow roads in colour, and colours the bus, scooter and car dots on slow roads. `0` hides it. The simulation takes the traffic in both cases, so the jams, their events and the slower trips go on while it is hidden | `1` |

Policy settings (placeholders):

| Key | Values | Default |
|---|---|---|
| `bus-lane`, `sidewalk`, `meals`, `rain-off` | `1` on, `0` off | `0` |
| `flex` | `0` to `50` percent, in steps of `5` | `10` |
| `headway` | `2` to `8` minutes, in steps of `0.5` | `4` |
| `stagger` | `0` to `60` minutes, in steps of `15` | `0` |

Example: `?flex=20&headway=3&bus-lane=1`

## How the model works

- One agent is 10 people. The model has 645,406 agents.
- Residents come from household registration data for each village (September 2026).
- MRT commuters come from the hourly MRT origin-destination (OD) data of September 2026: the mean of the 20 workdays, of the 4 Saturdays, and of the 6 Sundays and holidays.
- The OD data is per station. The model adds it up per district.
- Inside a district, a trip starts in a village in proportion to its residents. A trip ends in a village by half its MRT arrivals and half its residents.
- The MRT data does not include people who use a bus, a scooter, a car, or who walk. The model adds these commuters so that the daytime population of each district comes near a target.
- The target is the registered residents of the district multiplied by its day/night ratio in the telecom signal statistics (November 2023). It is not the telecom daytime count itself.
- Each commuter gets a mode. MRT commuters use the MRT. The other commuters get a mode from the 2024 mode share of Taipei residents. Walking is possible only for trips of 2.5 km or less between the two villages (between the district centers in a district-level run), and cycling only for 6 km or less.
- Short trips are added for people who walk or ride a bicycle (for example YouBike) to another village of their own district. Their number comes from two public figures:
  - Walking trips per MRT trip, from the 2024 mode share of Taipei residents (20.8% walk, 16.0% MRT).
  - YouBike rentals in Taipei, 234,000 a day in the first half of 2026. One person rents twice, there and back.
- The two rates are per resident, and they are the same in every village.
- A short trip goes to another village of the same district. The model weights each village by its residents plus its daily MRT arrivals, and less when it is farther away. A district-level run has no short trips, because it cannot show a move inside a district.
- A short trip leaves and comes back at the hours of all MRT trips in the city, because many districts have no MRT trips inside them.
- Night-time workers and visitors are added from the businesses in each village (national business tax registry, 2026-10-23). The model has four shifts and two kinds of visitors:
  - Early shift: breakfast shops. Leave home at 04:00 to 05:59, leave work at 11:00 to 11:59.
  - Evening shift: restaurants, food stalls, and drink shops. Leave home at 15:00 to 16:59, leave work at 22:00 to 23:59.
  - Overnight shift: convenience stores and hotels. Leave home at 22:00 to 22:59, leave work at 07:00 to 07:59 on the next day.
  - Nightlife: bars, karaoke, hostess clubs, and saunas. Leave home at 19:00 to 20:59, leave work at 03:00 to 04:59 on the next day.
  - Dinner visitors go to the evening-shift places from 18:00 to 20:59. Night-out visitors go to the nightlife places from 21:00 to 01:59.
- Night-time workers and visitors are residents who do not commute (on the MRT or as an added commuter) and do not make a short trip. Each group is the same share of the residents of every village. The work district is drawn by its businesses and its distance from home, then the village by its businesses.
- A night-time worker or visitor gets a mode from the 2024 mode share of Taipei residents (MRT included), with the walk and bike distance limits. A mode that does not run in some hour of the group's departure or return window is not used. Buses run from 05:00 to 24:00, and the MRT from 06:00 to 24:00. So the early shift, nightlife and night-out groups use a scooter, a car, a bicycle, or walk.
- Each agent has one plan at a time: leave home, travel, work, travel, go home. When the agent is home again, it gets its next plan. A plan can go past midnight. The position of an agent at a time is a function of this plan.
- The simulation runs in a Web Worker. The page needs WebGL2. From the bottom: the village fills (WebGL), then one SVG with cell edges, borders, lines and stations, then an SVG with the district labels, then the dots (WebGL).

### Real data and estimates

The model uses real open data, but some parts are estimates. The list below shows the estimates.

- Travel speeds and access times for each mode are assumptions.
- Travel time uses the straight-line distance multiplied by 1.3. It does not use the length of the route. On the road, a jam makes it longer (DATA.md, "Figures in the code").
- New Taipei uses the mode share of Taipei, because the model has no New Taipei figures yet.
- The work village inside a district is an estimate (half MRT arrivals, half residents).
- The added (non-MRT) commuters always work in another district. Their destination districts depend only on how many people each district is short, not on distance.
- New Taipei uses the walking and YouBike rates of Taipei, because the model has no New Taipei figures yet.
- The distance decay of short-trip destinations (0.8 km for walking, 2 km for cycling) is an assumption.
- The YouBike figure counts every rental, also trips that are not to work or school. The model gives all of them to short trips.
- Commuters who walk or ride across a district border come on top of the two targets. With seed 1 they are about 0.1% (walk) and 1% (bike) of them.
- Walkers in 33 villages ride instead, because no other village of their district is within 2.5 km. 3 villages (2,259 residents) have no short trip, because no village of their district is within 6 km.
- New Taipei has 30 villages that the 2021 village map does not show. The model gives their residents to the other villages in the same district.
- The people per business, the share on each shift, the hours, and the visitors per worker are guesses. No public source gives them. With seed 42 at village level, the night-time groups are about 238,000 people: early 13,390, evening 82,380, overnight 22,930, nightlife 6,330, dinner 80,560, and night-out 32,590.
- The distance decay of night-time destinations (5 km for workers, 2 km for dinner, 6 km for a night out) is an assumption.
- Hospitals, taxis, and other night work are not in the model. Most hospitals are not in the business tax registry.
- A business address without a village, with a village that the 2021 village map does not have, or with a village name that the map writes with a different character, counts for its district. The model reads 羣, 峯 and 臺 as 群, 峰 and 台, but some addresses use private-use characters (for example in 樹林區 and 萬華區). The model spreads these businesses over the villages of the district (24% of the businesses).
- Each commuter makes one trip to work and one trip home. The model has no school, shopping, or care trips yet.
- On a day off, 5% of the commuters (Saturday) or 8% (Sunday or holiday) are away from Taipei and New Taipei for the day. These shares are guesses.
- Each commuter has one fixed day-off place. Non-MRT trips on a day off keep the workday ratio to MRT trips. The night-time groups do the same on every day. These are guesses.
- The days off after 2027 and the solar terms after 2028 are guesses by rule (DATA.md, "Figures in the code").
- The bus hours and the MRT hours are those of a workday.
- The bus hours come from the first and last buses in the route files of both cities: most first buses leave at 05:00 or later, and most last buses leave before 24:00. A few routes run until 00:30. The MRT hours come from the MRT data: on a workday 43 trips start in hour 05 and 36,483 in hour 06. Hour 00 still has 10,471 trips (the last trains), but the model counts hour 00 as closed.
- A district-level run drops a night-time trip that stays in the home district, because the district is the node. With seed 42 it has 36,210 dinner visitors against 80,560 at village level.
- Cars, buses and scooters use the streets of the bus routes (with the one-way rules of OSM) and the 國道 and 快速道路, not the full road network. A scooter takes the streets only.

## Tests

The tests use Vitest and fast-check. The property tests use random cities, random networks, random URL values, and random clocks. They make sure of these properties:

- Every agent is on a valid village or on the road. No agent is lost.
- Every plan arrives no later than it leaves again, and leaves work less than one day after it leaves home. The next plan starts after the agent is home.
- The plans are the same for any split of the same whole minutes of the clock.
- The same seed gives the same run.
- A commuter only works in a district that has morning trips from home.
- Shortest paths equal brute-force shortest paths. A path follows the geometry of its edges.
- A URL setting reads back as the value that the app wrote. An unknown value gives the default.
- The change-rate history does not grow while the clock is paused. After the first window of a run, it spans the selected window.
- On a day off a commuter leaves home at most once, is home by 24:00 when its two legs fit in the day, and never leaves on a workday for an outing. The share that goes out does not grow over a run of days off. A way home moved to an earlier hour is timed for that hour.
- The map box has whole CSS pixels, and the map fits inside its area on every window shape.
- The list of events holds the newest 100 up to the clock, also around a holiday break.

An example test makes sure that the road-graph hash changes when one coordinate (by 0.000001 degree), one edge end, one geometry point, or one weight changes.

The tests with real data:

- One runs the district model to 11:00. It makes sure that the population of each district with 50,000 people or more is within 15% of its target.
- One uses a village run. It computes the two targets from the public figures and makes sure that the short walking and cycling trips of Taipei residents are within 10% of them. It also makes sure that every short trip stays in its district. No walk is longer than 2.5 km, and no ride is longer than 6 km.
- One makes sure that short trips in a district without MRT trips inside it follow the morning peak, not an even spread: more than 10 times as many leave at 08:00 as at 05:00.
- One makes sure that, at 00:00 and at 02:00, the overnight and nightlife workers at work are within 10% of the number that their businesses give. The test computes that number from `night.json` and the guesses.
- One makes sure that no early-shift, nightlife, or night-out agent uses the MRT or a bus, and that most dinner visitors do not use the MRT.
- One builds the contraction hierarchies of the real road graph, as `scripts/routes.ts` does, and makes sure that every variant of 100 random paths has the cost of a Dijkstra search, so no path drives a one-way road against its way.
- One makes sure that a batch of paths (`fill`) gives the same paths as one query at a time.
- One makes sure that the dots of road trips take their paths from the routes file, with no routing in the page, and that a dot goes home on its own path when that is not the way there reversed.
- One makes sure that a routes file for another road graph, a file cut short, or a file with a word too many is not used.
- Where `web/public/road-routes.bin` exists, one makes sure that it is the file that `scripts/routes.ts` makes from the road graph.

## Known gaps

- `web/public/` holds the data that the app uses. These build steps are scripts: `scripts/graphs.py` builds the road and MRT graphs and the shapes of the roads (`road-lines.json`), `scripts/names.py` builds `road-names.json`, `scripts/night.py` builds `night.json`, `scripts/od.py` builds `od2.json`, `scripts/days.py` builds `calendar.json`, `scripts/people.py` builds `people.json`, `scripts/atlas.py` builds `towns.json` and `villages2-topo.json`, `scripts/villages.py` builds `villages2.json`, `scripts/telecom.py` builds `signal.json`, `scripts/transit.py` builds `transit.json` (their docstrings give the inputs), and `scripts/routes.ts` builds `road-routes.bin`. `pnpm data` runs all of them except `routes.ts`, in the order of their dependencies (DATA.md, "Dependencies"). `pnpm dev` and `pnpm build` run `pnpm routes` first. Without the file, the page routes the road trips of the dots itself, and there is no traffic. The file holds contraction hierarchies of about 1 MB (DATA.md). A run starts when the page has found the road paths of every road trip; the page shows 路網 N% meanwhile. In headless Chromium on the dev server (2026-10-27), the clock started 12.3 s after the page opened. It was not measured on a phone.
- The events narrate the plans of the model and the calendar. A jam changes a plan: the trip takes longer, and the character can leave work later. The policy settings are placeholders.

## License

The code is under the MIT License. See [LICENSE](LICENSE).
The data files have their own licenses. See [DATA.md](DATA.md).
