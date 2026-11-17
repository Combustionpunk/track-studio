# Deploy record: 17 November 2026 (evening)

This deploy updated tracks.rcmisfits.org from `234d08f` (this morning's deploy, #140) to `20277c2` (#150). Deployed by Yeti, with Marshal, at about 20:35 UTC on 17 November 2026.

## Where it lives
- **Droplet:** `tracks-misfits`.
- **Repo:** `/opt/track-studio`. Found from the running container's compose label: `com.docker.compose.project.working_dir`.
- **Compose services:**
  - `track-studio` (the app, image `track-studio:prod`);
  - `caddy` (the web proxy, not rebuilt).
- **Data volume:** `track-studio_track-studio-data`.

## Contents
- **#150 (#149):** the shared RC Misfits top bar, `<rm-header site="tracks">` from brand **v0.2.0**.
  - It has the logo, Forum · Meetings · Tracks · Timing, and the account, and it folds into a menu button on phones.
  - In the editors, Track Studio's own row goes to the plan, so the designer keeps its room.
- **#145 (#126), phone designer 7:** a long-press context sheet for a corner, corner point, jump or the start line.
- **#148 (#127), phone designer 8:** a 3D preview on phones, behind `?phone3d=1`.
- **#143 (#142):** CI on every push to main, and an issue opened when main goes red. CI only; nothing on the site.
- **#144:** this morning's deploy record (docs).

There were no migrations, no settings changes and no API changes. The image build fetches the brand package from `codeload.github.com`; it took 238 s.

## Steps
1. DigitalOcean snapshot of `tracks-misfits`.
2. Data volume backed up with the app stopped, to `/root/backups/track-studio-20261117T2032Z-before-topbar.tgz` (1.1 MB):
   ```sh
   docker compose stop track-studio
   docker run --rm -v track-studio_track-studio-data:/data -v /root/backups:/out alpine \
     tar czf /out/track-studio-<UTC time>-before-topbar.tgz -C /data .
   docker compose start track-studio
   ```
   The first try left off the final `.`, and tar refused with "empty archive". Nothing was written, and the rerun with the `.` worked.
3. `git pull --ff-only` (`234d08f..20277c2`), then `docker compose up -d --build`.
4. **Health:** `track-studio-track-studio-1` was healthy, and `/healthz` returned `{"ok":true,"version":"47b544eb6b34"}`. `version` is a build id, not the git commit. `git log -1` on the droplet shows `20277c2 (HEAD -> main, origin/main)`.

## Post-checks (passed, Yeti: "all looks good")
- **Laptop:**
  - the shared bar on the home page and in the designer, with the designer's row clear under it;
  - Forum, Meetings and Timing go to the live sites;
  - signed in, the username shows, and Sign out works.
- **Phone, on an existing track's `/t/<id>/edit`:**
  - the bar's menu button opens and closes, including on a press outside it;
  - a long press on a corner opens the action sheet, and the press itself changes nothing;
  - `?phone3d=1` shows the 3D button; the view spins, and the phone goes back to 2D. The phone's 3D figures (time to first frame, fps) weren't recorded.

All three sites now carry the same top bar: the forum, the timing site and Track Studio.

## Rollback
```sh
cd /opt/track-studio && git checkout 234d08f && docker compose up -d --build
```
If the data ever needs to go back too, restore `track-studio-20261117T2032Z-before-topbar.tgz` into the volume with the app stopped.

## Still to do
- **3D on phones by default?** The Board needs the phone's figures from `?phone3d=1` first.
- **Spaces backups** are still not set up (#13). Only local backups in `/root/backups` exist.
- **Member theme from the forum** (#141).
- **Marshal cones** (#151): planned, waiting for the Mechanic.
