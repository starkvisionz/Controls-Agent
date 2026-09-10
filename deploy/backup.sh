#!/usr/bin/env bash
#
# Back up the database while the app is running.
#
# `cp` on a live SQLite database in WAL mode copies a file whose latest writes
# are still in the -wal, which can restore as a torn database. This uses
# SQLite's own online backup instead: a consistent snapshot taken under the
# same locking the app uses, with no need to stop the service.
#
# Run by starkvisionz-backup.timer nightly; also fine by hand.
#
#   STARKVISIONZ_DB_PATH      database to copy (required)
#   STARKVISIONZ_BACKUP_DIR   where to put it (default: alongside, in backups/)
#   STARKVISIONZ_BACKUP_KEEP  how many to keep (default 14)

set -euo pipefail

DB="${STARKVISIONZ_DB_PATH:-}"
[ -n "$DB" ] || { echo "STARKVISIONZ_DB_PATH is not set" >&2; exit 1; }
[ -f "$DB" ] || { echo "No database at $DB" >&2; exit 1; }

DIR="${STARKVISIONZ_BACKUP_DIR:-$(dirname "$DB")/backups}"
KEEP="${STARKVISIONZ_BACKUP_KEEP:-14}"

mkdir -p "$DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DIR/starkvisionz-$stamp.db"

# better-sqlite3 comes with the app, so there is no separate sqlite3 package to
# keep installed. This runs from the checkout so the module resolves.
node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
db.backup(process.argv[2])
  .then(() => { db.close(); })
  .catch((err) => { console.error(err.message); process.exit(1); });
' "$DB" "$out"

# Written 0600: a backup of this database is the database.
chmod 600 "$out"
gzip -f "$out"

# Keep the newest KEEP, drop the rest.
mapfile -t old < <(ls -1t "$DIR"/starkvisionz-*.db.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
if [ "${#old[@]}" -gt 0 ]; then
  rm -f "${old[@]}"
fi

printf '%s  (%s kept)\n' "$out.gz" "$(ls -1 "$DIR"/starkvisionz-*.db.gz 2>/dev/null | wc -l)"
