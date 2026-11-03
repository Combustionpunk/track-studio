#!/usr/bin/env bash
# Nightly backup: SQLite online snapshot -> DigitalOcean Spaces, keeping BACKUP_KEEP (14). Run from cron on the droplet
# (docs/deploy.md); pass --dry-run to check the snapshot and see what it would upload and prune.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) backup"
docker compose -f docker-compose.prod.yml exec -T track-studio node dist/backup.js "$@"
