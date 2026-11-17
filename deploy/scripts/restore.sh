#!/bin/sh
# Usage: sh restore.sh /path/to/trusted.sql.gz
# Requires a current protective backup and an approved maintenance window.
set -eu
umask 077

[ "$#" -eq 1 ] || { echo 'Usage: sh restore.sh <trusted.sql.gz>' >&2; exit 1; }
BACKUP_FILE=$1
: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
case "$POSTGRES_DB" in
  postgres|template0|template1) echo 'Refusing to replace a maintenance database.' >&2; exit 1 ;;
esac
[ -f "$BACKUP_FILE" ] && [ -r "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] || {
  echo 'Backup must be a readable, nonempty regular file.' >&2
  exit 1
}
command -v psql >/dev/null
TEMP_DIR=$(mktemp -d)
cleanup() {
  rm -f "$TEMP_DIR/restore.sql"
  rmdir "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
# Fully decompress before touching the target; no unchecked gunzip/psql pipeline.
gzip -dc "$BACKUP_FILE" > "$TEMP_DIR/restore.sql"
[ -s "$TEMP_DIR/restore.sql" ] || { echo 'Empty SQL backup; restore rejected.' >&2; exit 1; }
export PGPASSWORD="$POSTGRES_PASSWORD"
run_psql() {
  psql -X --no-password -v ON_ERROR_STOP=1 \
    -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
    -v target_db="$POSTGRES_DB" -v target_owner="$POSTGRES_USER" "$@"
}
run_psql -d "$POSTGRES_DB" -c 'SELECT 1;' >/dev/null

TARGET="$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
echo "WARNING: This destroys and replaces $TARGET. Stop application writers first."
echo 'A readable archive is not proof of recovery. Verify your protective backup first.'
printf 'Type RESTORE %s to proceed: ' "$TARGET"
IFS= read -r CONFIRMATION || { echo 'Restore cancelled.' >&2; exit 1; }
[ "$CONFIRMATION" = "RESTORE $TARGET" ] || { echo 'Target confirmation did not match.' >&2; exit 1; }

# psql variable quoting handles database/owner names as literals and identifiers.
run_psql -d postgres <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname = :'target_db' AND pid <> pg_backend_pid();
SQL
# DROP/CREATE DATABASE cannot share one -c string (implicit transaction).
run_psql -d postgres <<'SQL'
DROP DATABASE :"target_db";
SQL
run_psql -d postgres <<'SQL'
CREATE DATABASE :"target_db" OWNER :"target_owner";
SQL
run_psql -d "$POSTGRES_DB" --single-transaction --file "$TEMP_DIR/restore.sql"
echo "[$(date)] Restore complete: $TARGET. Validate before restarting writers."
