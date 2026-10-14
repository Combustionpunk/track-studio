# Track Studio — briefing for Claude Code

Track Studio is a web app for RC Misfits (forum.rcmisfits.org): members design carpet/astro RC tracks, clubs keep
venue templates (track area, rostrum, fixed obstacles), organisers browse layouts that fit their venue, and tracks are
shown on the Discourse forum (link previews / embedded viewer) and imported into a Unity driving sim.

## Read first
- `docs/PLAN.md` — architecture, data model, API, screens, phases
- `docs/rctrack-SPEC.md` — the track file format (`.rctrack.json`) and venue templates (`.rcvenue.json`)
- `reference/` — Python reference implementation (`bake.py`, `fit.py`, `preview_svg.py`) and fixtures

## Non-negotiables
- **The track format is the contract.** Don't change it without updating `docs/rctrack-SPEC.md` and bumping the version.
- **The TypeScript engine must reproduce the reference.** `packages/engine` is a port of `bake.py`/`fit.py`. Tests
  load every file in `reference/examples` and `reference/venues`, re-bake / re-fit, and compare with the stored results
  (racing line and dividers within 1 cm, lap length within 1 cm, same check codes, same fit orientations).
- **Units and axes:** metres; origin at the centre of the track area; +x east (right on plans), +z north (up on plans);
  headings in degrees, 0 = +x, counter-clockwise towards +z. Never use pixels or feet in stored data.
- **Consumers draw `built`, never recompute it.** Only the designer/engine reads `design`.
- Keep the engine pure (no DOM, no Node APIs) so it runs in the browser and on the server.

## Stack
pnpm workspaces monorepo · TypeScript everywhere · `packages/engine` (pure TS) · `apps/server` (Node 20+, Fastify,
SQLite via better-sqlite3, @resvg/resvg-js for PNG) · `apps/web` (Vite + React + three.js) · Vitest · Docker.

## Workflow
Small, testable steps. Each phase ends with tests passing and a short summary of what changed and how to try it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Combustionpunk/track-studio` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
