# @track-studio/web

React app (Vite): library with filters and "fits venue", track page (pan/zoom plan with layers and hover details,
checks, revisions, download, copy link / forum embed, Edit / Make my own copy, Submit/Approve/Archive, fit to a venue),
venues (read-only), the compact `/embed/:id` viewer for forum posts, and the **designer** (`/new`, `/t/:id/edit`).

## Theme, fonts, logo
- **Colours come from tokens only.** `src/theme/tokens.css` holds the forum-synced tokens (`--bg`, `--text`,
  `--accent`, `--header-bg`, …; defaults = the forum's Grey Amber, overridden by the server's `<style id="theme">`),
  the few fixed ones the forum has no colour for (`--warning`, `--info`) and the font tokens. The plan drawing's fixed
  palette is `src/theme/plan-palette.css` + `src/lib/plan.ts`. `test/tokens.test.ts` fails on a literal colour
  anywhere else, and on a `var(--x)` that isn't defined.
- **Fonts:** Inter (`--font-body`) and Oswald (`--font-heading`: headings and figures such as lap length and corner
  count), variable woff2 in `src/theme/fonts/` (SIL OFL), bundled by Vite, with system fallbacks.
- **Logo:** `src/brand/logo.svg` is the one file (placeholder: loop mark + RC MISFITS wordmark as paths). The header
  shows it whole; `brand.ts` makes `/favicon.svg` from its `<view id="mark">`. Replace the file (keep that view) and
  rebuild.

## Designer (`src/designer/`)
- `geometry.ts` — live racing line and placements on the main thread, pointer projection, snapping, starter loop.
  Tuning constants are at the top: `GRID` 0.25 m, `LINE_SNAP` 0.35 m (+ `ANGLE_TOLERANCE` 15°), `CORNER_SNAP` 0.5 m,
  `MIN_POINT_GAP` 0.3 m. `Designer.tsx` has the wheel ones: one notch = ~10% radius (min 5 cm) / 10 cm lane width,
  `GRAB_PX` 14 (a press on the track this close to a point grabs it instead of adding one).
- `snap.ts` — snapping in lanes and pipes (pure, tested in `test/snap.test.ts`):
  - **Lanes** (default): centre points on the lane grid — lane centres measured from both walls (−L/2 + w/2 + k·w and
    +L/2 − w/2 − k·w), w = the point's lane width — and 0°/45°/90° from a neighbour. **Fine** (Shift): 0.25 m + 45°.
    **Free** (Alt): none. Inserting a point on a straight uses the same mode.
  - **Beside lane** (wins over the grid): a straight within `BESIDE_ANGLE` 7° of parallel to another, centre lines
    within `BESIDE_RANGE` 1.5 × average width, overlapping → exactly (w1 + w2)/2 apart (one shared pipe), any angle.
  - **Outside-corner handles** (diamonds, square / auto ≤ 120° corners): drag the pipes' corner; snaps within
    `MITRE_PULL` 0.3 m to the hall's corners and walls, other pipes' corners and lane edges. Corners whose pipes sit in a
    hall corner stay pinned there while neighbours move (by up to `PIN_FOLLOW` 0.5 m).
  - Neighbour lines pull within `LINE_PULL` 0.35 m; the sharp-turn badge shows past `SHARP_TURN` 150°; H = hairpin.
- `bake.worker.ts` + `useBake.ts` — the full engine bake (pipes, checks, stats) in a Web Worker, latest-wins.
- `history.ts` — undo/redo snapshots; a drag is one step, wheel/typing bursts merge.
- Auto-save goes to localStorage per track (`designer:<id>` / `designer:new:…`) and is offered back on return.

It always runs behind the server (`pnpm dev` from the repo root serves it through Vite middleware on the server's
port), so pages, API and login share one origin. Plans are drawn from `built` only — see `src/lib/plan.ts`
(SVG units are metres, y = −z so north is up).

`pnpm --filter @track-studio/web build` → `dist/`, served by the server in production. Tests: `src/lib` helpers
(view maths, fit preview transform, formatting).
