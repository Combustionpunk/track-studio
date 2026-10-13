# @track-studio/engine

Pure TypeScript port of the rctrack reference engine (`reference/bake.py`, `fit.py`, `preview_svg.py`). No DOM or
Node APIs — runs in the browser (designer) and on the server.

```ts
import { bake, fits, adapt, previewSvg, validateTrack, validateVenue } from "@track-studio/engine";
```

- `bake(doc)` / `bakeBuilt(doc)` — design -> built (racing line, dividers, features, start, rostrum, checks, footprint,
  size); format v1.2. `countCorners()` is the racer's corner count (same-direction turns joined by < 3 m are one corner)
- `fits(track, venue)` / `adapt(track, venue, fit)` — venue fit search (8 orientations, 0.1 m grid) and adapted copy
- `previewSvg(doc)` — 2D plan drawn from `built` only
- `validateTrack` / `validateVenue` — JSON Schema (draft 2020-12). `src/schemas/rctrack.schema.json` is a copy of
  `reference/rctrack.schema.json` (a test keeps them identical); `rcvenue.schema.json` is written from the spec.
- `compareBuilt(a, b)` — geometric diff of two `built` sections

## Tests
`pnpm test` re-bakes every `reference/examples/*.rctrack.json` plus `test/fixtures/extra/*` (extra designs baked by
the Python reference to cover every check code, closed dividers and rotated obstacles), and runs the fit search for
every track x venue against `test/fixtures/fit-expected.json`. Regenerate the Python-side fixtures with
`python3 packages/engine/scripts/gen_fixtures.py` (needs numpy + scipy).

## CLI (from the repo root, paths relative to where you are)
```
pnpm engine bake <track> [out]          # re-bake; diffs against the stored built
pnpm engine fit <track> <venue> [out]   # fit search; [out] = adapted copy for the first result
pnpm engine preview <track> [out.svg]
pnpm engine validate <file>...
```
