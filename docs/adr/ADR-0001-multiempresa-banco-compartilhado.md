# ADR-0001 — Multiempresa: banco compartilhado, empresa por cabeçalho validado

**Situação:** aceita (22/10/2026)

**Contexto.** O GE EASY passa a atender várias empresas. Opções: schema por empresa, banco por empresa ou
banco compartilhado com `empresa_id` + RLS. A empresa ativa poderia vir de um claim no JWT (Custom Access
Token Hook) ou de um cabeçalho por requisição.

**Decisão.** Banco compartilhado, `empresa_id` em todas as tabelas de negócio e política RLS **restritiva**
de isolamento em cada tabela. A empresa ativa vem do cabeçalho `x-empresa-id` (enviado pelo servidor a partir
do cookie/subdomínio) e, sem cabeçalho, de `profiles.empresa_padrao_id`; `empresa_atual()` só devolve a empresa
se houver vínculo ativo e a empresa estiver ativa. Papel e situação passam a ser por vínculo (`empresa_membros`).

**Por quê.** Não depende de configurar hook no painel do Supabase nem de renovar o token ao trocar de empresa;
cada aba/subdomínio pode trabalhar numa empresa; um id forjado não abre nada (o vínculo é conferido no banco).
A política restritiva protege mesmo onde as regras antigas de escopo eram amplas.

**Consequências.** Toda gravação do service role precisa informar ou herdar `empresa_id` (gatilho
`zz_empresa_vinculos`). Realtime/Storage usam a empresa padrão. Clientes grandes poderão ir para banco
próprio no futuro (plano premium).
