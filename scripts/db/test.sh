#!/usr/bin/env bash
# Sobe um Postgres temporário, aplica stubs do Supabase + migrations e roda
# scripts/db/test.sql. Uso: npm run test:db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" ]]; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi

WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
AS=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb recusa rodar como root.
  chown -R postgres "$WORK"
  AS=(runuser -u postgres --)
fi

cleanup() {
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$ROOT/scripts/db/stubs.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -f "$ROOT/scripts/db/test.sql"
