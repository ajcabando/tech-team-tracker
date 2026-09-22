# Backup and restore

GPS history is business-critical and cannot be regenerated. Back up regularly and **test a
restore** on a non-production host before you rely on it.

## What to back up

| Data | Lives in | Backup method |
| --- | --- | --- |
| All platform data (organizations, users, technicians, locations, trips, audit logs) | PostgreSQL in the `postgres_data` Docker volume | `pg_dump` (preferred) |
| Compose configuration and secrets | `.env` on the host | Encrypted off-host copy (never in git) |
| Android signing keystore | Your keystore file | Encrypted vault |

## Automated dump (recommended)

`scripts/backup.sh` runs `pg_dump` inside the `postgres` container and writes a gzipped file:

```bash
cd /opt/tracker
bash scripts/backup.sh
# ./backups/tracker-20260921-031500.sql.gz
```

Schedule it with cron:

```cron
# every day at 02:30, keep local copies for 30 days
30 2 * * * cd /opt/tracker && bash scripts/backup.sh >> /var/log/tracker-backup.log 2>&1
```

Keep copies **off the server** (S3, Backblaze, rsync to another host). A backup on the same disk
as the database does not survive disk failure. Example with `rclone`:

```bash
rclone copy /opt/tracker/backups remote:tracker-backups --max-age 24h
```

## Manual dump

```bash
docker compose exec -T postgres pg_dump -U tracker -d tracker --format=custom \
  | gzip > tracker-$(date +%Y%m%d).dump.gz
```

Plain SQL (human-readable) instead of custom format:

```bash
docker compose exec -T postgres pg_dump -U tracker -d tracker | gzip > tracker-$(date +%Y%m%d).sql.gz
```

## Alternative: volume-level backup

If the database is idle, you can snapshot the Docker volume:

```bash
docker compose stop backend            # stop writers
docker run --rm -v tracker_postgres_data:/data -v "$PWD/backups":/backup alpine \
  tar czf /backup/postgres-volume-$(date +%Y%m%d).tar.gz -C /data .
docker compose start backend
```

Volume snapshots can be inconsistent if writers are active, so prefer `pg_dump` for routine backups.

## Restore

```bash
cd /opt/tracker
bash scripts/restore.sh backups/tracker-20260921-031500.sql.gz
```

`scripts/restore.sh` stops the backend, drops and recreates the schema, restores the dump, and
starts the backend again. Restoring is destructive to current data — confirm you picked the right
file.

Manual equivalent for a custom-format dump:

```bash
docker compose stop backend
docker compose exec -T postgres dropdb -U tracker --if-exists tracker
docker compose exec -T postgres createdb -U tracker tracker
gunzip -c backups/tracker-YYYYMMDD.dump.gz \
  | docker compose exec -T postgres pg_restore -U tracker -d tracker --clean --if-exists
docker compose start backend
```

## Verify a restore

Always confirm the restored data is usable:

```bash
curl -fsS http://localhost:5789/health          # {"status":"ok","database":"ok",...}
docker compose exec -T postgres psql -U tracker -d tracker -c 'select count(*) from "Location";'
docker compose exec -T postgres psql -U tracker -d tracker -c 'select count(*) from "Trip";'
```

Then sign in to the dashboard and confirm technicians, trips, and route replay look correct.

## Retention and backups

Retention windows (Settings → Data retention) delete old raw GPS points on a daily schedule. Your
backups therefore hold the *only* copy of data beyond the retention window. Size your backup
retention to your compliance requirements, and remember that a restore brings back data the
running instance had already purged.
