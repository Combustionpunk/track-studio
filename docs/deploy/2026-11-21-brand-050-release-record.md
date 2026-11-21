# Live release, 21 Nov 2026: brand 0.5.0

Done by Yeti on `tracks-misfits` (`/opt/track-studio`), guided by Marshal, about 11:40 to 12:05 UK time.

## What went live
`2f0ff00` → `cba46a5`: #165 (#164), the brand package moves from v0.2.0 to v0.5.0, the forum's version. The 9 light palettes' accents are darker; the dark palettes are unchanged. No data change, no rebake.

## Steps
1. DigitalOcean snapshot; local backup `/root/backups/track-studio-20261121T1140Z-before-membertheme.tgz` (1.1 MB).
2. `git pull`; `git log -1` → `cba46a5`.
3. `FORUM_THEME_API_KEY` added to `.env`: a single-user admin key on the live forum, scope `discourse_event_system: read_member_themes` only. **Nothing reads it yet**; #163 (member theme from the forum) will. It is not in this repo.
4. `docker compose up -d --build`; container healthy.

## Checks (Yeti): passed
Light palette accents on the phone; tracks open as normal.

## Still to come
#163, which reads the member's theme from the forum, is back with the worker: after merging main it showed light palettes as Pit Lane dark. Its update is `git pull` and `up -d --build`; the key is already in place. Check the log for `members' own themes: read from the forum`.

## Rollback
`git checkout 2f0ff00`, `docker compose up -d --build`. No data to restore.
