# Deploy record: 17 November 2026

This deploy updated tracks.rcmisfits.org from `3823146` (phone designer 3) to `234d08f` (#140). Deployed by Yeti, with Marshal, early on 17 November 2026 (UK).

## Contents
- **#136, phone designer 4:** selection, Checks, Jump and How to draw sheets.
- **#137, the brand package:** `@rcmisfits/brand` v0.1.0. Pit Lane colours, fonts and logo, and a themed plan and 3D view.
- **#139, phone designer 5:** the overflow menu, the Save button in the header and the Save sheet, layout details. **The phone layout is now the default under 640 px.** The `?phone=edit` switch is gone.
- **#140, phone designer 6:** a drag loupe on phones.
- **#138:** the 15 November deploy record (docs).

There were no migrations, no settings changes and no API changes. The image build fetches the brand package from `codeload.github.com`.

Main had been unable to build after #136 and #137 merged together (two `palette` declarations in `Designer.tsx`). #139 fixed that before this deploy. #143, CI on every push to main, follows so it can't recur.

## Steps
1. DigitalOcean snapshot of `tracks-misfits`.
2. Data volume backed up to `/root/backups/track-studio-<UTC time>-before-phone6.tgz`, with the app stopped.
3. `git pull --ff-only`, `docker compose up -d --build`, then `/healthz`.

## Post-checks
**Passed (Yeti: "all tests pass"):**
- **Laptop:** the new Pit Lane look and fonts; the designer's bar, Save and Checks tab.
- **Phone, on an existing track's `/t/<id>/edit`:**
  - the phone layout with no parameter;
  - the selection sheet;
  - the Checks pill;
  - the ⋯ menu;
  - the drag loupe, including flipping below near the top;
  - the Save sheet with the keyboard up;
  - the rotate prompt in landscape.

This is the real-device check the Board asked for on #133, #136, #139 and #140.

## Rollback
`git checkout 3823146 && docker compose up -d --build`, and restore the data volume backup if the data needs to go back too.

## Still to do
- **#143, CI on every push to main:** merge once Yeti has posted his own approval comment (it changes workflows).
- **Spaces backups** are still not set up (#13). Only local backups in `/root/backups` exist.
- **Member theme from the forum** (#141): Track Studio doesn't read it yet.
- **The shared top bar:** adopt `<rm-header>` from brand `v0.2.0` in a follow-up.
