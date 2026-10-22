"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const CATEGORIAS = ["imovel", "veiculo", "moto", "pesados", "servicos", "agro"] as const;
const COTA_STATUS = ["proposta", "ativa", "contemplada", "quitada", "cancelada", "inadimplente"] as const;
const FORMAS = ["sorteio", "lance_livre", "lance_fixo", "lance_embutido"] as const;
const RESULTADOS = ["pendente", "contemplado", "nao_contemplado"] as const;

const isInt = (v: number | null | undefined) => v === null || v === undefined || Number.isInteger(v);

const cotaSchema = z
  .object({
    cliente_id: zs.requiredUuid("o cliente"),
    administradora_id: zs.uuid(),
    produto_id: zs.uuid(),
    categoria: zs.enumOf([...CATEGORIAS], "Selecione a categoria"),
    grupo: zs.text(30),
    cota: zs.text(30),
    numero_contrato: zs.text(60),
    valor_credito: zs.money(),
    prazo_meses: zs.number(1, 400),
    parcela_valor: zs.money(),
    taxa_adm: zs.number(0, 100),
    fundo_reserva: zs.number(0, 100),
    data_adesao: zs.date(),
    dia_vencimento: zs.number(1, 31),
    parcelas_pagas: zs.number(0, 400),
    status: zs.enumOf([...COTA_STATUS], "Selecione o status"),
    contemplada_em: zs.date(),
    forma_contemplacao: z.union([zs.enumOf([...FORMAS]), z.literal("")]).optional().transform((v) => (v ? v : null)),
    valor_lance: zs.money(),
    consultor_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!v.valor_credito || v.valor_credito <= 0) issue("valor_credito", "Informe o valor do crédito");
    if (!v.prazo_meses) issue("prazo_meses", "Informe o prazo em meses");
    else if (!isInt(v.prazo_meses)) issue("prazo_meses", "O prazo deve ser um número inteiro");
    if (!isInt(v.parcelas_pagas)) issue("parcelas_pagas", "Informe um número inteiro");
    if (!isInt(v.dia_vencimento)) issue("dia_vencimento", "Informe um dia entre 1 e 31");
    if (v.prazo_meses && v.parcelas_pagas && v.parcelas_pagas > v.prazo_meses) issue("parcelas_pagas", "Não pode ser maior que o prazo");
    if (!v.data_adesao) issue("data_adesao", "Informe a data de adesão");
    if (v.contemplada_em && v.data_adesao && v.contemplada_em < v.data_adesao) issue("contemplada_em", "Anterior à data de adesão");
  })
  .transform((v) => ({
    ...v,
    parcela_valor: v.parcela_valor ?? 0,
    taxa_adm: v.taxa_adm ?? 0,
    fundo_reserva: v.fundo_reserva ?? 0,
    parcelas_pagas: v.parcelas_pagas ?? 0,
    data_adesao: v.data_adesao ?? todayISO(),
  }));

function revalidateCota(id?: string, clienteId?: string | null) {
  revalidatePath("/consorcios");
  if (id) revalidatePath(`/consorcios/${id}`);
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

export async function createCota(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const parsed = cotaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();

  // Confirma acesso ao cliente (RLS) e herda o consultor responsável da carteira
  const { data: cliente } = await supabase.from("clientes").select("id, consultor_id").eq("id", parsed.data.cliente_id).maybeSingle();
  if (!cliente) return { error: "Verifique os campos destacados.", fieldErrors: { cliente_id: "Cliente não encontrado ou sem acesso" } };

  const canTransfer = can(g.session.profile, "clientes.transfer");
  const consultor_id = (canTransfer ? parsed.data.consultor_id : null) ?? (cliente.consultor_id as string | null) ?? g.session.userId;
  const { data: row, error } = await supabase
    .from("consorcio_cotas")
    .insert({ ...parsed.data, consultor_id })
    .select("id")
    .single();
  if (error) return dbError(error);
  revalidateCota(row.id, parsed.data.cliente_id);
  revalidatePath("/comissoes");
  return { ok: true, message: parsed.data.status === "proposta" ? "Proposta de consórcio cadastrada." : "Cota cadastrada.", id: row.id };
}

export async function updateCota(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Cota inválida." };
  const parsed = cotaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { consultor_id, ...rest } = parsed.data;
  const payload: Record<string, unknown> = { ...rest };
  // Somente a gestão transfere a carteira; vazio = mantém o responsável atual
  if (can(g.session.profile, "clientes.transfer") && consultor_id) payload.consultor_id = consultor_id;

  const supabase = await createClient();
  const { data, error } = await supabase.from("consorcio_cotas").update(payload).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar esta cota." };
  revalidateCota(id, parsed.data.cliente_id);
  revalidatePath("/comissoes");
  return { ok: true, message: "Cota atualizada.", id };
}

export async function deleteCota(id: string): Promise<ActionState> {
  const g = await guard("negocios.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cota inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("consorcio_cotas").delete().eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para excluir esta cota." };
  revalidateCota(undefined, data.cliente_id as string);
  revalidatePath("/comissoes");
  return { ok: true, message: "Cota excluída." };
}

// ---------------------------------------------------------------------------
// Lances e assembleias
// ---------------------------------------------------------------------------

const lanceSchema = z
  .object({
    cota_id: zs.requiredUuid("a cota"),
    data_assembleia: zs.date(),
    tipo: zs.enumOf([...FORMAS], "Selecione o tipo de lance"),
    percentual: zs.number(0, 100),
    valor: zs.money(),
    resultado: zs.enumOf([...RESULTADOS], "Selecione o resultado"),
    observacoes: zs.text(2000),
  })
  .superRefine((v, ctx) => {
    if (!v.data_assembleia) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_assembleia"], message: "Informe a data da assembleia" });
    if (v.tipo !== "sorteio" && v.percentual === null && v.valor === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor"], message: "Informe o valor ou o percentual do lance" });
    }
  });

function lanceMessage(resultado: string, base: string) {
  return resultado === "contemplado" ? `${base} Cota marcada como contemplada!` : base;
}

export async function createLance(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const parsed = lanceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("consorcio_lances").insert(parsed.data).select("id").single();
  if (error) return dbError(error);
  revalidateCota(parsed.data.cota_id);
  return { ok: true, message: lanceMessage(parsed.data.resultado, "Lance registrado."), id: row.id };
}

export async function updateLance(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Lance inválido." };
  const parsed = lanceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { cota_id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("consorcio_lances").update(rest).eq("id", id).eq("cota_id", cota_id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este lance." };
  revalidateCota(cota_id);
  return { ok: true, message: lanceMessage(rest.resultado, "Lance atualizado."), id };
}

/** Atualização rápida do resultado da assembleia (usada no seletor da tabela). */
export async function updateLanceResultado(id: string, resultado: string): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lance inválido." };
  const r = z.enum(RESULTADOS).safeParse(resultado);
  if (!r.success) return { error: "Resultado inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("consorcio_lances").update({ resultado: r.data }).eq("id", id).select("id, cota_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este lance." };
  revalidateCota(data.cota_id as string);
  return { ok: true, message: lanceMessage(r.data, "Resultado atualizado.") };
}

export async function deleteLance(id: string): Promise<ActionState> {
  const g = await guard("negocios.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lance inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("consorcio_lances").delete().eq("id", id).select("id, cota_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para excluir este lance." };
  revalidateCota(data.cota_id as string);
  return { ok: true, message: "Lance removido." };
}
