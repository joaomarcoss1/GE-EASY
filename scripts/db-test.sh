#!/usr/bin/env bash
# Aplica todas as migrações num PostgreSQL 17 local (com o stub do Supabase) e roda os testes SQL.
# Uso (Windows): wsl -d Ubuntu -u postgres -- bash /mnt/c/.../GE-EASY/scripts/db-test.sh
# Uso (Linux/CI): PGUSER=postgres bash scripts/db-test.sh
# Testes *_test.sql terminam com RAISE EXCEPTION (rollback). A exceção final é aceita somente quando
# contém RESULTADO; qualquer erro anterior, ausência do marcador ou resultado FALHOU derruba o CI.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${GEEASY_TEST_DB:-geeasy_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

dropdb --if-exists "$DB" >/dev/null && createdb "$DB" || exit 1
"${PSQL[@]}" -f "$ROOT/supabase/tests/local/00_supabase_stub.sql" >/dev/null || exit 1

for f in "$ROOT"/supabase/migrations/*.sql; do
  # pg_cron e pg_net não existem no PostgreSQL comum: o stub cria os schemas equivalentes
  if ! sed -E '/create extension if not exists (pg_cron|pg_net)/d' "$f" | "${PSQL[@]}" --single-transaction >/dev/null; then
    echo "FALHA na migração $(basename "$f")"; exit 1
  fi
done
echo "migrações aplicadas: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l)"
# como em produção: já existe um dono da plataforma (o "primeiro usuário" não é nenhum dos usuários de teste)
"${PSQL[@]}" -c "insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), 'dono@plataforma.local', '{}')" >/dev/null || exit 1

falhas=0
for t in "$ROOT"/supabase/tests/*_test.sql; do
  saida="$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1)"
  status=$?
  nome="$(basename "$t")"
  if grep -q "RESULTADO: FALHOU" <<<"$saida" || grep -q "FALHOU" <<<"$saida"; then
    echo "FALHOU $nome"
    grep -E "FALHOU|ERROR" <<<"$saida" | head -30
    falhas=$((falhas + 1))
  elif grep -q "RESULTADO: OK" <<<"$saida"; then
    echo "ok    $nome"
  elif grep -q "RESULTADO" <<<"$saida"; then
    # Suítes legadas imprimem valores em vez de RESULTADO: OK. O marcador prova que chegaram
    # à exceção intencional final; um erro de setup encerraria antes e cairia no ramo abaixo.
    echo "legado $nome (migrar asserções textuais para pg_temp.ok)"
  else
    echo "ERRO  $nome (status $status; teste não chegou ao marcador RESULTADO)"
    sed -n '/ERROR/,$p' <<<"$saida" | head -40
    falhas=$((falhas + 1))
  fi
done
exit $falhas
