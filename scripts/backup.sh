#!/usr/bin/env bash
# Dump the PostgreSQL database to ./backups/tracker-<timestamp>.sql.gz
#
# Usage:
#   bash scripts/backup.sh
#
# Environment overrides: POSTGRES_USER, POSTGRES_DB, BACKUP_DIR
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-tracker}"
POSTGRES_DB="${POSTGRES_DB:-tracker}"
BACKUP_DIR="${BACKUP_DIR:-backups}"

# Prefer values from .env when present, without echoing secrets.
if [[ -f .env ]]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2- || true)"
  POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2- || true)"
  POSTGRES_USER="${POSTGRES_USER:-tracker}"
  POSTGRES_DB="${POSTGRES_DB:-tracker}"
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/tracker-$stamp.sql.gz"

echo "Backing up database '$POSTGRES_DB' as user '$POSTGRES_USER'…"
# -T disables TTY allocation so the dump can be piped.
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$target"

if [[ ! -s "$target" ]]; then
  echo "Backup failed: $target is empty" >&2
  rm -f "$target"
  exit 1
fi

echo "Wrote $target ($(du -h "$target" | cut -f1))"
echo "Copy it off-host: a backup on the same disk does not survive disk failure."
