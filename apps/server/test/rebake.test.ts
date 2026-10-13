import type { RcTrack } from "@track-studio/engine";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rebakeAll } from "../src/rebake.js";
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
    expect(existsSync(join(config.dataDir, "previews", CLUB_A, "1.png"))).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/tracks?minCorners=12&maxCorners=12" })).json().tracks.map((t: { id: string }) => t.id)).toEqual([CLUB_A]);

    // nothing left to do the second time
    expect(rebakeAll(app.db, config.dataDir).changed).toEqual([]);
  });

  it("drops a cached preview whose drawing changed", async () => {
    const { app, config } = await makeApp({ seeded: true });
    await app.inject({ method: "GET", url: `/p/${CLUB_A}/1.png` });
    const doc = JSON.parse(app.db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ?").pluck().get(CLUB_A) as string) as RcTrack;
    doc.built!.lapLength = 999; // shown in the preview's title
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ?").run(JSON.stringify(doc), CLUB_A);
    const report = rebakeAll(app.db, config.dataDir);
    expect(report.changed.find((c) => c.id === CLUB_A)!.previewChanged).toBe(true);
    expect(existsSync(join(config.dataDir, "previews", CLUB_A, "1.png"))).toBe(false);
    expect((await app.inject({ method: "GET", url: `/p/${CLUB_A}/1.png` })).headers["x-preview-cache"]).toBe("miss");
  });
});
