// Tags on the edges of the road graph (route.ts), and the profiles of the scenarios that allow tags (route.ts PROFILES). An edge is usable in a profile when the
// profile allows each of its tags. A street node (route.ts graphFrom) is a node of an edge of class 0; a future road
// is class 0. A village starts its trips at its nearest street node (paths.ts roadNode).
abstract sig Tag {}
one sig Motorway, Works, Future extends Tag {}
sig Node {}
sig Edge { a, b: one Node, tags: set Tag } { a != b }
abstract sig Profile { allowed: set Tag }
one sig Now, Later extends Profile {}
fact { Now.allowed = Motorway + Works and Later.allowed = Tag }
fact { all e: Edge | not (Works + Future in e.tags) } // a road under works exists today; a future road does not
fun usable[p: Profile]: set Edge { { e: Edge | e.tags in p.allowed } }
fun link[p: Profile]: Node -> Node { { x, y: Node | some e: usable[p] | (e.a = x and e.b = y) or (e.a = y and e.b = x) } }
fun street: set Node { { x: Node | some e: Edge | Motorway not in e.tags and x in e.a + e.b } }
fun today: set Node { { x: Node | some e: Edge | Future not in e.tags and x in e.a + e.b } }
// The graph of today is connected.
fact { all x, y: today | x != y => y in x.^(link[Now]) }

// Each street node reaches each other street node in Now.
pred streetsConnected[p: Profile] { all x, y: street | x != y => y in x.^(link[p]) }
assert NowConnected { streetsConnected[Now] }
check NowConnected for 5 expect 1
// A future road only joins nodes of today: then Now stays connected.
pred joinsToday { all e: Edge | Future in e.tags => e.a + e.b in today }
assert NowConnectedIfJoined { joinsToday => streetsConnected[Now] }
check NowConnectedIfJoined for 5 expect 0
// Later is connected as soon as today is.
assert LaterConnected { streetsConnected[Later] }
check LaterConnected for 5 expect 1
// A future road can make a new node (on the airport land) only reachable in Later.
pred newNode { some x: street - today | some y: today & street | y in x.^(link[Later]) }
run newNode for 5 expect 1

// Fix 1: each new node reaches a node of today in Later (a future road is not an island).
pred noIsland { all x: Node - today | some x.^(link[Later]) & today }
assert LaterConnectedIfNoIsland { noIsland => streetsConnected[Later] }
check LaterConnectedIfNoIsland for 6 expect 0
// Fix 2: the street nodes of a profile come from its usable edges, so a village of Now never starts at a new node.
fun streetOf[p: Profile]: set Node { { x: Node | some e: usable[p] | Motorway not in e.tags and x in e.a + e.b } }
assert NowConnectedStreetOf { all x, y: streetOf[Now] | x != y => y in x.^(link[Now]) }
check NowConnectedStreetOf for 6 expect 0
