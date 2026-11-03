import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupKey, loadBackupConfig, restoreBackup, runBackup, type BackupConfig } from "../src/backup.js";
import { ConfigError } from "../src/config.js";
import { openDb } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { startS3Stub } from "./s3-stub.js";

const CREDS = { bucket: "rcmisfits-backups", accessKey: "test-access-key", secretKey: "test-secret-key-0123456789", region: "ams3" };
const NOW = new Date("2026-11-03T03:15:00Z");

let stub: Awaited<ReturnType<typeof startS3Stub>>;
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "track-studio-backup-"));
  dirs.push(d);
  return d;
};
beforeEach(async () => {
  stub = await startS3Stub(CREDS);
});
afterEach(async () => {
  await stub.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const cfgFor = (dataDir: string, over: Partial<BackupConfig> = {}): BackupConfig => ({
  dataDir,
  dbFile: "track-studio.sqlite",
  prefix: "track-studio/nightly/",
  keep: 14,
  s3: { endpoint: stub.endpoint, region: CREDS.region, bucket: CREDS.bucket, accessKey: CREDS.accessKey, secretKey: CREDS.secretKey },
  ...over,
});

/** Open a gzipped snapshot from the stub as a database. */
function openSnapshot(gz: Buffer) {
  const file = join(tempDir(), "snap.sqlite");
  writeFileSync(file, gunzipSync(gz));
  return new Database(file, { readonly: true });
}

describe("backup config", () => {
  const env = { DATA_DIR: "/data", SPACES_ENDPOINT: "https://ams3.digitaloceanspaces.com", SPACES_BUCKET: "b", SPACES_KEY: "k", SPACES_SECRET: "super-secret-value" };

  it("reads the Spaces settings, taking the region from the endpoint and keeping 14 by default", () => {
    const c = loadBackupConfig(env);
    expect(c.s3).toEqual({ endpoint: "https://ams3.digitaloceanspaces.com", region: "ams3", bucket: "b", accessKey: "k", secretKey: "super-secret-value" });
    expect(c.keep).toBe(14);
    expect(c.prefix).toBe("track-studio/nightly/");
    expect(c.dataDir).toBe("/data");
    expect(loadBackupConfig({ ...env, SPACES_REGION: "us-east-1", BACKUP_KEEP: "7", BACKUP_PREFIX: "x" }).s3.region).toBe("us-east-1");
    expect(loadBackupConfig({ ...env, BACKUP_PREFIX: "x" }).prefix).toBe("x/");
  });

  it("names every missing setting and never prints a secret", () => {
    expect(() => loadBackupConfig({ DATA_DIR: "/data" })).toThrow(ConfigError);
    try {
      loadBackupConfig({ ...env, SPACES_BUCKET: "", SPACES_KEY: "", BACKUP_KEEP: "0" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("SPACES_BUCKET");
      expect(msg).toContain("SPACES_KEY");
      expect(msg).toContain("BACKUP_KEEP");
      expect(msg).not.toContain("super-secret-value");
    }
  });

  it("dry run needs no Spaces settings", () => {
    expect(loadBackupConfig({ DATA_DIR: "/data" }, { dryRun: true }).s3).toBeNull();
  });
});

describe("nightly backup", () => {
  it("uploads a consistent online snapshot, including writes still in the WAL of the running server", async () => {
    const { app, config } = await makeApp({ seeded: true });
    const tracks = app.db.prepare("SELECT count(*) FROM tracks").pluck().get() as number;
    expect(tracks).toBeGreaterThan(0);
    // the running server's last write is still only in the write-ahead log: a raw copy of the .sqlite file would miss it
    app.db.pragma("wal_autocheckpoint = 0");
    app.db.prepare("UPDATE tracks SET name = 'Only in the WAL' WHERE id = (SELECT id FROM tracks LIMIT 1)").run();
    expect(statSync(join(config.dataDir, "track-studio.sqlite-wal")).size).toBeGreaterThan(0);

    const r = await runBackup(cfgFor(config.dataDir), { now: NOW });
    expect(r.key).toBe("track-studio/nightly/track-studio-20261103T031500Z.sqlite.gz");
    expect(r.uploaded).toBe(true);
    const snap = openSnapshot(stub.objects.get(r.key)!);
    expect(snap.prepare("SELECT count(*) FROM tracks").pluck().get()).toBe(tracks);
    expect(snap.prepare("SELECT count(*) FROM tracks WHERE name = 'Only in the WAL'").pluck().get()).toBe(1);
    expect(snap.pragma("integrity_check", { simple: true })).toBe("ok");
    snap.close();
    // the server keeps working and no temporary files are left in DATA_DIR
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect(readdirSync(config.dataDir).filter((f) => f.includes("backup"))).toEqual([]);
  });

  it("keeps the 14 newest nightlies and leaves other objects alone", async () => {
    const dataDir = tempDir();
    openDb(dataDir).close();
    for (let d = 1; d <= 16; d++) stub.objects.set(backupKey("track-studio/nightly/", new Date(Date.UTC(2026, 9, d, 3, 15))), gzipSync("old"));
    stub.objects.set("track-studio/nightly/notes.txt", Buffer.from("keep me"));
    stub.objects.set("elsewhere/track-studio-20200101T000000Z.sqlite.gz", Buffer.from("not ours"));

    const r = await runBackup(cfgFor(dataDir), { now: NOW });
    const ours = [...stub.objects.keys()].filter((k) => /^track-studio\/nightly\/track-studio-.*\.sqlite\.gz$/.test(k)).sort();
    expect(ours).toHaveLength(14);
    expect(ours.at(-1)).toBe(r.key);
    expect(ours[0]).toBe(backupKey("track-studio/nightly/", new Date(Date.UTC(2026, 9, 4, 3, 15))));
    expect(r.deleted).toHaveLength(3);
    expect(stub.objects.has("track-studio/nightly/notes.txt")).toBe(true);
    expect(stub.objects.has("elsewhere/track-studio-20200101T000000Z.sqlite.gz")).toBe(true);
  });

  it("dry run checks the snapshot and reports what it would do, without changing Spaces", async () => {
    const dataDir = tempDir();
    openDb(dataDir).close();
    for (let d = 1; d <= 15; d++) stub.objects.set(backupKey("track-studio/nightly/", new Date(Date.UTC(2026, 9, d))), gzipSync("old"));

    const r = await runBackup(cfgFor(dataDir), { now: NOW, dryRun: true });
    expect(r.uploaded).toBe(false);
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.deleted).toHaveLength(2); // would delete
    expect(stub.objects.size).toBe(15);
    expect(stub.requests.filter((q) => q.method !== "GET")).toEqual([]);
    // and with no Spaces settings at all, it only makes and checks the snapshot
    const offline = await runBackup({ ...cfgFor(dataDir), s3: null }, { now: NOW, dryRun: true });
    expect(offline).toMatchObject({ uploaded: false, deleted: [] });
  });

  it("fails without deleting anything when the upload is refused", async () => {
    const dataDir = tempDir();
    openDb(dataDir).close();
    for (let d = 1; d <= 15; d++) stub.objects.set(backupKey("track-studio/nightly/", new Date(Date.UTC(2026, 9, d))), gzipSync("old"));
    const wrong = cfgFor(dataDir);
    wrong.s3 = { ...wrong.s3!, secretKey: "wrong-secret" };
    await expect(runBackup(wrong, { now: NOW })).rejects.toThrow(/403/);
    expect(stub.objects.size).toBe(15);
  });

  it("fails when there is no database to back up", async () => {
    await expect(runBackup(cfgFor(tempDir()), { now: NOW })).rejects.toThrow(/no database/i);
  });
});

describe("restore", () => {
  it("round trip: restores the latest backup into an empty DATA_DIR and the app serves it", async () => {
    const { app, config } = await makeApp({ seeded: true });
    const tracks = (await app.inject({ method: "GET", url: "/api/tracks" })).json();
    await runBackup(cfgFor(config.dataDir), { now: new Date("2026-11-01T03:15:00Z") });
    await runBackup(cfgFor(config.dataDir), { now: NOW });

    const fresh = tempDir();
    const r = await restoreBackup(cfgFor(fresh), "latest");
    expect(r.key).toBe("track-studio/nightly/track-studio-20261103T031500Z.sqlite.gz");
    expect(r.previous).toBeNull();
    const { app: restored } = await makeApp({ config: { dataDir: fresh } });
    expect((await restored.inject({ method: "GET", url: "/api/tracks" })).json()).toEqual(tracks);
  });

  it("restores a named backup and keeps the database it replaces", async () => {
    const source = tempDir();
    const db = openDb(source);
    db.prepare("CREATE TABLE marker (v TEXT)").run();
    db.prepare("INSERT INTO marker VALUES ('from the backup')").run();
    db.close();
    const { key } = await runBackup(cfgFor(source), { now: NOW });

    const target = tempDir();
    openDb(target).close();
    const before = readFileSync(join(target, "track-studio.sqlite"));
    const r = await restoreBackup(cfgFor(target), key, { now: new Date("2026-11-04T09:00:00Z") });
    expect(r.previous).toBe(join(target, "track-studio.sqlite.before-restore-20261104T090000Z"));
    expect(readFileSync(r.previous!)).toEqual(before);
    const out = new Database(join(target, "track-studio.sqlite"), { readonly: true });
    expect(out.prepare("SELECT v FROM marker").pluck().get()).toBe("from the backup");
    out.close();
  });

  it("refuses while the server looks like it's running (a -wal file exists), unless forced", async () => {
    const { config } = await makeApp({ seeded: true }); // open, so the WAL exists
    const { key } = await runBackup(cfgFor(config.dataDir), { now: NOW });
    await expect(restoreBackup(cfgFor(config.dataDir), key)).rejects.toThrow(/stop the server/i);
  });

  it("leaves the current database alone when the download isn't a good SQLite file", async () => {
    const target = tempDir();
    openDb(target).close();
    const before = readFileSync(join(target, "track-studio.sqlite"));
    const key = backupKey("track-studio/nightly/", NOW);
    stub.objects.set(key, gzipSync("this is not a database"));
    await expect(restoreBackup(cfgFor(target), key)).rejects.toThrow(/not a usable SQLite/i);
    expect(readFileSync(join(target, "track-studio.sqlite"))).toEqual(before);
    expect(readdirSync(target).sort()).toEqual(["track-studio.sqlite"]);
  });

  it("says so when there is nothing to restore", async () => {
    const target = tempDir();
    await expect(restoreBackup(cfgFor(target), "latest")).rejects.toThrow(/no backups/i);
    expect(existsSync(join(target, "track-studio.sqlite"))).toBe(false);
  });
});
