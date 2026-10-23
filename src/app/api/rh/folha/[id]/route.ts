import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { isUuid, registrarAcesso } from "@/lib/actions/utils";
import { csvResponse, toCsv } from "@/lib/csv";

/** Exporta a pré-folha (CSV para a contabilidade). Só folha.gerir; exportação auditada. */
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !can(session.profile, "folha.gerir")) return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  if (!isUuid(id)) return NextResponse.json({ error: "inválido" }, { status: 400 });
  const supabase = await createClient();
  const { data: comp } = await supabase.from("folha_competencias").select("id, competencia, status").eq("id", id).maybeSingle();
  if (!comp) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  const { data: itens } = await supabase.from("folha_itens").select("*, funcionarios(nome, matricula, cargo)").eq("competencia_id", id);
  const n = (v: unknown) => Number(v ?? 0).toFixed(2).replace(".", ",");
  const linhas = (itens ?? []).map((i) => {
    const f = i.funcionarios as { nome: string; matricula: string | null; cargo: string | null };
    return [f.matricula ?? "", f.nome, f.cargo ?? "", n(i.salario_base), n(i.adicionais), String(i.horas_extras_min), n(i.valor_extras), String(i.faltas_min), n(i.desconto_faltas),
      n(i.comissoes), n(i.reembolsos), n(i.outros_proventos), n(i.outros_descontos), n(i.total), i.observacoes ?? ""];
  });
  await registrarAcesso("EXPORTACAO", "folha_competencias", id, { linhas: linhas.length });
  if (comp.status === "aprovada") await supabase.from("folha_competencias").update({ status: "exportada", exportada_em: new Date().toISOString() }).eq("id", id);
  const csv = toCsv(["Matrícula", "Nome", "Cargo", "Salário base", "Adicionais", "Extras (min)", "Valor extras", "Faltas/débitos (min)", "Desconto faltas", "Comissões", "Reembolsos", "Outros proventos", "Outros descontos", "Total"], linhas.map((l) => l.slice(0, 14)));
  return csvResponse(`pre-folha-${String(comp.competencia).slice(0, 7)}.csv`, csv);
}
