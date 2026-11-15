# @track-studio/web

React app (Vite): library with filters and "fits venue", track page (pan/zoom plan with layers and hover details,
checks, revisions, download, copy link / forum embed, Edit / Make my own copy, Submit/Approve/Archive, fit to a venue),
venues (read-only), the compact `/embed/:id` viewer for forum posts, and the **designer** (`/new`, `/t/:id/edit`).

## Theme, fonts, logo
- **The brand package.** Colours, fonts and the header logo come from `@rcmisfits/brand` (pinned to a tag in
  `package.json`; its README is "Consuming it"). `src/theme/tokens.css` imports its `fonts.css` and `tokens.css` and
  maps the app's own names (`--bg`, `--text`, `--accent`, `--header-bg`, …) to its `--rm-*` variables, in one place.
  `test/tokens.test.ts` fails on a literal colour anywhere else, and on a `var(--x)` that isn't defined.
- **The member's theme** (`src/lib/theme.tsx`): `data-theme` on `<html>` is the signed-in member's theme (`me.theme`,
  once the forum sends it), else the club's (none yet), else none: the brand's CSS then gives Pit Lane, or Pit Lane
  light when the device asks for light. Unknown ids are ignored.
- **The plan and the 3D view** are drawn with colours, not CSS, so `planPalette()` makes their palette from the theme's
  colours (the engine's `planLayers` takes it as `palette`); `ThemeProvider` also writes it to the `--plan-*`
  variables for the overlays. `test/theme.test.ts` checks it reads (3:1 for pipes, racing line and problems) in every
  theme. The build sheet keeps the fixed print palette; server pictures (PNG previews, cards) keep `PLAN_PALETTE`.
- **Fonts:** Inter (`--font-body`) and Oswald (`--font-heading`), the brand package's self-hosted woff2, bundled by
  Vite.
- **Logo:** the header shows the brand package's logo as it is. `src/brand/logo.svg` (placeholder) is still the
  favicon (`brand.ts` crops it to its `<view id="mark">`) and the link-preview card's logo.

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
