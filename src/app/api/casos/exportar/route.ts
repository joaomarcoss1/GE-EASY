import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";
import { maskDocumento, maskPhone, todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { aplicarFiltros, lerFiltros, SELECT_CASOS } from "@/lib/casos";
import { registrarAcesso } from "@/lib/actions/utils";
import { aba, gerarPlanilha, paraData, respostaPlanilha, type Coluna } from "@/lib/planilha";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Linha = Record<string, unknown> & {
  clientes: { nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
  assessores: { nome: string } | { nome: string }[] | null;
};

const rot = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v == null ? "" : String(v));
const nomeAssessor = (r: Linha) => (Array.isArray(r.assessores) ? r.assessores[0]?.nome : r.assessores?.nome) ?? "";
const texto = (v: unknown) => (v == null ? "" : String(v));

const COLUNAS: Coluna<Linha>[] = [
  { titulo: "Cliente", valor: (r) => r.clientes.nome, largura: 34 },
  { titulo: "CPF", valor: (r) => (r.clientes.documento ? maskDocumento(r.clientes.documento) : ""), largura: 16 },
  { titulo: "Telefone", valor: (r) => maskPhone(r.clientes.whatsapp || r.clientes.telefone), largura: 16 },
  { titulo: "Tipo de ação", valor: (r) => texto(r.tipo), largura: 18 },
  { titulo: "Status", valor: (r) => rot(CASO_STATUS, r.status), largura: 16 },
  { titulo: "Estado atual", valor: (r) => texto(r.situacao_atual), largura: 28 },
  { titulo: "Protocolo INSS", valor: (r) => texto(r.protocolo_inss), largura: 18 },
  { titulo: "Assessor", valor: (r) => nomeAssessor(r) || texto(r.corretor), largura: 20 },
  { titulo: "Corretor (planilha)", valor: (r) => texto(r.corretor), largura: 20 },
  { titulo: "Cidade", valor: (r) => texto(r.cidade), largura: 22 },
  { titulo: "UF", valor: (r) => texto(r.uf), largura: 6 },
  { titulo: "Recebido em", valor: (r) => paraData(r.recebido_em as string | null), formato: "data", largura: 13 },
  { titulo: "Habilitado em", valor: (r) => paraData(r.habilitado_em as string | null), formato: "data", largura: 13 },
  { titulo: "Perícia", valor: (r) => paraData(r.pericia_em as string | null), formato: "data", largura: 12 },
  { titulo: "Avaliação", valor: (r) => paraData(r.avaliacao_em as string | null), formato: "data", largura: 12 },
  { titulo: "Prazo da exigência", valor: (r) => paraData(r.exigencia_prazo as string | null), formato: "data", largura: 14 },
  { titulo: "Exigência prorrogada", valor: (r) => (r.status === "exigencia" ? r.exigencia_prorrogada === true : null), largura: 12 },
  { titulo: "Exigência (planilha)", valor: (r) => (r.exigencia_estado === "aberta" ? "Em aberto" : r.exigencia_estado === "cumprida" ? "Cumprida" : ""), largura: 14 },
  { titulo: "Pendência", valor: (r) => rot(CASO_PENDENCIAS, r.pendencia), largura: 24 },
  { titulo: "Contrato assinado", valor: (r) => (r.contrato_assinado == null ? null : r.contrato_assinado === true), largura: 11 },
  { titulo: "Procuração assinada", valor: (r) => (r.procuracao_assinada == null ? null : r.procuracao_assinada === true), largura: 11 },
  { titulo: "Ano (planilha)", valor: (r) => (r.ano == null ? null : Number(r.ano)), formato: "inteiro", largura: 9 },
  { titulo: "Observações", valor: (r) => texto(r.observacoes), largura: 48 },
];

/** Exporta os processos dos clientes (planilha .xlsx com resumo; ?formato=csv mantém o CSV) com os filtros da tela. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "clientes.exportar") || !can(session.profile, "clientes.ver_todos")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const f = lerFiltros(sp);
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar", p_max: 30, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitas exportações em pouco tempo. Aguarde alguns minutos." }, { status: 429 });
  const linhas: Linha[] = [];
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await aplicarFiltros(supabase.from("cliente_casos").select(SELECT_CASOS).order("recebido_em", { ascending: false, nullsFirst: false }).order("id").range(i, i + 999), f);
    if (error) return NextResponse.json({ error: "Não foi possível exportar." }, { status: 400 });
    linhas.push(...((data ?? []) as unknown as Linha[]));
    if (!data || data.length < 1000) break;
  }
  await registrarAcesso("EXPORTACAO", "cliente_casos", null, { linhas: linhas.length, filtros: f });

  if (sp.formato === "csv") {
    const csv = toCsv(COLUNAS.map((c) => c.titulo), linhas.map((r) => COLUNAS.map((c) => {
      const v = c.valor(r);
      return v instanceof Date ? v.toISOString().slice(0, 10).split("-").reverse().join("/") : typeof v === "boolean" ? (v ? "Sim" : "Não") : (v ?? "");
    })));
    return csvResponse(`processos-clientes-${todayISO()}.csv`, csv);
  }

  const filtros = [
    f.q && `Busca: ${f.q}`,
    f.status && `Status: ${rot(CASO_STATUS, f.status)}`,
    f.tipo && `Tipo: ${f.tipo}`,
    f.corretor && `Assessor/corretor: ${f.corretor}${f.principal ? " (principal)" : ""}`,
    f.cidade && `Cidade: ${f.cidade}`,
    f.ano && `Ano: ${f.ano}`,
    f.pendencia && `Pendência: ${rot(CASO_PENDENCIAS, f.pendencia)}`,
    f.habilitado !== null && `Habilitação: ${f.habilitado ? "com data" : "sem data"}`,
    f.exigencia && `Exigência: ${f.exigencia}`,
    f.assinaturas && `Assinaturas: ${f.assinaturas}`,
  ].filter(Boolean) as string[];
  const porStatus = CASO_STATUS.map((s) => ({ rotulo: `Status: ${s.label}`, valor: linhas.filter((l) => l.status === s.value).length })).filter((x) => x.valor > 0);
  const buf = await gerarPlanilha({
    titulo: "Processos dos clientes",
    empresa: session.empresa?.nome ?? "",
    usuario: session.profile.full_name || session.profile.email,
    filtros,
    resumo: [
      { rotulo: "Total de processos", valor: linhas.length },
      { rotulo: "Clientes", valor: new Set(linhas.map((l) => l.cliente_id)).size },
      ...porStatus,
      { rotulo: "Habilitados sem protocolo do INSS", valor: linhas.filter((l) => l.status === "habilitado" && !l.protocolo_inss).length },
      { rotulo: "Sem contrato ou procuração assinados", valor: linhas.filter((l) => l.assinaturas === "faltando").length },
    ],
    abas: [aba("Processos", COLUNAS, linhas)],
  });
  return respostaPlanilha(buf, "processos-clientes");
}
