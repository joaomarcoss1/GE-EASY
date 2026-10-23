"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/format";
import { lerOfx } from "@/lib/financeiro/ofx";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);

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
  centro_custo_id: zs.uuid(),
  conta_id: zs.uuid(),
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
  if (error) return erroDb(error);
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
  if (error) return erroDb(error);
  revalidar();
  return { ok: true, message: `${data?.length ?? 0} lançamento(s) baixado(s).` };
}

export async function deleteLancamento(id: string): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lançamento inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("financeiro_lancamentos").delete().eq("id", id).select("processo_id, contrato_id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Somente lançamentos em aberto podem ser excluídos (ou pela gestão)." };
  revalidar(data.processo_id, data.contrato_id);
  return { ok: true, message: "Lançamento excluído." };
}

// ------------------------------------------------------------------ fase 8: cadastros, recorrências, alçada, conciliação
const revalidarGestao = () => {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/gestao");
  revalidatePath("/financeiro/relatorios");
};

const centroSchema = z.object({
  id: zs.uuid(), nome: zs.required("Nome", 120), tipo: zs.enumOf(["departamento", "rota", "equipe", "campanha", "projeto", "outro"]), departamento_id: zs.uuid(), ativo: zs.bool(),
});
export async function salvarCentroCusto(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  const parsed = centroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { error } = id ? await supabase.from("centros_custo").update(v).eq("id", id) : await supabase.from("centros_custo").insert(v);
  if (error) return error.code === "23505" ? { error: "Já existe um centro de custo com este nome." } : erroDb(error);
  revalidarGestao();
  return { ok: true, message: "Centro de custo salvo." };
}

const contaSchema = z.object({
  id: zs.uuid(), nome: zs.required("Nome", 120), banco: zs.text(80), agencia: zs.text(20), conta: zs.text(30), saldo_inicial: zs.money(), saldo_inicial_em: zs.date(), ativo: zs.bool(),
});
export async function salvarContaBancaria(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  const parsed = contaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const row = { ...v, saldo_inicial: v.saldo_inicial ?? 0, saldo_inicial_em: v.saldo_inicial_em ?? todayISO() };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("contas_bancarias").update(row).eq("id", id) : await supabase.from("contas_bancarias").insert(row);
  if (error) return erroDb(error);
  revalidarGestao();
  return { ok: true, message: "Conta salva." };
}

const recSchema = z.object({
  id: zs.uuid(), tipo: zs.enumOf(["receita", "despesa"]), categoria: zs.required("Categoria", 80), descricao: zs.required("Descrição", 300),
  valor: zs.money().refine((v) => v !== null && v > 0, "Informe o valor"), dia_vencimento: zs.number(1, 31).refine((v) => v !== null, "Informe o dia"),
  fornecedor: zs.text(200), cliente_id: zs.uuid(), departamento_id: zs.uuid(), centro_custo_id: zs.uuid(), conta_id: zs.uuid(),
  inicio: zs.date().refine((v) => !!v, "Informe o início"), fim: zs.date(), ativo: zs.bool(),
});
export async function salvarRecorrencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  const parsed = recSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const row = { ...v, dia_vencimento: Math.round(v.dia_vencimento!), inicio: `${v.inicio!.slice(0, 7)}-01` };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("financeiro_recorrencias").update(row).eq("id", id) : await supabase.from("financeiro_recorrencias").insert(row);
  if (error) return erroDb(error);
  const { data: n } = await supabase.rpc("gerar_recorrencias", { p_empresa: g.session.empresa!.id });
  revalidarGestao();
  return { ok: true, message: `Recorrência salva${n ? `; ${n} lançamento(s) gerado(s)` : ""}. Os próximos meses são gerados automaticamente.` };
}

const aprovSchema = z.object({ id: zs.requiredUuid("o lançamento"), aprovar: zs.enumOf(["sim", "nao"]), observacao: zs.text(500) });
export async function decidirAprovacao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.pagar");
  if ("denied" in g) return g.denied;
  const parsed = aprovSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_lancamento", { p_id: parsed.data.id, p_aprovar: parsed.data.aprovar === "sim", p_obs: parsed.data.observacao });
  if (error) return erroDb(error);
  revalidarGestao();
  return { ok: true, message: parsed.data.aprovar === "sim" ? "Despesa aprovada: já pode ser paga." : "Despesa recusada." };
}

export async function importarExtrato(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  const conta = formData.get("conta_id");
  const file = formData.get("arquivo");
  if (!isUuid(conta)) return { error: "Escolha a conta.", fieldErrors: { conta_id: "Obrigatório" } };
  if (!(file instanceof File) || !file.size) return { error: "Escolha o arquivo OFX.", fieldErrors: { arquivo: "Obrigatório" } };
  if (file.size > 3 * 1024 * 1024) return { error: "O extrato deve ter até 3 MB." };
  const texto = new TextDecoder("latin1").decode(await file.arrayBuffer());
  if (!/<OFX>/i.test(texto)) return { error: "O arquivo não é um extrato OFX." };
  const movs = lerOfx(texto).slice(0, 5000);
  if (!movs.length) return { error: "Nenhuma transação encontrada no extrato." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("extrato_movimentos").upsert(movs.map((m) => ({ ...m, conta_id: conta })), { onConflict: "conta_id,fitid", ignoreDuplicates: true }).select("id");
  if (error) return erroDb(error);
  revalidarGestao();
  return { ok: true, message: `${data?.length ?? 0} movimento(s) novo(s) de ${movs.length} no arquivo (os já importados foram ignorados).` };
}

export async function conciliarMovimento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  const parsed = z.object({ movimento_id: zs.requiredUuid("o movimento"), lancamento_id: zs.requiredUuid("o lançamento") }).safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("conciliar_movimento", { p_mov: parsed.data.movimento_id, p_lanc: parsed.data.lancamento_id });
  if (error) return erroDb(error);
  revalidarGestao();
  return { ok: true, message: "Conciliado e baixado." };
}

/** Confirma todas as sugestões automáticas da conta (mesmo valor, até 5 dias de diferença, um para um). */
export async function conciliarSugestoes(contaId: string): Promise<ActionState> {
  const g = await guard("financeiro.conciliar");
  if ("denied" in g) return g.denied;
  if (!isUuid(contaId)) return { error: "Conta inválida." };
  const supabase = await createClient();
  const { data: sug } = await supabase.rpc("sugerir_conciliacao", { p_conta: contaId });
  let ok = 0;
  for (const s of (sug ?? []) as { movimento_id: string; lancamento_id: string }[]) {
    const { error } = await supabase.rpc("conciliar_movimento", { p_mov: s.movimento_id, p_lanc: s.lancamento_id });
    if (!error) ok++;
  }
  revalidarGestao();
  return { ok: true, message: `${ok} movimento(s) conciliado(s).` };
}

const paramFinSchema = z.object({ alcada_aprovacao: zs.money() });
export async function salvarParametrosFinanceiro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.pagar");
  if ("denied" in g) return g.denied;
  const parsed = paramFinSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").upsert({ chave: "financeiro", valor: { alcada_aprovacao: parsed.data.alcada_aprovacao ?? 0 }, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidarGestao();
  return { ok: true, message: "Alçada salva. Vale para os próximos lançamentos." };
}
