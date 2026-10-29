---- MODULE SpeedClock ----
\* App.tsx and worker.ts: each change of speed (and each new run) has a stamp `since`, the time of the change. The page
\* takes the clock of a frame only when the frame has the stamp of the latest change (`m.since === l.since`).
\* `since` is performance.timeOrigin + now, never 0, so the stamps start at 1. postMessage keeps the order in each
\* direction. A model of the code, not the code: change it with both files.
EXTENDS Naturals, Sequences
CONSTANTS MaxChanges, MaxTime, MaxQueue, NewStamp \* NewStamp: no two changes get the same stamp
VARIABLES now, version, since, toWorker, workerVersion, workerSince, toPage, wrong
vars == <<now, version, since, toWorker, workerVersion, workerSince, toPage, wrong>>

Init == now = 1 /\ version = 0 /\ since = 0 /\ toWorker = <<>> /\ workerVersion = 0 /\ workerSince = 0
        /\ toPage = <<>> /\ wrong = FALSE

Tick == now < MaxTime /\ now' = now + 1 /\ UNCHANGED <<version, since, toWorker, workerVersion, workerSince, toPage, wrong>>

\* startClock or a new run: l.since = since; post({ ..., at: since })
Change == version < MaxChanges /\ (NewStamp => now > since)
          /\ version' = version + 1 /\ since' = now
          /\ toWorker' = Append(toWorker, [v |-> version + 1, s |-> now])
          /\ UNCHANGED <<now, workerVersion, workerSince, toPage, wrong>>

\* onmessage 'speed' or 'init': since = m.at
WorkerTakes == toWorker # <<>> /\ workerVersion' = Head(toWorker).v /\ workerSince' = Head(toWorker).s
               /\ toWorker' = Tail(toWorker) /\ UNCHANGED <<now, version, since, toPage, wrong>>

\* frame(): a message with the clock of the worker and its `since`
Frame == Len(toPage) < MaxQueue /\ toPage' = Append(toPage, [v |-> workerVersion, s |-> workerSince])
         /\ UNCHANGED <<now, version, since, toWorker, workerVersion, workerSince, wrong>>

\* w.onmessage: if (m.since === l.since) take the clock of the frame
PageTakes == toPage # <<>> /\ toPage' = Tail(toPage)
             /\ wrong' = (wrong \/ (Head(toPage).s = since /\ Head(toPage).v # version))
             /\ UNCHANGED <<now, version, since, toWorker, workerVersion, workerSince>>

Next == Tick \/ Change \/ WorkerTakes \/ Frame \/ PageTakes

\* The page never takes the clock of a frame that the worker made before the latest change of the page.
OnlyLatestClock == ~wrong
====
