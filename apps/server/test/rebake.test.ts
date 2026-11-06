import type { RcTrack } from "@track-studio/engine";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rebakeAll } from "../src/rebake.js";
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
    expect(dry.changed).toHaveLength(3);
    expect((await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json().track.corners).toBe(18);

    const report = rebakeAll(app.db, config.dataDir);
    expect(report.failed).toEqual([]);
    const club = report.changed.find((c) => c.id === CLUB_A)!;
    expect(club).toMatchObject({ corners: [18, 12], size: ["—", "22 × 11.8 m"], previewChanged: false });

    const got = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB_A}` })).json();
    expect(got.track).toMatchObject({ corners: 12, size: { length: 22, width: 11.8 }, revision: 1, approvedRevision: 1 });
    expect(got.doc.built.size).toEqual({ length: 22, width: 11.8, bbox: [-11, -5.9, 11, 5.9] });
    expect(got.doc.design).toEqual(designBefore);
    expect(app.db.prepare("SELECT COUNT(*) FROM track_revisions").pluck().get()).toBe(3);
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
    const rows = app.db.prepare("SELECT track_id, revision FROM track_revisions").all() as { track_id: string; revision: number }[];
    for (const f of readdirSync(v16).filter((n) => n.endsWith(".rctrack.json"))) {
      const doc = JSON.parse(readFileSync(join(v16, f), "utf8")) as RcTrack;
      app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ?").run(JSON.stringify(doc), doc.id);
    }
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
});
