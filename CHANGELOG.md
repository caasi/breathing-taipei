# Changelog

This file lists the changes that a user of the site can see, for each version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version has an annotated git tag, and the site at https://caasi.github.io/breathing-taipei/ shows its version and commit in the info panel.

## [Unreleased]

## [0.1.2] - 2026-10-24

### Added

- A GitHub icon next to the info icon. It links to the repository and opens in a new tab.

## [0.1.1] - 2026-10-24

### Added

- Open Graph and Twitter card metadata, with a screenshot of a run, so that a shared link shows a preview.

### Changed

- A policy setting goes into the URL only after you change it. A setting that you did not change stays out of the link.
- The 20 districts with no MRT trips in the source data (for example 汐止, 樹林 and 林口) now go out on a day off. Their day-off trips are a guess from the workday trips and the day-off ratio of the whole city (see `DATA.md`).

### Fixed

- A day-off plan starts on its own day.
- The way home of a day-off outing is timed again for each hour that it moves.
- A day at home on a workday gives no event.
- The event list follows the clock at every speed, also when two events come one after the other.
- A Saturday that is a holiday counts as a holiday, not as a Saturday off.
- 其他 is no longer drawn as a surname.
- Public greetings continue after the end of the calendar table (2034).
- A map cell with no data no longer shows `NaN`.
- A stored speed of 0 (pause) is not restored when the page opens.

## [0.1.0] - 2026-10-24

The first public version.

### Added

- A simulation of commuting in the 1,465 villages (里) of 臺北市 and 新北市, in a Web Worker: one agent is 10 people. Residents come from household registration, and MRT commuters from the hourly MRT origin-destination data.
- Short walk and YouBike trips inside each district.
- Night-time workers and visitors from the business tax registry, and night-time modes limited by the service hours of bus and MRT.
- A full-page map: village fills and dots in WebGL, the static map layers in SVG. Layouts for desktop, phone portrait and phone landscape.
- Info and settings panels behind icons. Display settings stay in the browser. Policy settings are in the URL.
- A calendar: the run starts on the day the page opens, with the office calendar, the lunar date, the solar terms and the commemorative days, from 2026 to 2034.
- Days off change how commuters move: away from the two cities for the day, out to a day-off place, or home.
- Every agent is a named character. The event panel shows some of their plans and the public events of each day: holidays, observances, solar terms, the 2026 local election, the new mayors and greetings of the city.
- A placeholder policy panel. Its settings do not change the simulation yet.
- Publishing to GitHub Pages by a workflow on each push to `main`.

[Unreleased]: https://github.com/caasi/breathing-taipei/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/caasi/breathing-taipei/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/caasi/breathing-taipei/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/caasi/breathing-taipei/releases/tag/v0.1.0
