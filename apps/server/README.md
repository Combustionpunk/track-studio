# @track-studio/server

Fastify + SQLite API, DiscourseConnect login, PNG previews, and the web app's pages (with Open Graph tags filled in
server-side). Uses `@track-studio/engine` for validation, baking, fit search and the SVG preview.

## Run
```
cp .env.example .env        # repo root; fill in the secrets (see below)
pnpm install
pnpm seed                   # reference venues + example tracks (approved, by "system"); safe to re-run
pnpm dev                    # server + web app on one port (Vite middleware, hot reload); server reloads on changes
pnpm test                   # engine + server + web tests
pnpm build && pnpm start    # production build: web app (apps/web/dist) + bundled server
pnpm rebake [--dry-run]     # after an engine update: refresh every stored revision's `built` in place
```
How the web app is served (logged at startup): `pnpm dev` sets `WEB_DEV=1` → Vite middleware; otherwise the built
`apps/web/dist` if it exists; otherwise plain fallback pages (API and previews still work).

`rebake` keeps each revision's number and design (approvals stay pinned) and only replaces derived data. If a
revision's drawn preview changes, its cached PNG is deleted and re-rendered on the next request (the URL stays the
same, so clients that cached it may show the old image for a while).
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

Forum embeds (`/embed/:id`, "Copy forum embed" on a track page): add `<BASE_URL>/embed/` to the forum's
`allowed iframes` setting. Track Studio only lets the forum's origin (`FORUM_URL`) frame those pages; every other page
refuses to be framed. Link previews (onebox) read the Open Graph tags of `/t/:id`; a forum on the internet can't fetch
a LAN `BASE_URL`, and Discourse blocks private addresses unless they're in `allowed internal hosts`.

## Public vs latest revision
A track's **public** revision is its approved one if it has one, else its latest. The library, links, link previews,
embeds and fit searches show the public revision; editing an approved track adds a newer draft that only becomes
public when it's approved. Each revision row stores its own summary (name, lap, corners, size, errors, preview hash).

## API
Errors are always `{error, message, details?}`. Reads are public; writes need the session cookie, and cross-origin
writes (an `Origin` header other than `BASE_URL`) are refused.

| | |
|---|---|
| `GET /auth/login?return=/path` → forum → `GET /auth/callback` | login; `POST /auth/logout`; `GET /api/me` (user or `null`) |
| `GET /api/tracks?status=&venue=&minLap=&maxLap=&minCorners=&maxCorners=&q=` | list (archived hidden unless `status=archived`) |
| `GET /api/tracks?fits=<venueId>` | approved tracks (their pinned revision) that fit, each with `fit.results` |
| `POST /api/tracks` `{track, fromVenue?, note?}` (or a bare rctrack doc) | new draft; server sets id/revision/author/dates/status, re-bakes |
| `PUT /api/tracks/:id` `{track, note?, baseRevision?}` | new revision (author or organiser), always a draft; `baseRevision` ≠ latest → 409 `stale`. Venue-based tracks keep the template's area/obstacles/rostrum |
| `POST /api/tracks/:id/copy` `{revision?}` | "Make my own copy": a new draft for you, `info.derivedFrom` credits the original |
| `POST /api/tracks/:id/submit` · `/approve` · `/archive` | author · organiser (pins the latest revision) · organiser. Submit/approve → 409 `has-errors` while the latest revision has error-level checks |
| `GET /api/tracks/:id` · `/revisions` · `/r/:rev.rctrack.json` | summary + the **public** revision's doc + `can` (what you may do) · history · download (`/r/:rev` = plain JSON, e.g. the latest for the designer) |
| `GET /api/tracks/:id/fit/:venueId[?r=]` · `POST /api/tracks/:id/adapt/:venueId` `{orientation?, revision?}` | fit search (cached per revision pair; each result has a `thumbUrl`) · adapted draft copy |
| `GET /api/venues` · `/api/venues/:id` · `POST /api/venues` · `PUT /api/venues/:id` | venue templates (writes: organisers) |
| `GET /p/:id/:rev.png?v=<hash>` | 1200 px preview; `v` = hash of the drawing, so the exact URL is cached for a year and a changed drawing gets a new URL (no/old `v`: same image, 5 min cache) |
| `GET /p/:id/:rev/fit/:venueId/:k.png?v=` | the track placed in the venue as fit orientation `k` (index in the engine's `ORIENTS`) — "fits venue" thumbnails |
| `GET /`, `/t/:id`, `/t/:id/edit`, `/new`, `/new/design`, `/embed/:id[?r=]`, `/v`, `/v/:id` | web app pages; `/t` and `/embed` carry Open Graph tags (public revision); `/embed` may be framed by the forum |
| `GET /api/config` | what the web app needs (dev login on?, forum URL) |

Input limits (to keep the engine's work bounded): area ≤ 100 × 100 m, ≤ 300 points within ±100 m, lap ≤ 1500 m,
≤ 100 features, lane width ≤ 10 m, radius ≤ 50 m, body ≤ 2 MB.
