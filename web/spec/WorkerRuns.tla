---- MODULE WorkerRuns ----
\* worker.ts: the 'init' handler awaits the data, then routes.then of traffic() fills the road use of the run.
\* The 'policies' handler keeps the latest settings and puts them on the world of the run, if there is one.
\* A model of the code, not the code: change it with worker.ts.
EXTENDS Naturals
CONSTANTS MaxRuns, InOrder, \* InOrder: two handlers that await the same promises resume in the order they began
          MaxPolicies, ReadAtResume \* ReadAtResume: 'init' reads the settings after its await, not before it
VARIABLES w, started, waiting, queued, routesReady, use,
          latest, \* the settings that the worker got last (a number for each change of the page)
          pol,    \* the settings on the world w (0: no world)
          readAt  \* readAt[r]: the settings that run r read when its 'init' began (ReadAtResume = FALSE only)
vars == <<w, started, waiting, queued, routesReady, use, latest, pol, readAt>>

Init == w = 0 /\ started = 0 /\ waiting = {} /\ queued = {} /\ routesReady = FALSE /\ use = 0
        /\ latest = 0 /\ pol = 0 /\ readAt = [r \in 1..MaxRuns |-> 0]

\* w = undefined; await Promise.all([data, net])
Start == started < MaxRuns /\ started' = started + 1 /\ w' = 0 /\ pol' = 0
         /\ waiting' = waiting \cup {started + 1} /\ readAt' = [readAt EXCEPT ![started + 1] = latest]
         /\ UNCHANGED <<queued, routesReady, use, latest>>

\* cityFrom(..., policies); w = init(...); traffic(w) sets use = undefined and registers routes.then. Reading the
\* settings and setting w are in one synchronous part, so no handler runs between them.
Resume(r) == r \in waiting /\ (InOrder => \A s \in waiting : r <= s)
             /\ w' = r /\ use' = 0 /\ waiting' = waiting \ {r} /\ queued' = queued \cup {r}
             /\ pol' = (IF ReadAtResume THEN latest ELSE readAt[r])
             /\ UNCHANGED <<started, routesReady, latest, readAt>>

\* policies = m.policies; if (w) { setPolicies; repolicy(w) }. Synchronous. The road use does not depend on the
\* settings (traffic.ts builds the legs from the modes that init drew), so the model leaves use as it is.
SetPolicies == latest < MaxPolicies /\ latest' = latest + 1 /\ pol' = (IF w # 0 THEN latest + 1 ELSE pol)
               /\ UNCHANGED <<w, started, waiting, queued, routesReady, use, readAt>>

LoadRoutes == ~routesReady /\ routesReady' = TRUE /\ UNCHANGED <<w, started, waiting, queued, use, latest, pol, readAt>>

\* routes.then(known => { if (world !== w) return; ... use = found.use }). The fill of the road use takes many frames,
\* and the code checks `world === w` again at its end; the model makes the fill one step, so it checks only the first.
Routed(r) == routesReady /\ r \in queued /\ queued' = queued \ {r}
             /\ use' = (IF r = w THEN r ELSE use) /\ UNCHANGED <<w, started, waiting, routesReady, latest, pol, readAt>>

Next == Start \/ LoadRoutes \/ SetPolicies \/ \E r \in 1..MaxRuns : Resume(r) \/ Routed(r)

\* The road use of a run never serves another run.
UseIsOfThisRun == (w # 0 /\ use # 0) => use = w
\* When every 'init' has resumed, the world is the one of the latest 'init'.
LatestWins == (started > 0 /\ waiting = {}) => w = started
\* A world always has the settings that the worker got last: a change during the await of an 'init' is not lost.
LatestPolicies == w # 0 => pol = latest
====
