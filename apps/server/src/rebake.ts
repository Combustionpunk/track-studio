// pnpm rebake [--dry-run]: one-off refresh of every stored revision's `built` with the current engine.
// The design is untouched, so revisions keep their numbers (and approvals stay pinned); only derived data changes.
import { bake, previewSvg, type RcTrack } from "@track-studio/engine";
import { config as loadDotenv } from "dotenv";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, loadConfig, ROOT_DIR } from "./config.js";
import { openDb, type DB } from "./db.js";
import { builtColumns } from "./store.js";

export interface RebakeChange {
  id: string;
  name: string;
  revision: number;
  corners: [number, number];
  size: [string, string];
  /** the drawn preview changed, so its cached PNG was dropped */
  previewChanged: boolean;
}

export interface RebakeReport {
  revisions: number;
  changed: RebakeChange[];
  failed: { id: string; revision: number; error: string }[];
  dryRun: boolean;
}

const sizeText = (doc: RcTrack) => (doc.built?.size ? `${doc.built.size.length} × ${doc.built.size.width} m` : "—");

export function rebakeAll(db: DB, dataDir: string, { dryRun = false } = {}): RebakeReport {
  const rows = db.prepare("SELECT track_id, revision, rctrack_json, png_path FROM track_revisions ORDER BY track_id, revision").all() as {
    track_id: string;
    revision: number;
    rctrack_json: string;
    png_path: string | null;
  }[];
  const report: RebakeReport = { revisions: rows.length, changed: [], failed: [], dryRun };
  const pngsToDelete: string[] = [];

  db.transaction(() => {
    const writeRev = db.prepare("UPDATE track_revisions SET rctrack_json = ?, png_path = ? WHERE track_id = ? AND revision = ?");
    for (const r of rows) {
      const old = JSON.parse(r.rctrack_json) as RcTrack;
      let fresh: RcTrack;
      try {
        fresh = bake(old);
      } catch (e) {
        report.failed.push({ id: r.track_id, revision: r.revision, error: (e as Error).message });
        continue;
      }
      const json = JSON.stringify(fresh);
      const before = JSON.stringify({ ...old.built, generator: "" });
      const after = JSON.stringify({ ...fresh.built, generator: "" });
      if (before === after) continue;
      const previewChanged = !old.built || previewSvg(old) !== previewSvg(fresh);
      report.changed.push({
        id: r.track_id,
        name: fresh.info.name,
        revision: r.revision,
        corners: [old.built?.stats.corners ?? 0, fresh.built!.stats.corners],
        size: [sizeText(old), sizeText(fresh)],
        previewChanged,
      });
      if (previewChanged && r.png_path) pngsToDelete.push(r.png_path);
      if (!dryRun) writeRev.run(json, previewChanged ? null : r.png_path, r.track_id, r.revision);
    }
    if (dryRun) return;
    // summary columns come from each track's current revision
    const tracks = db.prepare("SELECT id, current_revision FROM tracks").all() as { id: string; current_revision: number }[];
    const getRev = db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck();
    const upd = db.prepare(
      `UPDATE tracks SET lap_length = @lap, corners = @corners, area_length = @al, area_width = @aw, footprint_w = @fpW, footprint_h = @fpH,
         size_length = @sizeL, size_width = @sizeW WHERE id = @id`,
    );
    for (const t of tracks) {
      const doc = JSON.parse(getRev.get(t.id, t.current_revision) as string) as RcTrack;
      if (doc.built) upd.run({ id: t.id, ...builtColumns(doc) });
    }
    // fit results come from the engine too; they're cheap to recompute
    db.prepare("DELETE FROM fit_cache").run();
  })();

  if (!dryRun) for (const p of pngsToDelete) rmSync(join(dataDir, p), { force: true });
  return report;
}

if (process.argv[1] && /rebake\.(ts|js)$/.test(process.argv[1])) {
  loadDotenv({ path: join(ROOT_DIR, ".env"), quiet: true });
  try {
    const config = loadConfig();
    const dryRun = process.argv.includes("--dry-run");
    const db = openDb(config.dataDir);
    const r = rebakeAll(db, config.dataDir, { dryRun });
    console.log(`${dryRun ? "[dry run] " : ""}Re-baked ${r.revisions} revisions in ${config.dataDir}: ${r.changed.length} changed.`);
    for (const c of r.changed) {
      const corners = c.corners[0] === c.corners[1] ? `${c.corners[1]} corners` : `corners ${c.corners[0]} → ${c.corners[1]}`;
      const size = c.size[0] === c.size[1] ? `size ${c.size[1]}` : `size ${c.size[0]} → ${c.size[1]}`;
      console.log(`  ${c.name} r${c.revision}: ${corners}, ${size}${c.previewChanged ? ", preview re-rendered" : ""}`);
    }
    for (const f of r.failed) console.log(`  FAILED ${f.id} r${f.revision}: ${f.error}`);
    if (r.changed.some((c) => c.previewChanged)) {
      console.log("Note: changed previews keep their URLs; browsers and the forum may show cached copies for a while.");
    }
    db.close();
    process.exit(r.failed.length ? 1 : 0);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
