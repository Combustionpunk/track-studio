# rctrack — shared track format (v1.9)

One file describes a track for the forum, the real world and the sim. Designers write it; the forum stores,
previews and links it to venues and meetings; the sim imports it. Files are JSON, extension `.rctrack.json`.

**A layout belongs to no venue** *(v1.7)*. A layout is its name, its id and the track itself (lanes, corners, jumps,
start). Venue templates (`.rcvenue.json`, below) hold the hall: its area, pillars and obstacles, and the rostrum. A
template is used to start a new layout (its area and obstacles are shown as a guide while drawing, and not saved into
the layout) and to check a layout against a venue (the fit search, which says whether and in which orientations it fits).

## Principles
- **One source of truth.** The same file is approved for a meeting, laid out in the hall and driven in the sim.
- **Design vs built.** `design` holds the editable inputs (corner points, radii, widths, features). `built` holds the
  geometry calculated from them (racing line, every divider as a polyline, placed features, checks).
  Only designers read `design` and run the geometry engine. Everything else — forum previews, 3D viewer, the sim,
  build sheets — draws `built` directly, so they can never disagree.
- **Engine can improve without breaking files.** Consumers never recompute geometry, so the engine can be refined
  (e.g. smoother divider merging) and old files keep working; re-saving a design simply refreshes `built`.
- **Metres, top-down plan.** Origin at the centre of the drawing area (`area`; a layout without one is drawn on a box
  centred on the origin, see `area` below), **+x east (right on the plan), +z north (up on
  the plan)**, heights in metres. Headings in degrees: 0 = +x, counter-clockwise towards +z.

## Top level
| Key | Notes |
|---|---|
| `format`, `version` | `"rctrack"`, `1` |
| `id`, `revision` | UUID stable across edits; revision increments on every saved change. Meetings pin a revision. |
| `info` | name, author (forum username), dates, description, venue `{id, name}`, status `draft / submitted / approved / archived`, surface, classes, tags, `derivedFrom` (below), `drawnFor` *(v1.7)*: `{venueTemplate, name}`, the venue template the layout was drawn for — a label for people browsing ("drawn for …"); nothing checks it |
| `area` | optional *(v1.7)*: `{length, width}` in metres, the drawing area the designer used (a venue template's, or set for a blank design). No check depends on it. Without it, draw the layout on the smallest box centred on the origin, in whole metres, that holds `built.size` with 0.5 m to spare (`drawingArea` in the engine) |
| `design` | editable inputs, below |
| `built` | derived geometry, below |

## design
- `laneWidth` — default lane width (m).
- `points[]` — corner points in driving order, closed loop: `{x, z, radius, width, outer}`.
  Straights run point-to-point at any angle (diagonals); each corner is a circular arc of `radius` (small = hairpin,
  large = sweeper), automatically reduced if it can't fit the straights either side. `width` blends linearly between points.
  `outer` — the outside of the corner: `"square"` (two straight pipes meeting in a corner, as clubs build them),
  `"round"` (the pipe follows the arc) or `"auto"` (the default: square for turns up to 120°, round for sharper ones).
  The racing line is the same either way. *(v1.3; `auto` v1.4)*
- `features[]` — `{type, distance, length?, height?}`; `distance` is metres along the racing line from point 0 to the
  feature's centre. Types: `tabletop, double, kicker, stepup, stepdown, whoops, bump` (defaults in the engine), and
  `crossover` *(v1.6)*: a bridge carrying one pass of the track over another where the track crosses itself (see
  *Crossings*). A crossover has `{type: "crossover", distance, rampLength?, topLength?, height?, over?}` instead of
  `length`: `distance` is at the crossing (either pass's distance finds it; the bake puts it on the over pass), `over`
  is `"first"` (the default) or `"second"`, the pass that goes over, in driving order from the start line.
- `start.distance` — start/finish line position along the racing line.
- Direction of travel is the order of `points`: reversing a track reorders them to `[p0, pn-1, …, p1]` and moves each `distance` so jumps and the start line stay in the same spot (no field for it).

## built
- `lapLength` (m)
- `racingLine[]` — `[x, z, laneWidth]` every ~0.25 m (closed loop)
- `dividers[]` — `{points: [[x, z], ...], shared, closed}`; each is one continuous run of pipe. `shared = true` where a
  single pipe separates two parts of the track.
- `features[]` — `{type, x, z, heading, length, width, height, profile: [[along, height], ...]}`, one per design
  feature, in the same order. A crossover that bridges a crossing sits on it, on the over pass: length
  2 × ramp + top, profile `[[0, 0], [ramp, height], [ramp + top, height], [2 × ramp + top, 0]]`.
- `crossings[]` *(v1.6)* — one per place the racing line crosses itself; **absent** when it doesn't:
  `{x, z, distances: [first, second], angle, over, bridge, footprint}`. `distances` are both passes' lap distances
  (m from point 0), first and second in driving order from the start line; `angle` is the angle between the passes,
  0–90° (90 = square); `over` is `"first"`, `"second"` or `null` (unbridged); `bridge` is `{type: "crossover" |
  "tabletop", feature}` (index into `design.features` / `built.features`) or `null`; `footprint` is the bridge's
  outline, four `[x, z]` corners (the bridging feature's length × width), or `null`. Consumers draw the bridge from
  `footprint` and the ramps from the feature. The lanes and dividers of both passes run straight through a crossing
  in plan (the under pass's pipes go under the bridge), so an even-odd fill of `lanes` leaves the crossing square
  empty: draw the bridge (or the under pass) on top.
- `startLine` — `{x, z, heading, width, distance}`. `heading` is the direction of travel at `distance`; where that is
  a racing-line sample (a corner join, say), it is the true tangent there, so a track and its reverse give the same
  line facing the other way *(v1.8)*.
- `checks[]` — `{level: error|warning|info, code, message, x?, z?}`, the track's own checks *(v1.7: no venue checks;
  see Fit search)*. Codes: `tight-corner`, `narrow-lane`, `feature-in-corner`, `radius-reduced`, and *(v1.6)*
  `crossing-unbridged`, `crossing-too-low`, `crossing-angle`, `crossing-too-close`, `crossover-unused` (see *Crossings*),
  *(v1.8)* `start-on-feature`, and *(v1.9)* `lane-overlap` (see *Lane overlaps*). A distance in a message is on the lap, from 0 up to `lapLength` *(v1.8)*: a feature
  at `distance` -1.5 is "at 47.1 m" on a 48.6 m lap.
  `start-on-feature` *(v1.8)*: a `warning` at the start line, "Start line is on a ramp", when `start.distance` lies
  within a crossover's length, or within the length of a tabletop that bridges a crossing (`crossings[].bridge`). Nothing
  is moved: it is the designer's call.
  `feature-in-corner` *(v1.8)*: a feature on or landing into a corner (from half its length before its distance to
  1 m past its end, across lap distance 0 if need be). For a jump it is `info`, "Tabletop at 12.4 m is on or lands
  into a corner (technical section)": a technical drive, not a mistake. For a crossover it is a `warning`, because a
  bridge's ramps need straight track.
- `stats` — `{dividerLength, dividerRuns, corners}` (feeds the build sheet). `corners` counts corners the way racers
  do (see *Corner count* below).
- `lanes` — `{right: [[x, z], …], left: [[x, z], …]}`: both lane edges as closed rings (the borders below, before
  divider merging, simplified with the dividers' 0.02 m tolerance). Fill the band between them (even-odd) to draw the
  carpet — square corners included. *(v1.4)*
- `size` — the track's real size from its lane edges (no pipe padding): `{length, width, bbox: [xmin, zmin, xmax, zmax]}`
  in metres, `length` along x. This is the figure to show people ("22 × 12 m"). *(v1.2)*
- `footprint` — raster of the area the lanes and pipes cover, for fit searches only: `{cell, origin, rows, cols, bbox, rle}`
  (`rle` = row-major run lengths, starting with an empty run). Its bbox includes pipe thickness and a one-cell margin, so
  it is slightly bigger than `size`. Covered = discs of radius width/2 + 0.04 m round every other racing-line sample, plus
  each square corner's outer half out to its mitre (see *Borders*).

## Geometry engine (reference: `bake.py`)
1. **Racing line:** closed polyline through `points`, each corner filleted with its radius. A corner turning θ with
   radius r takes t = r · tan(θ/2) from each straight next to it. Corners share each straight by what they need: on a
   straight of length L between corners i and i+1, if t_i + t_{i+1} ≤ L both get what they ask for; otherwise each gets
   its share in proportion, f = L / (t_i + t_{i+1}). A corner keeps t_i · min(f_in, f_out) over its two straights, and its
   effective radius is that t / tan(θ/2); `radius-reduced` is raised where it is more than 0.01 m below the radius asked
   for. *(v1.5; was: t at most half of each straight)*
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
5. **Features / start:** placed by distance along the racing line; crossings and their bridges (below).
6. **Checks:** corner radius (min 0.6 m), lane width (min 1.4 m), features on or landing into corners
   (crossovers too: their ramps must be on straight track, with 1 m to land), crossings, lane overlaps *(v1.9)*. The track only: checks
   against a venue are the fit's (*Fit search*).
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

So a loop whose points sit width/2 from the edges of an area reaches the area's edges *and* corners.

### Crossings *(v1.6)*
A track may cross itself where a bridge carries one pass over the other.
- **Detection:** every place the dense racing line (step 1) crosses itself, from different parts of the lap (≥ 1 m
  apart along it). The two passes are *first* and *second* in driving order from the start line.
- **Bridge span:** a bridge on one pass needs a flat top of `w / sin(angle) + 2 × 1 m` along it, where `w` is the
  other (under) pass's lane width at the crossing: the under pass's lane plus 1 m each side.
- **Crossover:** claims the nearest crossing (not already claimed) whose first or second distance is within half the
  crossover's length of its `distance` (crossovers that would bridge the crossing they find claim first, in feature
  order, then the rest), and goes over pass `over` (default `"first"`). Defaults: `rampLength` 2 m,
  `topLength` the bridge span (so `laneWidth + 2 m` for a square crossing), `height` 0.40 m. It bridges the crossing if
  its top is at least the bridge span and it is at least 0.40 m high (the clearance cars need to pass under). A
  crossover that claims no crossing stays where its `distance` puts it, with a top of `laneWidth + 2 m`.
- **Tabletop:** a tabletop whose length covers one pass's crossing point bridges the crossing, with that pass over, if
  its flat top (the middle 0.8 / 2.2 of its length) covers the bridge span centred on the crossing and it is at least
  0.40 m high (so a default-height tabletop never bridges).
- **Checks:** a crossing that nothing bridges is an error, `crossing-unbridged` (its message says why a crossover or
  tabletop there doesn't count). If a crossover or tabletop is in place and long enough but lower than 0.40 m, the
  error is `crossing-too-low` instead ("The crossover at 9.0 m is 0.30 m high; cars need 0.40 m to pass under"). A
  crossover that bridges no crossing and isn't the reason for one's error (it claims none: away from any, or a second
  on one already claimed; or a tabletop bridges the one it claims) is a warning, `crossover-unused`, at the crossover. An angle under 60° (outside 60–120° between the passes) is a warning,
  `crossing-angle`. Two crossings whose footprints overlap are an error, `crossing-too-close`; an unbridged crossing's
  footprint for this is where a default crossover over the first pass would stand. Lanes overlapping anywhere else are
  a `lane-overlap` error *(v1.9, see Lane overlaps)*.
- **Dividers:** a divider crossing itself where the lanes of a crossing overlap (within 0.2 m) is not cut (step 4):
  both passes' pipes stay whole.

### Lane overlaps *(v1.9)*
`lane-overlap` (error): the lane of one part of the lap runs into the lane of another, away from a crossing.
- **Samples:** every 0.25 m of racing line (the exported `racingLine`'s samples), each a disc of half its lane width round
  its centre. Two samples overlap by how far their discs reach into each other: half their widths' sum less the distance
  between them. Up to 0.02 m (the dividers' tolerance) is no overlap: two lanes sharing a pipe touch. (Discs, not the lane
  edges: a square corner's mitre reaching into a sweeper round it is where the bake puts a shared pipe.)
- **The lane meeting itself is not an overlap:** a pair is left out if (1) one way round the lap or the other, every
  sample between them overlaps the first (the lane never got clear of it: a corner, the bend of a hairpin), or (2) both
  are in one corner's own stretch: its arc and the straight samples whose inside edge is held at its collapsed apex (a
  sharp V: the legs overlap out to where the inside edges meet), or (3) they are the two passes of a crossing, each within
  max(lane widths) / max(sin(angle), 0.1) + 1 m of it along its pass (`built.crossings`; bridged, or reported, by the
  crossing checks). Rule (1) stands in for a fixed lap-distance separation, which would be either too short for a
  sweeper or long enough to hide a real overlap next to a hairpin. The legs of a hairpin closer than a lane width do
  overlap, beyond its bend.
- **Reported:** overlapping pairs that neighbour each other (each sample within one of the other pair's, either way
  round) are one overlap. One check per overlap, at the mean of its pairs' midpoints (the middle of the overlap), with
  the deepest overlap ("Lanes overlap by 0.60 m here"), in the order of each overlap's first pair (by sample).

### Corner count
A design point whose turn is more than 20° is a corner. Turns **the same way** joined by less than **3 m** of racing line
(the straight between them, plus any intermediate turns of 20° or less) count as **one** corner — a hairpin drawn as two
90° points, or a turn – short straight – turn the same way (carousel). A track that is a single continuous turn counts as
1. Club A: 18 corner points → 12 corners. The 3 m is a single setting (`CORNER_JOIN_GAP` in `bake.py` and the TypeScript
engine); changing it means changing both and re-baking stored tracks.

`examples/*.rctrack.json` are fixtures: a TypeScript or C# port must reproduce their `built` sections (within 1 cm).

## Venue templates (`.rcvenue.json`)
The hall: `{format: "rcvenue", version: 1, id, revision, info: {name, venue: {id, name, trackId, trackName}, notes},
area: {length, width}, rostrum: {side, offset}, obstacles: [...]}`. `area` is the usable track area in metres, origin at
its centre; `rostrum` stands 1.5 m outside the middle of its `side` (north/south/east/west), moved `offset` metres along
it, eyes 2.8 m up; `obstacles` are fixed items inside the area: `{type: "circle", x, z, radius, label}` or `{type: "rect",
x, z, length, width, rotation?, label}`. Created by a club organiser in Track Studio. `info.venue` links the template to
one forum venue (`id`, `name`) and one of its tracks (`trackId`, `trackName`), since a forum venue can have several (an
indoor carpet track and an outdoor tarmac one); at most one template per forum track.

A template is used for two things only *(v1.7)*:
1. **Starting a new layout:** the designer shows the template's area and obstacles as a guide while drawing. They are
   not saved into the layout; the layout keeps the area as its drawing `area` and the template as `info.drawnFor`.
2. **Checking a layout against the venue:** the fit search and venue checks below.

rcvenue changes:
- **1.1** — `info.venue` gains `trackId` and `trackName`: the forum track the template is for. `version` stays `1`;
  1.0 files (`{id, name}` only) still load, and Track Studio asks for the track the next time one is edited. New
  templates linked to a forum venue must name the track.

## Fit search (reference: `fit.py`)
For a track and a venue template: try 8 orientations (as designed, mirrored, rotated 90/180/270, mirrored + rotated),
slide the footprint over the venue area on a 0.1 m grid, keep positions inside the area and clear of every obstacle
(lanes + pipe thickness), prefer the most central. Results are labelled by orientation so organisers can judge the
rostrum view.

**Venue checks** *(v1.7; `check` in `fit.py`, `venueCheck` in the engine)* test the layout where it is drawn (its
coordinates taken as the venue's) and report where the venue's rostrum stands, `{checks, rostrum: {side, x, z,
eyeHeight}}`. Check codes: `outside-area` (error: a lane edge leaves the venue's area) and `obstacle` (error: lanes +
pipe thickness overlap a fixed obstacle). These were in `built.checks` before 1.7; they belong to the fit, which has the
venue's area, obstacles and rostrum.

Choosing a result creates an adapted copy for that venue (new id, `info.derivedFrom` = original id, revision and
orientation), rotated or mirrored and moved to the chosen fit, and re-bakes it. Nothing of the venue is copied in but its
area (as the drawing area) and `info.drawnFor`: no obstacles, no rostrum. Features (crossovers included) are placed by distance along the racing line, so they move
with the track; mirroring and rotating keep the driving order, so each crossing keeps its over pass.

## Forum integration (plan)
- **Venue:** links to its venue template in Track Studio (which holds area, rostrum and obstacles).
- **Track library:** each design is a topic in a "Track Designs" category; the `.rctrack.json` is attached to the
  first post. The plugin renders the 2D preview (SVG from `built`, as in `preview_svg.py`) and a 3D viewer,
  with download and "open in sim" links. New revisions are new attachments; the topic shows history.
- **Status workflow:** draft → submitted → approved (for a venue) → archived.
- **Meetings:** an event gets a `track_design` link (topic + pinned revision). The event page shows the 2D/3D
  views and a "practise in the sim" download.

## Sim integration (plan)
Import a `.rctrack.json` (file or forum link) and build directly from `built`: area (or the drawing area, see `area`)
→ hall, dividers → pipes, features → ramps, startLine → timing line and grid. **Rostrum** *(v1.7)*: a layout has none.
A consumer that needs one (the sim) asks the player for the side, N/S/E/W, when loading the layout (standing 1.5 m
outside the middle of that side, eyes 2.8 m up). When the layout is loaded through an event or a venue, the side and
position default to that venue's rostrum, which the fit check reports with its results (`venueCheck(...).rostrum`, in
the venue's coordinates: for a copy adapted to the venue, these are the layout's own).

## Changes
- **1.9** — a new check, `lane-overlap` (error), where the lane of one part of the lap overlaps the lane of another
  (*Lane overlaps*): two straights closer than a lane width, or a corner clipping another pass. Crossings, shared pipes
  and the inside of a hairpin or sharp V are not overlaps. Until 1.9 lanes overlapping away from a crossing were not
  checked. `version` stays `1`: no field changes. Re-baking adds the error to tracks whose lanes overlap; every other
  track bakes exactly as in 1.8. Older readers that list the check codes they know must show an unknown error code as an
  error.
- **1.8** — three fixes to `built`, one release. (1) `feature-in-corner` checks a jump whose span runs across lap
  distance 0 (1.5–1.7 did this for crossovers only), so a jump just before the start that lands into point 0's corner
  is now reported. (2) A jump on or landing into a corner is a technical section racers enjoy: its
  `feature-in-corner` is `info`, not a `warning`, with the message "*Type* at *d* m is on or lands into a corner
  (technical section)". A crossover's stays a `warning`. (3) `startLine.heading` is the true tangent where the start
  sits on a racing-line sample, such as a corner join at `start.distance: 0`; it read the segment after the start, the
  arc one way round and the straight the other, up to ~1.5° apart. `version` stays `1`. Re-baking changes only
  tracks with a jump next to a corner (the level and message of its check; a jump across lap distance 0 may gain
  one) or a start on a corner join (its heading); everything else bakes exactly as in 1.7. Older readers that count
  warnings see fewer. Added in the same release (#91), as they only add a code and tidy messages: a start line on a
  crossover's ramp or on a bridging tabletop is a `warning`, `start-on-feature` ("Start line is on a ramp"); distances
  in check messages are on the lap, 0 up to `lapLength` (a feature at `distance` -1.5 was "at -1.5 m"). The reference
  preview draws no ring for `info` checks.
- **1.7** — a layout belongs to no venue: venue features move out of the layout. Removed: `obstacles`,
  `design.rostrum`, `basedOn` and `built.rostrum`; `built.checks` no longer has `outside-area` or `obstacle`, which are
  now venue checks, reported by the fit (*Fit search*) for the venue tested. `area` is optional, only the drawing area,
  and nothing checks against it. New: `info.drawnFor = {venueTemplate, name}`, a label. Adapting a layout to a venue
  copies no obstacles or rostrum. The sim asks for the rostrum side, or takes the venue's (*Sim integration*).
  `version` stays `1`. **Loading a 1.6 file:** drop `obstacles`, `design.rostrum` and `built.rostrum` and the venue
  checks; `basedOn` becomes `info.drawnFor` (named after the template; `upgrade` in `bake.py`, `upgradeTrack` in the
  engine). Re-baking gives the same racing line, dividers, footprint and size; only those fields change. Older readers
  that need `built.rostrum` or `area` must fall back (a rostrum south, the drawing area above).
- **1.6** — crossovers: a track may cross itself on a bridge. `design.features` gains `type: "crossover"` (`rampLength`,
  `topLength`, `height`, `over`); `built.crossings` lists every place the racing line crosses itself, with its lap
  distances, angle, over pass, bridging feature and footprint; a long enough tabletop on the crossing also counts as
  the bridge. A bridge needs 0.40 m clearance: a crossover (default height 0.40 m) or tabletop lower than that
  doesn't bridge. New checks `crossing-unbridged` (error), `crossing-too-low` (error: in place and long enough but
  under 0.40 m), `crossing-angle` (warning), `crossing-too-close` (error) and `crossover-unused` (warning: a crossover
  that bridges no crossing and isn't the reason for a crossing error).
  Divider loop cutting leaves crossings alone. `version` stays `1`. Tracks that don't cross themselves bake exactly as
  in 1.5 (`built.crossings` is absent), so 1.5 files load and re-bake unchanged; older readers ignore `crossings`,
  but a track with a crossover also has `type: "crossover"` in `built.features`, which readers with a fixed list of
  feature types must skip or draw as a generic ramp.
- **1.5** — corners share a straight by what each needs (see step 1 of the geometry engine), instead of each taking at
  most half of it: a sweeper next to a hairpin keeps its radius. `version` stays `1`; re-baking changes `built` only of
  tracks that had a squeezed corner (radius shrunk to fit: a `radius-reduced` check, if by more than 0.01 m). Those
  corners get more room, and a corner next to one asking for more than half the straight can now be cut in proportion.
  A track with no corner shrunk to fit bakes exactly as in 1.4.
- **1.4** — `outer: "auto"` (now the default when `outer` is missing: square up to 120°, round beyond). `built.lanes`:
  the lane-edge rings, for drawing the carpet. Re-baking changes `built` of tracks with corners sharper than 120° that
  had no explicit `outer` (they were square in 1.3).
- **1.3** — `design.points[].outer: "square" | "round"` (default `square`): square outer corners (mitre, bevel past
  120°). Inside corners tighter than the lane collapse cleanly to the apex. Shared dividers: nearest-point pairing,
  blended transitions, cut self-crossings, trimmed overlaps, no fragments under 0.25 m. Footprint includes square
  corners. `version` stays `1`; re-baking changes `built` of existing tracks (outer pipes, size/footprint near corners).
- **1.2** — `info.derivedFrom = {id, revision, orientation?, author?}` credits the track this one came from: a venue
  adaptation (`orientation`, see Fit search) or someone's copy (`author` = the original's author). `built.size` added (lane-edge size); `stats.corners` counts like a racer (same-direction turns joined by
  < 3 m are one corner; was: every corner point turning > 20°). `version` stays `1`: older readers ignore `size`, and
  files baked by 1.1 simply have no `size` and the old corner count until re-baked.
- **1.1** — footprint raster, obstacles, `obstacle` check, rostrum offset.
