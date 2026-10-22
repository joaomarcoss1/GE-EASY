"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

function revalidar(processoId?: string | null, contratoId?: string | null) {
  revalidatePath("/financeiro");
  revalidatePath("/contratos");
  if (contratoId) revalidatePath(`/contratos/${contratoId}`);
  if (processoId) revalidatePath(`/processos/${processoId}`);
}

/** Soma `n` meses a uma data ISO mantendo o dia (limitado ao último dia do mês). */
function addMonths(iso: string, n: number, dia?: number | null) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dia ?? d, last));
  return target.toISOString().slice(0, 10);
}

const lancSchema = z.object({
  tipo: zs.enumOf(["receita", "despesa"]),
  categoria: zs.required("Categoria", 80),
  descricao: zs.required("Descrição", 300),
  valor: zs.money().refine((v) => v !== null && v > 0, "Informe o valor"),
  vencimento: zs.date().refine((v) => !!v, "Informe o vencimento"),
  status: zs.enumOf(["aberto", "pago", "cancelado"]),
  data_pagamento: zs.date(),
  forma_pagamento: zs.text(40),
  cliente_id: zs.uuid(),
  processo_id: zs.uuid(),
  contrato_id: zs.uuid(),
  departamento_id: zs.uuid(),
  fornecedor: zs.text(160),
  reembolsavel: zs.bool(),
  documento_ref: zs.text(80),
  observacoes: zs.text(2000),
  repetir: zs.number(1, 60),
});

/** Cria ou edita lançamento. Advogados só lançam despesas de processos que editam (RLS). */
export async function saveLancamento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = lancSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { repetir, ...v } = parsed.data;
  const fin = can(g.session.profile, "financeiro.view");
  if (!fin && !(v.tipo === "despesa" && v.processo_id && can(g.session.profile, "processos.write"))) {
    return { error: "Você só pode lançar despesas vinculadas a processos." };
  }
  const id = formData.get("id");
  const supabase = await createClient();
  if (isUuid(id)) {
    const { data, error } = await supabase.from("financeiro_lancamentos").update(v).eq("id", id).select("id").maybeSingle();
    if (error) return dbError(error);
    if (!data) return { error: "Sem permissão para alterar este lançamento." };
    revalidar(v.processo_id, v.contrato_id);
    return { ok: true, message: "Lançamento atualizado.", id };
  }
  const n = Math.max(1, Math.min(60, Math.round(repetir ?? 1)));
  const rows = Array.from({ length: n }, (_, i) => ({
    ...v,
    vencimento: addMonths(v.vencimento!, i),
    status: i === 0 ? v.status : "aberto",
    data_pagamento: i === 0 ? v.data_pagamento : null,
    parcela: n > 1 ? i + 1 : null,
    total_parcelas: n > 1 ? n : null,
  }));
  const { error } = await supabase.from("financeiro_lancamentos").insert(rows);
  if (error) return error.code === "42501" ? { error: "Sem permissão para este lançamento." } : dbError(error);
  revalidar(v.processo_id, v.contrato_id);
  return { ok: true, message: n > 1 ? `${n} lançamentos mensais criados.` : "Lançamento criado." };
}

export async function baixarLancamento(id: string): Promise<ActionState> {
  return setStatus(id, "pago");
}
export async function estornarLancamento(id: string): Promise<ActionState> {
  return setStatus(id, "aberto");
}
export async function cancelarLancamento(id: string): Promise<ActionState> {
  return setStatus(id, "cancelado");
}

async function setStatus(id: string, status: "aberto" | "pago" | "cancelado"): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lançamento inválido." };
  const supabase = await createClient();
  const patch = status === "pago" ? { status, data_pagamento: todayISO() } : { status };
  const { data, error } = await supabase.from("financeiro_lancamentos").update(patch).eq("id", id).select("processo_id, contrato_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este lançamento." };
  revalidar(data.processo_id, data.contrato_id);
  return { ok: true, message: status === "pago" ? "Baixa registrada." : status === "aberto" ? "Lançamento reaberto." : "Lançamento cancelado." };
}

export async function baixarEmLote(ids: string[]): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  const valid = ids.filter(isUuid).slice(0, 500);
  if (!valid.length) return { error: "Nenhum lançamento selecionado." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("financeiro_lancamentos").update({ status: "pago", data_pagamento: todayISO() }).in("id", valid).eq("status", "aberto").select("id");
  if (error) return dbError(error);
  revalidar();
  return { ok: true, message: `${data?.length ?? 0} lançamento(s) baixado(s).` };
}

export async function deleteLancamento(id: string): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lançamento inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("financeiro_lancamentos").delete().eq("id", id).select("processo_id, contrato_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Somente lançamentos em aberto podem ser excluídos (ou pela gestão)." };
  revalidar(data.processo_id, data.contrato_id);
  return { ok: true, message: "Lançamento excluído." };
}
