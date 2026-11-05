---- MODULE WorkerScenarios ----
\* worker.ts: each 'init' carries a scenario, and the worker makes the routes of a scenario when a run first needs them.
\* traffic(world) and draw(world) both wait on those routes. The handlers must read the scenario of their own run:
\* WorkerScenariosModule.cfg gives the counterexample when they read a module-level `scenario`. Policies are left out
\* (WorkerRuns.tla has them). A model of the code, not the code: change it with worker.ts.
EXTENDS Naturals
CONSTANTS MaxRuns, Scen,
          ModuleScenario, \* the handlers read a module-level `scenario`, not the scenario of their run
          ScenarioMessage, \* a 'scenario' message changes the scenario without a new 'init'
          NoLatestCheck \* the handler does not stop after its await when a later 'init' came
VARIABLES w, started, waiting, sc, current, requested, loaded, queued, use, drawn, pend
vars == <<w, started, waiting, sc, current, requested, loaded, queued, use, drawn, pend>>
None == <<0, 0>>

Init == w = 0 /\ started = 0 /\ waiting = {} /\ sc = [r \in 1..MaxRuns |-> 0] /\ current = 0
        /\ requested = {} /\ loaded = {} /\ queued = {} /\ use = None /\ drawn = None /\ pend = None

\* onmessage 'init': w = undefined; scenario = m.scenario; await data
Start(s) == started < MaxRuns /\ started' = started + 1 /\ w' = 0 /\ sc' = [sc EXCEPT ![started + 1] = s]
            /\ current' = s /\ waiting' = waiting \cup {started + 1}
            /\ UNCHANGED <<requested, loaded, queued, use, drawn, pend>>

\* The scenario that a handler of run r reads when its routes arrive.
ScenOf(r) == IF ModuleScenario THEN current ELSE sc[r]

\* After the await: each scenario has its own promise, so the handlers resume in any order. A handler that is not the
\* last 'init' stops (me !== inits). Else w = init(...); traffic(w) and draw(w) ask for the routes of the scenario of
\* the run (one promise per scenario, made at the first ask). draw clears pending paths.
Stale(r) == r \in waiting /\ r # started /\ ~NoLatestCheck /\ waiting' = waiting \ {r}
            /\ UNCHANGED <<w, started, sc, current, requested, loaded, queued, use, drawn, pend>>
Resume(r) == r \in waiting /\ (r = started \/ NoLatestCheck)
             /\ w' = r /\ waiting' = waiting \ {r} /\ queued' = queued \cup {r} /\ use' = None
             /\ requested' = requested \cup {sc[r]} /\ drawn' = <<r, 0>> /\ pend' = None
             /\ UNCHANGED <<started, sc, current, loaded>>

Load(s) == s \in requested /\ s \notin loaded /\ loaded' = loaded \cup {s}
           /\ UNCHANGED <<w, started, waiting, sc, current, requested, queued, use, drawn, pend>>

\* routes.then(known => { if (world !== w) return; ... use = found.use })
Routed(r) == r \in queued /\ ScenOf(r) \in loaded /\ queued' = queued \ {r}
             /\ use' = (IF r = w THEN <<r, ScenOf(r)>> ELSE use)
             /\ UNCHANGED <<w, started, waiting, sc, current, requested, loaded, drawn, pend>>

\* routes.then(known => { if (thisDraw === drawn) pending = bothPaths(...) })
DrawRouted == drawn # None /\ drawn[2] = 0 /\ ScenOf(drawn[1]) \in loaded
              /\ pend' = <<drawn[1], ScenOf(drawn[1])>> /\ drawn' = <<drawn[1], 1>>
              /\ UNCHANGED <<w, started, waiting, sc, current, requested, loaded, queued, use>>

SetScenario(s) == ScenarioMessage /\ current' = s
                  /\ UNCHANGED <<w, started, waiting, sc, requested, loaded, queued, use, drawn, pend>>

Next == \E s \in Scen : Start(s) \/ Load(s) \/ SetScenario(s)
        \/ \E r \in 1..MaxRuns : Resume(r) \/ Stale(r) \/ Routed(r)
        \/ DrawRouted
Spec == Init /\ [][Next]_vars /\ WF_vars(\E s \in Scen : Load(s)) /\ WF_vars(\E r \in 1..MaxRuns : Routed(r)) /\ WF_vars(DrawRouted)
        /\ WF_vars(\E r \in 1..MaxRuns : Resume(r) \/ Stale(r))

\* The world is the last run, or none yet.
Latest == w \in {0, started}
\* The road use of the world comes from the routes of the scenario of its run.
UseOfOwnScenario == (w # 0 /\ use # None) => use = <<w, sc[w]>>
\* The dots that the world draws have paths of its run and of its scenario.
PathsOfOwnScenario == (w # 0 /\ pend # None) => pend = <<w, sc[w]>>
\* A run that stays the latest gets its road use: the routes of its scenario are asked for and come.
Routes == (started = MaxRuns /\ waiting = {}) ~> (use[1] = started)
====
