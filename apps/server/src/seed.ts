// pnpm seed: import reference/venues/* and reference/examples/* (as approved tracks by the "system" user).
// Safe to run again: anything already present is skipped.
import { config as loadDotenv } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getUser } from "./auth.js";
import { ConfigError, loadConfig, ROOT_DIR, type Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { createTrack, createVenue } from "./store.js";

export const SYSTEM_USER_ID = 0;

export function seed(db: DB, config: Config, referenceDir = join(ROOT_DIR, "reference"), log: (s: string) => void = console.log) {
  const system = getUser(db, SYSTEM_USER_ID, config.organiserGroup);
  if (!system) throw new Error("system user missing (migration 001)");
  const read = (dir: string, suffix: string) =>
    readdirSync(join(referenceDir, dir))
      .filter((f) => f.endsWith(suffix))
      .sort()
      .map((f) => ({ f, doc: JSON.parse(readFileSync(join(referenceDir, dir, f), "utf8")) as Record<string, unknown> }));
  let added = 0;
  for (const { f, doc } of read("venues", ".rcvenue.json")) {
    if (db.prepare("SELECT 1 FROM venues WHERE id = ?").get(doc.id)) { log(`  venue ${f}: already there`); continue; }
    createVenue(db, system, doc, { legacy: true }); // the fixtures are rcvenue 1.0: no forum track
    log(`  venue ${f}: added`);
    added++;
  }
  // tracks based on a venue template need the venue first; venues are imported above
  for (const { f, doc: file } of read("examples", ".rctrack.json")) {
    if (db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(file.id)) { log(`  track ${f}: already there`); continue; }
    const doc = withoutUntidyCones(file);
    createTrack(db, system, doc, { keepId: true, status: "approved", approve: true });
    log(`  track ${f}: added (approved)${doc === file ? "" : "; its cones left out (they carry a deliberate error, for the tests)"}`);
    added++;
  }
  return added;
}

/**
 * An example whose cones carry an error (freeform-example's untidy set has a cone on the track, #151) without them, so
 * a fresh install never shows an approved layout with an error (#157); the reference file keeps them for the check
 * tests. Judged from the file's stored bake; the save re-bakes it. Other examples come back as they are.
 */
export function withoutUntidyCones(doc: Record<string, unknown>): Record<string, unknown> {
  const built = doc.built as { checks?: { level?: string; code?: string }[] } | undefined;
  const untidy = built?.checks?.some((c) => c.level === "error" && c.code?.startsWith("marshal-"));
  const design = doc.design as { marshals?: unknown } | undefined;
  if (!untidy || !design?.marshals) return doc;
  const { marshals: _m, ...rest } = design;
  return { ...doc, design: rest };
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  loadDotenv({ path: join(ROOT_DIR, ".env"), quiet: true });
  try {
    const config = loadConfig();
    const db = openDb(config.dataDir);
    console.log(`Seeding ${config.dataDir}`);
    const n = seed(db, config);
    console.log(`Done: ${n} added.`);
    db.close();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
