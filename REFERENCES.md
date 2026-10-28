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

## Drawing lines in WebGL

Collected on 2026-10-28 for issue #34, when the borders moved into WebGL (`strips()` in `web/src/ui/lines.ts`). The user gave the first two sources and asked for a search of common methods. For the pages marked "checked (summary)", the agent opened the page, but the fetch tool gave a summary, not the full text.

Used already:

- Coverage from a geometry that is 1 pixel wider than the line on each side: the fragment shader gets the signed distance from the line and computes the share of the pixel that the line covers. "How 2 draw lines in WebGL that look like canvas 2d", Ivan, Crazy Panda (PixiJS), Khronos, PDF created 2021-10-13 (https://www.khronos.org/assets/uploads/developers/presentations/Crazy_Panda_How_to_draw_lines_in_WebGL.pdf), checked. The slides call it "HHAA". `coverOf` in `lines.ts` is the coverage of one edge pair (the slides' `pixelLine`); the slides also give the coverage of a miter as `a2*b2 - a1*b1`, which `lines.ts` does not use, because `strips()` builds the miter in the geometry.
- Miter joins in one strip, with the miter length `width / dot(miter, normal)`: Matt Stobbs, "Drawing Lines with WebGL", Scott Logic, 2019-11-18 (https://blog.scottlogic.com/2019/11/18/drawing-lines-with-webgl.html), checked. Above a miter length of 10 it cuts the corner, with 4 vertices for each point.
- A bevel when the miter is longer than the limit: Crazy Panda (above), MapLibre GL JS (default `line-miter-limit` 2, style spec v8), deck.gl PathLayer (default `miterLimit` 4). SVG also bevels above its `stroke-miterlimit` (default 4, from memory, not checked); `strips()` uses 4.

Not used yet:

1. Split a line into parts that do not overlap (inner segments, end segments, joins, caps), so that a line with alpha is not darker where parts meet. Rye Terrell, "Instanced Line Rendering Part II: Alpha blending", 2021-09-30 (https://wwwtyro.net/2021/10/01/instanced-lines-part-2.html), checked (summary). Part I, 2019 (https://wwwtyro.net/2019/11/18/instanced-lines.html), checked (summary): one instanced quad for each segment, and joins as separate instances (round: a fan of 16 slices; miter: 6 vertices; bevel: 3). Part II names two ways to one draw call: merge the join geometry into the segments, or use the stencil buffer against the overlap of round joins and round caps, with a cost in performance.
2. Dashes from a dash texture: MapLibre GL JS keeps each dash pattern as a 1-channel distance field in a texture atlas. The x coordinate is the distance along the line scaled by the length of the dash pattern (`a_linesofar * u_patternscale_a_x / floorwidth`; what `dasharray.w` holds was not checked), and the alpha is a `smoothstep` around 0.5. The units of `line-dasharray` are line widths. At a corner sharper than 75 degrees, MapLibre adds vertices 15 px from the corner, so that the dashes do not tilt. Shaders `line_sdf.vertex.glsl` and `line_sdf.fragment.glsl` (https://github.com/maplibre/maplibre-gl-js/tree/main/src/shaders/glsl), checked (raw files); `line_bucket.ts` (`COS_HALF_SHARP_CORNER`, `SHARP_CORNER_OFFSET = 15`), checked (raw file).
3. Dashes that stay even across a corner: each instance carries the distance at its start and at the starts of its neighbours, and at a corner the fragment shader takes the union of the dashes of the two segments. Yuqi Pan, "Lesson 12 - Draw polyline", An infinite canvas tutorial (https://infinite-canvas-tutorial.pages.dev/guide/lesson-012), checked (summary).
4. A colour for each segment from data: MapLibre gives each feature its paint values as vertex attributes (from the `#pragma` lines of the shaders; the code that fills them was not read); `line-gradient` samples a ramp by the share of the line already drawn, and it needs `lineMetrics` on a GeoJSON source. deck.gl takes one colour for each vertex when the colours come as a binary attribute; `getColor` gives one colour for each path. Crazy Panda keeps the style in a data texture, with an ID in the attribute. This is for the load of each rail segment (issue #24).
5. Dashes in deck.gl `PathStyleExtension` (https://deck.gl/docs/api-reference/extensions/path-style-extension), checked (summary): `dashMode` `segment` starts the pattern again at each vertex; `path` keeps it continuous, from a length measured on the CPU.
6. Joins, caps and a colour for each vertex in one library: regl-gpu-lines, Ricky Reusser (https://github.com/rreusser/regl-gpu-lines), checked (summary). It has no dashes, and its joins do not follow a change of width.

Other facts from the search:

- `gl.lineWidth` is of no use: ANGLE limits it to 1. Matt DesLauriers, "Drawing Lines is Hard", 2015 (https://mattdesl.svbtle.com/drawing-lines-is-hard), checked (summary). He lists five ways to antialias: MSAA, feathered triangles, a texture of alpha, coverage in the fragment shader, and a second pass of `gl.LINES`.
- MapLibre does not compute the coverage of a line thinner than a pixel. It fades the alpha over about 1 pixel at the edge, `clamp(min(dist - (inner - blur), outer - dist) / blur, 0, 1)` in `line.fragment.glsl`, checked (raw file). That shader has no special case for the overlap at joins.
- None of the sources solves the fold of a strip on the inner side of a segment that is shorter than the inner offsets of its miters. Crazy Panda names the case ("self-intersecting"). `strips()` reduces it with a gap between points, and lists it as a limit.
- The box filter of the dash in `Borders.tsx` (the share of a pixel that the dashes cover, from the integral of the square wave) was not found in these sources.
- Not opened: Dan Bagnell, "Robust polyline rendering with WebGL", 2013; the three.js `LineMaterial` forum threads; the Skia analytic AA pages.

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
