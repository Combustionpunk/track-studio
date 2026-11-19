// pnpm rebake [--dry-run]: one-off refresh of every stored revision's `built` with the current engine.
// The design is untouched, so revisions keep their numbers (and approvals stay pinned); only derived data changes.
// Revisions from before rctrack 1.7 are upgraded too: obstacles, the rostrums and the venue checks are dropped and
// basedOn becomes info.drawnFor.
import { bake, type FitResult, type RcTrack, type RcVenue } from "@track-studio/engine";
import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { ConfigError, loadConfig, ROOT_DIR } from "./config.js";
import { openDb, type DB } from "./db.js";
import { drawPreview } from "./drawing.js";
import { sweepPreviews } from "./previews.js";
import { builtColumns, computeFit, publicRevision, setRevisionColumns, upgradeStored, type CachedFit } from "./store.js";

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
  /** warnings before and after */
  warnings: [number, number];
  /** warning codes the fresh bake has and the stored one didn't (1.10: lane-squeeze) */
  gainedWarnings: string[];
  /** the drawn preview changed: it gets a new URL (?v=) and the old cached PNG is dropped */
  previewChanged: boolean;
}

/** A layout revision whose cached fit in a venue template differs from what this engine answers. */
export interface FitChange {
  id: string;
  name: string;
  revision: number;
  /** the orientations that fit: cached, then this engine's */
  orientations: [string[], string[]];
  /** orientations that fit both times but sit elsewhere (shift or spare differs by more than 1 mm) */
  moved: string[];
  /** errors when the layout is checked where it is drawn (outside-area, obstacle); null for a pre-1.7 cache row, which has none */
  asDrawnErrors: [number, number] | null;
  /** as-drawn error codes this engine gives and the cached answer didn't */
  asDrawnGained: string[];
}

/**
 * The fit search reads the design and the engine's lane mask, not the stored footprint, so the only "before" there is
 * is the fit cache: answers the previous engine gave since the last rebake. For each layout's public revision (the one
 * the library and fit search use), a cached answer for the venue template's current revision is compared with this
 * engine's; a layout nobody fitted there has nothing to compare (`notCached`). compared + notCached = layouts.
 */
export interface VenueFits {
  id: string;
  name: string;
  revision: number;
  /** layouts whose public revision has a cached answer for this venue revision, compared */
  compared: number;
  changed: FitChange[];
  /** layouts whose public revision has no cached answer for this venue revision */
  notCached: number;
  /** cached answers this engine couldn't recompute (they are still counted as compared) */
  failed: { id: string; revision: number; error: string }[];
}

export interface RebakeReport {
  revisions: number;
  changed: RebakeChange[];
  /** fit changes per venue template, ordered by name (#160) */
  fits: VenueFits[];
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

const codesAt = (doc: RcTrack, level: "error" | "warning") => (doc.built?.checks ?? []).filter((c) => c.level === level).map((c) => c.code as string);
const errorCodes = (doc: RcTrack) => codesAt(doc, "error");
const warningCodes = (doc: RcTrack) => codesAt(doc, "warning");
const newCodes = (before: string[], after: string[]) => [...new Set(after)].filter((c) => !before.includes(c));

const sizeText = (doc: RcTrack) => (doc.built?.size ? `${doc.built.size.length} × ${doc.built.size.width} m` : "—");

const asDrawnErrorCodes = (a: CachedFit["asDrawn"]) => a.checks.filter((c) => c.level === "error").map((c) => c.code as string).sort();
const sitsElsewhere = (a: FitResult, b: FitResult) =>
  [0, 1].some((i) => Math.abs(a.shift[i] - b.shift[i]) > 0.001 || Math.abs(a.spare[i] - b.spare[i]) > 0.001);

/** Compare one cached fit answer with this engine's; null when they agree. */
function fitChange(cached: CachedFit | FitResult[], now: CachedFit): Omit<FitChange, "id" | "name" | "revision"> | null {
  const old = Array.isArray(cached) ? { results: cached, asDrawn: null } : cached; // (a bare array: a cache row from before 1.7)
  const moved = old.results.filter((o) => {
    const n = now.results.find((r) => r.orientation === o.orientation);
    return n && sitsElsewhere(o, n);
  });
  const orientations: [string[], string[]] = [old.results.map((r) => r.orientation), now.results.map((r) => r.orientation)];
  const codes = old.asDrawn ? [asDrawnErrorCodes(old.asDrawn), asDrawnErrorCodes(now.asDrawn)] : null;
  const same = orientations[0].join("|") === orientations[1].join("|") && !moved.length && (!codes || codes[0].join("|") === codes[1].join("|"));
  if (same) return null;
  return {
    orientations,
    moved: moved.map((r) => r.orientation),
    asDrawnErrors: codes ? [codes[0].length, codes[1].length] : null,
    asDrawnGained: codes ? newCodes(codes[0], codes[1]) : [],
  };
}

/** Cached fit answers, per venue template, compared with this engine's (read-only). */
export function fitReport(db: DB): VenueFits[] {
  const venues = db.prepare("SELECT id, name, current_revision FROM venues ORDER BY name, id").all() as { id: string; name: string; current_revision: number }[];
  const tracks = db.prepare("SELECT id, current_revision, approved_revision FROM tracks ORDER BY id").all() as { id: string; current_revision: number; approved_revision: number | null }[];
  const getVenue = db.prepare("SELECT rcvenue_json FROM venue_revisions WHERE venue_id = ? AND revision = ?").pluck();
  const getRev = db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck();
  const cached = db.prepare("SELECT results_json FROM fit_cache WHERE track_id = ? AND track_revision = ? AND venue_id = ? AND venue_revision = ?").pluck();
  const out: VenueFits[] = [];
  for (const v of venues) {
    const report: VenueFits = { id: v.id, name: v.name, revision: v.current_revision, compared: 0, changed: [], notCached: 0, failed: [] };
    out.push(report);
    const venueJson = getVenue.get(v.id, v.current_revision) as string | undefined;
    for (const t of tracks) {
      const revision = publicRevision(t);
      const row = cached.get(t.id, revision, v.id, v.current_revision) as string | undefined;
      if (!row) {
        report.notCached++;
        continue;
      }
      report.compared++;
      try {
        if (!venueJson) throw new Error(`venue revision ${v.current_revision} is missing`);
        const json = getRev.get(t.id, revision) as string | undefined;
        if (!json) throw new Error("track revision is missing");
        const track = upgradeStored(db, JSON.parse(json) as RcTrack);
        const change = fitChange(JSON.parse(row) as CachedFit | FitResult[], computeFit(track, JSON.parse(venueJson) as RcVenue));
        if (change) report.changed.push({ id: t.id, name: track.info.name, revision, ...change });
      } catch (e) {
        report.failed.push({ id: t.id, revision, error: (e as Error).message });
      }
    }
  }
  return out;
}

export function rebakeAll(db: DB, dataDir: string, { dryRun = false } = {}): RebakeReport {
  const rows = db.prepare("SELECT track_id, revision, rctrack_json FROM track_revisions ORDER BY track_id, revision").all() as {
    track_id: string;
    revision: number;
    rctrack_json: string;
  }[];
  // before the rebake clears the fit cache: the cache is the only record of what the previous engine answered
  const report: RebakeReport = { revisions: rows.length, changed: [], fits: fitReport(db), failed: [], dryRun };

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
        gained: newCodes(errorCodes(old), errorCodes(fresh)),
        warnings: [warningCodes(old).length, warningCodes(fresh).length],
        gainedWarnings: newCodes(warningCodes(old), warningCodes(fresh)),
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
 * The warnings part does the same for warnings (#102: "errors 3 → 0, warnings 0 → 1 (new: lane-squeeze)").
 */
export function changeLine(c: RebakeChange): string {
  const corners = c.corners[0] === c.corners[1] ? `${c.corners[1]} corners` : `corners ${c.corners[0]} → ${c.corners[1]}`;
  const size = c.size[0] === c.size[1] ? `size ${c.size[1]}` : `size ${c.size[0]} → ${c.size[1]}`;
  const removed = c.removed.length ? `, removed ${c.removed.join(", ")}` : "";
  const line = c.racingLineChanged ? ", RACING LINE CHANGED" : "";
  const errors = c.errors[0] === c.errors[1] && !c.gained.length ? "" : `, errors ${c.errors[0]} → ${c.errors[1]}${c.gained.length ? ` (new: ${c.gained.join(", ")})` : ""}`;
  const warnings = c.warnings[0] === c.warnings[1] && !c.gainedWarnings.length ? "" : `, warnings ${c.warnings[0]} → ${c.warnings[1]}${c.gainedWarnings.length ? ` (new: ${c.gainedWarnings.join(", ")})` : ""}`;
  return `  ${c.name} r${c.revision}: ${corners}, ${size}${removed}${line}${errors}${warnings}${c.previewChanged ? ", preview re-rendered" : ""}`;
}

/**
 * The fit part of the report (#160): one line per venue template, then one per layout revision that fits differently
 * ("fits 2 → 4 (new: ...)", "moved: ...", "as drawn errors 1 → 0"), and one per cached answer that couldn't be recomputed.
 */
export function fitLines(venues: VenueFits[]): string[] {
  if (!venues.length) return ["Fits: no venue templates."];
  const lines = ["Fits (each layout's cached answer, from the engine that answered it, compared with this engine's):"];
  for (const v of venues) {
    const notCached = v.notCached ? `, ${v.notCached} layout${v.notCached === 1 ? "" : "s"} not cached (no earlier answer to compare)` : "";
    lines.push(`  ${v.name} r${v.revision}: ${v.compared} compared, ${v.changed.length} changed${notCached}`);
    for (const c of v.changed) {
      const [was, now] = c.orientations;
      const gained = now.filter((o) => !was.includes(o)), lost = was.filter((o) => !now.includes(o));
      const count = was.length === now.length && !gained.length ? `fits ${now.length}` : `fits ${was.length} → ${now.length}`;
      const parts = [
        count + (gained.length ? ` (new: ${gained.join(", ")})` : "") + (lost.length ? ` (lost: ${lost.join(", ")})` : ""),
        ...(c.moved.length ? [`moved: ${c.moved.join(", ")}`] : []),
        ...(c.asDrawnErrors && (c.asDrawnErrors[0] !== c.asDrawnErrors[1] || c.asDrawnGained.length)
          ? [`as drawn errors ${c.asDrawnErrors[0]} → ${c.asDrawnErrors[1]}${c.asDrawnGained.length ? ` (new: ${c.asDrawnGained.join(", ")})` : ""}`]
          : []),
      ];
      lines.push(`    ${c.name} r${c.revision}: ${parts.join(", ")}`);
    }
    for (const f of v.failed) lines.push(`    FIT FAILED ${f.id} r${f.revision}: ${f.error}`);
  }
  return lines;
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
    for (const l of fitLines(r.fits)) console.log(l);
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
