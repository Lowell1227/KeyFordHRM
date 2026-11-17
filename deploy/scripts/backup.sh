#!/bin/sh
# Daily plain-SQL backup. Retain this application's completed backups for 30 days.
set -eu
umask 077

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_DIR=${BACKUP_DIR:-/backups}
[ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ] || {
  echo 'Backup directory is missing or not writable.' >&2
  exit 1
}

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEMP_DIR=$(mktemp -d "$BACKUP_DIR/.backup.XXXXXX")
cleanup() {
  rm -f "$TEMP_DIR/dump.sql" "$TEMP_DIR/dump.sql.gz"
  rmdir "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
FILENAME="$BACKUP_DIR/kayford_perf_${TIMESTAMP}_${TEMP_DIR##*.}.sql.gz"

echo "[$(date)] Starting backup."
# POSIX sh has no portable pipefail. Check dump and compression separately.
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-password --no-owner --no-acl > "$TEMP_DIR/dump.sql"
[ -s "$TEMP_DIR/dump.sql" ] || { echo 'Empty SQL dump; backup rejected.' >&2; exit 1; }
gzip -c "$TEMP_DIR/dump.sql" > "$TEMP_DIR/dump.sql.gz"
gzip -t "$TEMP_DIR/dump.sql.gz"

# Same filesystem: incomplete data never appears under a completed backup name.
[ ! -e "$FILENAME" ] || { echo 'Backup filename collision.' >&2; exit 1; }
mv "$TEMP_DIR/dump.sql.gz" "$FILENAME"
echo "[$(date)] Backup complete: $FILENAME"

# Never run retention before successful dump, compression, validation and rename.
find "$BACKUP_DIR" -type f -name 'kayford_perf_*.sql.gz' -mtime +30 -delete
echo "[$(date)] Completed backup retention."
