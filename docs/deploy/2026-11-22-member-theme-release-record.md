# Live release, 22 Nov 2026: members' own forum themes

Done by Yeti on `tracks-misfits` (`/opt/track-studio`), guided by Marshal, about 12:44 to 12:53 UK time.

## What went live
`cba46a5` → `1818c73`: #163 (#141). The server reads each signed-in member's theme from the forum, server to server (`/des/members/:user_id/theme.json`), using `FORUM_THEME_API_KEY`, and passes it in `/api/me`. The web app shows the member's palette by mode, `dark_theme` in dark, and Match my car. Without the key, or on any failure, the site behaves as before. No data change, no rebake.

## Steps
1. DigitalOcean snapshot.
2. Local backup of the data volume `track-studio_track-studio-data`:
   `/root/backups/track-studio-20261122T1245Z-before-163.tgz` (1.17 MB), made with
   `docker run --rm -v track-studio_track-studio-data:/data:ro -v /root/backups:/backup alpine tar czf /backup/<name>.tgz -C /data .`
3. `git pull` (fast-forward), `git log -1` → `1818c73`.
4. `docker compose up -d --build`. The key was already in `.env` from the 21 Nov release (a single-user admin key, scope `discourse_event_system: read_member_themes` only; not in this repo).

## Checks (Yeti): passed
The member's forum theme applies on live after signing in.

## Rollback
`git checkout cba46a5`, `docker compose up -d --build`. No data to restore. To keep the code and stop reading themes, remove `FORUM_THEME_API_KEY` from `.env` and run `docker compose up -d`.
