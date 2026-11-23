import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { protegerApi } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CASO_STATUS, INCONSISTENCIAS } from "@/lib/constants";
import { registrarAcesso } from "@/lib/actions/utils";
import { carregarInconsistencias, type Inconsistencia } from "@/lib/inconsistencias";
import { aba, gerarPlanilha, respostaPlanilha } from "@/lib/planilha";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rot = (opts: { value: string; label: string }[], v: string | null) => (v ? (opts.find((o) => o.value === v)?.label ?? v) : "");

export async function GET() {
  const session = await getSession();
  const bloqueio = await protegerApi(session);
  if (bloqueio) return bloqueio;
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "clientes.ver_todos") || !can(session.profile, "clientes.exportar")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar", p_max: 30, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitas exportações em pouco tempo. Aguarde alguns minutos." }, { status: 429 });
  const { todas, resumo } = await carregarInconsistencias(can(session.profile, "rotas.ver"));
  await registrarAcesso("EXPORTACAO", "cliente_casos", null, { relatorio: "inconsistencias", linhas: todas.length });
  const gravidade = (c: string) => INCONSISTENCIAS.find((i) => i.value === c)?.gravidade ?? "";
  const buf = await gerarPlanilha({
    titulo: "Inconsistências nos processos, clientes e rotas",
    empresa: session.empresa?.nome ?? "",
    usuario: session.profile.full_name || session.profile.email,
    resumo: [{ rotulo: "Total de inconsistências", valor: todas.length }, ...resumo.filter((r) => r.total > 0).map((r) => ({ rotulo: r.label, valor: r.total }))],
    abas: [
      aba<Inconsistencia>("Inconsistências", [
        { titulo: "Gravidade", valor: (i) => ({ alta: "Alta", media: "Média", baixa: "Baixa" } as Record<string, string>)[gravidade(i.chave)] ?? "", largura: 10 },
        { titulo: "Tipo de inconsistência", valor: (i) => rot(INCONSISTENCIAS, i.chave), largura: 34 },
        { titulo: "Cliente / rota", valor: (i) => i.cliente_nome ?? "", largura: 34 },
        { titulo: "Tipo de ação", valor: (i) => i.tipo ?? "", largura: 18 },
        { titulo: "Status", valor: (i) => rot(CASO_STATUS, i.status), largura: 16 },
        { titulo: "Detalhe", valor: (i) => i.detalhe, largura: 52 },
      ], [...todas].sort((a, b) => ["alta", "media", "baixa"].indexOf(gravidade(a.chave)) - ["alta", "media", "baixa"].indexOf(gravidade(b.chave)))),
    ],
  });
  return respostaPlanilha(buf, "inconsistencias");
}
