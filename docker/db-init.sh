#!/bin/sh
# Runs once on first container start: Supabase shims, then every migration in order.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /supabase/local/bootstrap.sql
for f in /supabase/migrations/*.sql; do
  echo "applying $f"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
done
