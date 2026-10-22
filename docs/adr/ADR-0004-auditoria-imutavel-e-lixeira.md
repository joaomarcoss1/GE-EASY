# ADR-0004 — Auditoria imutável com selo encadeado e exclusão lógica

**Situação:** aceita (22/10/2026)

**Decisão.** `audit_logs` particionada por mês, com gatilhos que bloqueiam UPDATE/DELETE/TRUNCATE (exceto o
selo, uma vez, pela rotina, e a retenção). A cada 5 min a rotina sela os eventos por empresa:
`hash = sha256(hash_anterior || conteúdo)`, na ordem `selo_seq` (eventos de transações longas entram no
próximo ciclo sem quebrar a cadeia). `auditoria_verificar()` recalcula e aponta o primeiro evento adulterado.
DELETE em clientes, processos, documentos e oportunidades vira exclusão lógica (lixeira); exclusão definitiva
só por retenção/LGPD.

**Por quê.** Selar no momento da gravação serializaria as transações de cada empresa; o selo em lote mantém o
desempenho e ainda evidencia adulteração. A exclusão lógica atende "nada é apagado" sem mudar as telas.

**Consequências.** As partições são tabelas com RLS ligado e sem privilégio para a API. O dono do banco ainda
pode desativar gatilhos — por isso o selo e os backups/PITR fazem parte do controle.
