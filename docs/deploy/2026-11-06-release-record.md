# Deploy record: 6 November 2026

This deploy updated tracks.rcmisfits.org to `cd43bc9` (#78). Deployed by Yeti, with Marshal, on the evening of 6 November 2026 (UK).

It includes:
- rctrack 1.6 crossovers (#56, #70) and 1.7 standalone layouts (#72);
- the library lock (#73);
- forum venue links (#74);
- "Used at" (#77);
- lap times and class speeds (#78);
- designer fixes.

## Before

- A droplet snapshot was taken.
- **`deploy/backup.sh` failed:** `SPACES_ENDPOINT`, `SPACES_BUCKET`, `SPACES_KEY` and `SPACES_SECRET` aren't set, so **no Spaces backups have ever run** (the nightly job too, if it was scheduled).
- **Local backup instead:** a copy of the data volume was taken with the app stopped:
  ```sh
  docker run --rm -v track-studio_track-studio-data:/data -v /root/backups:/out alpine \
    tar czf /out/track-studio-data-<UTC time>.tgz -C /data .
  ```

## Update

- **Pull and build:** `git pull --ff-only` to `cd43bc9`, then `docker compose up -d --build`. The build took about 2 minutes, and the container came up healthy. `/healthz` returned `{"ok":true}`.
- **Migrations:** 004 (`venues.forum_track_id`) and 005 (`class_speeds`) ran at start-up.
- **Rebake:** `rebake.js --dry-run` reported **0 revisions**, because live had no stored tracks, so the real rebake was skipped.

## Post-checks

- **Class speeds:** `/api/class-speeds` returns the four defaults (2WD Buggy 6.5, 4WD Buggy 7.0, Stadium Truck 6.0, Short Course 5.5 m/s).
- **Forum venues:** `/api/forum-venues` returns the forum's venues, so the container reaches the forum.
- **Forum track lookup:** `/api/venues?forumTrack=999999` returns 404, as expected.
- **Logs:** no errors or warnings.

## Found on live

- **Quick mode can't draw a track that crosses itself** (step 1 refuses used squares). Raised as #79.

## Still to do

- **Set up Spaces backups** (the bucket, a key limited to it, `.env` and cron) and test a restore. This is part of #13.
- **Link the venue templates** to forum venues and tracks, then set the forum's `discourse_event_system_track_studio_url`.
