# Deploy record: 15 November 2026

This deploy updated tracks.rcmisfits.org to `3823146`: Phone designer 3, with the header, the full-screen plan and the bottom toolbar under 640 px (#122, #133). Deployed by Yeti, with Marshal, late on 15 November 2026 (UK). Checked on a phone on 16 November.

The phone designer is still switched off by default. It only appears with `?phone=edit` on an existing track.

## Before

- **Droplet snapshot:** asked for in the steps. It was not confirmed in the session.
- **Local backup:** the data volume was copied with the app stopped, to `/root/backups/track-studio-20261115T2351Z-before-phone3.tgz`:
  ```sh
  docker compose stop track-studio
  docker run --rm -v track-studio_track-studio-data:/data -v /root/backups:/out alpine \
    tar czf /out/track-studio-<UTC time>-before-phone3.tgz -C /data .
  docker compose start track-studio
  ```

## Update

- **Pull and build:** `git pull --ff-only` to `3823146`, then `docker compose up -d --build`.
- **Live is now:** `3823146 (HEAD -> main, origin/main)`, so it matches main.
- **Not recorded:** the commit that was live before, and the list from `git log HEAD..origin/main`.

## Post-checks

- **Phone designer:** on an existing track, `/t/<id>/edit?phone=edit` works on a real phone. Yeti's check: "appears to be working". The detailed 10-step list from the #133 review was not reported item by item.

## Still to do

- **Next deploy:** #136 (phone designer 4) and #137 (brand package) once merged. Both are reviewed and approved. The Docker build needs to reach `codeload.github.com` for the brand package.
- **Before ticket 5 removes the `?phone=edit` switch:** a full real-device check.
- **Carried over from 6 November:** Spaces backups are still not set up (#13). Only local backups in `/root/backups` exist.
