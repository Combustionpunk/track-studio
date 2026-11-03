// Nightly backup of the SQLite database to DigitalOcean Spaces (any S3-compatible store), and restore.
//   node dist/backup.js [--dry-run]     (in the container: deploy/backup.sh, from cron)
//   node dist/restore.js --list | latest | <key> [--force]
// The snapshot uses SQLite's online backup API, so it is consistent while the server keeps running (a copy of the
// .sqlite file alone would miss whatever is still in the -wal file). Preview PNGs are a cache and aren't backed up.
import Database from "better-sqlite3";
import { config as loadDotenv } from "dotenv";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ConfigError, ROOT_DIR } from "./config.js";
import { S3Client, type S3Settings } from "./s3.js";

export interface BackupConfig {
  /** absolute */
  dataDir: string;
  dbFile: string;
  /** key prefix in the bucket, ends with "/" */
  prefix: string;
  /** how many nightlies to keep */
  keep: number;
  /** null only for a dry run without Spaces settings */
  s3: S3Settings | null;
}

export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env, { dryRun = false } = {}): BackupConfig {
  const problems: string[] = [];
  const get = (name: string) => env[name]?.trim() ?? "";
  const required = (name: string): string => {
    const v = get(name);
    if (!v) problems.push(`${name} is required`);
    return v;
  };
  const dataDir = required("DATA_DIR");
  const keep = Number(env.BACKUP_KEEP?.trim() || 14);
  if (!Number.isInteger(keep) || keep < 1) problems.push(`BACKUP_KEEP must be a whole number of at least 1 (got "${env.BACKUP_KEEP}")`);
  const prefix = (env.BACKUP_PREFIX?.trim() || "track-studio/nightly").replace(/^\/+|\/+$/g, "") + "/";

  let s3: S3Settings | null = null;
  const anyS3 = ["SPACES_ENDPOINT", "SPACES_BUCKET", "SPACES_KEY", "SPACES_SECRET"].some((n) => get(n));
  if (!dryRun || anyS3) {
    const endpoint = required("SPACES_ENDPOINT").replace(/\/+$/, "");
    if (endpoint && !/^https?:\/\/[^/]+$/.test(endpoint)) problems.push(`SPACES_ENDPOINT must be like https://ams3.digitaloceanspaces.com (got "${endpoint}")`);
    // Spaces signs with the region in the endpoint's host (ams3.digitaloceanspaces.com -> ams3)
    const fromHost = /^https?:\/\/([a-z0-9-]+)\.digitaloceanspaces\.com$/.exec(endpoint)?.[1];
    s3 = {
      endpoint,
      region: env.SPACES_REGION?.trim() || fromHost || "us-east-1",
      bucket: required("SPACES_BUCKET"),
      accessKey: required("SPACES_KEY"),
      secretKey: required("SPACES_SECRET"),
    };
  }
  if (problems.length) throw new ConfigError(`Invalid backup configuration:\n  - ${problems.join("\n  - ")}\nSee .env.example and docs/deploy.md.`);
  return { dataDir: isAbsolute(dataDir) ? dataDir : resolve(ROOT_DIR, dataDir), dbFile: "track-studio.sqlite", prefix, keep, s3 };
}

/** 2026-11-03T03:15:00Z -> 20261103T031500Z */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const backupKey = (prefix: string, at: Date) => `${prefix}track-studio-${stamp(at)}.sqlite.gz`;
const isBackupKey = (prefix: string, key: string) => key.startsWith(prefix) && /^track-studio-\d{8}T\d{6}Z\.sqlite\.gz$/.test(key.slice(prefix.length));

const removeDbFiles = (file: string) => {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true });
};

/** Throws unless `file` is a SQLite database that passes integrity_check and has our schema. */
function checkDb(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`integrity_check: ${String(result)}`);
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()) throw new Error("no schema_migrations table");
  } finally {
    db.close();
  }
}

/** A consistent, self-contained copy (rollback journal, not WAL) of the live database, checked. */
async function snapshot(src: string, dest: string) {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const out = new Database(dest);
  try {
    out.pragma("journal_mode = DELETE");
  } finally {
    out.close();
  }
  checkDb(dest);
}

const s3Client = (cfg: BackupConfig, fetchFn?: typeof fetch) => {
  if (!cfg.s3) throw new ConfigError("Spaces settings (SPACES_ENDPOINT, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET) are required");
  return new S3Client(cfg.s3, fetchFn);
};

export interface BackupReport {
  key: string;
  /** gzipped size */
  bytes: number;
  uploaded: boolean;
  /** old nightlies deleted (dry run: would be deleted) */
  deleted: string[];
  dryRun: boolean;
}

export async function runBackup(cfg: BackupConfig, { dryRun = false, now = new Date(), fetch: fetchFn }: { dryRun?: boolean; now?: Date; fetch?: typeof fetch } = {}): Promise<BackupReport> {
  const dbPath = join(cfg.dataDir, cfg.dbFile);
  if (!existsSync(dbPath)) throw new Error(`No database to back up at ${dbPath}`);
  const tmp = join(cfg.dataDir, `.backup-${stamp(now)}.sqlite`);
  let gz: Buffer;
  try {
    await snapshot(dbPath, tmp);
    gz = gzipSync(readFileSync(tmp));
  } finally {
    removeDbFiles(tmp);
  }
  const key = backupKey(cfg.prefix, now);
  if (!cfg.s3) return { key, bytes: gz.length, uploaded: false, deleted: [], dryRun };

  const client = s3Client(cfg, fetchFn);
  const existing = (await client.list(cfg.prefix)).filter((k) => isBackupKey(cfg.prefix, k));
  if (!dryRun) await client.put(key, gz);
  // keys sort by time; only prune once tonight's backup is safely up
  const all = [...new Set([...existing, key])].sort();
  const deleted = all.slice(0, Math.max(0, all.length - cfg.keep));
  if (!dryRun) for (const k of deleted) await client.delete(k);
  return { key, bytes: gz.length, uploaded: !dryRun, deleted, dryRun };
}

/** Backups in the bucket, oldest first. */
export async function listBackups(cfg: BackupConfig, { fetch: fetchFn }: { fetch?: typeof fetch } = {}): Promise<string[]> {
  return (await s3Client(cfg, fetchFn).list(cfg.prefix)).filter((k) => isBackupKey(cfg.prefix, k)).sort();
}

export interface RestoreReport {
  key: string;
  file: string;
  /** where the database it replaced was moved, or null if there wasn't one */
  previous: string | null;
}

/**
 * Download a backup (`"latest"` or a key), check it, and put it in place as DATA_DIR/track-studio.sqlite. The current
 * database is kept as track-studio.sqlite.before-restore-<time>. The server must be stopped.
 */
export async function restoreBackup(
  cfg: BackupConfig,
  which: string,
  { force = false, now = new Date(), fetch: fetchFn }: { force?: boolean; now?: Date; fetch?: typeof fetch } = {},
): Promise<RestoreReport> {
  const client = s3Client(cfg, fetchFn);
  let key = which;
  if (which === "latest") {
    const keys = await listBackups(cfg, { fetch: fetchFn });
    if (!keys.length) throw new Error(`No backups in ${cfg.s3!.bucket}/${cfg.prefix}`);
    key = keys.at(-1)!;
  }
  const dbPath = join(cfg.dataDir, cfg.dbFile);
  if (!force && existsSync(`${dbPath}-wal`)) {
    throw new Error(`${dbPath} looks in use (its -wal file exists): stop the server first (docker compose stop track-studio), or pass --force if it's already stopped`);
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  const gz = await client.get(key);
  const tmp = join(cfg.dataDir, `.restore-${stamp(now)}.sqlite`);
  try {
    writeFileSync(tmp, gunzipSync(gz));
    checkDb(tmp);
  } catch (e) {
    removeDbFiles(tmp);
    throw new Error(`${key} is not a usable SQLite backup (${(e as Error).message}); nothing was changed`);
  }
  let previous: string | null = null;
  if (existsSync(dbPath)) {
    previous = `${dbPath}.before-restore-${stamp(now)}`;
    renameSync(dbPath, previous);
    // a leftover WAL belongs to the old database: keep it with it, never let SQLite apply it to the restored one
    for (const ext of ["-wal", "-shm"]) if (existsSync(dbPath + ext)) renameSync(dbPath + ext, previous + ext);
  }
  renameSync(tmp, dbPath);
  return { key, file: dbPath, previous };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** Shared by the two CLIs: print config errors and failures without a stack trace (and never a secret). */
export async function cli(main: () => Promise<void>) {
  loadDotenv({ path: join(ROOT_DIR, ".env"), quiet: true });
  try {
    await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1] && /backup\.(ts|js)$/.test(process.argv[1])) {
  void cli(async () => {
    const dryRun = process.argv.includes("--dry-run");
    const cfg = loadBackupConfig(process.env, { dryRun });
    const r = await runBackup(cfg, { dryRun });
    const where = cfg.s3 ? `${cfg.s3.bucket}/${r.key}` : `(no Spaces settings) ${r.key}`;
    console.log(`${dryRun ? "[dry run] would upload" : "Uploaded"} ${kb(r.bytes)} snapshot of ${join(cfg.dataDir, cfg.dbFile)} to ${where}`);
    for (const k of r.deleted) console.log(`  ${dryRun ? "would delete" : "deleted"} ${k} (keeping ${cfg.keep})`);
  });
}
