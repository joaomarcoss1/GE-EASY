"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { date, todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const RAMOS = ["auto", "vida", "residencial", "empresarial", "saude", "odonto", "viagem", "rc", "frota", "prestamista", "outros"] as const;
const APOLICE_STATUS = ["cotacao", "proposta", "vigente", "renovada", "cancelada", "vencida"] as const;
const SINISTRO_STATUS = ["aberto", "em_analise", "aprovado", "negado", "pago"] as const;

const apoliceSchema = z
  .object({
    cliente_id: zs.requiredUuid("o cliente"),
    seguradora_id: zs.uuid(),
    produto_id: zs.uuid(),
    ramo: zs.enumOf([...RAMOS], "Selecione o ramo"),
    numero_apolice: zs.text(60),
    numero_proposta: zs.text(60),
    item_segurado: zs.text(300),
    inicio_vigencia: zs.date(),
    fim_vigencia: zs.date(),
    premio_liquido: zs.money(),
    premio_total: zs.money(),
    forma_pagamento: zs.text(40),
    parcelas: zs.number(1, 24),
    comissao_percentual: zs.number(0, 100),
    status: zs.enumOf([...APOLICE_STATUS], "Selecione o status"),
    consultor_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!v.inicio_vigencia) issue("inicio_vigencia", "Informe o início da vigência");
    if (!v.fim_vigencia) issue("fim_vigencia", "Informe o fim da vigência");
    if (v.inicio_vigencia && v.fim_vigencia && v.fim_vigencia < v.inicio_vigencia) issue("fim_vigencia", "O fim da vigência deve ser igual ou posterior ao início");
    if (v.parcelas !== null && v.parcelas !== undefined && !Number.isInteger(v.parcelas)) issue("parcelas", "Informe um número inteiro de parcelas");
    if (v.premio_liquido !== null && v.premio_total !== null && v.premio_liquido !== undefined && v.premio_total !== undefined && v.premio_total < v.premio_liquido) {
      issue("premio_total", "O prêmio total não pode ser menor que o líquido");
    }
    if (v.status === "vigente" && !v.premio_liquido) issue("premio_liquido", "Informe o prêmio líquido da apólice vigente");
  })
  .transform((v) => ({
    ...v,
    inicio_vigencia: v.inicio_vigencia as string,
    fim_vigencia: v.fim_vigencia as string,
    premio_liquido: v.premio_liquido ?? 0,
    premio_total: v.premio_total ?? v.premio_liquido ?? 0,
    parcelas: v.parcelas ?? 1,
    comissao_percentual: v.comissao_percentual ?? 0,
  }));

function revalidateApolice(id?: string | null, clienteId?: string | null) {
  revalidatePath("/seguros");
  if (id) revalidatePath(`/seguros/${id}`);
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

export async function createApolice(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const parsed = apoliceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();

  const { data: cliente } = await supabase.from("clientes").select("id, consultor_id").eq("id", parsed.data.cliente_id).maybeSingle();
  if (!cliente) return { error: "Verifique os campos destacados.", fieldErrors: { cliente_id: "Cliente não encontrado ou sem acesso" } };

  const canTransfer = can(g.session.profile, "clientes.transfer");
  const consultor_id = (canTransfer ? parsed.data.consultor_id : null) ?? (cliente.consultor_id as string | null) ?? g.session.userId;
  const { data: row, error } = await supabase
    .from("seguro_apolices")
    .insert({ ...parsed.data, consultor_id })
    .select("id")
    .single();
  if (error) return dbError(error);
  revalidateApolice(row.id, parsed.data.cliente_id);
  revalidatePath("/comissoes");
  return { ok: true, message: "Seguro cadastrado.", id: row.id };
}

export async function updateApolice(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Apólice inválida." };
  const parsed = apoliceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { consultor_id, ...rest } = parsed.data;
  const payload: Record<string, unknown> = { ...rest };
  if (can(g.session.profile, "clientes.transfer") && consultor_id) payload.consultor_id = consultor_id;

  const supabase = await createClient();
  const { data, error } = await supabase.from("seguro_apolices").update(payload).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar esta apólice." };
  revalidateApolice(id, parsed.data.cliente_id);
  revalidatePath("/comissoes");
  return { ok: true, message: "Apólice atualizada.", id };
}

export async function deleteApolice(id: string): Promise<ActionState> {
  const g = await guard("negocios.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Apólice inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("seguro_apolices").delete().eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para excluir esta apólice." };
  revalidateApolice(null, data.cliente_id as string);
  revalidatePath("/comissoes");
  return { ok: true, message: "Apólice excluída." };
}

/** Soma 1 ano a uma data YYYY-MM-DD (29/02 vira 28/02). */
function addOneYear(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y + 1, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * Gera a renovação: nova apólice (status "proposta") com os mesmos dados,
 * vigência de 1 ano a partir do fim da atual, e marca a atual como "renovada".
 */
export async function renovarApolice(id: string): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Apólice inválida." };
  const supabase = await createClient();

  const { data: old, error: e1 } = await supabase.from("seguro_apolices").select("*").eq("id", id).maybeSingle();
  if (e1) return dbError(e1);
  if (!old) return { error: "Apólice não encontrada ou sem acesso." };
  const { data: existing } = await supabase.from("seguro_apolices").select("id").eq("renovacao_de", id).limit(1).maybeSingle();
  if (existing) return { error: "Esta apólice já possui uma renovação gerada.", id: existing.id as string };
  if (old.status !== "vigente" && old.status !== "vencida") return { error: "Somente apólices vigentes ou vencidas podem ser renovadas." };

  const inicio = old.fim_vigencia as string;
  const ref = old.numero_apolice ?? old.numero_proposta;
  const { data: row, error: e2 } = await supabase
    .from("seguro_apolices")
    .insert({
      cliente_id: old.cliente_id,
      seguradora_id: old.seguradora_id,
      produto_id: old.produto_id,
      renovacao_de: id,
      ramo: old.ramo,
      item_segurado: old.item_segurado,
      inicio_vigencia: inicio,
      fim_vigencia: addOneYear(inicio),
      premio_liquido: old.premio_liquido,
      premio_total: old.premio_total,
      forma_pagamento: old.forma_pagamento,
      parcelas: old.parcelas,
      comissao_percentual: old.comissao_percentual,
      status: "proposta",
      consultor_id: old.consultor_id,
      observacoes: `Renovação ${ref ? `da apólice ${ref}` : "da apólice anterior"} gerada em ${date(todayISO())}.`,
    })
    .select("id")
    .single();
  if (e2) return dbError(e2);

  const { error: e3 } = await supabase.from("seguro_apolices").update({ status: "renovada" }).eq("id", id);
  if (e3) return { ok: true, message: "Renovação gerada, mas não foi possível marcar a apólice anterior como renovada.", id: row.id };

  revalidateApolice(id, old.cliente_id as string);
  revalidatePath(`/seguros/${row.id}`);
  return { ok: true, message: "Renovação gerada como proposta. Revise prêmio e número da apólice.", id: row.id };
}

// ---------------------------------------------------------------------------
// Sinistros
// ---------------------------------------------------------------------------

const sinistroSchema = z
  .object({
    apolice_id: zs.requiredUuid("a apólice"),
    numero_sinistro: zs.text(60),
    data_ocorrencia: zs.date(),
    descricao: zs.required("Descrição", 5000),
    status: zs.enumOf([...SINISTRO_STATUS], "Selecione o status"),
    valor_indenizacao: zs.money(),
  })
  .superRefine((v, ctx) => {
    if (!v.data_ocorrencia) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_ocorrencia"], message: "Informe a data da ocorrência" });
    else if (v.data_ocorrencia > todayISO()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_ocorrencia"], message: "A data não pode estar no futuro" });
  });

export async function createSinistro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const parsed = sinistroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("seguro_sinistros").insert(parsed.data).select("id").single();
  if (error) return dbError(error);
  revalidateApolice(parsed.data.apolice_id);
  return { ok: true, message: "Sinistro registrado.", id: row.id };
}

export async function updateSinistro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Sinistro inválido." };
  const parsed = sinistroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { apolice_id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("seguro_sinistros").update(rest).eq("id", id).eq("apolice_id", apolice_id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este sinistro." };
  revalidateApolice(apolice_id);
  return { ok: true, message: "Sinistro atualizado.", id };
}

export async function deleteSinistro(id: string): Promise<ActionState> {
  const g = await guard("negocios.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Sinistro inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("seguro_sinistros").delete().eq("id", id).select("id, apolice_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para excluir este sinistro." };
  revalidateApolice(data.apolice_id as string);
  return { ok: true, message: "Sinistro removido." };
}
