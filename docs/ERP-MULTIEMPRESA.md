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

## 5. App de campo — PWA offline (Fase 4)

- **`/campo`**: PWA instalável (`campo.webmanifest`, `sw.js`), uso com uma mão. Funciona sem internet:
  pré-cadastro com consentimento LGPD, scanner de documentos (detecção de bordas, endireitamento, filtros,
  PDF de várias páginas), rota do dia, check-in, despesas, ponto. Tudo entra numa **fila local** no
  IndexedDB, **criptografada** (AES-GCM, chave não exportável) e é enviado item a item para
  `/api/campo/sync` (idempotente pelo id gerado no aparelho; 410 = aparelho revogado ⇒ apaga tudo).
- PIN opcional (5 erros apagam os dados do aparelho); push (Web Push/VAPID) a partir das notificações.
- OCR opcional (Google Vision, desligável por empresa — custo por página).
- Limitação de navegador: não há como detectar GPS simulado (no app nativo seria `isMock`).

## 6. Rotas e check-in (Fase 5)

- Rotas com paradas (cliente, cidade, endereço), geocodificação com cache (Google Maps, ou OpenStreetMap
  sem chave), otimização (Google ou vizinho mais próximo), reagendamento.
- Check-in/saída com raio, sinais de fraude (precisão ruim, horário divergente, salto de velocidade,
  ponto repetido), revisão pelo gestor. Km por hodômetro ou linha reta × fator; tempos de locomoção e visita;
  custo por km ou por consumo; custo por visitado/adquirido. Despesas com comprovante e aprovação.
- Mapa do campo em tempo quase real (Realtime).

## 7. WhatsApp e leads (Fase 6)

- **Leads** de WhatsApp, formulário público `/f/<slug>` (limite por IP, campo isca, Turnstile, LGPD),
  Facebook/Instagram Lead Ads, indicação, consultor e importação. Deduplicação por telefone/CPF/e-mail,
  pontuação, distribuição (dono da carteira → regras por cidade/DDD/origem/interesse/campanha → rodízio ou
  menor carga), SLA do primeiro contato com redistribuição e aviso ao supervisor, conversão em cliente.
- **WhatsApp Cloud API** (oficial): webhook `/api/webhooks/meta` (assinatura `X-Hub-Signature-256`,
  fila `webhook_eventos` idempotente, processamento com `after()` e pelo cron a cada minuto), mensagens
  particionadas por mês, mídia validada pela assinatura do arquivo e servida só por URL assinada,
  janela de 24 h (fora dela só modelo aprovado), opt-in/opt-out ("SAIR"), menu inicial, horário,
  transferência com nota, campanhas com limite por hora, métricas. Token da Meta criptografado.
- Regra dos 45 dias e desligamento movem conversas e leads.

## 8. RH, ponto e pré-folha (Fase 7)

- Funcionários (contrato) separados dos **dados sensíveis** (CPF, salário, dados bancários criptografados,
  dependentes, atestados) — só `rh.dados_sensiveis`, leitura auditada.
- **Ponto**: horário do servidor, NSR por empresa, hash encadeado, marcações **inalteráveis**, cercas
  virtuais, funcionário externo, offline sinalizado, localização só no ato. Ajustes e ausências aprovados por
  outra pessoa (a original é mantida). Cálculo diário e espelho mensal com ciência/contestação.
  *Controle interno de jornada*: para valer como REP-P (Portaria MTP 671/2021) faltam registro do programa,
  certificado e AFD — validar com a assessoria trabalhista.
- **Pré-folha**: salário, extras (valor-hora = salário/220, +50%), faltas, comissões recebidas, reembolsos de
  rota → revisão → aprovação (vira contas a pagar) → CSV para a contabilidade.

## 9. Financeiro ampliado (Fase 8)

Centros de custo, contas bancárias, recorrências automáticas, **alçada de aprovação** (outra pessoa aprova;
baixa exige `financeiro.pagar`), extrato **OFX** com conciliação sugerida, fluxo previsto × realizado,
DRE gerencial, centros de custo, inadimplência por atraso e saldos.

## 10. Relatórios e BI (Fase 9)

- `indicadores_diarios` por empresa e consultor (rotina 02h30, refaz os últimos 3 dias).
- **Relatório mensal geral** automático no 1º dia útil (09h): gastos, rotas, clientes e custo por cliente,
  documentação e 45 dias, vendas/processos com lista nominal, WhatsApp, ranking ponderado configurável,
  pontos de atenção, comparação com o mês anterior; aviso aos admins e e-mail (Resend) com o resumo e o link.
- Relatório operacional por período: check-ins, km, gastos, locomoção, CAC de campo, clientes, documentação, WhatsApp.

## 11. Comercialização (Fase 10)

- Planos (limites e módulos) e assinatura; cobrança pela **Asaas** (webhook `/api/webhooks/asaas` com
  token), suspensão após a tolerância (7 dias) e ao fim do teste.
- **Cadastro self-service** `/cadastro` (teste de 14 dias). **White-label** (logo e cor). **Domínio próprio**
  pela API da Vercel. **Portabilidade** (`/api/empresa/exportar`, NDJSON auditado) e **exclusão agendada**
  (anonimização após 30 dias; arquivos removidos). **Suporte temporário** autorizado pelo admin master.
- Importação de clientes por CSV (Administrativo › Base).

## 12. Como verificar

```bash
npm run typecheck && npm run lint && npm test           # app (59 testes)
wsl -d Ubuntu -u postgres -- bash /mnt/c/Users/joaom/Projetos/GE-EASY/scripts/db-test.sh   # banco
```
`scripts/db-test.sh` cria um PostgreSQL 17 limpo com o stub do Supabase, aplica as 28 migrações e roda os
testes: multiempresa (49), acessos/auditoria (39), regra dos 45 dias (37), complemento da fase 2 (31),
rotas (27), WhatsApp/leads (42), RH/ponto (29), financeiro (19), BI (19), comercialização (25) e os 3 antigos.
Também rodam no CI (job `banco`). Os mesmos arquivos rodam no SQL Editor do Supabase (terminam com rollback).

## 13. Implantação (homologação → produção)

1. **Backup**: anote o horário para PITR antes de migrar.
2. Aplique as migrações em ordem **e** publique o app na mesma janela.
3. Variáveis (todas opcionais — sem elas o recurso fica desligado ou usa a alternativa): ver `.env.example`
   (VAPID, WhatsApp/Meta, Google Maps/Vision, Turnstile, Asaas, Vercel, Resend).
4. **Reversão**: restaurar o PITR anterior e promover o deploy anterior na Vercel.

## 14. Limitações conhecidas

- Dias úteis sem feriados (prazos, 5º dia útil da folha, 1º dia útil do relatório).
- PWA: sem detecção de GPS simulado e sem rastreio em segundo plano (padrão desligado por LGPD).
- Ponto não é REP-P certificado; pré-folha não calcula INSS/IRRF/FGTS (contabilidade/eSocial).
- Exclusão de empresa anonimiza (não apaga) as linhas e mantém a trilha de auditoria (obrigação legal).
- Pesquisa de satisfação do WhatsApp e envio de mídia pelo atendente não implementados.
