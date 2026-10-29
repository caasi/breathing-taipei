# Changelog

This file lists the changes that a user of the site can see, for each version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version has an annotated git tag, and the site at https://caasi.github.io/breathing-taipei/ shows its version and commit in the info panel.

## [Unreleased]

### Fixed

- The clock of a run can no longer start before the routing of the run ends. This needed a click or a key press at the moment the first frame of the run came, after a load of more than 5 s. Found with a TLA+ model; not seen on a device.

## [0.3.0] - 2026-10-29

### Added

- The setting 區名與人數 hides the district names and their counts, to show the map with no text over the districts (#47).
- The setting 車站與機場 hides the badges and names of the stations and the airport (#47).
- While the road paths are found, sparks run along a sample of them on the map. With reduced motion, the map loads with no sparks (#48).

### Changed

- The settings of the map are in two rows: 路網 for the lines and the traffic, and 標示 for the stations and the district names (#47).
- The digits of a count have one width, so a count under a district name no longer moves when a digit changes (#47).
- The map is one WebGL canvas, and the text, the stations, the roads and the dots are drawn in it (#34).
- A station is a square badge with round corners and the sign of its kind: a train, a high speed train or a plane, in the colour of the kind (高鐵 orange, 台鐵 grey, the airport white). A station of two kinds (臺北, 南港) stacks its badges as cards. A badge is never smaller than 9 CSS pixels (#41).
- The airport name no longer starts with ✈ (#41).
- The station names are over the roads (#42).
- Before the run starts, the map itself shows, darker and blurred: the land, the borders, the lines, the stations and the names, with the registered residents as the counts until the first frame. It becomes less blurred as the road paths are found, and clear when the run starts. Before, a blurred outline of the districts showed, and the map faded in halfway while the paths were found (#45, #48).
- The dots are under the names. Where many dots meet, the map under them is a little brighter, because the dots add their colour onto the map (#46).
- The dots move smoothly between pixels. Before, they stepped by whole pixels (#46).
- A screen reader can no longer read the district names, their counts and the station names: they are drawn in the WebGL canvas, and the page has no text alternative yet (#43). KNOWN-ISSUES.md has the limit.

### Removed

- The box 機場: the airport follows 車站與機場 (#47).

### Fixed

- When a hidden tab comes back, the dashes of the traffic no longer jump forward (#42).
- While the run waits for its road paths, the dashes of the traffic stand still (#45).

## [0.2.0] - 2026-10-27

### Added

- Traffic: the roads of the two cities, with the 國道 and 快速道路, in thin lines on the map. A slow road turns orange, red, then dark red, and glows; dashes move along the roads in use, slower where the traffic is slow. The setting `traffic` shows or hides the layer; the simulation takes the traffic in both cases (#27).
- Jams make trips longer. The bus, scooter and car dots take the colour of the slowest road of their place (#27).
- Jam events: a character stuck on a road, by the name of the road or the nearest village, gets angry, waits, goes blank, starts work by phone, or asks for an hour of leave to come late. A character that a jam made late to work also leaves work later, and the event of its way home says so (#27).
- The setting `metrics` shows at the top of the map the time of the model in each frame, the frame rate, and the frame rate of the slowest and the fastest 1% of the frames (`SIM 003.9ms | FPS 60 ↓48↑61`). It is off by default, and replaces the line of figures in the settings panel (#28).
- The map shows the other counties around Taipei and New Taipei, and the sea in a darker colour (#22).
- While the run waits for the road paths, 路網 N% next to the spinner shows the share of the paths found (#31).

### Changed

- The jobs of 內湖科技園區 are in the villages of the park, from its company list. The commuters to 內湖區 now go to these villages (#27).
- The district and the village in an event are in two tones of blue, not grey (#27).
- The borders of the villages and districts are in the blue of the place names of the events, so that they stay apart from the roads (#27).
- The simulation runs at half the speed: 1x is half a simulated hour a second, and 8x is 4 hours. The events come more slowly, and a slow device keeps up more easily (#28).
- The pause is a play and pause button, apart from the speed buttons 1x to 8x, so a pause keeps the speed for when the run goes on (#28).
- The settings give the number of dots as 追蹤 N 個移動單位 (#28).
- The road paths come from a file of contraction hierarchies of 1.05 MB (0.54 MB with gzip), not from the precomputed paths of 0.1.5 (6.39 MB, 1.01 MB with gzip): the page finds the shortest path of any trip on the roads. A run starts when the page has found the paths of every trip on the roads. The settings no longer show the share of the dots' road paths (#31).
- The district level shows the same run as the village level: each district is the sum of its villages. A switch of the level keeps the run and its clock; before, it started a new run at 00:00. At district level the events name the district only (#35).
- While the run waits for the road paths, the map fades in halfway; it becomes clear when the run starts (#35).

### Removed

- The `highway` layer: the traffic layer draws the 國道 and 快速道路 (#27).

### Fixed

- With the colour by change rate, the map started in the colours of the density and faded to the colours of the rate. It now starts with no change (#32).

## [0.1.5] - 2026-10-26

### Fixed

- On a slow device the simulation ran slower than its speed setting. It now keeps its speed setting while the simulation gets at least about 7.5 updates a second (#1, #15, #16).
- The dots no longer jump back after a change of speed or a pause (#15, #16).
- After a switch between district and village level, the shown time no longer jumps (about 13 simulated hours at 8x). A new run now waits until the page has drawn its first frame, for up to 5 seconds (#18).
- The knobs of the policy icon now turn orange with the open button (#19).

### Changed

- The simulation stops while the tab is hidden, and goes on when the tab shows again (#18).
- On a pause, the shown time moves on to the time of the dots, which can be ahead of it (at 8x, usually up to about 16 simulated minutes) (#16).
- A switch between district and village level keeps the old picture until the new run shows, so the map no longer goes black (#19).

### Added

- A turning icon at the bottom right of the map shows from the first paint until a run starts (#18, #19).
- Before the first frame, the map shows a blurred outline of the districts, and the map fades in at the first frame (#19).

## [0.1.4] - 2026-10-24

### Changed

- The event stream is more even: the plans are picked by error diffusion instead of one draw for each plan (#10). A workday shows 24 personal events, and the longest time with no personal event between 06:00 and 24:00 is 1.3 to 3.7 hours.

### Added

- A shown trip to work or to a day-off place also shows its way home, so the stream follows one character through the day (搭捷運下班回家).

## [0.1.3] - 2026-10-24

### Changed

- A change of the dot density (1 dot = N people) no longer starts the simulation again. Other agents are drawn as dots, and the run goes on.
- A switch between district and village level starts a new run on the day that the clock shows, from 00:00 of that day, not on the first day. A note in the settings panel says so.
- A workday shows more personal events: the weight of a plan to work in the event stream is 0.25 (it was 0.05).

### Fixed

- The clock shows no time before the first frame of a run, so the page no longer shows 00:00 while it starts.

## [0.1.2] - 2026-10-24

### Added

- A GitHub icon next to the info icon. It links to the repository and opens in a new tab.

## [0.1.1] - 2026-10-24

### Added

- Open Graph and Twitter card metadata, with a screenshot of a run, so that a shared link shows a preview.

### Changed

- A policy setting goes into the URL only after you change it. A setting that you did not change stays out of the link.
- In the 20 districts with no MRT trips in the source data (for example 汐止, 樹林 and 林口), people now make outings on a day off. Their number is a guess: the workday trips times the day-off ratio of the whole city (see `DATA.md`).
- A display setting is saved in the browser only after you change it. A later version can then change a default for a returning viewer.

### Fixed

- A trip on a day off leaves on that day. When the two legs leave room for it, the way home moves earlier so that the person is home by 24:00.
- The way home from a day-off outing is timed for its final hour.
- A day at home on a workday no longer shows as a day of rest.
- The event list follows the clock at every speed, also when two events are close in time.
- A Saturday that is a holiday counts as a holiday, not as a Saturday off.
- 其他 is no longer used as a surname.
- The greetings of the city continue after 2034, the end of the calendar data.
- The district labels no longer show `NaN` for one frame after a quick switch between district and village level.
- On a phone, the clock stays right of the title.
- A stored speed of 0 (pause) is not restored when the page opens.

## [0.1.0] - 2026-10-24

The first public version.

### Added

- A simulation of commuting in the 1,465 villages (里) of 臺北市 and 新北市, in a Web Worker: one agent is 10 people. Residents come from household registration, and MRT commuters from the hourly MRT origin-destination data.
- Short walk and YouBike trips inside each district.
- Night-time workers and visitors from the business tax registry, and night-time modes limited by the service hours of bus and MRT.
- A full-page map: village fills and dots in WebGL, the static map layers in SVG. Layouts for desktop, phone portrait and phone landscape.
- Road paths are made ahead of time, so the dots do not wait for the routing in the browser.
- Info and settings panels that open from icons. Display settings stay in the browser. Policy settings are in the URL.
- A calendar: the run starts on the day the page opens, with the office calendar, the lunar date, the solar terms and the commemorative days, from 2026 to 2034.
- Days off change how commuters move: away from the two cities for the day, out to a place for the day off, or home.
- Every agent is a named character. The event panel shows some of their plans and the public events of each day: holidays, observances, solar terms, the 2026 local election, the new mayors and greetings of the city.
- A placeholder policy panel. Its settings do not change the simulation yet.
- Publishing to GitHub Pages by a workflow on each push to `main`.

[Unreleased]: https://github.com/caasi/breathing-taipei/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/caasi/breathing-taipei/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/caasi/breathing-taipei/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/caasi/breathing-taipei/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/caasi/breathing-taipei/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/caasi/breathing-taipei/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/caasi/breathing-taipei/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/caasi/breathing-taipei/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/caasi/breathing-taipei/releases/tag/v0.1.0
