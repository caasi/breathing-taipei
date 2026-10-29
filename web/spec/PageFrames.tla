---- MODULE PageFrames ----
\* App.tsx and worker.ts: a new run (an 'init' with `start`) while frames of the old run are still on their way. The
\* page drops a frame of another run (`m.start !== started.current`, `shown.current !== started.current`), and the
\* clock of a new run starts only when a frame of that run says that its routing is done. WorkerRuns.tla checks that
\* the worker world is the one of the latest 'init', so here an 'init' takes effect when the worker reads it.
\* A model of the code, not the code: change it with both files.
EXTENDS Naturals, Sequences
CONSTANTS MaxRuns, MaxQueue
VARIABLES started, shown, waiting, frameRun, frameRouting, toWorker, run, routing, sendStart, routed, toPage
vars == <<started, shown, waiting, frameRun, frameRouting, toWorker, run, routing, sendStart, routed, toPage>>

Init == started = 0 /\ shown = 0 /\ waiting = 0 /\ frameRun = 0 /\ frameRouting = TRUE /\ toWorker = <<>>
        /\ run = 0 /\ routing = FALSE /\ sendStart = FALSE /\ routed = {} /\ toPage = <<>>

\* the runStart effect: waitRef.current = ++started.current; post({ type: 'init', start })
NewRun == started < MaxRuns /\ started' = started + 1 /\ waiting' = started + 1
          /\ toWorker' = Append(toWorker, started + 1)
          /\ UNCHANGED <<shown, frameRun, frameRouting, run, routing, sendStart, routed, toPage>>

\* onmessage 'init' up to traffic(w): routing = true; extra = { start: m.start, ... }
WorkerStarts == toWorker # <<>> /\ run' = Head(toWorker) /\ toWorker' = Tail(toWorker)
                /\ routing' = TRUE /\ sendStart' = TRUE
                /\ UNCHANGED <<started, shown, waiting, frameRun, frameRouting, routed, toPage>>

\* doneRouting(), guarded by world === w
RoutingDone == run # 0 /\ routing /\ routing' = FALSE /\ routed' = routed \cup {run}
               /\ UNCHANGED <<started, shown, waiting, frameRun, frameRouting, toWorker, run, sendStart, toPage>>

\* frame(): nothing while no world; `start` only in the first frame of a run. `run` is not in the message: it is
\* the ghost that the invariants read.
Frame == run # 0 /\ Len(toPage) < MaxQueue
         /\ toPage' = Append(toPage, [run |-> run, start |-> IF sendStart THEN run ELSE 0, routing |-> routing])
         /\ sendStart' = FALSE
         /\ UNCHANGED <<started, shown, waiting, frameRun, frameRouting, toWorker, run, routing, routed>>

\* w.onmessage
PageTakes == toPage # <<>> /\ toPage' = Tail(toPage)
             /\ (LET m == Head(toPage) IN
                 IF m.start # 0
                 THEN IF m.start # started THEN UNCHANGED <<shown, frameRun, frameRouting>>
                      ELSE shown' = m.start /\ frameRun' = m.run /\ frameRouting' = m.routing
                 ELSE IF shown # started THEN UNCHANGED <<shown, frameRun, frameRouting>>
                      ELSE frameRun' = m.run /\ frameRouting' = m.routing /\ UNCHANGED shown)
             /\ UNCHANGED <<started, waiting, toWorker, run, routing, sendStart, routed>>

\* the effect that starts the clock: routing = shown.current !== waiting || !!s?.routing
Go == waiting # 0 /\ shown = waiting /\ ~frameRouting /\ waiting' = 0
      /\ UNCHANGED <<started, shown, frameRun, frameRouting, toWorker, run, routing, sendStart, routed, toPage>>

Next == NewRun \/ WorkerStarts \/ RoutingDone \/ Frame \/ PageTakes \/ Go

\* The page shows only frames of the run that it shows.
FramesOfShownRun == frameRun # 0 => frameRun = shown
\* The clock of a run runs only after the worker found the road paths of that run.
ClockAfterRouting == (started # 0 /\ waiting = 0 /\ shown = started) => started \in routed
====
