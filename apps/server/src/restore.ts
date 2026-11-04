// node dist/restore.js --list | latest | <key> [--force]   (stop the server first; see docs/deploy.md)
import { cli, listBackups, loadBackupConfig, restoreBackup } from "./backup.js";

void cli(async () => {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const which = args.find((a) => !a.startsWith("--"));
  const cfg = loadBackupConfig();
  if (args.includes("--list") || !which) {
    const keys = await listBackups(cfg);
    if (!which && !args.includes("--list")) console.log("Usage: restore.js --list | latest | <key> [--force]\n");
    console.log(keys.length ? keys.join("\n") : `No backups in ${cfg.s3!.bucket}/${cfg.prefix}`);
    return;
  }
  const r = await restoreBackup(cfg, which, { force });
  console.log(`Restored ${r.key} to ${r.file}`);
  if (r.previous) console.log(`The database it replaced is kept as ${r.previous}`);
});
