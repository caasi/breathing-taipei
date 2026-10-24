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

1. **Event simulation**, on its own branch. The user set this order on 2026-10-24, after the UI branch `feat/full-page-map`.
   - The event panel shows placeholders today (`EVENTS` in `web/src/ui/Dashboard.tsx`). The real events replace them, and the panel keeps the latest 100 (`recent`, `MAX_EVENTS`, with a test).
   - An event is wide (an area) or personal (one resident). A personal event names the district, the village, and the resident. A resident is 先生 or 小姐. A person outside the binary is a nickname with no title, in the share `NICKNAME_SHARE` (1.6%, a U.S. upper bound; DATA.md gives the source).
   - To change the plan of an agent, move the agent to a new bucket (see "State of the model"). An agent must never be in two buckets.
   - The policy panel is also a placeholder. Its settings are in the query string (`usePolicies`), and nothing in the simulation reads them yet.
2. **Publish to gh-pages**, on its own branch. If there is time before the end of the 市政 debug 松, the user will show the site to other people. If there is not, the work continues for the user alone. The user decides on the day whether to publish before the event simulation is done. `pnpm build` runs `pnpm routes` first, so the published site has the precomputed road paths. After the first publish, check that GitHub Pages sends `road-routes.bin` gzipped (`curl -sI -H 'Accept-Encoding: gzip' <url>/road-routes.bin`): it is 4.6 MB raw and 0.8 MB gzipped. Not checked yet.
3. **Personal settings** (people per agent, dot density): to be discussed with the user, and kept apart from the policy settings. Since 2026-10-24 the display settings are in local storage (`useStored` in `web/src/query.ts`) and the policy settings are in the query string (`usePolicies` in `web/src/ui/Dashboard.tsx`), as the user set; a new personal setting goes with the display settings. A trial of 1 agent = 100 people is on the branch `feat/scale-100` (not merged). It helped an old Intel Mac, but it made the villages too coarse: the median village has about 42 agents at 1/100.
4. **Later ideas, not started:** policy settings that change the simulation (the user grouped them by the HEART idea of puma.taipei: space, opportunity, company, resilience, time; the Chinese name 陪伴 for "company" is a translation by the agent, not checked against puma.taipei), and build scripts for the data files that came from one-off steps.
5. **Small items:**
   - A quick 區/里 switch shows NaN in the district labels for a moment.
   - The favicon is an empty data URI (`web/index.html`); the site needs a real icon.
   - The first paths batch still takes 187 to 313 ms in Node (measured on 2026-10-24): the nearest road node of each village is a linear search (1,465 villages x 12,930 nodes), and the first batch holds about 130,000 trips that need no road routing. The road node of each village could also be precomputed.
   - WebGL context loss and restore on iOS was not tested on a device; headless Chromium has no GPU. Check that the map comes back after the Safari tab returns from the background.

## State of the model (2026-10-24)

- `main` has the night-time model (merge `7b291a0`). Each agent has one plan at a time. The agent gets its next plan in the minute it is home again, from a ring of per-minute buckets in `core.ts`. For events, add a function that moves an agent to a new bucket. An agent must never be in two buckets.
- `City.kinds` holds every group that does not commute on the OD: short walk and bike trips, four night shifts, and two kinds of night-time visitors. To add a group, add a kind. Do not add a branch in `plan()`.
- The people per business, the shift shares, the hours and the visitors per worker in `city.ts` (`SHIFTS`, `VISITS`) are guesses that the user agreed to. Do not present them as data.
- Drawing has three layers, as the user set on 2026-10-24:
  - What changes every frame is WebGL: the cell fills (`web/src/ui/Fills.tsx`, triangles on the GPU once, one colour per cell each frame) and the dots (`web/src/ui/Travellers.tsx`, the CPU finds the positions, one draw call).
  - What changes little is SVG: cell edges, district borders, lines and stations in one SVG that changes only when a layer, the level or the map data changes, and the district labels in a second SVG (their counts change, so they must not share the static SVG).
  - The controls on top are HTML from React.
  - Both WebGL layers use `useWebGL2` in `web/src/ui/gl.ts`. The cleanup of each run deletes GL objects and does not lose the context, because the next run gets the same context from the same canvas. An unmount loses the context, to free one of the about 16 contexts that a browser allows. So the canvas must not be mounted again after an unmount: React StrictMode would leave the layers blank, and `web/src/main.tsx` does not use it. Vite fast refresh does the same when you edit `gl.ts`, `Fills.tsx` or `Travellers.tsx`: reload the page after such an edit. (Measured on 2026-10-24: an edit of `Fills.tsx` lost the fills context; an edit of `HeatMap.tsx` lost none.) The page needs WebGL2: without it, or when setup throws, the fills and dots stay empty.
  - Why: with SVG fills, a CPU profile in Chromium showed 75% of the main thread in browser style and paint work. A static SVG is expected to cost about the same as a canvas bitmap when it is composited, and to be expensive only when its content changes; this follows from how browsers composite and was not measured.
- Performance, 16x with 20 people per dot (16x was removed afterwards), measured by the user after 8 simulated days, before the dots moved to WebGL: with the WebGL fills, 30 to 50 fps on the iPhone 16 Pro Max and 60 fps on the Mac. With SVG fills, the iPhone ran at 20 to 25 fps. On an Intel Mac with OBS open it was about 10 fps. In headless Chromium with the CPU slowed 4 times, `main` before the night model and after it gave the same fps.

- The UI (branch `feat/full-page-map`, 2026-10-24), as the user set it:
  - One view (`web/src/ui/view.ts`: screen = k * map + (x, y)) places both WebGL layers and the SVG layers. Zoom and pan are to change only the view. The static SVG paths are memoized without the view, so a view change does not rebuild them.
  - `layoutFor` picks the layout from the window shape. A desktop gets the full-page map left of the event and policy panels (zoom 0.8). A portrait window gets the map in a 4:3 box on top. A landscape window that is too narrow for the desktop map gets the map in a 3:4 box on the left. A phone layout zooms to 台北市.
  - The info and gear icons open a panel. On a desktop it opens over the map. On a phone the icons sit on the map, and the panel opens below it or beside it. On a phone the events fill that area, and a third icon opens the policies.
  - Display settings are in local storage (`useStored`), and policy settings are in the query string (`useQuery`). `README.md` lists the keys.
  - Codex did not review this branch: its usage limit was reached. Five rounds of Opus and Sonnet reviewed it. The last round found nothing open, but the loop wanted two dry rounds in a row and stopped at the limit of 5.

## Data that is only on this machine

`data/` is git-ignored (678 MB on 2026-10-24). It holds the raw downloads, for example `data/night/BGMOPEN1.csv` (the business tax registry, 322 MB, extract of 2026-10-23) that `scripts/night.py` reads. To rebuild `web/public/night.json`, download the file again from the URL in the docstring of `scripts/night.py`.
