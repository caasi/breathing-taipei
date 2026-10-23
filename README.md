# 台北鼓動 (Breathing Taipei)

> Note: Claude Opus 5.5 wrote this README and the code in this repository, with Isaac Huang.

台北鼓動 (Breathing Taipei) shows one weekday in Taipei City and New Taipei City.
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
  - Bus, scooter, and car commuters move on the bus routes.
  - People who walk or ride a bicycle move in a straight line.
- **The panel.** It shows the time, the frame time of the simulation, the frame rate, and the number of people on the road for each mode.

## Run it

You need Node.js 24 and pnpm.

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

## Settings in the URL

All settings are in the query string, so a link shows the same view.
An unknown value goes back to the default.

| Key | Values | Default |
|---|---|---|
| `speed` | `0` (pause), `1`, `2`, `4`, `8`, `16` simulated hours per second | `1` |
| `level` | `village`, `district` | `village` |
| `colour` | `rate`, `density` | `rate` |
| `window` | `15`, `30`, `60`, `120` simulated minutes for the change rate | `30` |
| `dot` | `20`, `50`, `100`, `200`, `500` people for each dot | `50` |
| `dots` | `1` shows the dots, `0` hides them | `1` |
| `mode` | `1` colors the dots by mode | `0` |
| `layers` | Comma list of `mrt`, `lrt`, `tra`, `hsr`, `airport`, `highway` | All except `highway` |

Example: `?speed=4&dot=20&colour=rate&window=60&layers=mrt,highway`

## How the model works

- One agent is 10 people. The model has 645,406 agents.
- Residents come from household registration data for each village (September 2026).
- MRT commuters come from the hourly MRT origin-destination (OD) data, weekdays of September 2026.
- The OD data is per station. The model adds it up per district.
- Inside a district, a trip starts in a village in proportion to its residents. A trip ends in a village by half its MRT arrivals and half its residents.
- The MRT data does not include people who use a bus, a scooter, a car, or who walk. The model adds these commuters so that the daytime population of each district matches the telecom signal statistics (November 2023).
- Each commuter gets a mode. MRT commuters use the MRT. The other commuters get a mode from the 2024 mode share of Taipei residents.
- Each agent gets one plan for each day: leave home, travel, work, travel, go home. The position of an agent at a time is a function of this plan.
- The simulation runs in a Web Worker. The map is SVG. The dots are on a 2D canvas.

### Real data and estimates

The model uses real open data, but some parts are estimates. The list below shows the estimates.

- Travel speeds and access times for each mode are assumptions.
- Travel time uses the straight-line distance multiplied by 1.3. It does not use the length of the route.
- New Taipei uses the mode share of Taipei, because the model has no New Taipei figures yet.
- The work village inside a district is an estimate (half MRT arrivals, half residents).
- New Taipei has 30 villages that the 2021 village map does not show. The model gives their residents to the other villages in the same district.
- Each commuter makes one trip to work and one trip home. The model has no school, shopping, or care trips yet.
- Scooters and cars use the bus routes, not the full road network.

## Tests

The tests use Vitest and fast-check. The property tests use random cities and random networks. They make sure of these properties:

- Every agent is on a valid village or on the road. No agent is lost.
- Every plan arrives before the next departure and ends before midnight.
- At midnight, every agent is at home.
- The same seed gives the same run.
- A commuter only works in a district that has morning trips from home.
- Shortest paths equal brute-force shortest paths. A path follows the geometry of its edges.

A test with real data makes sure that the daytime population of each large district is within 15% of the telecom target.

## Known gaps

- `web/public/` holds the data that the app uses. Only some build steps are scripts: `scripts/graphs.py` builds the road and MRT graphs. The other files came from one-off steps. These steps are not in the repository yet.
- There are no events and no policy settings yet.

## License

The code is under the MIT License. See [LICENSE](LICENSE).
The data files have their own licenses. See [DATA.md](DATA.md).
