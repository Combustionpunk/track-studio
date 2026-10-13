# @track-studio/web

React app (Vite): library with filters and "fits venue", track page (pan/zoom plan with layers and hover details,
checks, revisions, download, copy link / forum embed, Edit / Make my own copy, Submit/Approve/Archive, fit to a venue),
venues (read-only), the compact `/embed/:id` viewer for forum posts, and the **designer** (`/new`, `/t/:id/edit`).

## Designer (`src/designer/`)
- `geometry.ts` — live racing line and placements on the main thread, pointer projection, snapping, starter loop.
  Tuning constants are at the top: `GRID` 0.25 m, `LINE_SNAP` 0.35 m (+ `ANGLE_TOLERANCE` 15°), `CORNER_SNAP` 0.5 m,
  `MIN_POINT_GAP` 0.3 m. `Designer.tsx` has the wheel ones: one notch = ~10% radius (min 5 cm) / 10 cm lane width,
  `GRAB_PX` 14 (a press on the track this close to a point grabs it instead of adding one).
- `bake.worker.ts` + `useBake.ts` — the full engine bake (pipes, checks, stats) in a Web Worker, latest-wins.
- `history.ts` — undo/redo snapshots; a drag is one step, wheel/typing bursts merge.
- Auto-save goes to localStorage per track (`designer:<id>` / `designer:new:…`) and is offered back on return.

It always runs behind the server (`pnpm dev` from the repo root serves it through Vite middleware on the server's
port), so pages, API and login share one origin. Plans are drawn from `built` only — see `src/lib/plan.ts`
(SVG units are metres, y = −z so north is up).

`pnpm --filter @track-studio/web build` → `dist/`, served by the server in production. Tests: `src/lib` helpers
(view maths, fit preview transform, formatting).
