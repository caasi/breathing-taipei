# References

> Note: Claude Opus 5.5 wrote this file. It keeps the outside sources that the user asked to keep for later, with what each one gives. "Checked" means that an agent opened the primary page or source file. "Not checked" means that the facts come from a search snippet, a copy or memory.

DATA.md gives the sources of the data and of the figures in the code. This file is for methods and formats.

## Rendering of the traffic layer

Collected on 2026-10-26 by an agent search; the user asked to keep them for later.

Used already:

- Dual filtering (a Kawase blur on a chain of half sizes) for the glow: Marius Bjørge (ARM), "Bandwidth-Efficient Rendering", SIGGRAPH 2015. Not checked: cited from memory.
- Moving dashes for the flow: the Mapbox GL JS example "Add an ant path animation to a line" (https://docs.mapbox.com/mapbox-gl-js/example/animate-ant-path/), not checked. The dash speed per road is our addition.

Not tried yet, in the order that the search ranked them:

1. Accumulate the cover times the slowness in a float texture, then map it with a log or histogram-equalized scale, so that the dense centre does not saturate and the suburbs stay visible. Datashader 0.13 release, James A. Bednar, HoloViz, 2021-06-23 (https://blog.holoviz.org/posts/ds_release_0.13/), checked.
2. Trails behind the dots. deck.gl TripsLayer (https://deck.gl/docs/api-reference/geo-layers/trips-layer): each vertex has a time, and the fragment shader fades the alpha by `1 - (currentTime - vTime) / trailLength`; checked in `modules/geo-layers/src/trips-layer/trips-layer.ts`. Or a feedback texture that keeps the last frame at 0.996: mapbox/webgl-wind (https://github.com/mapbox/webgl-wind), code checked.
3. A soft glow from one draw, without a post pass: the `line-blur` ramp of Mapbox GL JS, `alpha = clamp(min(dist - (inner - blur2), outer - dist) / blur2, 0, 1)` in `src/shaders/line.fragment.glsl` (https://github.com/mapbox/mapbox-gl-js), checked. It can be cheaper than the glow chain on a phone.
4. Show the slowness in two channels, width and colour, so that it does not depend on colour alone. City Roads, Andrei Kashcha (https://github.com/anvaka/city-roads), and "Roads to Rome", moovel lab, 2015 (https://flowingdata.com/2015/12/10/all-the-roads-that-lead-to-rome); both not checked.

Other facts from the search:

- Mapbox Traffic v1 (https://docs.mapbox.com/data/tilesets/reference/mapbox-traffic-v1/), checked: 4 classes of congestion (low, moderate, heavy, severe) per segment and per direction, with the two directions drawn apart by `line-offset`. Our levels have no direction on a two-way edge; a one-way edge has a bucket for each heading (since 2026-10-27).
- Translucent lines that overlap at a joint add up and look brighter: Rye Terrell, "Instanced Line Rendering Part II: Alpha blending", 2021-09-30 (https://wwwtyro.net/2021/10/01/instanced-lines-part-2.html), checked. Our cover bake adds up on purpose; use MAX blending if crossings look too bright.
- Anti-aliased lines from quads with a signed normal: Konstantin Käfer, "Drawing Antialiased Lines with OpenGL", Mapbox (https://blog.mapbox.com/drawing-antialiased-lines-with-opengl-8766f34192dc), not checked (the page returned 403). This is the method of `Traffic.tsx`.
- No primary source was found for how the Google Maps traffic layer or the Cities: Skylines traffic overlay is drawn.

## Performance metrics

The setting `metrics` shows one line at the top of the map, right of the clock when the row has room, else on the right below it: `SIM <ms>ms | FPS <fps> ↓<1% low>↑<1% top>` (`web/src/ui/Metrics.tsx`). The user chose the format after the performance monitor of the Steam overlay.

- The performance monitor of the Steam overlay (June 2025) shows the frame rate with its minimum and maximum, a graph of the frame rate over time, and the frames of frame generation apart from the game frames. An article of Jon Peddie Research of 2025-06-20 (https://www.jonpeddie.com/?p=49409), checked: the minimum and the maximum are "sampled over one-second intervals", and a minimum "usually less than half the average" is red, as a likely stutter. Steam Support, "Understanding the In-Game Overlay Performance Monitor" (https://help.steampowered.com/en/faqs/view/3462-CD4C-36BD-5767), not checked: the page shows its text only with JavaScript.
- Our line is not the same figure. `↓` and `↑` are the 1% low and 1% top of the frames of the last 10 s (the mean frame of the slowest and of the fastest 1%), not the minimum of each second; tools such as RivaTuner give a 1% low (from a search result, not checked). `SIM` is the time that the worker spends on the model in one frame.

## Shortest paths

Collected on 2026-10-27 by an agent search, when the routes file had to hold the road path of any pair of street nodes; the user asked to keep them.

Used: contraction hierarchies (`web/src/sim/ch.ts`, built by `scripts/routes.ts`).

- Robert Geisberger, Peter Sanders, Dominik Schultes, Daniel Delling, "Contraction Hierarchies: Faster and Simpler Hierarchical Routing in Road Networks", WEA 2008, Lecture Notes in Computer Science, pp. 319–333 (https://doi.org/10.1007/978-3-540-68552-4_24; the authors' PDF: https://ae.iti.kit.edu/download/contract.pdf). Checked on 2026-10-27 against the authors' PDF. Order the nodes, remove them from the least important one up, and add a shortcut for each shortest path through a removed node. A query searches up the order from both ends, and each shortcut unpacks recursively. Our code takes the simplest form of each step of the paper:
  - The priority is the edge difference plus the deleted neighbours, with equal weights, updated lazily. The paper weights them 190 and 120 (its footnote 8), and also recomputes the neighbours of a contracted node.
  - The witness search stops after 200 nodes. The paper limits the hops or the size of the search, and does not give 200; it also uses a bucket search, which our code does not.
  - Both searches of a query run to the end (the paper's Lemma 1). The paper's search that takes turns and stops early is not used.
  - Stall-on-demand, without the paper's propagation of a stall to further nodes. The paper takes the technique from highway-node routing (Schultes and Sanders, WEA 2007; not checked).
  - A shortcut stores its two arcs. The paper stores the node that the shortcut bypasses.
- Not to be confused with Robert Geisberger, "Heuristic Contraction Hierarchies with Approximation Guarantee", 2010: the page https://ae.iti.kit.edu/english/1498.php, which a search gave for the paper above, serves this one.
- Measured on our road graph (15,070 nodes, 2026-10-27, Node): all three variants of `paths.ts` give 120,036 shortcuts and a file of 1,050,726 bytes, against 54,592,250 bytes for the old file of precomputed paths. One query took about 0.25 ms against 3 to 4 ms for a Dijkstra search of the whole graph, and `web/src/sim/paths.test.ts` makes sure that 100 random pairs of street nodes in each variant have the cost of a Dijkstra search. On 2026-10-27, one-off checks by the agents compared 900, 3,600 and 7,199 random pairs, with no difference; those scripts are not in the repository.

Not used:

- Compressed path databases: a first-move table (the first edge of the shortest path for each pair), rows and columns reordered, then run-length encoded. Ben Strasser, Adi Botea, Daniel Harabor, "Compressing Optimal Paths with Run Length Encoding", JAIR 54 (2015) 593–629 (https://mlanthology.org/jair/2015/strasser2015jair-compressing), not checked: from a search summary. Queries near 100 ns; the build needs the full n x n table.
- SILC: for each node, the other nodes grouped by the first neighbour on their shortest path, stored as regions in a quadtree. Jagan Sankaranarayanan, Houman Alborzi, Hanan Samet, ACM GIS 2005 (https://www.cs.umd.edu/users/hjs/pubs/silc2005.pdf), not checked: from a search summary; a survey gives O(n^1.5) space.
- Hub labels and transit node routing: per node a small set of hubs with their distances. Fast for distances, and a path needs more structure. Survey: Hannah Bast et al., "Route Planning in Transportation Networks", 2016 (https://arxiv.org/abs/1504.05140), not checked: only the abstract was read.
