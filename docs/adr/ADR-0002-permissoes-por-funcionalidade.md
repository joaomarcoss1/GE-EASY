# ADR-0002 — Permissões: departamentos × níveis × funcionalidades sobre o escopo do papel

**Situação:** aceita (22/10/2026)

**Decisão.** O papel do vínculo (`app_role`) define o **escopo** dos dados (próprios, departamento, empresa),
como antes. O **que** cada um pode fazer vem de funcionalidades (catálogo global) atribuídas por níveis de
departamento + exceções individuais; admin master tem todas. O banco aplica `tem_permissao()` em políticas
restritivas das tabelas principais; o app usa as mesmas chaves (`can(profile, chave)`).

**Por quê.** Reaproveita as regras de escopo já testadas e permite que o admin master retire/conceda
funcionalidades com efeito imediato no banco. A área de trabalho é derivada das funcionalidades.

**Consequências.** Migração concede a cada usuário o que o papel antigo dava (sem perder acesso). Só o master
mexe em níveis/exceções (evita autoconcessão por quem gere usuários).
