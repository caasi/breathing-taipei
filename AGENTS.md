# AGENTS.md

> Note: Claude Opus 5.5 wrote this file. It gives the state of the work for the next agent. README.md tells what the model does, and DATA.md tells where each figure comes from. Read both first.

## Workflow

The user set this workflow on 2026-10-24, during the 市政 debug 松 (an off-site personal project, not a registered entry):

1. Do the work on a branch, in a git worktree on the RAM disk (`/dev/shm/<branch>`).
2. Run the review loop (the `review-loop` skill) until two rounds in a row find nothing open. The reviewers are an Opus subagent, a Sonnet subagent, and Codex (`gpt-6-astra`, or `gpt-6-sol` when Codex usage is at 50% or more).
3. Group the commits by logical step.
4. Merge into `main` with `--no-ff` only after the user says yes. Then bump the pointer in the omni repository.

Codex cannot read `/dev/shm`. Give it the omni checkout (`~/GitHub/omni/breathing-taipei`, which stays on `main`) and tell it to read the branch through git (`git show <branch>:<path>`).

Before you push, run `pnpm typecheck` and `pnpm test` in `web/`.

## Next steps, in this order

1. **Remove comments that repeat the code.** The user chose this on 2026-10-24. It is not a "zero comment" rule:
   - Delete a comment that says what the line already says. Give the thing a better name if necessary.
   - Delete a comment on an invariant only when a test fails if the invariant breaks. If no test covers it, write the test first. Example: the RING size in `core.ts` is covered, because the plan property test fails when RING is 1 or 2 days.
   - Keep every source and every guess. Move the details to "Figures in the code" in DATA.md, and keep one line in the code that points there. If a guess has no comment, the next reader takes it for data.
2. **Try 1 agent = 100 people** (now 10). Change `PER_AGENT` in `web/src/App.tsx`, and change `EVERY` so that the dot choices are 100, 200 and 500 people. Measured in Node on 2026-10-24: 64,558 agents, init 233 ms, and a frame (16x) of 0.9 ms median and 2.3 ms maximum. At 1/10 these were 645,406 agents, 808 ms, 9.6 ms and 35 ms. Every village still has agents at 1/100. On the iPhone the drawing, not the simulation, sets the frame rate, so also measure with fewer dots.
3. **Later ideas, not started:** events (incidents that change an agent's plan), policy settings (the user grouped them by the HEART idea of puma.taipei: space, opportunity, company, resilience, time), WebGL drawing, and build scripts for the data files that came from one-off steps.

## State of the model (2026-10-24)

- `main` has the night-time model (merge `7b291a0`). Each agent has one plan at a time. The agent gets its next plan in the minute it is home again, from a ring of per-minute buckets in `core.ts`. For events, add a function that moves an agent to a new bucket. An agent must never be in two buckets.
- `City.kinds` holds every group that does not commute on the OD: short walk and bike trips, four night shifts, and two kinds of night-time visitors. To add a group, add a kind. Do not add a branch in `plan()`.
- The people per business, the shift shares, the hours and the visitors per worker in `city.ts` (`SHIFTS`, `VISITS`) are guesses that the user agreed to. Do not present them as data.
- Performance: on the user's iPhone 16 Pro Max, 16x with 20 people per dot runs at 20 to 25 fps. On an Intel Mac with OBS open it was about 10 fps. In headless Chromium with the CPU slowed 4 times, `main` before the night model and after it gave the same fps.

## Data that is only on this machine

`data/` is git-ignored (678 MB on 2026-10-24). It holds the raw downloads, for example `data/night/BGMOPEN1.csv` (the business tax registry, 322 MB, extract of 2026-10-23) that `scripts/night.py` reads. To rebuild `web/public/night.json`, download the file again from the URL in the docstring of `scripts/night.py`.
