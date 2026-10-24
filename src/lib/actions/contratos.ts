"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";
import type { ContratoHonorarios } from "@/lib/types";

const TIPOS = ["fixo", "mensal", "exito", "por_ato", "hora", "misto"] as const;
const STATUS = ["proposta", "ativo", "suspenso", "encerrado", "cancelado"] as const;

const contratoSchema = z
  .object({
    numero: zs.text(40),
    titulo: zs.required("Título", 200),
    cliente_id: zs.requiredUuid("o cliente"),
    processo_id: zs.uuid(),
    tipo: zs.enumOf([...TIPOS], "Selecione o tipo"),
    valor_fixo: zs.money(),
    valor_mensal: zs.money(),
    percentual_exito: zs.number(0, 100),
    valor_hora: zs.money(),
    parcelas: zs.number(1, 120),
    dia_vencimento: zs.number(1, 31),
    data_inicio: zs.date().refine((v) => !!v, "Informe o início"),
    data_fim: zs.date(),
    indice_reajuste: zs.text(40),
    status: zs.enumOf([...STATUS]),
    responsavel_id: zs.uuid(),
    departamento_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    if ((v.tipo === "fixo" || v.tipo === "misto") && !v.valor_fixo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor_fixo"], message: "Informe o valor fixo" });
    if (v.tipo === "mensal" && !v.valor_mensal) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor_mensal"], message: "Informe o valor mensal" });
    if ((v.tipo === "exito" || v.tipo === "misto") && !v.percentual_exito) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentual_exito"], message: "Informe o percentual de êxito" });
    if (v.tipo === "hora" && !v.valor_hora) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor_hora"], message: "Informe o valor da hora" });
    if (v.data_fim && v.data_inicio && v.data_fim < v.data_inicio) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_fim"], message: "O término deve ser após o início" });
  })
  .transform((v) => ({ ...v, parcelas: Math.round(v.parcelas ?? 1), dia_vencimento: v.dia_vencimento ? Math.round(v.dia_vencimento) : null }));

function revalidar(id?: string, clienteId?: string | null, processoId?: string | null) {
  revalidatePath("/contratos");
  revalidatePath("/financeiro");
  if (id) revalidatePath(`/contratos/${id}`);
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
  if (processoId) revalidatePath(`/processos/${processoId}`);
}

export async function saveContrato(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("contratos.write");
  if ("denied" in g) return g.denied;
  const parsed = contratoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = { ...parsed.data, responsavel_id: parsed.data.responsavel_id ?? g.session.userId };
  const id = formData.get("id");
  const supabase = await createClient();
  if (isUuid(id)) {
    const { data: row, error } = await supabase.from("contratos_honorarios").update(data).eq("id", id).select("id").maybeSingle();
    if (error) return dbError(error);
    if (!row) return { error: "Sem permissão para alterar este contrato." };
    revalidar(id, data.cliente_id, data.processo_id);
    return { ok: true, message: "Contrato atualizado.", id };
  }
  const { data: row, error } = await supabase.from("contratos_honorarios").insert(data).select("id").single();
  if (error) return dbError(error);
  revalidar(row.id, data.cliente_id, data.processo_id);
  return { ok: true, message: "Contrato cadastrado.", id: row.id };
}


export async function deleteContrato(id: string): Promise<ActionState> {
  const g = await guard("contratos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Contrato inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("contratos_honorarios").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Somente a gestão pode excluir contratos." };
  revalidar();
  return { ok: true, message: "Contrato excluído (parcelas vinculadas também)." };
}

function addMonths(iso: string, n: number, dia?: number | null) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dia ?? d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Gera as parcelas a receber do contrato no financeiro.
 * - fixo/misto: valor fixo dividido em N parcelas mensais;
 * - mensal: valor mensal × N meses (ou até a data de término);
 * - êxito, por ato e por hora: lançados sob demanda (registrar êxito / faturar horas).
 * Não duplica: se já houver parcelas, só regera as que estão em aberto quando `regerar` = true.
 */
export async function gerarParcelas(contratoId: string, regerar = false): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(contratoId)) return { error: "Contrato inválido." };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contratos_honorarios").select("*").eq("id", contratoId).maybeSingle<ContratoHonorarios>();
  if (!c) return { error: "Contrato não encontrado." };
  if (!["fixo", "mensal", "misto"].includes(c.tipo)) return { error: "Este tipo de contrato não tem parcelas automáticas. Use “Registrar êxito” ou “Faturar horas”." };

  const { data: existentes } = await supabase.from("financeiro_lancamentos").select("id, status, parcela").eq("contrato_id", contratoId).eq("tipo", "receita").not("parcela", "is", null);
  if (existentes?.length) {
    if (!regerar) return { error: `Este contrato já tem ${existentes.length} parcela(s). Use “Regerar parcelas em aberto” para recriá-las.` };
    const abertas = existentes.filter((e) => e.status === "aberto").map((e) => e.id);
    if (abertas.length) await supabase.from("financeiro_lancamentos").delete().in("id", abertas);
  }

  let n = Math.max(1, c.parcelas);
  if (c.tipo === "mensal" && c.data_fim) {
    const [y1, m1] = c.data_inicio.split("-").map(Number);
    const [y2, m2] = c.data_fim.split("-").map(Number);
    n = Math.max(1, Math.min(120, (y2 - y1) * 12 + (m2 - m1) + 1));
  }
  const total = c.tipo === "mensal" ? Number(c.valor_mensal ?? 0) * n : Number(c.valor_fixo ?? 0);
  const base = Math.floor((total / n) * 100) / 100;
  const ajuste = Math.round((total - base * n) * 100) / 100;
  const pagas = new Set((existentes ?? []).filter((e) => e.status !== "aberto").map((e) => Number(e.parcela)));
  const rows = Array.from({ length: n }, (_, i) => ({
    tipo: "receita" as const,
    categoria: c.tipo === "mensal" ? "Assessoria mensal" : "Honorários contratuais",
    descricao: `${c.titulo} — parcela ${i + 1}/${n}`,
    valor: c.tipo === "mensal" ? Number(c.valor_mensal) : i === n - 1 ? Math.round((base + ajuste) * 100) / 100 : base,
    vencimento: addMonths(c.data_inicio, i, c.dia_vencimento),
    cliente_id: c.cliente_id,
    processo_id: c.processo_id,
    contrato_id: c.id,
    departamento_id: c.departamento_id,
    parcela: i + 1,
    total_parcelas: n,
  })).filter((r) => !pagas.has(r.parcela));
  if (!rows.length) return { error: "Todas as parcelas já foram pagas." };
  const { error } = await supabase.from("financeiro_lancamentos").insert(rows);
  if (error) return dbError(error);
  revalidar(contratoId);
  return { ok: true, message: `${rows.length} parcela(s) gerada(s) no contas a receber.` };
}

const exitoSchema = z.object({
  contrato_id: zs.requiredUuid("o contrato"),
  proveito: zs.money().refine((v) => v !== null && v > 0, "Informe o proveito econômico"),
  vencimento: zs.date().refine((v) => !!v, "Informe o vencimento"),
});

/** Registra honorários de êxito: % do proveito econômico obtido no caso. */
export async function registrarExito(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("financeiro.view");
  if ("denied" in g) return g.denied;
  const parsed = exitoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: c } = await supabase.from("contratos_honorarios").select("*").eq("id", parsed.data.contrato_id).maybeSingle<ContratoHonorarios>();
  if (!c) return { error: "Contrato não encontrado." };
  if (!c.percentual_exito) return { error: "Este contrato não tem percentual de êxito." };
  const valor = Math.round(parsed.data.proveito! * Number(c.percentual_exito)) / 100;
  const { error } = await supabase.from("financeiro_lancamentos").insert({
    tipo: "receita",
    categoria: "Honorários de êxito",
    descricao: `${c.titulo} — êxito ${Number(c.percentual_exito)}% sobre ${parsed.data.proveito!.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    valor,
    vencimento: parsed.data.vencimento!,
    cliente_id: c.cliente_id,
    processo_id: c.processo_id,
    contrato_id: c.id,
    departamento_id: c.departamento_id,
  });
  if (error) return dbError(error);
  revalidar(c.id, c.cliente_id, c.processo_id);
  return { ok: true, message: `Honorários de êxito lançados: ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` };
}
