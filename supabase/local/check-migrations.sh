#!/usr/bin/env bash
# Applies bootstrap + migrations to a throwaway Postgres and runs supabase/tests/*.sql.
# Uses $DATABASE_URL if set (e.g. a CI service container, which must be empty);
# otherwise starts a temporary local cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"

run_sql() { psql "$URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  URL="$DATABASE_URL"
else
  TMP="$(mktemp -d)"; PORT=54999
  AS=()
  if [[ "$(id -u)" == "0" ]]; then chown -R postgres "$TMP"; AS=(runuser -u postgres --); fi
  trap '"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  "${AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres >/dev/null
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
  URL="postgresql://postgres@/postgres?host=$TMP&port=$PORT"
fi

run_sql "$ROOT/supabase/local/bootstrap.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "applying $(basename "$f")"; run_sql "$f"; done
for f in "$ROOT"/supabase/tests/*.sql; do echo "running $(basename "$f")"; run_sql "$f"; done
echo "OK"
