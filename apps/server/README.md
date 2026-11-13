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
Production (tracks.rcmisfits.org: `docker-compose.prod.yml` with Caddy, nightly backups to Spaces with
`dist/backup.js`, restore with `dist/restore.js`): see [docs/deploy.md](../../docs/deploy.md).

## Environment (.env at the repo root)
| Name | |
|---|---|
| `BASE_URL` | public URL of this server, as browsers reach it (used for the login callback and og:image) |
| `FORUM_URL` | the Discourse forum (dev `http://discourse-dev.local:3000`, prod `https://forum.rcmisfits.org`) |
| `DISCOURSE_CONNECT_SECRET` | same value as the forum's provider secret for this host (optional only with `DEV_LOGIN=1`) |
| `SESSION_SECRET` | ≥ 32 chars, signs the session cookie (`openssl rand -hex 32`); changing it logs everyone out |
| `SILENT_SIGNIN` | optional; `off` turns off the silent forum sign-in (#132, below). On by default |
| `DATA_DIR` | SQLite file + `previews/` cache; relative paths are from the repo root |
| `PORT` (3000), `HOST` (0.0.0.0), `ORGANISER_GROUP` (track-admins), `LOG_LEVEL` (info) | optional |
| `SPACES_ENDPOINT`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET` (`SPACES_REGION`, `BACKUP_PREFIX`, `BACKUP_KEEP`) | backups only (docs/deploy.md) |
| `DEV_LOGIN=1` | enables `/auth/dev-login?user=<name>&organiser=1`; refused when `NODE_ENV=production` |

## Forum login (DiscourseConnect provider)
On the forum, Admin → Settings:
- `enable discourse connect provider` = on
- `discourse connect provider secrets`: add `<host of BASE_URL>|<DISCOURSE_CONNECT_SECRET>`, e.g. `192.168.0.6|…`
- create the group `track-admins` (or whatever `ORGANISER_GROUP` says) and add the organisers; forum admins are
  organisers anyway.

**Silent sign-in (#132).** Being signed into the forum means being signed in here, with no click. When a browser
opens a page (a top-level navigation: `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`) with no
`ts_sso_checked` cookie, the server answers with a 302 to the forum's DiscourseConnect with `prompt=none` and sets
`ts_sso_checked` for 30 minutes. Signed into the forum: the forum sends the signed payload back and the visitor lands
on the page they asked for, signed in. Not signed in: the forum answers `failed=true` and they carry on as a visitor,
with no error. A server-side redirect rather than a hidden iframe: one round trip before the page, and the forum
doesn't allow framing its login pages nor send its cookies to a third-party frame. Never redirected: dev-login users,
bots and link-preview fetchers (by user agent), `HEAD`, API calls, `/embed/*`, iframes, prefetches, pages that 404,
scripts without the `Sec-Fetch-*` headers, dev-login-only servers, and everything when `SILENT_SIGNIN=off`. The
forum's DiscourseConnect provider must support `prompt=none` and list our host in `discourse connect provider secrets`.

*While the forum is down*, nobody is sent there: before the redirect (and before a sign-out goes to the forum) the
server asks the forum's status page, `FORUM_URL/srv/status`, with a 2 s timeout, and believes the answer, up or down,
for 60 s. Unreachable: the page is served as it is, with no check cookie, so the next visit after the minute tries
again; a signed-in member keeps their session. The same probe and timings as the timing site (club-timing #111). The
probe can't tell a forum that is up but refuses the request (host missing from its provider secrets, a Discourse
without `prompt=none`): that still shows the forum's error page, and `SILENT_SIGNIN=off` is the switch for it.

*The forum's answer only counts in the browser that asked.* Each login or check puts its nonce in the `ts_sso`
cookie (`Path=/auth`, 10 minutes, the newest four, so tabs opened at once don't undo each other). A callback URL
carried to another browser is refused there: it signs nobody in, and a captured `failed=true` doesn't sign a member out.

*A silent check that goes wrong* (bad signature, stale nonce, another browser) is logged and lands back on the page as
a visitor; an ordinary Log in keeps its error. *A browser that keeps no cookies* comes back from its one check with
`?nosignin=1` on the address (the web app takes it off), and isn't sent round again for that page.

**One sign-out.** `POST /auth/logout` ends the session, sets `ts_sso_checked`, and returns `redirect`: a signed
DiscourseConnect `logout=true` URL. The web app's Log out sends the browser there; the forum signs it out and
returns it to our home page, so the forum and the other sites that use it are signed out too. While the forum is
down (same probe), `redirect` is `null` and the sign-out stays here: the forum keeps its session, so once the forum is
back a silent check (after `ts_sso_checked` lapses) can sign the member in here again. Signed-in members are
checked the same way once `ts_sso_checked` lapses (a successful login sets it), so signing out of the forum signs
them out here at their first page load once it lapses: up to 30 minutes later. That delay is accepted: our session
gives no access to the forum, and it saves a forum round trip on every page.

Login only goes through the browser (redirects), so the browser must resolve `FORUM_URL` and `BASE_URL`. The server
itself reads public URLs from the forum: `FORUM_URL/site.json`, for the colour scheme (below), `FORUM_URL/des/venues`,
the venue list the venue editor picks from, and `FORUM_URL/srv/status` before a silent sign-in (so the server must
resolve `FORUM_URL` too; where it can't, silent sign-in is simply off).

## Theme (colours from the forum)
At start and then hourly the server reads the forum's public `site.json` and maps its default colour scheme to the
web app's design tokens (`src/theme.ts`): `primary` → `text`, `secondary` → `bg`, `tertiary` → `accent`,
`header_background`/`header_primary` → `headerBg`/`headerText`, plus `highlight`, `success`, `danger`, `hover`,
`selected`. `surface`, `surface2`, `border` and `muted` are blends of primary over secondary (like Discourse's
`primary-low` etc.); `link`, `muted`, `dangerText` and `successText` are nudged lighter/darker until they meet WCAG AA.
If the forum has a separate dark scheme, dark is the default and its light scheme applies when the device prefers
light; with one scheme (today: Grey Amber, dark) that one is always used.

Every page gets the current theme as CSS variables in `<style id="theme">`, so there's no flash of the wrong colours.
The last good scheme is kept in `DATA_DIR/theme-cache.json`; if the forum can't be reached (or answers with something
unusable) the cached scheme stays, or the built-in **Grey Amber** if there's never been one. A failing forum is logged
once, and again only after it has recovered. Organisers can refresh at once from the header (↻, "Refresh theme now").
The plan drawing keeps its own fixed palette. The web app's defaults (`apps/web/src/theme/tokens.css`) are the derived
Grey Amber; a test keeps them in step with `theme.ts`.

Forum embeds (`/embed/:id`, "Copy forum embed" on a track page): add `<BASE_URL>/embed/` to the forum's
`allowed iframes` setting. Track Studio only lets the forum's origin (`FORUM_URL`) frame those pages; every other page
refuses to be framed. Link previews (onebox) read the Open Graph tags of `/t/:id`; a forum on the internet can't fetch
a LAN `BASE_URL`, and Discourse blocks private addresses unless they're in `allowed internal hosts`.

## Lap times (#76)

The forum computes lap times from published race results and serves them per layout at
`FORUM_URL/des/layouts/:id/stats.json`: for each class, the typical lap (median of the cleaned laps, 10% trimmed mean,
IQR, laps and meetings) and two track records (fastest lap, best 3 consecutive laps), each with driver, car and meeting.
`GET /api/tracks/:id` passes them on as `lapStats` (camelCase; `null` while the forum is down and nothing is cached).
Answers are cached 10 minutes, the forum gets 5 s to answer, and the last good copy is kept while it's down.

Layouts not raced in a class get an **estimate**: lap length ÷ the class's speed, labelled "est.". The speeds live in
the `class_speeds` table, seeded with 2WD Buggy 6.5 m/s, 4WD Buggy 7.0, Stadium Truck 6.0 and Short Course 5.5 (the
first is the one the designer shows). Organisers (`ORGANISER_GROUP`, forum admins) edit them on the web app's
**Lap speeds** page (`/lap-speeds`, linked in the header) or with `PUT /api/class-speeds`; everyone can read them.
Class names match the forum's ignoring case and spacing.

## Public vs latest revision
A track's **public** revision is its approved one if it has one, else its latest. The library, links, link previews,
embeds and fit searches show the public revision; editing an approved track adds a newer draft that only becomes
public when it's approved. Each revision row stores its own summary (name, lap, corners, size, errors, preview hash).

## API
Errors are always `{error, message, details?}`. Reads are public; writes need the session cookie, and cross-origin
writes (an `Origin` header other than `BASE_URL`) are refused.

| | |
|---|---|
| `GET /auth/login?return=/path` → forum → `GET /auth/callback` | login (and the silent `prompt=none` check on the first page visit); `POST /auth/logout` (returns the forum's logout URL as `redirect`); `GET /api/me` (user or `null`) |
| `GET /api/tracks?status=&venue=&minLap=&maxLap=&minCorners=&maxCorners=&q=&author=` | list (archived hidden unless `status=archived`) |
| `GET /api/tracks?fits=<venueId>` | approved tracks (their pinned revision) that fit, each with `fit.results` |
| `GET /api/tracks?lapClass=<class>[&minTypical=&maxTypical=&sort=typical]` | each track gets `typicalLap: {seconds, est}` (or `null`) for the class: the forum's median lap, else the estimate lap length ÷ class speed (`est: true`, also while the forum is down). `minTypical`/`maxTypical` (s) filter, `sort=typical` puts the fastest first and unknowns last; both need `lapClass` (400 otherwise) |
| `GET /api/tracks?author=me` | only your tracks; combines with every filter above, including `fits`. Signed out → 401; any value but `me` → 400 |
| `POST /api/tracks` `{track, fromVenue?, note?}` (or a bare rctrack doc) | new draft; server sets id/revision/author/dates/status, re-bakes |
| `PUT /api/tracks/:id` `{track, note?, baseRevision?}` | new revision (author or organiser), always a draft; `baseRevision` ≠ latest → 409 `stale`. Venue-based tracks keep the template's area/obstacles/rostrum |
| `POST /api/tracks/:id/copy` `{revision?}` | "Make my own copy": a new draft for you, `info.derivedFrom` credits the original |
| `POST /api/tracks/:id/submit` · `/approve` · `/archive` | author · organiser (pins the latest revision) · organiser. Submit/approve → 409 `has-errors` while the latest revision has error-level checks |
| `GET /api/tracks/:id` · `/revisions` · `/r/:rev.rctrack.json` | summary + the **public** revision's doc + `can` (what you may do) + `usedAt` (#66) + `lapStats` (see Lap times) · history · download (`/r/:rev` = plain JSON, e.g. the latest for the designer) |
| `GET /api/tracks/:id/fit/:venueId[?r=]` · `POST /api/tracks/:id/adapt/:venueId` `{orientation?, revision?}` | fit search (cached per revision pair; each result has a `thumbUrl`) · adapted draft copy |
| `GET /api/venues` · `/api/venues/:id` | venue templates; each summary has `tracks` (tracks drawn on it, archived not counted); `/:id` adds `can: {edit}` |
| `GET /api/venues?forumTrack=<id>` | the template for that forum track, as `/:id` answers (404 if none). Open to any origin: the forum plugin's layout picker uses it |
| `POST /api/venues` `{venue}` · `PUT /api/venues/:id` `{venue, baseRevision?}` | organisers only; every save is a new revision (`baseRevision` ≠ latest → 409 `stale`). Id `new` is reserved. One template per forum track (`info.venue.trackId`): a second → 409 `forum-track-taken` with `details.venue {id, name, url}`; a new template linked to a forum venue must name the track, and a new or changed link's track must be one of that venue's tracks on the forum (400 `invalid-venue`; not checked while the forum is down) |
| `GET /api/class-speeds` · `PUT /api/class-speeds` `{classes: [{class, speed}]}` | the lap time estimate's speed per class, in order (see Lap times) · organisers replace the whole list: 1–40 character names, unique ignoring case, 0.5–30 m/s, at most 30 |
| `GET /api/forum-venues?q=` | the forum's venues (`FORUM_URL/des/venues`): `{venues: [{id, name, town, tracks}], fetchedAt, stale}` (`town` comes from the address: the forum's list has none). Cached 10 min; forum down → the last copy with `stale: true`, or 503 `forum-unavailable`. `q` matches venue, town or track name |
| `GET /api/venues/:id/revisions` · `GET /api/venues/:id/r/:rev[.rcvenue.json]` | revision history, newest first · one revision (`.rcvenue.json` = download) |
| `GET /p/:id/:rev.png?v=<hash>` | 1200 px preview; `v` = hash of the drawing, so the exact URL is cached for a year and a changed drawing gets a new URL (no/old `v`: same image, 5 min cache) |
| `GET /p/:id/:rev/fit/:venueId/:k.png?v=` | the track placed in the venue as fit orientation `k` (index in the engine's `ORIENTS`) — "fits venue" thumbnails |
| `GET /`, `/t/:id`, `/t/:id/edit`, `/new`, `/new/design`, `/embed/:id[?r=]`, `/v`, `/v/:id`, `/lap-speeds` | web app pages; `/t` and `/embed` carry Open Graph tags (public revision); `/embed` may be framed by the forum |
| `GET /api/config` | what the web app needs (dev login on?, forum URL) |
| `GET /api/theme.json` | public, CORS `*`: `{source, syncedAt, scheme:{name,dark}, colors, light, fonts:{body,headings}}` — `source` is `forum`, `cache` or `fallback`; `syncedAt` is the last successful fetch (ISO, `null` if never); `colors` are hex tokens (see Theme); `light` is `{name, colors}` or `null` |
| `POST /api/theme/refresh` | organisers: fetch the forum's scheme now → `{ok, error?, theme, css}`; on failure `ok: false` and the theme is unchanged |

Input limits (to keep the engine's work bounded): area ≤ 100 × 100 m, ≤ 300 points within ±100 m, lap ≤ 1500 m,
≤ 100 features, lane width ≤ 10 m, radius ≤ 50 m, body ≤ 2 MB.
