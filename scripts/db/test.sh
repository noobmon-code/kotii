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

# Desde 30/10/2026 a Supabase não dá mais acesso pela API às tabelas novas do schema public: só vale o grant
# que a migração escreve. As migrações de antes contam com o padrão antigo (o de stubs.sql). As de
# NO_DEFAULT_GRANTS_FROM em diante rodam aqui sem ele, como vão rodar lá: a tabela nova sem grant fica sem
# acesso, e os testes que a usam falham.
NO_DEFAULT_GRANTS_FROM=20261010000000
default_grants=on

"${PSQL[@]}" -f "$ROOT/scripts/db/stubs.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  if [[ "$default_grants" == on && "${name%%_*}" > "$NO_DEFAULT_GRANTS_FROM" ]]; then
    "${PSQL[@]}" -c "alter default privileges in schema public revoke all on tables from anon, authenticated, service_role" >/dev/null
    default_grants=off
  fi
  "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -f "$ROOT/scripts/db/test.sql"
