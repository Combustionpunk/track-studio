// pnpm rebake [--dry-run]: one-off refresh of every stored revision's `built` with the current engine.
// The design is untouched, so revisions keep their numbers (and approvals stay pinned); only derived data changes.
// Revisions from before rctrack 1.7 are upgraded too: obstacles, the rostrums and the venue checks are dropped and
// basedOn becomes info.drawnFor.
import { bake, type RcTrack } from "@track-studio/engine";
import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { ConfigError, loadConfig, ROOT_DIR } from "./config.js";
import { openDb, type DB } from "./db.js";
import { drawPreview } from "./drawing.js";
import { sweepPreviews } from "./previews.js";
import { builtColumns, setRevisionColumns, upgradeStored } from "./store.js";

export interface RebakeChange {
  id: string;
  name: string;
  revision: number;
  corners: [number, number];
  size: [string, string];
  /** the racing line moved (by more than 1 mm anywhere, or a different number of points) */
  racingLineChanged: boolean;
  /** fields removed from the stored document by the rctrack 1.7 upgrade (obstacles, basedOn, design/built rostrum) */
  removed: string[];
  /** errors before and after (the library's error count) */
  errors: [number, number];
  /** error codes the fresh bake has and the stored one didn't (1.9: lane-overlap) */
  gained: string[];
  /** the drawn preview changed: it gets a new URL (?v=) and the old cached PNG is dropped */
  previewChanged: boolean;
}

export interface RebakeReport {
  revisions: number;
  changed: RebakeChange[];
  failed: { id: string; revision: number; error: string }[];
  dryRun: boolean;
}

const racingLineMoved = (a: RcTrack, b: RcTrack) => {
  const p = a.built?.racingLine ?? [], q = b.built?.racingLine ?? [];
  return p.length !== q.length || p.some((v, i) => Math.hypot(v[0] - q[i][0], v[1] - q[i][1]) > 0.001 || Math.abs(v[2] - q[i][2]) > 0.001);
};

/** What the 1.7 upgrade takes out of a stored document. */
function removedFields(old: RcTrack): string[] {
  const o = old as RcTrack & { basedOn?: unknown; obstacles?: unknown; design: { rostrum?: unknown }; built?: { rostrum?: unknown } };
  return [
    ...("obstacles" in o ? ["obstacles"] : []),
    ...("basedOn" in o ? ["basedOn"] : []),
    ...("rostrum" in o.design ? ["design.rostrum"] : []),
    ...(o.built && "rostrum" in o.built ? ["built.rostrum"] : []),
  ];
}

const errorCodes = (doc: RcTrack) => (doc.built?.checks ?? []).filter((c) => c.level === "error").map((c) => c.code as string);

const sizeText = (doc: RcTrack) => (doc.built?.size ? `${doc.built.size.length} × ${doc.built.size.width} m` : "—");

export function rebakeAll(db: DB, dataDir: string, { dryRun = false } = {}): RebakeReport {
  const rows = db.prepare("SELECT track_id, revision, rctrack_json FROM track_revisions ORDER BY track_id, revision").all() as {
    track_id: string;
    revision: number;
    rctrack_json: string;
  }[];
  const report: RebakeReport = { revisions: rows.length, changed: [], failed: [], dryRun };

  db.transaction(() => {
    const writeRev = db.prepare("UPDATE track_revisions SET rctrack_json = ? WHERE track_id = ? AND revision = ?");
    for (const r of rows) {
      const old = JSON.parse(r.rctrack_json) as RcTrack;
      let fresh: RcTrack;
      try {
        fresh = bake(upgradeStored(db, old));
      } catch (e) {
        report.failed.push({ id: r.track_id, revision: r.revision, error: (e as Error).message });
        continue;
      }
      const json = JSON.stringify(fresh);
      const generatorless = (d: RcTrack) => JSON.stringify({ ...d, built: { ...d.built, generator: "" } });
      if (generatorless(old) === generatorless(fresh)) continue;
      const previewChanged = !old.built || drawPreview(old) !== drawPreview(fresh);
      report.changed.push({
        id: r.track_id,
        name: fresh.info.name,
        revision: r.revision,
        corners: [old.built?.stats.corners ?? 0, fresh.built!.stats.corners],
        size: [sizeText(old), sizeText(fresh)],
        racingLineChanged: racingLineMoved(old, fresh),
        removed: removedFields(old),
        errors: [errorCodes(old).length, errorCodes(fresh).length],
        gained: [...new Set(errorCodes(fresh))].filter((c) => !errorCodes(old).includes(c)),
        previewChanged,
      });
      if (!dryRun) {
        writeRev.run(json, r.track_id, r.revision);
        setRevisionColumns(db, r.track_id, r.revision, fresh); // new preview hash -> new image URL
      }
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

  // cached pictures whose drawing changed are no longer referenced by any URL
  if (!dryRun) for (const id of new Set(report.changed.map((c) => c.id))) sweepPreviews(db, dataDir, id);
  return report;
}

/**
 * One report line per changed revision. The errors part prints when the count changes or when the fresh bake has
 * error codes the stored one didn't (#100): a track swapping one error for another shows "errors 1 → 1 (new: ...)".
 */
export function changeLine(c: RebakeChange): string {
  const corners = c.corners[0] === c.corners[1] ? `${c.corners[1]} corners` : `corners ${c.corners[0]} → ${c.corners[1]}`;
  const size = c.size[0] === c.size[1] ? `size ${c.size[1]}` : `size ${c.size[0]} → ${c.size[1]}`;
  const removed = c.removed.length ? `, removed ${c.removed.join(", ")}` : "";
  const line = c.racingLineChanged ? ", RACING LINE CHANGED" : "";
  const errors = c.errors[0] === c.errors[1] && !c.gained.length ? "" : `, errors ${c.errors[0]} → ${c.errors[1]}${c.gained.length ? ` (new: ${c.gained.join(", ")})` : ""}`;
  return `  ${c.name} r${c.revision}: ${corners}, ${size}${removed}${line}${errors}${c.previewChanged ? ", preview re-rendered" : ""}`;
}

if (process.argv[1] && /rebake\.(ts|js)$/.test(process.argv[1])) {
  loadDotenv({ path: join(ROOT_DIR, ".env"), quiet: true });
  try {
    const config = loadConfig();
    const dryRun = process.argv.includes("--dry-run");
    const db = openDb(config.dataDir);
    const r = rebakeAll(db, config.dataDir, { dryRun });
    console.log(`${dryRun ? "[dry run] " : ""}Re-baked ${r.revisions} revisions in ${config.dataDir}: ${r.changed.length} changed.`);
    for (const c of r.changed) console.log(changeLine(c));
    for (const f of r.failed) console.log(`  FAILED ${f.id} r${f.revision}: ${f.error}`);
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
