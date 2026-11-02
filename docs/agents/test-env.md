# Test environment: CT 104

_To be completed by Yeti when CT 104 is built._

## Build
- Proxmox CT 104 `track-studio-test` on Suntree: Node 20+, pnpm, Playwright with Chromium, Docker if image changes are to be tested.
- The repo is cloned from GitHub separately from CT 102.
- `gh` signed in with a token that can read the repo, comment on and label PRs, and push to PR branches. No admin rights.

## Reset before every test run
1. `git checkout main && git pull --ff-only origin main && git clean -fdx`
2. Delete the local data directory so `pnpm seed` starts from the reference venues and examples. _Path: TBC._
