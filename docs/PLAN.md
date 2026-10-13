# Track Studio — plan

## Users
- **Designers** (any forum member): draw tracks from a venue template or from blank, save revisions, submit them.
- **Organisers / venue admins** (forum group `track-admins`): create venue templates, approve tracks, find layouts that
  fit their venue, link a track to a meeting.
- **Everyone**: browse the library, view 2D/3D, download for the sim. Forum readers see previews inline.

## Architecture
```
packages/engine   pure TS: bake (design -> built), fit search, SVG preview, validation (JSON Schema)
apps/server       Fastify API + SQLite + DiscourseConnect login + PNG previews + link-preview (Open Graph) pages
apps/web          React + three.js: library, viewer (2D/3D), designer, venue template editor, embed page
```
One Docker image serves API + built web app. Dev: Suntree (LXC). Production: DigitalOcean droplet (same region as the
forum), Caddy for HTTPS, `tracks.rcmisfits.org`, nightly SQLite backup to DigitalOcean Spaces.

## Login
Forum is the identity provider (DiscourseConnect provider). `/auth/login` -> forum -> `/auth/callback` (verify HMAC,
read user id, username, avatar, groups) -> signed session cookie. Roles from forum groups: `track-admins` = organiser.

## Data
- `users` (forum_id, username, avatar_url, groups, last_seen)
- `venues` (id, forum_venue_id, name, owner_forum_id, current_revision, created/updated)
- `venue_revisions` (venue_id, revision, rcvenue_json, created_at, created_by)
- `tracks` (id uuid, name, author_forum_id, status, venue_template_id, derived_from_id, current_revision, lap_length,
  corners, area_length, area_width, footprint_w, footprint_h, created/updated)
- `track_revisions` (track_id, revision, rctrack_json, png_path, created_at, created_by, note)
- Status: `draft` -> `submitted` -> `approved` -> `archived`. Approvals pin a revision.

## API (JSON)
- `GET /api/tracks?status=&venue=&fits=<venueId>&minLap=&maxLap=&q=` — list (fits= runs the fit search)
- `GET /api/tracks/:id` · `GET /api/tracks/:id/revisions` · `GET /api/tracks/:id/r/:rev.rctrack.json` (download)
- `POST /api/tracks` (new, from template or blank) · `PUT /api/tracks/:id` (new revision; server re-validates + re-bakes)
- `POST /api/tracks/:id/submit` · `/approve` · `/archive` (approve/archive: organisers)
- `GET /api/tracks/:id/fit/:venueId` -> fit results · `POST /api/tracks/:id/adapt/:venueId` -> new adapted track
- `GET /api/venues` · `GET /api/venues/:id` · `POST/PUT /api/venues` (organisers)
- `GET /p/:id/:rev.png` — preview image (cached, rendered from the engine's SVG with resvg)

## Pages
- `/` library: cards (preview, name, lap, corners, venue, status), filters, "fits my venue" picker
- `/t/:id` track page: 2D plan, 3D view, details, checks, revisions, download, "open in sim"; **Open Graph tags**
  (title, description, og:image = PNG) so forum links become preview cards
- `/t/:id/edit` designer · `/v` venues · `/v/:id/edit` venue template editor
- `/embed/:id` minimal viewer for forum iframes (add tracks.rcmisfits.org to Discourse "allowed iframes")

## Designer v1
Corner points (click add / insert on a straight, drag, right-click delete), snap 0.25 m + 45° (Shift = free), radius
(scroll), lane width (Ctrl+scroll), features placed by distance along the line (drag along, edit type/length/height),
start line, undo/redo (whole-document snapshots), area/rostrum/obstacles from a venue template or set for blank, live
checks panel, live 2D, 3D preview toggle. The engine runs in the browser on every change (debounced).

## Forum side (separate tasks for the discourse-event-system plugin)
- Venue: link to its Track Studio venue template.
- Event: "track for this meeting" = Track Studio track id + pinned revision; event page shows the preview card/embed.
- Admin settings only: DiscourseConnect provider on, `allowed iframes` += https://tracks.rcmisfits.org/embed/.

## Phases
1. **Engine port** — TS port of bake + fit + SVG preview + schema validation; fixture tests pass. (no UI)
2. **Server skeleton** — Fastify, SQLite, DiscourseConnect login, tracks/venues CRUD + revisions, PNG previews, OG pages.
3. **Library + viewer** — list, filters, track page with 2D plan, download, embed page.
4. **Designer** — editing as above.
5. **Venue templates + fit search UI** — template editor, "fits my venue", adapt.
6. **3D viewer** — three.js from `built` (carpet, pipes, ramps, rostrum view).
7. **Integration** — forum plugin tasks, sim import, production deploy.
