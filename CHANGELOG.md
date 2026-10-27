# Changelog

This file lists the changes that a user of the site can see, for each version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version has an annotated git tag, and the site at https://caasi.github.io/breathing-taipei/ shows its version and commit in the info panel.

## [Unreleased]

### Added

- The setting `metrics` shows at the top of the map the time of the model in each frame, the frame rate, and the frame rate of the slowest and the fastest 1% of the frames (`SIM 003.9ms · FPS 60 ↓48↑61`). It is off by default, and replaces the line of figures in the settings panel.
- The map shows the other counties around Taipei and New Taipei, and the sea in a darker colour.
- Traffic: the roads of the two cities, with the 國道 and 快速道路, in thin lines on the map. A slow road turns orange, red, then dark red, and glows; dashes move along the roads in use, slower where the traffic is slow. The setting `traffic` shows or hides the layer; the simulation takes the traffic in both cases.
- Jams make trips longer. The bus, scooter and car dots take the colour of the slowest road of their place.
- Jam events: a character stuck on a road, by the name of the road or the nearest village, gets angry, waits, goes blank, starts work by phone, or asks for an hour of leave to come late. A character that a jam made late to work also leaves work later, and the event of its way home says so.

### Changed

- The simulation runs at half the speed: 1x is half a simulated hour a second, and 8x is 4 hours. The events come more slowly, and a slow device keeps up more easily.
- The borders of the villages and districts are in the blue of the place names of the events, so that they stay apart from the roads.
- The `highway` layer is gone: the traffic layer draws the 國道 and 快速道路.

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

[Unreleased]: https://github.com/caasi/breathing-taipei/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/caasi/breathing-taipei/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/caasi/breathing-taipei/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/caasi/breathing-taipei/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/caasi/breathing-taipei/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/caasi/breathing-taipei/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/caasi/breathing-taipei/releases/tag/v0.1.0
