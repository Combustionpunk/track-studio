// SQLite (better-sqlite3) + numbered SQL migrations from apps/server/migrations, applied at startup.
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

/** apps/server/migrations (src/ and the bundled dist/ are both one level below apps/server) */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export function openDb(dataDir: string, file = "track-studio.sqlite"): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, file));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB, dir = MIGRATIONS_DIR): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT version FROM schema_migrations").pluck().all() as number[]);
  const files = readdirSync(dir)
    .map((f) => ({ f, m: /^(\d+)_.+\.sql$/.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({ f, version: Number(m[1]) }))
    .sort((a, b) => a.version - b.version);
  const applied: number[] = [];
  for (const { f, version } of files) {
    if (done.has(version)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    })();
    applied.push(version);
  }
  return applied;
}
