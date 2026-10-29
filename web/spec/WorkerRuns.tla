---- MODULE WorkerRuns ----
\* worker.ts: the 'init' handler awaits the data, then routes.then of traffic() fills the road use of the run.
\* A model of the code, not the code: change it with worker.ts.
EXTENDS Naturals
CONSTANTS MaxRuns, InOrder \* InOrder: two handlers that await the same promises resume in the order they began
VARIABLES w, started, waiting, queued, routesReady, use
vars == <<w, started, waiting, queued, routesReady, use>>

Init == w = 0 /\ started = 0 /\ waiting = {} /\ queued = {} /\ routesReady = FALSE /\ use = 0

\* w = undefined; await Promise.all([data, net])
Start == started < MaxRuns /\ started' = started + 1 /\ w' = 0
         /\ waiting' = waiting \cup {started + 1} /\ UNCHANGED <<queued, routesReady, use>>

\* w = init(...); traffic(w) sets use = undefined and registers routes.then
Resume(r) == r \in waiting /\ (InOrder => \A s \in waiting : r <= s)
             /\ w' = r /\ use' = 0 /\ waiting' = waiting \ {r} /\ queued' = queued \cup {r}
             /\ UNCHANGED <<started, routesReady>>

LoadRoutes == ~routesReady /\ routesReady' = TRUE /\ UNCHANGED <<w, started, waiting, queued, use>>

\* routes.then(known => { if (world !== w) return; ... use = found.use }). The fill of the road use takes many frames,
\* and the code checks `world === w` again at its end; the model makes the fill one step, so it checks only the first.
Routed(r) == routesReady /\ r \in queued /\ queued' = queued \ {r}
             /\ use' = (IF r = w THEN r ELSE use) /\ UNCHANGED <<w, started, waiting, routesReady>>

Next == Start \/ LoadRoutes \/ \E r \in 1..MaxRuns : Resume(r) \/ Routed(r)

\* The road use of a run never serves another run.
UseIsOfThisRun == (w # 0 /\ use # 0) => use = w
\* When every 'init' has resumed, the world is the one of the latest 'init'.
LatestWins == (started > 0 /\ waiting = {}) => w = started
====
