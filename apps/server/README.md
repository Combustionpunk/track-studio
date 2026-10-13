# @track-studio/server

Fastify + SQLite API, DiscourseConnect login, PNG previews and Open Graph pages. Uses `@track-studio/engine` for
validation, baking, fit search and the SVG preview.

## Run
```
cp .env.example .env        # repo root; fill in the secrets (see below)
pnpm install
pnpm seed                   # reference venues + example tracks (approved, by "system"); safe to re-run
pnpm dev                    # tsx watch, reloads on changes (engine included)
pnpm test                   # engine + server tests
```
Production build: `pnpm --filter @track-studio/server build` -> `apps/server/dist/{main,seed}.js` (the engine is
bundled in; native and runtime-file packages stay in node_modules). Docker: `docker compose up --build`, seed with
`docker compose run --rm track-studio node dist/seed.js`.

## Environment (.env at the repo root)
| Name | |
|---|---|
| `BASE_URL` | public URL of this server, as browsers reach it (used for the login callback and og:image) |
| `FORUM_URL` | the Discourse forum (dev `http://discourse-dev.local:3000`, prod `https://forum.rcmisfits.org`) |
| `DISCOURSE_CONNECT_SECRET` | same value as the forum's provider secret for this host (optional only with `DEV_LOGIN=1`) |
| `SESSION_SECRET` | ≥ 32 chars, signs the session cookie (`openssl rand -hex 32`); changing it logs everyone out |
| `DATA_DIR` | SQLite file + `previews/` cache; relative paths are from the repo root |
| `PORT` (3000), `HOST` (0.0.0.0), `ORGANISER_GROUP` (track-admins), `LOG_LEVEL` (info) | optional |
| `DEV_LOGIN=1` | enables `/auth/dev-login?user=<name>&organiser=1`; refused when `NODE_ENV=production` |

## Forum login (DiscourseConnect provider)
On the forum, Admin → Settings:
- `enable discourse connect provider` = on
- `discourse connect provider secrets`: add `<host of BASE_URL>|<DISCOURSE_CONNECT_SECRET>`, e.g. `192.168.0.6|…`
- create the group `track-admins` (or whatever `ORGANISER_GROUP` says) and add the organisers; forum admins are
  organisers anyway.

The forum is only ever reached by the browser (redirects), never by the server, so the browser must resolve
`FORUM_URL` and `BASE_URL`.

## API
Errors are always `{error, message, details?}`. Reads are public; writes need the session cookie, and cross-origin
writes (an `Origin` header other than `BASE_URL`) are refused.

| | |
|---|---|
| `GET /auth/login?return=/path` → forum → `GET /auth/callback` | login; `POST /auth/logout`; `GET /api/me` (user or `null`) |
| `GET /api/tracks?status=&venue=&minLap=&maxLap=&q=` | list (archived hidden unless `status=archived`) |
| `GET /api/tracks?fits=<venueId>` | approved tracks (their pinned revision) that fit, each with `fit.results` |
| `POST /api/tracks` `{track, fromVenue?, note?}` (or a bare rctrack doc) | new draft; server sets id/revision/author/dates/status, re-bakes |
| `PUT /api/tracks/:id` `{track, note?}` | new revision (author or organiser); a changed track goes back to `draft` |
| `POST /api/tracks/:id/submit` · `/approve` · `/archive` | author · organiser (pins the current revision) · organiser |
| `GET /api/tracks/:id` · `/revisions` · `/r/:rev.rctrack.json` | current doc · history · download |
| `GET /api/tracks/:id/fit/:venueId` · `POST /api/tracks/:id/adapt/:venueId` `{orientation?}` | fit search (cached per revision pair) · adapted draft copy |
| `GET /api/venues` · `/api/venues/:id` · `POST /api/venues` · `PUT /api/venues/:id` | venue templates (writes: organisers) |
| `GET /p/:id/:rev.png` · `GET /t/:id` | 1200 px preview (cached in DATA_DIR, immutable) · page with Open Graph tags |

Input limits (to keep the engine's work bounded): area ≤ 100 × 100 m, ≤ 300 points within ±100 m, lap ≤ 1500 m,
≤ 100 features, lane width ≤ 10 m, radius ≤ 50 m, body ≤ 2 MB.
