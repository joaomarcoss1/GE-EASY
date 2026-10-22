#!/usr/bin/env bash
# Aplica todas as migrações num PostgreSQL 17 local (com o stub do Supabase) e roda os testes SQL.
# Uso (Windows): wsl -d Ubuntu -u postgres -- bash /mnt/c/.../GE-EASY/scripts/db-test.sh
# Uso (Linux/CI): PGUSER=postgres bash scripts/db-test.sh
# Testes *_test.sql terminam com RAISE EXCEPTION (rollback). Os novos passam quando a mensagem traz "RESULTADO: OK".
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
  saida="$(psql -X -q -d "$DB" -f "$t" 2>&1)"
  nome="$(basename "$t")"
  if grep -q "RESULTADO: OK" <<<"$saida"; then
    echo "ok    $nome"
  elif grep -q "RESULTADO: FALHOU" <<<"$saida"; then
    echo "FALHOU $nome"; grep -E "FALHOU|ERROR" <<<"$saida" | head -20; falhas=$((falhas + 1))
  else
    # testes antigos: mostram o relatório para conferência manual
    echo "----- $nome (conferir com o resultado esperado no cabeçalho do arquivo)"; sed -n '/ERROR/,$p' <<<"$saida" | head -40
  fi
done
exit $falhas
