# ADR-0003 — Contexto de autorização calculado uma vez por requisição

**Situação:** aceita (22/10/2026)

**Contexto.** As políticas chamavam funções de autorização linha a linha; com multiempresa e permissões,
contar 30 mil clientes levava ~2 s.

**Decisão.** `_contexto()` calcula empresa, papel, master e permissões uma vez e guarda em parâmetros locais
da transação (chave = JWT + cabeçalhos + versão incrementada por gatilho quando vínculos/permissões mudam).
A função é VOLÁTIL (o planejador não a avalia com snapshot antigo). As políticas usam `(select função())`.

**Resultado medido.** Contagem 2 s → 9 ms; lista de 50 → 1 ms (PostgreSQL 17, 30 mil clientes).

**Regra para o futuro.** Novas políticas devem envolver funções sem dependência da linha em `(select ...)`.
