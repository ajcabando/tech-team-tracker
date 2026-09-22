#!/usr/bin/env bash
# Restore the database from a .sql.gz dump produced by scripts/backup.sh
#
# Usage:
#   bash scripts/restore.sh backups/tracker-20260921-031500.sql.gz
#
# WARNING: this drops and recreates the current schema. Confirm the file name first.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

dump="$1"
if [[ ! -f "$dump" ]]; then
  echo "Backup file not found: $dump" >&2
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-tracker}"
POSTGRES_DB="${POSTGRES_DB:-tracker}"
if [[ -f .env ]]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2- || true)"
  POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2- || true)"
  POSTGRES_USER="${POSTGRES_USER:-tracker}"
  POSTGRES_DB="${POSTGRES_DB:-tracker}"
fi

echo "This will REPLACE all data in database '$POSTGRES_DB'."
read -r -p "Type 'restore' to continue: " confirmation
if [[ "$confirmation" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

echo "Stopping backend so nothing writes during the restore…"
docker compose stop backend

echo "Recreating schema…"
docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "Restoring $dump…"
gunzip -c "$dump" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

echo "Starting backend…"
docker compose start backend

echo "Restore complete. Verify:"
echo "  curl -fsS http://localhost:5789/health"
echo "  docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c 'select count(*) from \"Location\";'"
