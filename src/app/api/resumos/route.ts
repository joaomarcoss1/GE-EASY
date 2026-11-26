import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { protegerApi } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { DIA_AVALIACOES, LIGACAO_RESULTADOS } from "@/lib/constants";
import { date, todayISO } from "@/lib/format";
import { registrarAcesso } from "@/lib/actions/utils";
import { isISODate } from "@/components/dashboard/periods";
import { aba, gerarPlanilha, paraData, respostaPlanilha } from "@/lib/planilha";
import { fetchAll } from "@/components/dashboard/fetch-all";

export const dynamic = "force-dynamic";

interface Resumo {
  usuario_id: string; data: string; processos_novos: number; processos_trabalhados: number; ligacoes: number; visitas: number;
  documentos_coletados: number; pendencias_resolvidas: number; exigencias_cumpridas: number; avaliacao: string | null; atividades: string | null; dificuldades: string | null;
  plano_amanha: string | null; atualizado_em: string; ligacoes_detalhe: { nome: string; resultado: string; cliente_id?: string | null }[];
}
const rot = (o: { value: string; label: string }[], v: string | null) => (v ? (o.find((x) => x.value === v)?.label ?? v) : "");

/** Planilha dos resumos do dia (período): resumo por pessoa, resumos e ligações. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  const bloqueio = await protegerApi(session);
  if (bloqueio) return bloqueio;
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "clientes.exportar") || !(can(session.profile, "consultores.manage") || can(session.profile, "clientes.ver_todos"))) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const hoje = todayISO();
  let de = isISODate(sp.get("de")) ? sp.get("de")! : `${hoje.slice(0, 8)}01`;
  let ate = isISODate(sp.get("ate")) ? sp.get("ate")! : hoje;
  if (de > ate) [de, ate] = [ate, de];
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar", p_max: 30, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitas exportações em pouco tempo." }, { status: 429 });
  const [data, profiles] = await Promise.all([
    fetchAll<Resumo>((from, to) => supabase.from("resumos_diarios").select("*").gte("data", de).lte("data", ate).order("data", { ascending: false }).order("usuario_id").range(from, to), 50_000),
    getProfileMap(),
  ]);
  const resumos = data;
  const nome = (u: string) => profiles.get(u)?.full_name ?? "—";
  await registrarAcesso("EXPORTACAO", "resumos_diarios", null, { de, ate, linhas: resumos.length });
  const porPessoa = [...new Set(resumos.map((r) => r.usuario_id))].map((u) => {
    const l = resumos.filter((r) => r.usuario_id === u);
    const soma = (k: keyof Resumo) => l.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    return { nome: nome(u), dias: l.length, novos: soma("processos_novos"), trab: soma("processos_trabalhados"), lig: soma("ligacoes"), vis: soma("visitas"), docs: soma("documentos_coletados"), pend: soma("pendencias_resolvidas"), exig: soma("exigencias_cumpridas") };
  }).sort((a, b) => b.novos - a.novos);
  const ligacoes = resumos.flatMap((r) => r.ligacoes_detalhe.map((l) => ({ ...l, data: r.data, usuario: nome(r.usuario_id) })));

  const buf = await gerarPlanilha({
    titulo: "Resumos do dia dos consultores e assessores",
    empresa: session.empresa?.nome ?? "",
    usuario: session.profile.full_name || session.profile.email,
    filtros: [`Período: ${date(de)} a ${date(ate)}`],
    resumo: [
      { rotulo: "Resumos enviados", valor: resumos.length },
      { rotulo: "Processos novos (declarados)", valor: resumos.reduce((a, r) => a + r.processos_novos, 0) },
      { rotulo: "Processos trabalhados", valor: resumos.reduce((a, r) => a + r.processos_trabalhados, 0) },
      { rotulo: "Ligações", valor: resumos.reduce((a, r) => a + r.ligacoes, 0) },
      { rotulo: "Visitas / atendimentos", valor: resumos.reduce((a, r) => a + r.visitas, 0) },
    ],
    abas: [
      aba("Por pessoa", [
        { titulo: "Consultor / assessor", valor: (r) => r.nome, largura: 28 },
        { titulo: "Dias com resumo", valor: (r) => r.dias, formato: "inteiro", largura: 12 },
        { titulo: "Processos novos", valor: (r) => r.novos, formato: "inteiro", largura: 12 },
        { titulo: "Trabalhados", valor: (r) => r.trab, formato: "inteiro", largura: 12 },
        { titulo: "Ligações", valor: (r) => r.lig, formato: "inteiro", largura: 10 },
        { titulo: "Visitas", valor: (r) => r.vis, formato: "inteiro", largura: 10 },
        { titulo: "Documentos", valor: (r) => r.docs, formato: "inteiro", largura: 11 },
        { titulo: "Pendências resolvidas", valor: (r) => r.pend, formato: "inteiro", largura: 12 },
        { titulo: "Exigências cumpridas", valor: (r) => r.exig, formato: "inteiro", largura: 12 },
      ], porPessoa),
      aba<Resumo>("Resumos", [
        { titulo: "Data", valor: (r) => paraData(r.data), formato: "data", largura: 12 },
        { titulo: "Consultor / assessor", valor: (r) => nome(r.usuario_id), largura: 26 },
        { titulo: "Processos novos", valor: (r) => r.processos_novos, formato: "inteiro", largura: 11 },
        { titulo: "Trabalhados", valor: (r) => r.processos_trabalhados, formato: "inteiro", largura: 11 },
        { titulo: "Ligações", valor: (r) => r.ligacoes, formato: "inteiro", largura: 9 },
        { titulo: "Visitas", valor: (r) => r.visitas, formato: "inteiro", largura: 9 },
        { titulo: "Documentos", valor: (r) => r.documentos_coletados, formato: "inteiro", largura: 10 },
        { titulo: "Pendências resolvidas", valor: (r) => r.pendencias_resolvidas, formato: "inteiro", largura: 11 },
        { titulo: "Exigências cumpridas", valor: (r) => r.exigencias_cumpridas ?? 0, formato: "inteiro", largura: 11 },
        { titulo: "Dia", valor: (r) => rot(DIA_AVALIACOES, r.avaliacao), largura: 10 },
        { titulo: "Destaques", valor: (r) => r.atividades ?? "", largura: 40 },
        { titulo: "Dificuldades / pendências", valor: (r) => r.dificuldades ?? "", largura: 40 },
        { titulo: "Plano para amanhã", valor: (r) => r.plano_amanha ?? "", largura: 40 },
        { titulo: "Enviado em", valor: (r) => paraData(r.atualizado_em), formato: "datahora", largura: 16 },
      ], resumos),
      aba("Ligações", [
        { titulo: "Data", valor: (l) => paraData(l.data), formato: "data", largura: 12 },
        { titulo: "Quem ligou", valor: (l) => l.usuario, largura: 26 },
        { titulo: "Para quem", valor: (l) => l.nome, largura: 32 },
        { titulo: "Cliente cadastrado", valor: (l) => !!l.cliente_id, largura: 12 },
        { titulo: "Resultado", valor: (l) => rot(LIGACAO_RESULTADOS, l.resultado), largura: 18 },
      ], ligacoes),
    ],
  });
  return respostaPlanilha(buf, "resumos-do-dia");
}
