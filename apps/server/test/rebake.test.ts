import type { RcTrack } from "@track-studio/engine";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changeLine, fitLines, rebakeAll, type RebakeChange, type VenueFits } from "../src/rebake.js";
import { ROOT_DIR } from "../src/config.js";
import { setRevisionColumns } from "../src/store.js";
import { makeApp } from "./helpers.js";

const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";

/** Make the stored data look like it was baked by engine 1.1 (old corner count, no size). */
function makeOld(app: Awaited<ReturnType<typeof makeApp>>["app"]) {
  const rows = app.db.prepare("SELECT track_id, revision, rctrack_json FROM track_revisions").all() as { track_id: string; revision: number; rctrack_json: string }[];
  for (const r of rows) {
    const doc = JSON.parse(r.rctrack_json) as RcTrack;
    delete doc.built!.size;
    doc.built!.stats.corners = doc.design.points.length;
    doc.built!.generator = "rctrack-bake.py 1.1";
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ? AND revision = ?").run(JSON.stringify(doc), r.track_id, r.revision);
  }
  app.db.prepare("UPDATE tracks SET corners = 18, size_length = NULL, size_width = NULL").run();
  for (const r of rows) {
    const doc = JSON.parse(app.db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(r.track_id, r.revision) as string) as RcTrack;
    setRevisionColumns(app.db, r.track_id, r.revision, doc); // as engine 1.1 would have stored them
  }
}

describe("rebake", () => {
  it("brings old tracks up to engine 1.2 in place", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // a cached preview that stays valid (the drawing doesn't change)
    await app.inject({ method: "GET", url: `/p/${CLUB_A}/1.png` });
    makeOld(app);
    const designBefore = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().doc.design;

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(dry.changed).toHaveLength(4);
    expect((await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().track.corners).toBe(18);

    const report = rebakeAll(app.db, config.dataDir);
    expect(report.failed).toEqual([]);
    const club = report.changed.find((c) => c.id === CLUB_A)!;
    expect(club).toMatchObject({ corners: [18, 12], size: ["—", "22 × 11.8 m"], previewChanged: false });

    const got = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json();
    expect(got.track).toMatchObject({ corners: 12, size: { length: 22, width: 11.8 }, revision: 1, approvedRevision: 1 });
    expect(got.doc.built.size).toEqual({ length: 22, width: 11.8, bbox: [-11, -5.9, 11, 5.9] });
    expect(got.doc.design).toEqual(designBefore);
    expect(app.db.prepare("SELECT COUNT(*) FROM track_revisions").pluck().get()).toBe(4);
    expect(readdirSync(join(config.dataDir, "previews", CLUB_A))).toHaveLength(1); // drawing unchanged: picture kept
    expect((await app.inject({ method: "GET", url: "/api/tracks?minCorners=12&maxCorners=12" })).json().tracks.map((t: { id: string }) => t.id)).toEqual([CLUB_A]);

    // nothing left to do the second time
    expect(rebakeAll(app.db, config.dataDir).changed).toEqual([]);
  });

  it("drops a cached preview whose drawing changed", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // stored by an older engine whose drawing differed (here: the start line in another place)
    const doc = JSON.parse(app.db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ?").pluck().get(CLUB_A) as string) as RcTrack;
    doc.built!.startLine.x += 1;
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ?").run(JSON.stringify(doc), CLUB_A);
    setRevisionColumns(app.db, CLUB_A, 1, doc);
    const before = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().track.previewUrl;
    await app.inject({ method: "GET", url: before });
    const report = rebakeAll(app.db, config.dataDir);
    expect(report.changed.find((c) => c.id === CLUB_A)!.previewChanged).toBe(true);
    expect(existsSync(join(config.dataDir, "previews", CLUB_A))).toBe(true);
    expect(readdirSync(join(config.dataDir, "previews", CLUB_A))).toEqual([]); // old picture swept
    const url = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().track.previewUrl;
    expect(url).not.toBe(before);
    expect((await app.inject({ method: "GET", url })).headers["x-preview-cache"]).toBe("miss");
  });

  it("upgrades revisions stored by rctrack 1.6: every track changes, no racing line does (#63)", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // the seeded examples as rctrack 1.6 stored them: obstacles, basedOn, design and built rostrum
    const v16 = join(ROOT_DIR, "packages/engine/test/fixtures/v16");
    // (the examples that existed in 1.6; later ones, such as the crossover added for #155, stay as they are)
    const old = readdirSync(v16).filter((n) => n.endsWith(".rctrack.json")).map((f) => JSON.parse(readFileSync(join(v16, f), "utf8")) as RcTrack);
    const rows = (app.db.prepare("SELECT track_id, revision FROM track_revisions").all() as { track_id: string; revision: number }[]).filter((r) => old.some((d) => d.id === r.track_id));
    expect(rows).toHaveLength(3);
    for (const doc of old) app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ?").run(JSON.stringify(doc), doc.id);
    const stored = () => rows.map((r) => app.db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(r.track_id, r.revision) as string);
    expect(stored().every((j) => j.includes('"rostrum"'))).toBe(true);
    // read through the API before the rebake, they already come back as 1.7
    const before = (await app.inject({ method: "GET", url: "/api/tracks/46897d82-0114-460f-9a75-984ee97bca0e" })).json().doc;
    expect(before).not.toHaveProperty("basedOn");
    expect(before.info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" });

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(dry.changed.map((c) => c.id).sort()).toEqual([...new Set(rows.map((r) => r.track_id))].sort());
    expect(dry.changed.every((c) => !c.racingLineChanged)).toBe(true);
    expect(dry.changed.every((c) => c.removed.includes("design.rostrum") && c.removed.includes("built.rostrum"))).toBe(true);
    expect(dry.changed.find((c) => c.id === "46897d82-0114-460f-9a75-984ee97bca0e")!.removed).toEqual(["obstacles", "basedOn", "design.rostrum", "built.rostrum"]);
    expect(stored().every((j) => j.includes('"rostrum"'))).toBe(true); // dry run: nothing written

    expect(rebakeAll(app.db, config.dataDir).failed).toEqual([]);
    for (const j of stored()) expect(j).not.toMatch(/"rostrum"|"obstacles"|"basedOn"/);
    expect(JSON.parse(stored()[rows.findIndex((r) => r.track_id === "46897d82-0114-460f-9a75-984ee97bca0e")]).info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" });
    expect(rebakeAll(app.db, config.dataDir).changed).toEqual([]);
  });

  it("lists tracks that gain an error, such as rctrack 1.9's lane-overlap; approvals stay (#95)", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // club A's revision replaced by lanes that overlap, as 1.8 baked it: no lane-overlap check yet
    const doc = JSON.parse(readFileSync(join(ROOT_DIR, "packages/engine/test/fixtures/extra/overlap-straights.rctrack.json"), "utf8")) as RcTrack;
    const stored = { ...doc, id: CLUB_A, built: { ...doc.built!, generator: "rctrack-bake.py 1.8", checks: doc.built!.checks.filter((c) => c.code !== "lane-overlap") } };
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ? AND revision = 1").run(JSON.stringify(stored), CLUB_A);
    setRevisionColumns(app.db, CLUB_A, 1, stored);
    const errors = () => app.db.prepare("SELECT errors FROM track_revisions WHERE track_id = ? AND revision = 1").pluck().get(CLUB_A);
    expect(errors()).toBe(0);

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(dry.changed.map((c) => [c.id, c.errors, c.gained])).toEqual([[CLUB_A, [0, 1], ["lane-overlap"]]]);
    expect(errors()).toBe(0); // dry run: nothing written

    expect(rebakeAll(app.db, config.dataDir).failed).toEqual([]);
    expect(errors()).toBe(1);
    const got = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json();
    expect(got.track).toMatchObject({ revision: 1, approvedRevision: 1 });
    expect(got.doc.built.checks.filter((c: { code: string }) => c.code === "lane-overlap")).toHaveLength(1);
  });

  it("reports errors lost and warnings gained: 1.9's lane-overlap errors on \"Test\" become one lane-squeeze warning (#102)", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // club A's revision replaced by the production layout "Test" as 1.9 baked it: three lane-overlap errors, no squeeze
    const doc = JSON.parse(readFileSync(join(ROOT_DIR, "packages/engine/test/fixtures/extra/test-squeezed-corner.rctrack.json"), "utf8")) as RcTrack;
    const overlap = (x: number, z: number, m: string) => ({ level: "error" as const, code: "lane-overlap" as const, x, z, message: `Lanes overlap by ${m} m here` });
    const checks19 = [...doc.built!.checks.filter((c) => c.code !== "lane-squeeze"), overlap(7.711, 3.855, "0.02"), overlap(8.504, 3.237, "0.03"), overlap(-8.185, -3.119, "0.35")];
    const stored = { ...doc, id: CLUB_A, built: { ...doc.built!, generator: "rctrack-bake.py 1.9", checks: checks19 } };
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ? AND revision = 1").run(JSON.stringify(stored), CLUB_A);
    setRevisionColumns(app.db, CLUB_A, 1, stored);
    const errors = () => app.db.prepare("SELECT errors FROM track_revisions WHERE track_id = ? AND revision = 1").pluck().get(CLUB_A);
    expect(errors()).toBe(3);

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(dry.changed.map((c) => [c.id, c.errors, c.gained, c.warnings, c.gainedWarnings])).toEqual([[CLUB_A, [3, 0], [], [0, 1], ["lane-squeeze"]]]);
    expect(changeLine(dry.changed[0])).toMatch(/errors 3 → 0, warnings 0 → 1 \(new: lane-squeeze\)/);
    expect(errors()).toBe(3); // dry run: nothing written

    expect(rebakeAll(app.db, config.dataDir).failed).toEqual([]);
    expect(errors()).toBe(0);
    const got = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json();
    expect(got.track).toMatchObject({ revision: 1, approvedRevision: 1, errors: 0 });
    expect(got.doc.built.checks.filter((c: { level: string }) => c.level === "error")).toEqual([]);
    expect(got.doc.built.checks.filter((c: { code: string }) => c.code === "lane-squeeze")).toHaveLength(1);
  });

  it("rctrack 1.12, a 0.065 m square pipe: the footprint loses cells on the same grid; checks, size and the report stay (#155)", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // club A's revision as 1.10 baked it (the lanes padded by half a 0.08 m pipe)
    const stored = JSON.parse(readFileSync(join(ROOT_DIR, "packages/engine/test/fixtures/v110/club-a.rctrack.json"), "utf8")) as RcTrack;
    expect(stored.id).toBe(CLUB_A);
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ? AND revision = 1").run(JSON.stringify(stored), CLUB_A);
    setRevisionColumns(app.db, CLUB_A, 1, stored);

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(dry.failed).toEqual([]);
    expect(dry.changed.map((c) => [c.id, c.racingLineChanged, c.errors, c.gained, c.warnings, c.gainedWarnings, c.previewChanged, c.size[0] === c.size[1], c.corners[0] === c.corners[1]])).toEqual([
      [CLUB_A, false, [0, 0], [], [0, 0], [], false, true, true],
    ]);
    expect(changeLine(dry.changed[0])).not.toMatch(/RACING LINE|errors|warnings|preview/);

    expect(rebakeAll(app.db, config.dataDir).failed).toEqual([]);
    const got = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().doc as RcTrack;
    const now = got.built!.footprint, was = stored.built!.footprint;
    // (the stored bake is bake.py's and the fresh one the engine's, the same within the reference tolerance)
    expect(got.built!.checks).toEqual(stored.built!.checks);
    expect(got.built!.size).toEqual(stored.built!.size);
    expect(got.built!.racingLine).toHaveLength(stored.built!.racingLine.length);
    expect({ ...now, rle: "" }).toEqual({ ...was, rle: "" }); // the same cell, origin, rows, cols and bbox
    const covered = (rle: string) => rle.split(" ").reduce((n, run, i) => n + (i % 2 ? Number(run) : 0), 0);
    expect(covered(now.rle)).toBeLessThan(covered(was.rle));
    expect(covered(now.rle)).toBeGreaterThan(covered(was.rle) * 0.99);
    // and a second rebake finds nothing to do
    expect(rebakeAll(app.db, config.dataDir, { dryRun: true }).changed).toEqual([]);
  });
});

describe("rebake: fit changes per venue template (#160)", () => {
  const CLUB_HALL = "venue-1";
  const cacheRow = (app: Awaited<ReturnType<typeof makeApp>>["app"]) =>
    app.db.prepare("SELECT results_json FROM fit_cache WHERE track_id = ? AND venue_id = ?").pluck().get(CLUB_A, CLUB_HALL) as string | undefined;

  it("compares each cached fit (the previous engine's answer) with this engine's, per venue template", async () => {
    const { app, config } = await makeApp({ seeded: true });
    const fit = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}/fit/${CLUB_HALL}` })).json();
    expect(fit.results.map((r: { orientation: string }) => r.orientation)).toEqual(["as designed", "mirrored", "rotated 180", "mirrored, rotated 180"]);
    // as an older engine answered: two orientations didn't fit, one sat elsewhere, and the lanes hit a pillar as drawn
    const now = JSON.parse(cacheRow(app)!);
    const older = {
      results: [{ ...now.results[0], shift: [now.results[0].shift[0] + 0.1, now.results[0].shift[1]] }, now.results[1]],
      asDrawn: { ...now.asDrawn, checks: [...now.asDrawn.checks, { level: "error", code: "obstacle", x: 0, z: 0, message: "Lanes over a pillar" }] },
    };
    app.db.prepare("UPDATE fit_cache SET results_json = ? WHERE track_id = ? AND venue_id = ?").run(JSON.stringify(older), CLUB_A, CLUB_HALL);

    const dry = rebakeAll(app.db, config.dataDir, { dryRun: true });
    expect(Object.fromEntries(dry.fits.map((v) => [v.id, [v.compared, v.notCached, v.changed.length]]))).toEqual({
      [CLUB_HALL]: [1, 3, 1], // Club hall: Club A compared; the three other layouts were never fitted there
      "venue-2": [0, 4, 0],
      "venue-3": [0, 4, 0],
    });
    const hall = dry.fits.find((v) => v.id === CLUB_HALL)!;
    expect(hall).toMatchObject({ name: "Club hall", revision: 1 });
    expect(hall.changed).toEqual([
      {
        id: CLUB_A, name: "Club A", revision: 1,
        orientations: [["as designed", "mirrored"], ["as designed", "mirrored", "rotated 180", "mirrored, rotated 180"]],
        moved: ["as designed"],
        asDrawnErrors: [1, 0],
        asDrawnGained: [],
      },
    ]);
    expect(fitLines(dry.fits).join("\n")).toContain("    Club A r1: fits 2 → 4 (new: rotated 180, mirrored, rotated 180), moved: as designed, as drawn errors 1 → 0");
    expect(cacheRow(app)).toBe(JSON.stringify(older)); // dry run: the cache is kept

    // the real run reports the same, then clears the cache
    const real = rebakeAll(app.db, config.dataDir);
    expect(real.fits).toEqual(dry.fits);
    expect(cacheRow(app)).toBeUndefined();
  });

  it("reports no change when the cached answer is this engine's, and a bare pre-1.7 cache row by its orientations", async () => {
    const { app, config } = await makeApp({ seeded: true });
    await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}/fit/${CLUB_HALL}` });
    expect(rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)).toMatchObject({ compared: 1, changed: [] });

    const { results } = JSON.parse(cacheRow(app)!);
    app.db.prepare("UPDATE fit_cache SET results_json = ? WHERE track_id = ? AND venue_id = ?").run(JSON.stringify(results.slice(0, 1)), CLUB_A, CLUB_HALL);
    const hall = rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)!;
    expect(hall.changed.map((c) => [c.orientations[0], c.moved, c.asDrawnErrors])).toEqual([[["as designed"], [], null]]);
  });

  it("notices one as-drawn error swapped for another", async () => {
    const { app, config } = await makeApp({ seeded: true });
    // "Freeform example @ Sports hall B" in Club hall: four orientations, one as-drawn error
    const FREEFORM = "46897d82-0114-460f-9a75-984ee97bca0e";
    await app.inject({ method: "GET", url: `/api/tracks/${FREEFORM}/fit/${CLUB_HALL}` });
    const row = () => app.db.prepare("SELECT results_json FROM fit_cache WHERE track_id = ?").pluck().get(FREEFORM) as string;
    const now = JSON.parse(row());
    expect(now.asDrawn.checks.filter((c: { level: string }) => c.level === "error")).toHaveLength(1);
    const swapped = { ...now, asDrawn: { ...now.asDrawn, checks: now.asDrawn.checks.map((c: { code: string }) => ({ ...c, code: c.code === "obstacle" ? "outside-area" : "obstacle" })) } };
    app.db.prepare("UPDATE fit_cache SET results_json = ? WHERE track_id = ?").run(JSON.stringify(swapped), FREEFORM);
    const hall = rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)!;
    expect(hall.changed.map((c) => [c.asDrawnErrors, c.asDrawnGained])).toEqual([[[1, 1], [now.asDrawn.checks[0].code]]]);
    expect(fitLines([hall])[2]).toMatch(/: fits 4, as drawn errors 1 → 1 \(new: (obstacle|outside-area)\)$/);
  });

  it("compares each layout's public revision only: an approved revision with a newer draft is compared as the approved one", async () => {
    const { app, config } = await makeApp({ seeded: true });
    await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}/fit/${CLUB_HALL}` }); // r1, approved and public
    const stale = (rev: number) => app.db.prepare("INSERT INTO fit_cache (track_id, track_revision, venue_id, venue_revision, results_json) VALUES (?, ?, ?, 1, '[]')").run(CLUB_A, rev, CLUB_HALL);
    // a newer draft revision of Club A, fitted (and cached) with a different answer: not what the library shows
    const r1 = app.db.prepare("SELECT * FROM track_revisions WHERE track_id = ? AND revision = 1").get(CLUB_A) as Record<string, unknown>;
    app.db.prepare(`INSERT INTO track_revisions (${Object.keys(r1).join(", ")}) VALUES (${Object.keys(r1).map((k) => "@" + k).join(", ")})`).run({ ...r1, revision: 2 });
    app.db.prepare("UPDATE tracks SET current_revision = 2 WHERE id = ?").run(CLUB_A);
    stale(2);
    const hall = rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)!;
    expect([hall.compared, hall.notCached, hall.changed]).toEqual([1, 3, []]);

    // once nothing is approved, the public revision is the current one, r2
    app.db.prepare("UPDATE tracks SET approved_revision = NULL WHERE id = ?").run(CLUB_A);
    const after = rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)!;
    expect(after.changed.map((c) => [c.revision, c.orientations[0].length])).toEqual([[2, 0]]);
  });

  it("reports a cached answer it can't recompute and carries on with the rebake", async () => {
    const { app, config } = await makeApp({ seeded: true });
    await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}/fit/${CLUB_HALL}` });
    app.db.prepare("UPDATE fit_cache SET results_json = 'not json'").run();
    const report = rebakeAll(app.db, config.dataDir);
    const hall = report.fits.find((v) => v.id === CLUB_HALL)!;
    expect(hall.failed.map((f) => [f.id, f.revision])).toEqual([[CLUB_A, 1]]);
    expect(fitLines([hall])).toContain(`    FIT FAILED ${CLUB_A} r1: ${hall.failed[0].error}`);
    expect(report.failed).toEqual([]);
    expect(app.db.prepare("SELECT COUNT(*) FROM fit_cache").pluck().get()).toBe(0); // the rebake still cleared it
  });

  it("ignores cache rows for a venue's older revisions, which nothing reads any more", async () => {
    const { app, config } = await makeApp({ seeded: true });
    await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}/fit/${CLUB_HALL}` });
    app.db.prepare("UPDATE fit_cache SET venue_revision = 0, results_json = '[]'").run();
    expect(rebakeAll(app.db, config.dataDir, { dryRun: true }).fits.find((v) => v.id === CLUB_HALL)).toMatchObject({ compared: 0, notCached: 4, changed: [] });
  });
});

describe("rebake fit lines", () => {
  const venue: VenueFits = { id: "v", name: "Niagara centre", revision: 2, compared: 2, notCached: 1, changed: [], failed: [] };

  it("prints one line per venue template, saying what had no earlier answer", () => {
    expect(fitLines([venue])).toEqual([
      "Fits (each layout's cached answer, from the engine that answered it, compared with this engine's):",
      "  Niagara centre r2: 2 compared, 0 changed, 1 layout not cached (no earlier answer to compare)",
    ]);
    expect(fitLines([{ ...venue, notCached: 0 }])[1]).toBe("  Niagara centre r2: 2 compared, 0 changed");
    expect(fitLines([{ ...venue, notCached: 3 }])[1]).toMatch(/3 layouts not cached/);
  });

  it("lists each layout that fits differently", () => {
    const changed = { id: "t", name: "Test", revision: 3, orientations: [[], ["as designed", "mirrored"]] as [string[], string[]], moved: [], asDrawnErrors: [1, 1] as [number, number], asDrawnGained: [] };
    expect(fitLines([{ ...venue, changed: [changed] }])[2]).toBe("    Test r3: fits 0 → 2 (new: as designed, mirrored)");
    expect(fitLines([{ ...venue, changed: [{ ...changed, orientations: [["mirrored"], ["mirrored"]], moved: ["mirrored"] }] }])[2]).toBe("    Test r3: fits 1, moved: mirrored");
    expect(fitLines([{ ...venue, changed: [{ ...changed, orientations: [["mirrored"], []], asDrawnErrors: null }] }])[2]).toBe("    Test r3: fits 1 → 0 (lost: mirrored)");
  });

  it("says so when there are no venue templates", () => {
    expect(fitLines([])).toEqual(["Fits: no venue templates."]);
  });
});

describe("rebake report lines", () => {
  const change: RebakeChange = {
    id: "t", name: "Club A", revision: 2, corners: [12, 12], size: ["22 × 11.8 m", "22 × 11.8 m"], racingLineChanged: false,
    removed: [], errors: [0, 0], gained: [], warnings: [0, 0], gainedWarnings: [], previewChanged: false,
  };

  it("says what errors were lost and what warnings were gained (#102)", () => {
    expect(changeLine({ ...change, errors: [3, 0], warnings: [0, 1], gainedWarnings: ["lane-squeeze"], previewChanged: true })).toBe(
      "  Club A r2: 12 corners, size 22 × 11.8 m, errors 3 → 0, warnings 0 → 1 (new: lane-squeeze), preview re-rendered",
    );
  });

  it("prints the warnings whenever new warning codes appear, even with the same count", () => {
    expect(changeLine({ ...change, warnings: [1, 1], gainedWarnings: ["lane-squeeze"] })).toBe("  Club A r2: 12 corners, size 22 × 11.8 m, warnings 1 → 1 (new: lane-squeeze)");
  });

  it("says nothing about warnings when neither the count nor the codes changed", () => {
    expect(changeLine({ ...change, errors: [1, 0] })).toBe("  Club A r2: 12 corners, size 22 × 11.8 m, errors 1 → 0");
  });

  it("says what changed, and nothing about errors when neither the count nor the codes changed", () => {
    expect(changeLine({ ...change, corners: [18, 12], removed: ["obstacles"], previewChanged: true })).toBe("  Club A r2: corners 18 → 12, size 22 × 11.8 m, removed obstacles, preview re-rendered");
  });

  it("names the error codes a track gains", () => {
    expect(changeLine({ ...change, errors: [0, 1], gained: ["lane-overlap"] })).toBe("  Club A r2: 12 corners, size 22 × 11.8 m, errors 0 → 1 (new: lane-overlap)");
  });

  it("prints the errors whenever new codes appear, even with the same count (#100)", () => {
    // a missed crossing's lane-overlap becomes crossing-unbridged: still one error, but a different one
    expect(changeLine({ ...change, errors: [1, 1], gained: ["crossing-unbridged"] })).toBe("  Club A r2: 12 corners, size 22 × 11.8 m, errors 1 → 1 (new: crossing-unbridged)");
  });

  it("prints a changed count without new codes", () => {
    expect(changeLine({ ...change, errors: [1, 0] })).toBe("  Club A r2: 12 corners, size 22 × 11.8 m, errors 1 → 0");
  });
});
