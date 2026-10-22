# GE EASY — ERP multiempresa (Fases 1 a 3)

Documento de decisão e entrega das fases 1 (fundação multiempresa), 2 (acessos e auditoria) e
3 (clientes, documentação e regra dos 45 dias) do prompt "GE EASY como ERP de gestão multiempresa".
As fases 4 a 10 (app mobile, rotas/check-in avançado, WhatsApp, RH/ponto, financeiro ampliado, BI,
comercialização) **não** foram implementadas; estão no fim deste documento.

## 1. Decisões adotadas para as perguntas da seção 2

Todas são **padrões configuráveis por empresa**. Revise e ajuste em *Configurações › Documentação*,
*Acessos* ou no painel da plataforma.

| # | Pergunta | Decisão (padrão) | Onde muda |
|---|---|---|---|
| 1 | Início dos 45 dias | Entrada do cliente em **documentação pendente** na carteira de um consultor | — |
| 2 | Corridos ou úteis | **Corridos**; opção "úteis" (seg–sex, sem feriados) | Configurações › Documentação |
| 3 | Envio parcial | **Não reinicia nem pausa**; só a gestão prorroga (com motivo, até 2× de 15 dias) | Configurações › Documentação |
| 4 | Após transferir | Consultor perde **visão e edição**; vê só "Cliente X transferido em dd/mm" | — |
| 5 | Comissão | Parâmetro `comissao_apos_transferencia` = **não** (gravado; o cálculo de comissão ainda não lê o parâmetro — fase 7) | Configurações › Documentação |
| 6 | Devolução | Administrativo/gestão **devolve ou redistribui**, com **novo prazo** e histórico | Cliente › Redistribuir |
| 7 | Avisos | **D-15, D-7, D-3, D-1** no sistema (consultor + supervisão do departamento comercial) | Configurações › Documentação |
| 8 | Leads do WhatsApp | Regra vale para qualquer cliente na carteira de consultor; WhatsApp é a fase 6 | — |
| 9 | Dono da plataforma × admin master | `plataforma_admins` (dono, painel `/plataforma`) separado do **admin master de cada empresa** | — |
| 10 | Planos e cobrança | Plano (texto) + limite de usuários ativos aplicado no banco; **sem cobrança integrada** (fase 10) | /plataforma |
| 11 | Mesmo login em várias empresas | **Sim** (um usuário, vários vínculos; troca sem novo login) | — |
| 12 | White-label | Domínio próprio e `marca` (jsonb) por empresa; logo/cores na interface ficam para a fase 10 | /plataforma |
| 13 | Grupos econômicos | **Não** nesta fase (cada empresa isolada) | — |
| 14 | App nativo × PWA | Fora das fases 1–3 (fase 4). Recomendação mantida: React Native/Expo | — |
| 15 | Raio do check-in | Fase 5 | — |
| 16–18 | GPS contínuo, km, reembolso | Fase 5 | — |
| 19–22 | WhatsApp | Fase 6 (Cloud API oficial) | — |
| 23 | Ponto legal | Fase 7 (validar Portaria 671/2021 com a assessoria) | — |
| 24 | Folha | Fase 7: pré-folha + exportação (recomendado) | — |
| 25 | Jurídico opcional | **Sim**: módulos por empresa (`empresas.modulos`) escondem a área | /plataforma |

Outras decisões técnicas estão nos ADRs em `docs/adr/`.

## 2. Arquitetura multiempresa (Fase 1)

- **Empresa ativa da requisição**: cabeçalho `x-empresa-id` enviado pelo servidor Next.js (cookie `ge_empresa`,
  definido pelo subdomínio ou pela escolha do usuário); sem cabeçalho (Realtime, Storage) vale
  `profiles.empresa_padrao_id`. O banco **sempre** confere o vínculo ativo (`empresa_atual()`); cabeçalho
  inválido ou de outra empresa ⇒ nenhuma linha visível. Ver ADR-0001.
- **Isolamento**: `empresa_id` em todas as tabelas de negócio + política RLS **restritiva**
  `empresa_id = (select empresa_atual())` em cada uma (soma-se às regras de escopo existentes).
- **Integridade**: gatilho `zz_empresa_vinculos` recusa vínculo com registro/usuário de outra empresa,
  impede mudar `empresa_id` e herda a empresa do registro pai quando o servidor (service role) grava.
- **Chaves únicas por empresa**: CPF/CNPJ, CNJ, parceiros, departamentos, configurações, publicações (hash), metas, cache do Drive.
- **Papel por empresa**: `empresa_membros(role, ativo, admin_master)`; `profiles.role/active` viraram legado
  (alterar `profiles.role` é bloqueado; `profiles.active` = bloqueio global, só a plataforma).
- **Storage**: novos arquivos em `empresas/<empresa_id>/clientes|processos/<id>/...`; o caminho legado continua válido
  (o acesso é sempre conferido pelo cliente/processo, que é da empresa).
- **Endereço**: `<slug>.NEXT_PUBLIC_ROOT_DOMAIN` ou domínio próprio (`empresas.dominio`) → cookie da empresa;
  sem domínio raiz configurado, o usuário escolhe a empresa após o login (`/selecionar-empresa`).
- **Integrações por empresa**: Drive (configuração e cache de pastas), DJEN (OABs dos membros + adicionais) e
  logs de integração; a rotina `/api/cron/sincronizar` percorre empresa por empresa.
- **Painel da plataforma** (`/plataforma`): criar empresa (com dados padrão e convite do admin master),
  situação (suspender = ninguém da empresa entra), plano, limite de usuários, domínio, módulos e uso.
- **Desempenho**: contexto (empresa, papel, master, permissões) calculado **uma vez por requisição** e
  políticas com `(select função())`. Medido localmente com 30 mil clientes: contagem 2 s → 9 ms; lista de
  50 → 1 ms. Ver ADR-0003.

## 3. Acessos e auditoria (Fase 2)

- **Departamentos × níveis × funcionalidades**: departamentos têm `tipo` (área). Cada departamento nasce com
  níveis Operador/Supervisor/Gestor e funcionalidades padrão (`funcionalidades_padrao`). Exceções
  individuais (concessão/revogação com motivo e validade). Permissão efetiva = níveis + concessões −
  revogações; **admin master = todas**.
- **No banco**: `tem_permissao('chave')` em políticas restritivas das tabelas principais — tirar a
  funcionalidade bloqueia a ação também por chamada direta à API. O **papel** continua definindo o escopo
  (próprios / departamento / empresa).
- **Quem gere**: só o admin master define níveis, funcionalidades e exceções; RH (`usuarios.manage`) convida,
  ativa e desativa (não promove a gestor/admin); ninguém altera o próprio acesso; sempre resta 1 master.
- **Entrada por departamento**: `/inicio` (escolha da área, última em destaque), URLs `/consultor`,
  `/administrativo`, `/juridico`, `/rh`, `/financeiro`; o menu mostra a área ativa. A área **não** amplia
  permissões.
- **Migração sem perda**: cada usuário atual recebeu departamento/nível equivalentes ao papel antigo e uma
  concessão "Migração do papel X" para qualquer funcionalidade que faltasse; admins viraram admin master.
- **Auditoria**: tabela particionada por mês, **imutável** (UPDATE/DELETE/TRUNCATE bloqueados), selada por
  **hash encadeado** a cada 5 min (`/auditoria › Integridade`). Cada evento guarda campos alterados, valor
  anterior, área, origem, IP, user-agent e request id. Ações próprias para EXCLUSAO, RESTAURACAO, ACESSO_NEGADO,
  TROCA_EMPRESA. Relatórios por funcionário/módulo, linha do tempo por registro, exportação CSV e alertas
  (exclusões em massa, exportações, mudanças de acesso, fora do horário) para os masters.
- **Exclusão lógica**: clientes, processos, documentos e oportunidades vão para a **lixeira** (`/lixeira`);
  exclusão definitiva só por retenção ou LGPD (a anonimização apaga os documentos de vez).

## 4. Clientes e documentação (Fase 3)

- **Carteira** (`consultor | administrativo | juridico`) e **situação do cadastro** (máquina de estados):
  `pre_cadastro → pendente_documentacao → documentacao_completa → ativo`, com `transferido_administrativo`,
  `perdido` (motivo obrigatório) e `inativo`. Transições validadas no banco; só a análise conclui o cadastro.
- **Documentos exigidos por empresa** (`documento_tipos`: obrigatório, PF/PJ, validade) e **análise
  documental** (enviado → em análise → aprovado/recusado com motivo → quem enviou é avisado; vencidos).
  Aprovado o último obrigatório ⇒ cadastro completo e prazo encerrado.
- **Regra dos 45 dias**: rotina diária `processar_prazos_documentacao()` (00h05 de Brasília), idempotente:
  avisos D-N, transferência para a base administrativa, histórico `regra_prazo_documentacao`, tarefa
  "Concluir documentação" para o departamento administrativo e notificações.
- **Duplicidade**: CPF/CNPJ único por empresa; a mensagem informa a carteira sem expor dados de outra.
- **Telas**: cartão "Cadastro e documentação" no cliente, `/consultor` (contagem regressiva),
  `/administrativo`, `/administrativo/documentacao` (fila), `/administrativo/base` (base completa com
  redistribuição em lote), *Configurações › Documentação*.
- **Encaminhamento ao jurídico**: cria processo com situação `encaminhado | em_analise | ajuizado | cancelado | pendente_confirmacao`.
- **Consentimento LGPD** obrigatório no cadastro (data, usuário, IP, versão do termo).

## 5. Como verificar

```bash
npm run typecheck && npm run lint && npm test           # app (44 testes)
wsl -d Ubuntu -u postgres -- bash /mnt/c/Users/joaom/Projetos/GE-EASY/scripts/db-test.sh   # banco
```
`scripts/db-test.sh` cria um PostgreSQL 17 limpo com o stub do Supabase, aplica as 20 migrações e roda:
`multiempresa_test.sql` (duas empresas: tela/API/arquivo/busca/rotina/suspensão — 49 verificações),
`acessos_auditoria_test.sql` (39), `regra_45_dias_test.sql` (37: D-1, D0/D+1, envio parcial, prorrogação,
devolução, dia 44, rotina repetida) e os 3 testes antigos (resultados iguais aos esperados).
Os mesmos arquivos rodam no SQL Editor do Supabase (terminam com rollback).

## 6. Implantação (homologação → produção)

1. **Backup**: anote o horário para PITR (ou gere um backup) antes de migrar.
2. **Homologação**: crie um branch/projeto de homologação, aplique `supabase/migrations/` (`supabase db push`)
   e rode os testes SQL acima no SQL Editor. Aponte um deploy de *preview* da Vercel para ele.
3. **Produção**: aplique as migrações `20261022000100` a `20261022000600` **e** publique o app na mesma janela
   (o app antigo não funciona com o banco novo e vice-versa — ex.: upsert de configurações por empresa).
4. Variáveis novas (opcionais): `NEXT_PUBLIC_ROOT_DOMAIN` (subdomínios por empresa; exige domínio curinga na Vercel).
5. Pós-implantação: entrar como admin master, revisar *Acessos* (as concessões "Migração do papel …"
   podem ser trocadas por níveis) e *Configurações › Documentação*.
6. **Reversão**: restaurar o PITR anterior à migração e promover o deploy anterior na Vercel.

## 7. Limitações conhecidas (desta entrega)

- Dias úteis sem feriados; rodízio de responsável administrativo não implementado (a tarefa vai para o departamento).
- Usuário em duas empresas com duas abas abertas no **mesmo** endereço: Realtime/Storage usam a empresa padrão
  (última escolhida); com subdomínios cada aba tem a sua.
- Acesso de suporte temporário da plataforma, onboarding self-service, importação CSV de clientes,
  white-label visual e cobrança: fase 10.
- `auditoria_verificar()` percorre toda a cadeia da empresa a cada consulta (ok para o volume atual).
- O cálculo de comissão ainda não lê `comissao_apos_transferencia`.

## 8. Próximas fases (não implementadas)

4 App do consultor (offline, scanner, push) · 5 Rotas e check-in GPS com anti-fraude, km e gastos ·
6 WhatsApp Cloud API e leads · 7 RH, ponto e pré-folha · 8 Financeiro ampliado · 9 Relatórios/BI e
fechamento mensal · 10 Comercialização (planos, cobrança, onboarding, white-label).
