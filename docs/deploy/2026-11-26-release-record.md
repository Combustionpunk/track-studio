# Live release, 26 Nov 2026: user guide, venue fields, private drafts

Done by Yeti on `tracks-misfits` (`/opt/track-studio`), guided by Marshal, about 01:08 to 01:24 UK time.

## What went live
`1818c73` → `f7cde99`:
| PR | What it does |
|---|---|
| #172 | User guide at `/help`, with "?" links in the app |
| #174 | Venue templates: surface, timing loop, pit area and rostrum zones (spec 1.13 / rcvenue 1.2); a club's committee edits its own venues |
| #181 | Draft layouts are private to their author and organisers (404 for everyone else) |
| #186 | Test-only: the race in the phone sheet and loupe E2E tests (#185) |
| #187 | Start line: the plan zooms back when it's let go |

No migration, no re-bake and no env change. The image is about 4 MB bigger (the guide's screenshots).

## Steps
1. DigitalOcean snapshot.
2. Backup of the data volume `track-studio_track-studio-data` to `/root/backups/track-studio-20261126-before-release.tgz`.
3. `git log -1` before: `1818c73` (the rollback point).
4. `git pull --ff-only`, then `git log -1` gave `f7cde99`.
5. `docker compose up -d --build`

## Checks (Yeti): passed
- `/help` loads signed out.
- Signed out, the live draft isn't in the library.
- In the designer, select the start line, then Escape: the plan zooms back.
- Niagara centre Indoor (Winter)'s venue page shows Surface and Timing loop, both "Not given" until set.

## Found and followed up
- **#190 (Board):** a template's surface comes from the forum venue track (the forum is the source), read-only in Track Studio. The forum already has Niagara Indoor (Winter) as carpet (indoor).
- **#191:** the venue page's revision list reads "r16 Nov 2026" (r1, 6 Nov 2026).

## Rollback
`git checkout 1818c73`, then `docker compose up -d --build`. There's no data to restore.
