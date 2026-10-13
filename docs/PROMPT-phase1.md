# Prompt for Claude Code — Phase 1 (engine port)

Read CLAUDE.md, docs/PLAN.md and docs/rctrack-SPEC.md first.

Set up the monorepo (pnpm workspaces, TypeScript strict, Vitest) with an empty `apps/` folder and implement
`packages/engine`:

1. `types.ts` — TypeScript types for rctrack v1.1 and rcvenue v1 matching `reference/rctrack.schema.json`.
2. `bake.ts` — port of `reference/bake.py`: racing line (filleted corner points), borders, shared-divider merging
   (same constants), divider runs + simplification, features, start line, rostrum (with offset), checks, stats,
   footprint raster + RLE, obstacle check. Pure functions, no DOM/Node. Use a simple spatial grid instead of scipy's
   KD-tree.
3. `fit.ts` — port of `reference/fit.py` (8 orientations, 0.1 m slide, obstacle clearance, centred preference)
   and `adapt()`.
4. `preview.ts` — port of `reference/preview_svg.py` returning an SVG string.
5. `validate.ts` — JSON Schema validation (ajv) for both formats.
6. Tests: for every file in `reference/examples/*.rctrack.json`, re-bake from `design` and compare with the stored
   `built` (racing line and divider points within 0.01 m after matching runs, lapLength within 0.01, same check codes,
   footprint bbox within one cell). For each example track x venue in `reference/venues`, the fit orientations must
   match the Python output (run `python3 reference/fit.py <track> <venue>` to see it; save the expected results as a
   JSON fixture).
7. A tiny CLI: `pnpm engine bake <file>` and `pnpm engine fit <track> <venue>` for manual checks.

Stop when tests pass. Summarise anything where the TS output differs from Python and why.
