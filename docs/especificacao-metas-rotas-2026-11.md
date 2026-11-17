# Especificação técnica — metas, painel da diretoria, inconsistências, exportação e rotas (2026-11)

Documento de referência (prompt técnico) para as mudanças pedidas pela diretoria da EASY. Toda regra de negócio
abaixo é aplicada no banco (RLS, gatilhos, funções) e repetida nas Server Actions; a interface só organiza.

## 1. Atribuição do processo ao assessor
- `cliente_casos.assessor_id` passa a ser a fonte única de "quem gerou o processo".
- Preenchido por gatilho, nesta ordem: assessor do cliente (`clientes.assessor_id`) → nome da planilha
  (`cliente_casos.corretor_principal` ∈ `assessores.apelidos`, mesma empresa).
- Mudou o assessor do cliente ou os apelidos do assessor → os processos sem assessor são reatribuídos.
- `assessores.categoria`: `consultor` | `corretor` | `diretoria`. `assessores.apelidos text[]`: como o nome aparece na planilha.

## 2. Metas de processos (editáveis)
Tabela `metas_processos` (recorrentes, valem para todo período até serem desativadas):

| Campo | Valores |
|---|---|
| indicador | `processos_novos`, `habilitados`, `judicializados`, `analises`, `ligacoes` |
| periodicidade | `diaria`, `mensal`, `anual` |
| alvo | `empresa` (geral), `assessor` (um assessor), `categoria` (cada assessor da categoria) |
| valor | inteiro > 0 |

Realizado (função `metas_processos_painel(p_ref)`, respeita o RLS de quem consulta só no que é exibido em detalhe):
- `processos_novos`: processos com `recebido_em` no período, atribuídos ao assessor (ou todos, se `empresa`).
- `habilitados`: processos com `habilitado_em` no período (o sistema grava a data ao mudar para Habilitado).
- `judicializados`: passagens para `judicializado` no período (`cliente_casos_historico`).
- `analises`: saídas de `em_analise` no período.
- `ligacoes`: interações do tipo ligação no período feitas pelo usuário ligado ao assessor (`assessores.user_id`).

Metas iniciais (EASY): diretoria 10/mês e 100/ano; geral 55 habilitações/mês e 30 judicializados/mês;
José 50/mês e 660/ano; Santana 30/mês e 360/ano; cada corretor 20/mês e 360/ano; Vitória 10/mês + 20 ligações/dia;
Vânia 20/mês + 20 ligações/dia. Tudo editável em **Metas** (`/metas/processos`, funcionalidade `metas.manage`).

## 3. Processo habilitado
- Novos campos: `protocolo_inss`, `situacao_atual` (estado atual do processo no INSS).
- Mudar para Habilitado exige protocolo e estado atual (ação + gatilho para usuários autenticados).
- `habilitado_em` é gravado automaticamente na primeira habilitação.

## 4. Inconsistências
Função `inconsistencias_processos()` (security invoker: cada usuário só vê o que pode ver). Verificações:
habilitado sem protocolo; habilitado sem data; exigência vencida; exigência em aberto na planilha com outro status;
falta de contrato/procuração; cliente sem CPF ou CPF com tamanho inválido; cliente sem telefone; processo sem assessor;
em análise há mais de 60 dias; data de habilitação anterior ao recebimento ou recebimento no futuro;
processos duplicados (mesmo cliente e tipo, ativos); documentação do cadastro vencida; rota concluída sem checklist.
Tela `/administrativo/inconsistencias` (lista e exportação) e seção no painel.

## 5. Painel da diretoria (administrador master)
Primeira tela do master (`/inicio` → `/dashboard`): indicadores do mês com metas, distribuição por status,
evolução de 12 meses (recebidos × habilitados), prazos importantes, trâmites recentes (histórico de status),
ranking de assessores, metas e inconsistências.

## 6. Relatórios e exportação
- `/relatorios/assessores`: por assessor e período — total, status, datas, pendências, exigências e prazos.
- Planilhas `.xlsx` (exceljs) com logo, cabeçalho (empresa, título, filtros), data/hora e autor da exportação,
  cabeçalho fixo, filtros, larguras e formatos de data. Usado por processos, relatório por assessor e inconsistências.

## 7. Rotas
- `rotas.objetivo_tipo`: `prospeccao` | `atender_corretor` | `pendencias`; `rotas.objetivo` = motivo (obrigatório).
- `rotas.cidades text[]` (cidades já lançadas no sistema), `rotas.corretores uuid[]` (obrigatório em atender corretor),
  `rotas.participantes uuid[]` (quem vai junto).
- `rota_checklists` (saída e chegada): km, nível do tanque, foto do painel; na chegada, avaria (sim/não), descrição
  e assinatura do responsável quando houver avaria. Iniciar exige o checklist de saída; finalizar exige o de chegada
  (rotas com veículo).
- `rota_assinaturas`: relatório final assinado por todos que foram na rota. Página imprimível `/rotas/[id]/relatorio`.
- App de campo: `/campo` (instalável no celular). Checklists e assinaturas funcionam offline e sincronizam depois.
