# @track-studio/web

React app (Vite) for browsing tracks: library with filters and "fits venue", track page (pan/zoom plan with layers
and hover details, checks, revisions, download, copy link / forum embed, Submit/Approve/Archive, fit to a venue and
make a copy), venues (read-only) and the compact `/embed/:id` viewer for forum posts.

It always runs behind the server (`pnpm dev` from the repo root serves it through Vite middleware on the server's
port), so pages, API and login share one origin. Plans are drawn from `built` only — see `src/lib/plan.ts`
(SVG units are metres, y = −z so north is up).

`pnpm --filter @track-studio/web build` → `dist/`, served by the server in production. Tests: `src/lib` helpers
(view maths, fit preview transform, formatting).
