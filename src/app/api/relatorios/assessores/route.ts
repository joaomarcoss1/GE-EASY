import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { protegerApi } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";
import { date, maskDocumento, maskPhone, todayISO } from "@/lib/format";
import { registrarAcesso } from "@/lib/actions/utils";
import { carregarRelatorio, lerFiltroRelatorio, type CasoRelatorio } from "@/lib/relatorio-assessor";
import { aba, gerarPlanilha, paraData, respostaPlanilha } from "@/lib/planilha";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rot = (opts: { value: string; label: string }[], v: string | null) => (v ? (opts.find((o) => o.value === v)?.label ?? v) : "");

/** Planilha do relatório por assessor: resumo, resumo por assessor e lista de processos. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  const bloqueio = await protegerApi(session);
  if (bloqueio) return bloqueio;
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "clientes.ver_todos") || !can(session.profile, "clientes.exportar")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar", p_max: 30, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitas exportações em pouco tempo. Aguarde alguns minutos." }, { status: 429 });
  const f = lerFiltroRelatorio(Object.fromEntries(req.nextUrl.searchParams));
  const [casos, { data: assessoresData }] = await Promise.all([carregarRelatorio(f), supabase.from("assessores").select("id, nome")]);
  const nomes = new Map((assessoresData ?? []).map((a) => [a.id as string, a.nome as string]));
  const nome = (c: CasoRelatorio) => (c.assessor_id ? (nomes.get(c.assessor_id) ?? "") : (c.corretor ?? "Sem assessor"));
  const hoje = todayISO();
  await registrarAcesso("EXPORTACAO", "cliente_casos", null, { relatorio: "assessor", ...f, linhas: casos.length });

  const grupos = new Map<string, CasoRelatorio[]>();
  for (const c of casos) grupos.set(c.assessor_id ?? "sem", [...(grupos.get(c.assessor_id ?? "sem") ?? []), c]);
  const resumoAssessores = [...grupos.entries()].map(([id, l]) => ({
    assessor: id === "sem" ? "Sem assessor" : (nomes.get(id) ?? ""),
    total: l.length,
    ...Object.fromEntries(CASO_STATUS.map((s) => [s.value, l.filter((c) => c.status === s.value).length])),
    sem_assinatura: l.filter((c) => c.assinaturas === "faltando").length,
    exig_vencidas: l.filter((c) => c.status === "exigencia" && c.exigencia_prazo && c.exigencia_prazo < hoje).length,
  })).sort((a, b) => b.total - a.total) as ({ assessor: string; total: number; sem_assinatura: number; exig_vencidas: number } & Record<string, number | string>)[];

  const filtroAssessor = f.assessor === "sem" ? "Sem assessor" : f.assessor ? (nomes.get(f.assessor) ?? "") : "Todos";
  const buf = await gerarPlanilha({
    titulo: "Relatório de processos por assessor",
    empresa: session.empresa?.nome ?? "",
    usuario: session.profile.full_name || session.profile.email,
    filtros: [`Assessor: ${filtroAssessor}`, `Recebidos de ${date(f.de)} a ${date(f.ate)}`],
    resumo: [
      { rotulo: "Processos gerados", valor: casos.length },
      { rotulo: "Clientes", valor: new Set(casos.map((c) => c.cliente_id)).size },
      ...CASO_STATUS.map((s) => ({ rotulo: `Status: ${s.label}`, valor: casos.filter((c) => c.status === s.value).length })),
      { rotulo: "Exigências com prazo vencido", valor: casos.filter((c) => c.status === "exigencia" && c.exigencia_prazo && c.exigencia_prazo < hoje).length },
      { rotulo: "Sem contrato ou procuração assinados", valor: casos.filter((c) => c.assinaturas === "faltando").length },
      { rotulo: "Habilitados sem protocolo do INSS", valor: casos.filter((c) => c.status === "habilitado" && !c.protocolo_inss).length },
    ],
    abas: [
      aba("Por assessor", [
        { titulo: "Assessor", valor: (r) => r.assessor, largura: 30 },
        { titulo: "Processos", valor: (r) => r.total, formato: "inteiro", largura: 11 },
        ...CASO_STATUS.map((s) => ({ titulo: s.label, valor: (r: (typeof resumoAssessores)[number]) => Number(r[s.value] ?? 0), formato: "inteiro" as const, largura: 12 })),
        { titulo: "Sem assinatura", valor: (r) => r.sem_assinatura, formato: "inteiro", largura: 12 },
        { titulo: "Exigências vencidas", valor: (r) => r.exig_vencidas, formato: "inteiro", largura: 12 },
      ], resumoAssessores),
      aba<CasoRelatorio>("Processos", [
        { titulo: "Assessor", valor: (c) => nome(c), largura: 22 },
        { titulo: "Cliente", valor: (c) => c.clientes.nome, largura: 32 },
        { titulo: "CPF", valor: (c) => (c.clientes.documento ? maskDocumento(c.clientes.documento) : ""), largura: 16 },
        { titulo: "Telefone", valor: (c) => maskPhone(c.clientes.whatsapp || c.clientes.telefone), largura: 16 },
        { titulo: "Tipo de ação", valor: (c) => c.tipo, largura: 18 },
        { titulo: "Cidade", valor: (c) => [c.cidade, c.uf].filter(Boolean).join("/"), largura: 20 },
        { titulo: "Recebido em", valor: (c) => paraData(c.recebido_em), formato: "data", largura: 13 },
        { titulo: "Status", valor: (c) => rot(CASO_STATUS, c.status), largura: 16 },
        { titulo: "Estado atual", valor: (c) => c.situacao_atual ?? "", largura: 28 },
        { titulo: "Habilitado em", valor: (c) => paraData(c.habilitado_em), formato: "data", largura: 13 },
        { titulo: "Protocolo INSS", valor: (c) => c.protocolo_inss ?? "", largura: 18 },
        { titulo: "Pendência", valor: (c) => rot(CASO_PENDENCIAS, c.pendencia), largura: 22 },
        { titulo: "Prazo da exigência", valor: (c) => (c.status === "exigencia" ? paraData(c.exigencia_prazo) : null), formato: "data", largura: 14 },
        { titulo: "Exigência vencida", valor: (c) => (c.status === "exigencia" ? !!(c.exigencia_prazo && c.exigencia_prazo < hoje) : null), largura: 11 },
        { titulo: "Assinaturas", valor: (c) => (c.assinaturas === "faltando" ? "Faltando" : c.assinaturas === "completas" ? "Completas" : ""), largura: 12 },
      ], casos),
    ],
  });
  return respostaPlanilha(buf, `relatorio-assessor-${filtroAssessor}`);
}
