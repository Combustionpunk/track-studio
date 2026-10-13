# rctrack — shared track format (v1.3)

One file describes a track for the forum, the real world and the sim. Designers write it; the forum stores,
previews and links it to venues and meetings; the sim imports it. Files are JSON, extension `.rctrack.json`.

## Principles
- **One source of truth.** The same file is approved for a meeting, laid out in the hall and driven in the sim.
- **Design vs built.** `design` holds the editable inputs (corner points, radii, widths, features). `built` holds the
  geometry calculated from them (racing line, every divider as a polyline, placed features, checks).
  Only designers read `design` and run the geometry engine. Everything else — forum previews, 3D viewer, the sim,
  build sheets — draws `built` directly, so they can never disagree.
- **Engine can improve without breaking files.** Consumers never recompute geometry, so the engine can be refined
  (e.g. smoother divider merging) and old files keep working; re-saving a design simply refreshes `built`.
- **Metres, top-down plan.** Origin at the centre of the track area, **+x east (right on the plan), +z north (up on
  the plan)**, heights in metres. Headings in degrees: 0 = +x, counter-clockwise towards +z.

## Top level
| Key | Notes |
|---|---|
| `format`, `version` | `"rctrack"`, `1` |
| `id`, `revision` | UUID stable across edits; revision increments on every saved change. Meetings pin a revision. |
| `info` | name, author (forum username), dates, description, venue `{id, name}`, status `draft / submitted / approved / archived`, surface, classes, tags, `derivedFrom` (below) |
| `area` | `{length, width}` usable track area in metres — from the venue template (or set by the designer for a blank design) |
| `basedOn` | `{venueTemplate, revision}` if the design started from a venue template, else `null` |
| `obstacles` | fixed items inside the area, copied from the venue template: `{type: "circle", x, z, radius, label}` or `{type: "rect", x, z, length, width, rotation?, label}` |
| `design` | editable inputs, below |
| `built` | derived geometry, below |

## design
- `laneWidth` — default lane width (m).
- `points[]` — corner points in driving order, closed loop: `{x, z, radius, width, outer}`.
  Straights run point-to-point at any angle (diagonals); each corner is a circular arc of `radius` (small = hairpin,
  large = sweeper), automatically reduced if it can't fit the straights either side. `width` blends linearly between points.
  `outer` — the outside of the corner: `"square"` (default: two straight pipes meeting in a corner, as clubs build them)
  or `"round"` (the pipe follows the arc). The racing line is the same either way. *(v1.3)*
- `features[]` — `{type, distance, length?, height?}`; `distance` is metres along the racing line from point 0 to the
  feature's centre. Types: `tabletop, double, kicker, stepup, stepdown, whoops, bump` (defaults in the engine).
- `start.distance` — start/finish line position along the racing line.
- `rostrum` — `{side: north/south/east/west, offset}`; offset in metres along that side from its centre.

## built
- `lapLength` (m)
- `racingLine[]` — `[x, z, laneWidth]` every ~0.25 m (closed loop)
- `dividers[]` — `{points: [[x, z], ...], shared, closed}`; each is one continuous run of pipe. `shared = true` where a
  single pipe separates two parts of the track.
- `features[]` — `{type, x, z, heading, length, width, height, profile: [[along, height], ...]}`
- `startLine` — `{x, z, heading, width, distance}`
- `rostrum` — `{side, x, z, eyeHeight}`
- `checks[]` — `{level: error|warning|info, code, message, x?, z?}`. Codes so far: `outside-area`, `tight-corner`,
  `narrow-lane`, `feature-in-corner`, `radius-reduced`.
- `stats` — `{dividerLength, dividerRuns, corners}` (feeds the build sheet). `corners` counts corners the way racers
  do (see *Corner count* below).
- `size` — the track's real size from its lane edges (no pipe padding): `{length, width, bbox: [xmin, zmin, xmax, zmax]}`
  in metres, `length` along x. This is the figure to show people ("22 × 12 m"). *(v1.2)*
- `footprint` — raster of the area the lanes and pipes cover, for fit searches only: `{cell, origin, rows, cols, bbox, rle}`
  (`rle` = row-major run lengths, starting with an empty run). Its bbox includes pipe thickness and a one-cell margin, so
  it is slightly bigger than `size`. Covered = discs of radius width/2 + 0.04 m round every other racing-line sample, plus
  each square corner's outer half out to its mitre (see *Borders*). New check code: `obstacle`.

## Geometry engine (reference: `bake.py`)
1. **Racing line:** closed polyline through `points`, each corner filleted with its radius (radius shrinks to fit).
2. **Borders:** the lane edges (see *Borders* below).
3. **Shared dividers:** a border point pairs with the nearest point of another border from a part of the track ≥ 3 m
   away along the line, running roughly parallel (|cos| ≥ 0.9 between the borders' own directions; a collapsed inside
   apex pairs with anything), closer than 0.6 m; it is pulled towards their midpoint (fully below 0.2 m, blended
   between). The pull is then averaged over ±4 samples (~0.4 m in all) along the border, so a pipe peels away smoothly —
   but never across a corner of the border (a turn of more than 30° between samples, or entering/leaving a collapsed
   apex); a corner vertex moves to where its two pulled legs meet. Fully shared stretches are generated once.
4. **Dividers:** remaining border runs, simplified (0.02 m tolerance). Then each is tidied: a self-crossing is cut (an
   open run splits there into head, loop and tail and loses the shortest; a closed one keeps its longer part); repeated
   points and short (< 0.25 m) end segments doubling back (> 120°) are dropped; longest first, end vertices lying within
   0.06 m of an already kept divider are trimmed (that stretch is drawn already); anything shorter than 0.25 m is dropped.
5. **Features / start / rostrum:** placed by distance along the racing line.
6. **Checks:** area, corner radius (min 0.6 m), lane width (min 1.4 m), features on or landing into corners.
7. **Size:** bounding box of both lane edges (step 2, before divider merging).

### Borders
Each sample of the racing line is offset ±width/2 sideways. At a corner (design point P, effective radius r, turn θ,
the corner point's width w — not the blend):
- **Inside:** the arc of radius r − w/2. Where that is ≤ 0 the inside edge collapses to the **apex**: the point where
  the two straights' inside edges meet, P + (inside bisector) · (w/2) / cos(θ/2); straight samples whose inside edge
  would run past it are held there too.
- **Outside, `round`:** the arc of radius r + w/2 (rctrack 1.2 behaviour).
- **Outside, `square`:** the incoming straight's outside edge runs on to the **mitre** — where the two straights'
  outside edges meet, P + (outside bisector) · (w/2) / cos(θ/2) — and the outgoing straight's outside edge leaves from
  there. The corner's arc samples are spread along that outline by length, with the mitre exactly on one sample.
- **Mitre limit:** a square corner turning more than 120° gets a **bevel** instead: the outline is cut square to the
  bisector at distance (r + w/2) / cos(60°) from the arc's centre — as far out as the mitre of a 120° corner reaches.
  For r = 0 that is width/2 / cos(60°) (= the lane width) from the corner point.

So a loop whose points sit width/2 from the edges of the area reaches the area's edges *and* corners.

### Corner count
A design point whose turn is more than 20° is a corner. Turns **the same way** joined by less than **3 m** of racing line
(the straight between them, plus any intermediate turns of 20° or less) count as **one** corner — a hairpin drawn as two
90° points, or a turn – short straight – turn the same way (carousel). A track that is a single continuous turn counts as
1. Club A: 18 corner points → 12 corners. The 3 m is a single setting (`CORNER_JOIN_GAP` in `bake.py` and the TypeScript
engine); changing it means changing both and re-baking stored tracks.

`examples/*.rctrack.json` are fixtures: a TypeScript or C# port must reproduce their `built` sections (within 1 cm).

## Venue templates (`.rcvenue.json`)
A venue's starting point for designs: `{format: "rcvenue", version: 1, id, revision, info: {name, venue: {id, name}, notes},
area: {length, width}, rostrum: {side, offset}, obstacles: [...]}`. Created by a club organiser in Track Studio; the forum
venue record links to it. Designs started from a template copy its area, rostrum and obstacles and record `basedOn`.

## Fit search (reference: `fit.py`)
For a track and a venue template: try 8 orientations (as designed, mirrored, rotated 90/180/270, mirrored + rotated),
slide the footprint over the venue area on a 0.1 m grid, keep positions inside the area and clear of every obstacle
(lanes + pipe thickness), prefer the most central. Results are labelled by orientation so organisers can judge the
rostrum view. Choosing a result creates an adapted copy for that venue (new id, `info.derivedFrom` = original id,
revision and orientation) and re-bakes it.

## Forum integration (plan)
- **Venue:** links to its venue template in Track Studio (which holds area, rostrum and obstacles).
- **Track library:** each design is a topic in a "Track Designs" category; the `.rctrack.json` is attached to the
  first post. The plugin renders the 2D preview (SVG from `built`, as in `preview_svg.py`) and a 3D viewer,
  with download and "open in sim" links. New revisions are new attachments; the topic shows history.
- **Status workflow:** draft → submitted → approved (for a venue) → archived.
- **Meetings:** an event gets a `track_design` link (topic + pinned revision). The event page shows the 2D/3D
  views and a "practise in the sim" download.

## Sim integration (plan)
Import a `.rctrack.json` (file or forum link) and build directly from `built`: area → hall, dividers → pipes,
features → ramps, startLine → timing line and grid, rostrum → VR/rostrum position.

## Changes
- **1.3** — `design.points[].outer: "square" | "round"` (default `square`): square outer corners (mitre, bevel past
  120°). Inside corners tighter than the lane collapse cleanly to the apex. Shared dividers: nearest-point pairing,
  blended transitions, cut self-crossings, trimmed overlaps, no fragments under 0.25 m. Footprint includes square
  corners. `version` stays `1`; re-baking changes `built` of existing tracks (outer pipes, size/footprint near corners).
- **1.2** — `info.derivedFrom = {id, revision, orientation?, author?}` credits the track this one came from: a venue
  adaptation (`orientation`, see Fit search) or someone's copy (`author` = the original's author). `built.size` added (lane-edge size); `stats.corners` counts like a racer (same-direction turns joined by
  < 3 m are one corner; was: every corner point turning > 20°). `version` stays `1`: older readers ignore `size`, and
  files baked by 1.1 simply have no `size` and the old corner count until re-baked.
- **1.1** — footprint raster, obstacles, `obstacle` check, rostrum offset.
