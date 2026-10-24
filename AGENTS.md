# AGENTS.md

> Note: Claude Opus 5.5 wrote this file. It gives the state of the work for the next agent. README.md tells what the model does, and DATA.md tells where each figure comes from. Read both first.

## Workflow

The user set this workflow on 2026-10-24, during the 市政 debug 松 (an off-site personal project, not a registered entry):

1. Do the work on a branch, in a git worktree on the RAM disk (`/dev/shm/<branch>`).
2. Run the review loop (the `review-loop` skill) until two rounds in a row find nothing open, for at most 5 rounds (the user set the limit on 2026-10-24). After round 5, give the open findings to the user. The reviewers are an Opus subagent, a Sonnet subagent, and Codex (`gpt-6-astra`, or `gpt-6-sol` when Codex usage is at 50% or more).
3. Group the commits by logical step.
4. Merge into `main` with `--no-ff` only after the user says yes. Then bump the pointer in the omni repository.

Codex cannot read `/dev/shm`. Give it the omni checkout (`~/GitHub/omni/breathing-taipei`, which stays on `main`) and tell it to read the branch through git (`git show <branch>:<path>`).

Before you push, run `pnpm typecheck` and `pnpm test` in `web/`.

## Comments

The user set this rule for the repository on 2026-10-24. It is not a "zero comment" rule:

- Do not write a comment that says what the line already says. Give the thing a better name.
- Do not keep a comment on an invariant that a test checks. If no test checks it, write the test, then delete the comment. Example: the ring of three days in `core.ts` has no comment, because the plan property test fails when the ring is one or two days.
- Keep every source and every guess. Give the details in DATA.md ("Figures in the code") and keep one line in the code that points there. Mark a guess with `ponytail:` in the code: if a guess has no comment, the next reader takes it for data.
- A comment that says why the code must be this way (a constraint, a trap, a fix for a device) stays.

## Next steps, in this order

1. **Published on GitHub Pages** (2026-10-24): https://caasi.github.io/breathing-taipei/, version `v0.1.0` (tag on the merge `ad75aa5`). `.github/workflows/pages.yml` builds, tests and deploys on each push to `main`; a commit with `[skip ci]` does not publish. The info panel shows the version from `web/package.json` and the commit of the build. GitHub Pages sends `road-routes.bin` gzipped (1,031,913 bytes from 6,173,472, checked on 2026-10-24). Note: `web/vite.config.ts` runs `git rev-parse HEAD` when `GITHUB_SHA` is not set, and `pnpm dev`, `pnpm build` and `pnpm test` all load that config, so none of them runs outside a git checkout (a ZIP from GitHub); use a clone.
2. **Events, the next part.** `main` has the names, the event stream and the public events since v0.1.0 (see "State of the model"). Still to do, as the user asked:
   - Events that change plans (accidents, 請假, 加班): one function moves an agent to a new bucket; an agent must never be in two buckets. A bad event gets a colour of its own, and every one of them shows in the stream.
   - The voting trip on election day: a short trip to a polling place in the voter's own 里, between 08:00 and 16:00; some people do not vote (find the turnout of 臺北市 and 新北市 in the 中選會 database first).
   - Weekly trips across counties: people who leave on Friday evening or before a long weekend, and come back on Sunday evening or early on Monday morning. Check the 台鐵 and 高鐵 station counts first.
   - The user (2026-10-24): what moves people is the boundary between days off and workdays, more than the kind of a single day. Some people also take leave on the workdays next to a long weekend to make it longer. Model the trips at those boundaries (the evening before the first day off, the morning after the last), and the leave days around a long weekend.
   - Who comes or leaves by 高鐵 or plane, and flights at 松山機場 from a real timetable (TDX); invent no flight numbers or times.
   - Each kind of event can carry a short explanation with its source and a link to government help, as the game 1in8b does. Check every link.
   - The city greetings come from a larger pool drawn at random, so that not every day shows the same ones.
3. **Personal settings** (people per agent, dot density): to be discussed with the user, and kept apart from the policy settings. Since 2026-10-24 the display settings are in local storage (`useStored` in `web/src/query.ts`) and the policy settings are in the query string (`usePolicies` in `web/src/ui/Dashboard.tsx`), as the user set; a new personal setting goes with the display settings. A trial of 1 agent = 100 people is on the branch `feat/scale-100` (not merged). It helped an old Intel Mac, but it made the villages too coarse: the median village has about 42 agents at 1/100.
4. **Later ideas, not started:** policy settings that change the simulation (the user grouped them by the HEART idea of puma.taipei: space, opportunity, company, resilience, time; the Chinese name 陪伴 for "company" is a translation by the agent, not checked against puma.taipei), and build scripts for the data files that came from one-off steps.
5. **Small items:**
   - The favicon is an empty data URI (`web/index.html`); the site needs a real icon.
   - The first paths batch still takes 187 to 313 ms in Node (measured on 2026-10-24): the nearest road node of each village is a linear search (1,465 villages x 12,930 nodes), and the first batch holds about 130,000 trips that need no road routing. The road node of each village could also be precomputed.
   - WebGL context loss and restore on iOS was not tested on a device; headless Chromium has no GPU. Check that the map comes back after the Safari tab returns from the background.

## State of the model (2026-10-24)

- `main` has the night-time model (merge `7b291a0`). Each agent has one plan at a time. The agent gets its next plan in the minute it is home again, from a ring of per-minute buckets in `core.ts`. For events, add a function that moves an agent to a new bucket. An agent must never be in two buckets.
- `City.kinds` holds every group that does not commute on the OD: short walk and bike trips, four night shifts, and two kinds of night-time visitors. To add a group, add a kind. Do not add a branch in `plan()` for a new group.
- Days off (`City.off`, type `DaysOff` in `core.ts`) are the one branch in `plan()`, for the commuters on the OD. Each day off gets one choice per commuter, drawn when the commuter is home from its previous plan (often the evening before), for a departure from that day's 00:00: away from the two cities for the day (`GONE`, the location `AWAY`), out to its one day-off place (`PLAY`, `World.play`), or home (`STAY`, a plan with no legs). An outing ends on its own day. `World.dest` holds the kind of the current plan. A sampled agent has two paths: path k to work and path n + k to its day-off place (`bothPaths` in `worker.ts`, `Travellers.tsx`), and `scripts/routes.ts` precomputes both. The calendar (`web/public/calendar.json`, `web/src/sim/calendar.ts`) gives the kind of each day; day 0 is the day the page opens.
- The people per business, the shift shares, the hours and the visitors per worker in `city.ts` (`SHIFTS`, `VISITS`) are guesses that the user agreed to. Do not present them as data.
- Drawing has three layers, as the user set on 2026-10-24:
  - What changes every frame is WebGL: the cell fills (`web/src/ui/Fills.tsx`, triangles on the GPU once, one colour per cell each frame) and the dots (`web/src/ui/Travellers.tsx`, the CPU finds the positions, one draw call).
  - What changes little is SVG: cell edges, district borders, lines and stations in one SVG that changes only when a layer, the level or the map data changes, and the district labels in a second SVG (their counts change, so they must not share the static SVG).
  - The controls on top are HTML from React.
  - Both WebGL layers use `useWebGL2` in `web/src/ui/gl.ts`. The cleanup of each run deletes GL objects and does not lose the context, because the next run gets the same context from the same canvas. An unmount loses the context, to free one of the about 16 contexts that a browser allows. So the canvas must not be mounted again after an unmount: React StrictMode would leave the layers blank, and `web/src/main.tsx` does not use it. Vite fast refresh does the same when you edit `gl.ts`, `Fills.tsx` or `Travellers.tsx`: reload the page after such an edit. (Measured on 2026-10-24: an edit of `Fills.tsx` lost the fills context; an edit of `HeatMap.tsx` lost none.) The page needs WebGL2: without it, or when setup throws, the fills and dots stay empty.
  - Why: with SVG fills, a CPU profile in Chromium showed 75% of the main thread in browser style and paint work. A static SVG is expected to cost about the same as a canvas bitmap when it is composited, and to be expensive only when its content changes; this follows from how browsers composite and was not measured.
- Performance, 16x with 20 people per dot (16x was removed afterwards), measured by the user after 8 simulated days, before the dots moved to WebGL: with the WebGL fills, 30 to 50 fps on the iPhone 16 Pro Max and 60 fps on the Mac. With SVG fills, the iPhone ran at 20 to 25 fps. On an Intel Mac with OBS open it was about 10 fps. In headless Chromium with the CPU slowed 4 times, `main` before the night model and after it gave the same fps.

- Events (since v0.1.0, merged from `feat/events` on 2026-10-24): every agent is one character, named from the surnames of its home district (`scripts/people.py`, `web/src/sim/people.ts`). `core.ts` calls `onPlan` with each agent that gets a new plan, and the worker keeps a few of them as personal events (`EVENTS_PER_DAY` and the weights `SHOWN` in `worker.ts`); the plans made during init go through the same filter. `web/src/sim/events.ts` makes the sentences and the public events of a day (holidays, observances, solar terms, civic days, greetings). The panel shows the newest `MAX_EVENTS`; the kind of an event shows by colour.
- The UI (since v0.1.0, merged from `feat/full-page-map` on 2026-10-24), as the user set it:
  - One view (`web/src/ui/view.ts`: screen = k * map + (x, y)) places both WebGL layers and the SVG layers. Zoom and pan are to change only the view. The static SVG paths are memoized without the view, so a view change does not rebuild them.
  - `layoutFor` picks the layout from the window shape. A desktop gets the full-page map left of the event and policy panels (zoom 0.8). A portrait window gets the map in a 4:3 box on top. A landscape window that is too narrow for the desktop map gets the map in a 3:4 box on the left. A phone layout zooms to 台北市.
  - The info and gear icons open a panel. On a desktop it opens over the map. On a phone the icons sit on the map, and the panel opens below it or beside it. On a phone the events fill that area, and a third icon opens the policies.
  - Display settings are in local storage (`useStored`), and policy settings are in the query string (`useQuery`). `README.md` lists the keys.

## Data that is only on this machine

`data/` is git-ignored (678 MB on 2026-10-24). It holds the raw downloads, for example `data/night/BGMOPEN1.csv` (the business tax registry, 322 MB, extract of 2026-10-23) that `scripts/night.py` reads. To rebuild `web/public/night.json`, download the file again from the URL in the docstring of `scripts/night.py`.
