# Live release, 19 Nov 2026: rctrack 1.12

Done by Yeti on `tracks-misfits` (`/opt/track-studio`), guided by Marshal, about 22:50 to 22:59 UK time.

## What went live
`20277c2` → `2f0ff00`. Includes rctrack 1.12 (65 mm square pipe), marshal points (#151, #157), the sim download (#155), the hairpin arrow keys (#147), and the spec tidy-up with the per-venue fit report in the rebake dry run (#160/#161).

## Steps
1. DigitalOcean snapshot of the droplet.
2. Local backup of the data volume `track-studio_track-studio-data`:
   `/root/backups/track-studio-20261119T2251Z-before-rctrack112.tgz` (1.1 MB).
3. `git pull` (fast-forward), `git log -1` → `2f0ff00`.
4. `docker compose up -d --build`: built in 259 s (the engine tests run inside the build); container healthy.
5. `docker compose exec track-studio node dist/rebake.js --dry-run`, then the real rebake. Both gave the same result:
   - 7 revisions re-baked, 7 changed (expected: the pipe changed);
   - Fits for Niagara centre – Indoor (Winter): 2 compared, 0 changed, 5 layouts not cached.

## Checks (Yeti): all passed
Tracks open in the plan and 3D views with the new pipe; the fit panel; the top bar and theme; the sim download button.

## Notes
- The 12-corner "New track at Niagara centre – Indoor (Winter)" bakes at 22.017 × 12.022 m, about 2 cm over the hall in each direction, likely the thicker pipe's outer edge. It's a test track, and the fit answers didn't change.
- `ls /root/backups | tail -2` sorts by name, so older dated backups may not show; use `ls -lt` for the newest.

## Rollback
Restore the snapshot, or: `git checkout 20277c2`, `docker compose up -d --build`, stop the container, restore the tar into the volume, start it again.
