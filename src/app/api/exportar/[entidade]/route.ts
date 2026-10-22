import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isBackofficeRole, type Permission } from "@/lib/rbac";
import { departamentoMap, getProfileMap, parceiroMap } from "@/lib/data";
import {
  APOLICE_STATUS, CATEGORIAS_CONSORCIO, CLIENTE_STATUS, COMISSAO_STATUS, CONTEMPLACAO, COTA_STATUS, ETAPAS, INSTANCIAS, LINHAS, PRAZO_CONTAGEM, PRAZO_STATUS, PRIORIDADES,
  PROCESSO_AREAS, PROCESSO_FASES, PROCESSO_POLO, PROCESSO_RISCO, PROCESSO_STATUS, RAMOS_SEGURO, type Option,
} from "@/lib/constants";
import { date as dateBR, maskDocumento, maskPhone, todayISO } from "@/lib/format";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, firstDay, isISODate, isMonth, lastDay, spStartOf } from "@/components/dashboard/periods";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

type Row = Record<string, unknown>;
type Cell = string | number | null | undefined;
type Column = [header: string, value: (r: Row) => Cell];

// ----------------------------------------------------------------- formatação
const str = (r: Row, k: string) => (r[k] == null ? "" : String(r[k]));
const money = (r: Row, k: string) => (r[k] == null || r[k] === "" ? "" : Number(r[k]).toFixed(2).replace(".", ","));
const decimal = (r: Row, k: string) => (r[k] == null || r[k] === "" ? "" : String(Number(r[k])).replace(".", ","));
const dt = (r: Row, k: string) => (r[k] ? dateBR(String(r[k])) : "");
const label = (opts: Option[], r: Row, k: string) => {
  const v = str(r, k);
  return opts.find((o) => o.value === v)?.label ?? v;
};
const embedded = (r: Row, k: string, field = "nome") => {
  const v = r[k] as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const o = Array.isArray(v) ? v[0] : v;
  return o?.[field] == null ? "" : String(o[field]);
};
const yesNo = (r: Row, k: string) => (r[k] === true ? "Sim" : r[k] === false ? "Não" : "");

/** Aspas sempre; neutraliza injeção de fórmula (= + - @ TAB CR) prefixando apóstrofo. */
function csvCell(v: Cell): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(columns: Column[], rows: Row[]): string {
  const lines = [columns.map(([h]) => csvCell(h)).join(";")];
  for (const r of rows) lines.push(columns.map(([, fn]) => csvCell(fn(r))).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ----------------------------------------------------------------- entidades
type DateKind = "date" | "timestamp" | "month";
interface Entity {
  table: string;
  permission: Permission;
  select: string;
  /** Coluna do filtro de período; null = exporta tudo o que o usuário enxerga (ignora o período). */
  dateCol: string | null;
  dateKind: DateKind;
  /** Ordenação (padrão: dateCol desc) */
  orderCol?: string;
  columns: (ctx: { consultor: (id: unknown) => string; parceiro: (id: unknown) => string; departamento: (id: unknown) => string; backoffice: boolean }) => Column[];
}

const ENTITIES: Record<string, Entity> = {
  auditoria: {
    table: "audit_logs",
    permission: "auditoria.view",
    select: "id, created_at, actor_email, acao, tabela, registro_id, campos_alterados, area, origem, ip, user_agent, hash",
    dateCol: "created_at",
    dateKind: "timestamp",
    columns: () => [
      ["Data e hora", (r) => (r.created_at ? new Date(String(r.created_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "")],
      ["Usuário", (r) => str(r, "actor_email")],
      ["Ação", (r) => str(r, "acao")],
      ["Tabela", (r) => str(r, "tabela")],
      ["Registro", (r) => str(r, "registro_id")],
      ["Campos alterados", (r) => (Array.isArray(r.campos_alterados) ? (r.campos_alterados as string[]).join(", ") : "")],
      ["Área", (r) => str(r, "area")],
      ["Origem", (r) => str(r, "origem")],
      ["IP", (r) => str(r, "ip")],
      ["Selo (hash)", (r) => str(r, "hash")],
    ],
  },
  clientes: {
    table: "clientes",
    permission: "clientes.exportar",
    select: "id, nome, tipo_pessoa, documento, email, telefone, whatsapp, cidade, uf, profissao, origem, status, tags, consultor_id, created_at",
    dateCol: "created_at",
    dateKind: "timestamp",
    columns: ({ consultor }) => [
      ["Nome / Razão social", (r) => str(r, "nome")],
      ["Tipo", (r) => (r.tipo_pessoa === "PJ" ? "Pessoa jurídica" : "Pessoa física")],
      ["CPF / CNPJ", (r) => maskDocumento(str(r, "documento"))],
      ["E-mail", (r) => str(r, "email")],
      ["Telefone", (r) => maskPhone(str(r, "telefone"))],
      ["WhatsApp", (r) => maskPhone(str(r, "whatsapp"))],
      ["Cidade", (r) => str(r, "cidade")],
      ["UF", (r) => str(r, "uf")],
      ["Profissão / Ramo", (r) => str(r, "profissao")],
      ["Origem", (r) => str(r, "origem")],
      ["Status", (r) => label(CLIENTE_STATUS, r, "status")],
      ["Etiquetas", (r) => (Array.isArray(r.tags) ? (r.tags as string[]).join(", ") : "")],
      ["Consultor", (r) => consultor(r.consultor_id)],
      ["Cadastrado em", (r) => dt(r, "created_at")],
    ],
  },
  cotas: {
    table: "consorcio_cotas",
    permission: "relatorios.view",
    select:
      "id, clientes(nome), administradora_id, categoria, grupo, cota, numero_contrato, valor_credito, prazo_meses, parcela_valor, taxa_adm, fundo_reserva, data_adesao, dia_vencimento, parcelas_pagas, status, contemplada_em, forma_contemplacao, valor_lance, consultor_id",
    dateCol: "data_adesao",
    dateKind: "date",
    columns: ({ consultor, parceiro }) => [
      ["Cliente", (r) => embedded(r, "clientes")],
      ["Administradora", (r) => parceiro(r.administradora_id)],
      ["Categoria", (r) => label(CATEGORIAS_CONSORCIO, r, "categoria")],
      ["Grupo", (r) => str(r, "grupo")],
      ["Cota", (r) => str(r, "cota")],
      ["Contrato", (r) => str(r, "numero_contrato")],
      ["Crédito (R$)", (r) => money(r, "valor_credito")],
      ["Prazo (meses)", (r) => str(r, "prazo_meses")],
      ["Parcela (R$)", (r) => money(r, "parcela_valor")],
      ["Taxa adm. (%)", (r) => decimal(r, "taxa_adm")],
      ["Fundo de reserva (%)", (r) => decimal(r, "fundo_reserva")],
      ["Adesão", (r) => dt(r, "data_adesao")],
      ["Dia de vencimento", (r) => str(r, "dia_vencimento")],
      ["Parcelas pagas", (r) => str(r, "parcelas_pagas")],
      ["Status", (r) => label(COTA_STATUS, r, "status")],
      ["Contemplada em", (r) => dt(r, "contemplada_em")],
      ["Forma de contemplação", (r) => label(CONTEMPLACAO, r, "forma_contemplacao")],
      ["Valor do lance (R$)", (r) => money(r, "valor_lance")],
      ["Consultor", (r) => consultor(r.consultor_id)],
    ],
  },
  apolices: {
    table: "seguro_apolices",
    permission: "relatorios.view",
    select:
      "id, clientes(nome), seguradora_id, ramo, numero_apolice, numero_proposta, item_segurado, inicio_vigencia, fim_vigencia, premio_liquido, premio_total, forma_pagamento, parcelas, comissao_percentual, status, consultor_id",
    dateCol: "inicio_vigencia",
    dateKind: "date",
    columns: ({ consultor, parceiro }) => [
      ["Cliente", (r) => embedded(r, "clientes")],
      ["Seguradora", (r) => parceiro(r.seguradora_id)],
      ["Ramo", (r) => label(RAMOS_SEGURO, r, "ramo")],
      ["Nº da apólice", (r) => str(r, "numero_apolice")],
      ["Nº da proposta", (r) => str(r, "numero_proposta")],
      ["Item segurado", (r) => str(r, "item_segurado")],
      ["Início da vigência", (r) => dt(r, "inicio_vigencia")],
      ["Fim da vigência", (r) => dt(r, "fim_vigencia")],
      ["Prêmio líquido (R$)", (r) => money(r, "premio_liquido")],
      ["Prêmio total (R$)", (r) => money(r, "premio_total")],
      ["Forma de pagamento", (r) => str(r, "forma_pagamento")],
      ["Parcelas", (r) => str(r, "parcelas")],
      ["Comissão (%)", (r) => decimal(r, "comissao_percentual")],
      ["Status", (r) => label(APOLICE_STATUS, r, "status")],
      ["Consultor", (r) => consultor(r.consultor_id)],
    ],
  },
  comissoes: {
    table: "comissoes",
    permission: "comissoes.view",
    select:
      "id, competencia, linha, descricao, clientes(nome), consultor_id, base_calculo, percentual_corretora, valor_corretora, percentual_consultor, valor_consultor, status, data_recebimento, data_pagamento, observacoes",
    dateCol: "competencia",
    dateKind: "month",
    columns: ({ consultor, backoffice }) => [
      ["Competência", (r) => str(r, "competencia").slice(0, 7).split("-").reverse().join("/")],
      ["Linha", (r) => label(LINHAS, r, "linha")],
      ["Descrição", (r) => str(r, "descricao")],
      ["Cliente", (r) => embedded(r, "clientes")],
      ["Consultor", (r) => consultor(r.consultor_id)],
      ["Base de cálculo (R$)", (r) => money(r, "base_calculo")],
      ...(backoffice
        ? ([
            ["% corretora", (r) => decimal(r, "percentual_corretora")],
            ["Valor corretora (R$)", (r) => money(r, "valor_corretora")],
          ] as Column[])
        : []),
      ["% consultor", (r) => decimal(r, "percentual_consultor")],
      ["Valor consultor (R$)", (r) => money(r, "valor_consultor")],
      ["Status", (r) => label(COMISSAO_STATUS, r, "status")],
      ...(backoffice ? ([["Recebida em", (r) => dt(r, "data_recebimento")]] as Column[]) : []),
      ["Paga ao consultor em", (r) => dt(r, "data_pagamento")],
      ["Observações", (r) => str(r, "observacoes")],
    ],
  },
  oportunidades: {
    table: "oportunidades",
    permission: "relatorios.view",
    select: "id, titulo, clientes(nome), linha, valor, etapa, probabilidade, previsao_fechamento, consultor_id, motivo_perda, created_at, fechado_em",
    dateCol: "created_at",
    dateKind: "timestamp",
    columns: ({ consultor }) => [
      ["Título", (r) => str(r, "titulo")],
      ["Cliente", (r) => embedded(r, "clientes")],
      ["Linha", (r) => label(LINHAS, r, "linha")],
      ["Valor (R$)", (r) => money(r, "valor")],
      ["Etapa", (r) => label(ETAPAS, r, "etapa")],
      ["Probabilidade (%)", (r) => str(r, "probabilidade")],
      ["Previsão de fechamento", (r) => dt(r, "previsao_fechamento")],
      ["Consultor", (r) => consultor(r.consultor_id)],
      ["Motivo da perda", (r) => str(r, "motivo_perda")],
      ["Criada em", (r) => dt(r, "created_at")],
      ["Fechada em", (r) => dt(r, "fechado_em")],
    ],
  },
};

// Núcleo jurídico (RLS do processo/prazo aplicado pelo cliente do usuário)
ENTITIES.processos = {
  table: "processos",
  permission: "processos.view",
  select:
    "id, numero_cnj, numero_interno, titulo, clientes(nome), polo_cliente, parte_contraria, area, classe, assunto, tribunal, orgao, comarca, uf, instancia, fase, status, risco, valor_causa, valor_provisionado, data_distribuicao, data_encerramento, resultado, segredo_justica, departamento_id, responsavel_id, tags, created_at",
  dateCol: null,
  dateKind: "date",
  orderCol: "created_at",
  columns: ({ consultor, departamento }) => [
    ["Número CNJ", (r) => str(r, "numero_cnj")],
    ["Nº interno", (r) => str(r, "numero_interno")],
    ["Título", (r) => str(r, "titulo")],
    ["Cliente", (r) => embedded(r, "clientes")],
    ["Posição do cliente", (r) => label(PROCESSO_POLO, r, "polo_cliente")],
    ["Parte contrária", (r) => str(r, "parte_contraria")],
    ["Área", (r) => label(PROCESSO_AREAS, r, "area")],
    ["Classe", (r) => str(r, "classe")],
    ["Assunto", (r) => str(r, "assunto")],
    ["Tribunal", (r) => str(r, "tribunal")],
    ["Vara / órgão", (r) => str(r, "orgao")],
    ["Comarca", (r) => str(r, "comarca")],
    ["UF", (r) => str(r, "uf")],
    ["Instância", (r) => label(INSTANCIAS, r, "instancia")],
    ["Fase", (r) => label(PROCESSO_FASES, r, "fase")],
    ["Situação", (r) => label(PROCESSO_STATUS, r, "status")],
    ["Risco", (r) => (r.risco ? label(PROCESSO_RISCO, r, "risco") : "Não avaliado")],
    ["Valor da causa (R$)", (r) => money(r, "valor_causa")],
    ["Valor provisionado (R$)", (r) => money(r, "valor_provisionado")],
    ["Distribuição", (r) => dt(r, "data_distribuicao")],
    ["Encerramento", (r) => dt(r, "data_encerramento")],
    ["Resultado", (r) => (r.segredo_justica === true ? "" : str(r, "resultado"))],
    ["Segredo de justiça", (r) => yesNo(r, "segredo_justica")],
    ["Departamento", (r) => departamento(r.departamento_id)],
    ["Responsável", (r) => consultor(r.responsavel_id)],
    ["Etiquetas", (r) => (Array.isArray(r.tags) ? (r.tags as string[]).join(", ") : "")],
    ["Cadastrado em", (r) => dt(r, "created_at")],
  ],
};

ENTITIES.prazos = {
  table: "prazos",
  permission: "processos.view",
  select:
    "id, descricao, processos(titulo, numero_cnj), data_publicacao, dias, contagem, data_fim, fatal, prioridade, status, responsavel_id, departamento_id, cumprido_em, observacoes, created_at",
  dateCol: "data_fim",
  dateKind: "date",
  columns: ({ consultor, departamento }) => [
    ["Vencimento", (r) => dt(r, "data_fim")],
    ["Prazo", (r) => str(r, "descricao")],
    ["Processo", (r) => embedded(r, "processos", "titulo")],
    ["Número CNJ", (r) => embedded(r, "processos", "numero_cnj")],
    ["Publicação / intimação", (r) => dt(r, "data_publicacao")],
    ["Dias", (r) => str(r, "dias")],
    ["Contagem", (r) => label(PRAZO_CONTAGEM, r, "contagem")],
    ["Fatal", (r) => yesNo(r, "fatal")],
    ["Prioridade", (r) => label(PRIORIDADES, r, "prioridade")],
    ["Situação", (r) => (r.status === "pendente" && typeof r.data_fim === "string" && r.data_fim < todayISO() ? "Vencido sem baixa" : label(PRAZO_STATUS, r, "status"))],
    ["Cumprido em", (r) => dt(r, "cumprido_em")],
    ["Responsável", (r) => consultor(r.responsavel_id)],
    ["Departamento", (r) => departamento(r.departamento_id)],
    ["Observações", (r) => str(r, "observacoes")],
  ],
};

function plain(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ entidade: string }> }) {
  const { entidade } = await params;
  const entity = Object.prototype.hasOwnProperty.call(ENTITIES, entidade) ? ENTITIES[entidade] : null;
  if (!entity) return plain(404, "Exportação não encontrada.");

  const session = await getSession();
  if (!session) return plain(401, "Sessão expirada. Entre novamente.");
  if (!session.profile.active) return plain(403, "Acesso pendente de liberação.");
  if (!can(session.profile, entity.permission)) return plain(403, "Você não tem permissão para esta exportação.");

  // Período opcional: ?mes=YYYY-MM  ou  ?de=YYYY-MM-DD&ate=YYYY-MM-DD
  const sp = req.nextUrl.searchParams;
  const mes = sp.get("mes");
  let de: string | null = null;
  let ate: string | null = null;
  if (isMonth(mes)) {
    de = firstDay(mes);
    ate = lastDay(mes);
  } else {
    const a = sp.get("de");
    const b = sp.get("ate");
    if (isISODate(a)) de = a;
    if (isISODate(b)) ate = b;
    if (de && ate && de > ate) [de, ate] = [ate, de];
  }

  const supabase = await createClient(); // cliente do usuário: RLS aplicado
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar", p_max: 30, p_janela_seg: 3600 });
  if (permitido !== true) return plain(429, "Muitas exportações em pouco tempo. Aguarde alguns minutos.");
  await supabase.rpc("registrar_acesso", { p_acao: "EXPORTACAO", p_tabela: entity.table, p_registro: null, p_detalhes: { entidade, de, ate } });
  const backoffice = isBackofficeRole(session.profile.role);

  const rows = await fetchAll<Row>((from, to) => {
    let q = supabase.from(entity.table).select(entity.select);
    if (!entity.dateCol) {
      // sem filtro de período
    } else if (entity.dateKind === "timestamp") {
      if (de) q = q.gte(entity.dateCol, spStartOf(de));
      if (ate) q = q.lt(entity.dateCol, spStartOf(addDays(ate, 1)));
    } else if (entity.dateKind === "month") {
      if (de) q = q.gte(entity.dateCol, firstDay(de.slice(0, 7)));
      if (ate) q = q.lte(entity.dateCol, firstDay(ate.slice(0, 7)));
    } else {
      if (de) q = q.gte(entity.dateCol, de);
      if (ate) q = q.lte(entity.dateCol, ate);
    }
    // Consultores só exportam as próprias comissões (o RLS também garante).
    if (entity.table === "comissoes" && !backoffice) q = q.eq("consultor_id", session.userId);
    return q.order(entity.orderCol ?? entity.dateCol ?? "id", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  }, MAX_ROWS);

  const [profiles, parceiros, deps] = await Promise.all([getProfileMap(), parceiroMap(), departamentoMap()]);
  const ctx = {
    backoffice,
    departamento: (id: unknown) => (typeof id === "string" ? (deps.get(id)?.nome ?? "") : ""),
    consultor: (id: unknown) => (typeof id === "string" ? (profiles.get(id)?.full_name ?? "") : ""),
    parceiro: (id: unknown) => (typeof id === "string" ? (parceiros.get(id) ?? "") : ""),
  };

  const csv = toCsv(entity.columns(ctx), rows);
  const filename = `ge-easy-${entidade}-${todayISO()}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(rows.length >= MAX_ROWS ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
