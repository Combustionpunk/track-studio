# rctrack — shared track format (v1.1)

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
| `info` | name, author (forum username), dates, description, venue `{id, name}`, status `draft / submitted / approved / archived`, surface, classes, tags |
| `area` | `{length, width}` usable track area in metres — from the venue template (or set by the designer for a blank design) |
| `basedOn` | `{venueTemplate, revision}` if the design started from a venue template, else `null` |
| `obstacles` | fixed items inside the area, copied from the venue template: `{type: "circle", x, z, radius, label}` or `{type: "rect", x, z, length, width, rotation?, label}` |
| `design` | editable inputs, below |
| `built` | derived geometry, below |

## design
- `laneWidth` — default lane width (m).
- `points[]` — corner points in driving order, closed loop: `{x, z, radius, width}`.
  Straights run point-to-point at any angle (diagonals); each corner is a circular arc of `radius` (small = hairpin,
  large = sweeper), automatically reduced if it can't fit the straights either side. `width` blends linearly between points.
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
- `stats` — `{dividerLength, dividerRuns, corners}` (feeds the build sheet)
- `footprint` — raster of the area the lanes and pipes cover, for fit searches: `{cell, origin, rows, cols, bbox, rle}`
  (`rle` = row-major run lengths, starting with an empty run). New check code: `obstacle`.

## Geometry engine (reference: `bake.py`)
1. **Racing line:** closed polyline through `points`, each corner filleted with its radius (radius shrinks to fit).
2. **Borders:** offset the line by ±width/2.
3. **Shared dividers:** border points from parts of the track ≥ 3 m apart along the line, running roughly parallel
   (|cos| ≥ 0.9) and closer than 0.6 m are pulled to their midpoint (fully below 0.2 m, blended between) — the two
   borders become one pipe, generated once.
4. **Dividers:** remaining border runs, simplified (0.02 m tolerance).
5. **Features / start / rostrum:** placed by distance along the racing line.
6. **Checks:** area, corner radius (min 0.6 m), lane width (min 1.4 m), features on or landing into corners.

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
