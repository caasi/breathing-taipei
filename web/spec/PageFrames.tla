---- MODULE PageFrames ----
\* App.tsx and worker.ts: a new run (an 'init' with `start`) while frames of the old run are still on their way. The
\* page drops a frame of another run (`m.start !== started.current`, `shown.current !== started.current`), and the
\* clock of a new run starts only when a frame of that run says that its routing ended. WorkerRuns.tla checks that
\* the worker world is the one of the latest 'init', so here an 'init' takes effect when the worker reads it. An
\* 'init' that fails is not modelled: it leaves no world, and the page shows the error with the clock stopped.
\* `shown` and `shownRouting` are refs that the message handler sets together, so a render never sees one new and
\* the other old. React state (`waiting`, `s`) can lag the refs: Schedule takes any run as the `waiting` of the render.
\* `ready` (App.tsx) needs `s`, React state, of the shown run: a frame that the page takes sets `taken`, and a later
\* commit copies it to `sRun`. PageFramesAnyRun.cfg gives the counterexample when `s` of any run makes the map ready.
\* Only the map path of the clock is modelled, not the deadline.
\* A model of the code, not the code: change it with both files.
EXTENDS Naturals, Sequences
CONSTANTS MaxRuns, MaxQueue, ReadyOfRun \* ReadyOfRun: ready also needs s of the shown run
VARIABLES onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, sRun, firedWith
vars == <<onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, sRun, firedWith>>

Init == onScreen = 0 /\ pendingGo = 0 /\ started = 0 /\ shown = 0 /\ waiting = 0 /\ frameRun = 0 /\ shownRouting = TRUE /\ toWorker = <<>>
        /\ run = 0 /\ routing = FALSE /\ sendStart = FALSE /\ routed = {} /\ toPage = <<>> /\ taken = 0 /\ sRun = 0 /\ firedWith = 0

\* the runStart effect: waitRef.current = ++started.current; post({ type: 'init', start })
NewRun == started < MaxRuns /\ started' = started + 1 /\ waiting' = started + 1
          /\ toWorker' = Append(toWorker, started + 1)
          /\ UNCHANGED <<onScreen, pendingGo, shown, frameRun, shownRouting, run, routing, sendStart, routed, toPage, taken, sRun, firedWith>>

\* onmessage 'init' up to traffic(w): routing = true; extra = { start: m.start, ... }
WorkerStarts == toWorker # <<>> /\ run' = Head(toWorker) /\ toWorker' = Tail(toWorker)
                /\ routing' = TRUE /\ sendStart' = TRUE
                /\ UNCHANGED <<onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, routed, toPage, taken, sRun, firedWith>>

\* doneRouting(), guarded by world === w
RoutingDone == run # 0 /\ routing /\ routing' = FALSE /\ routed' = routed \cup {run}
               /\ UNCHANGED <<onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, toWorker, run, sendStart, toPage, taken, sRun, firedWith>>

\* frame(): nothing while no world; `start` only in the first frame of a run. `run` is not in the message: it is
\* the ghost that the invariants read.
Frame == run # 0 /\ Len(toPage) < MaxQueue
         /\ toPage' = Append(toPage, [run |-> run, start |-> IF sendStart THEN run ELSE 0, routing |-> routing])
         /\ sendStart' = FALSE
         /\ UNCHANGED <<onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, routed, taken, sRun, firedWith>>

\* w.onmessage
PageTakes == toPage # <<>> /\ toPage' = Tail(toPage)
             /\ (LET m == Head(toPage) IN
                 IF m.start # 0
                 THEN IF m.start # started THEN UNCHANGED <<onScreen, shown, frameRun, shownRouting, taken>>
                      ELSE shown' = m.start /\ onScreen' = started /\ frameRun' = m.run /\ shownRouting' = m.routing /\ taken' = m.run
                 ELSE IF shown # started THEN UNCHANGED <<onScreen, shown, frameRun, shownRouting, taken>>
                      ELSE frameRun' = m.run /\ shownRouting' = m.routing /\ taken' = m.run /\ UNCHANGED <<onScreen, shown>>)
             /\ UNCHANGED <<pendingGo, started, waiting, toWorker, run, routing, sendStart, routed, sRun, firedWith>>

\* React commits setS(m): the state of the render is the frame taken last.
Commit == sRun # taken /\ sRun' = taken
          /\ UNCHANGED <<onScreen, pendingGo, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, firedWith>>

\* ready: the nodes of every run have one length, so `s` of any run makes it true, unless ReadyOfRun.
Ready(r) == IF ReadyOfRun THEN sRun = r ELSE sRun # 0

\* The effect that starts the clock: routing = shown.current !== waiting || shownRouting.current. It schedules go() for
\* two animation frames later, or for the deadline.
Schedule(r) == pendingGo = 0 /\ shown = r /\ ~shownRouting /\ Ready(r) /\ pendingGo' = r
               /\ UNCHANGED <<onScreen, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, sRun, firedWith>>

\* go(): if (waitRef.current !== run) return
Fire == pendingGo # 0 /\ pendingGo' = 0 /\ waiting' = (IF waiting = pendingGo THEN 0 ELSE waiting)
        /\ firedWith' = (IF waiting = pendingGo THEN sRun ELSE firedWith)
        /\ UNCHANGED <<onScreen, started, shown, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, sRun>>

\* the cleanup of the effect, at any later render
Cancel == pendingGo # 0 /\ pendingGo' = 0
          /\ UNCHANGED <<onScreen, started, shown, waiting, frameRun, shownRouting, toWorker, run, routing, sendStart, routed, toPage, taken, sRun, firedWith>>

Next == Commit \/ NewRun \/ WorkerStarts \/ RoutingDone \/ Frame \/ PageTakes \/ Fire \/ Cancel \/ \E r \in 1..MaxRuns : Schedule(r)

\* The page shows only frames of the run that it shows.
FramesOfShownRun == frameRun # 0 => frameRun = shown
\* The start day on the screen is the one of the run on the screen. setOnScreen(next.current) writes the day of the
\* latest start; the runStart effect sets next.current with ++started.current, so the model writes the number of that
\* start, `started`, to the ghost `onScreen`. A run number stands for its start day.
StartOfShownRun == onScreen = shown
\* The clock of a run runs only after the routing of that run ended (doneRouting: the paths were found, or the routing
\* gave up).
ClockAfterRouting == (started # 0 /\ waiting = 0 /\ shown = started) => started \in routed
\* The clock of the shown run starts only when the map of that run is on the screen.
ClockAfterMap == (started # 0 /\ waiting = 0 /\ shown = started) => firedWith = started
====
