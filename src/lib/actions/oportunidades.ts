"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { dbError, excluirRegistro, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const ETAPAS = ["novo", "contato", "qualificacao", "proposta", "negociacao", "ganho", "perdido"] as const;
type Etapa = (typeof ETAPAS)[number];

/** Probabilidade padrão por etapa (ganho/perdido são definidos pelo banco). */
const PROB_PADRAO: Record<Etapa, number> = { novo: 10, contato: 20, qualificacao: 40, proposta: 60, negociacao: 80, ganho: 100, perdido: 0 };

const oportunidadeSchema = z
  .object({
    titulo: zs.required("Título", 200).refine((v) => v.length >= 2, "Informe ao menos 2 caracteres"),
    cliente_id: zs.requiredUuid("o cliente"),
    linha: zs.enumOf(["consorcio", "seguro"], "Selecione a linha de negócio"),
    produto_id: zs.uuid(),
    valor: zs.money(),
    etapa: zs.enumOf([...ETAPAS], "Selecione a etapa"),
    probabilidade: zs.number(0, 100),
    previsao_fechamento: zs.date(),
    motivo_perda: zs.text(500),
    consultor_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    if (v.probabilidade !== null && v.probabilidade !== undefined && !Number.isInteger(v.probabilidade)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["probabilidade"], message: "Informe um número inteiro entre 0 e 100" });
    }
  })
  .transform((v) => ({
    ...v,
    valor: v.valor ?? 0,
    probabilidade: v.probabilidade ?? PROB_PADRAO[v.etapa],
    motivo_perda: v.etapa === "perdido" ? v.motivo_perda : null,
  }));

function revalidate(clienteIds: (string | null | undefined)[]) {
  revalidatePath("/oportunidades");
  revalidatePath("/dashboard");
  for (const c of new Set(clienteIds.filter(Boolean))) revalidatePath(`/clientes/${c}`);
}

export async function createOportunidade(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const parsed = oportunidadeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const { consultor_id, ...rest } = parsed.data;
  // Para não gestores o banco força consultor_id = usuário atual (trigger enforce_own_consultor).
  const data = { ...rest, consultor_id: isManagerRole(profile.role) ? (consultor_id ?? userId) : userId };
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("oportunidades").insert(data).select("id").single();
  if (error) return dbError(error);
  revalidate([data.cliente_id]);
  return { ok: true, message: "Oportunidade criada.", id: row.id };
}

export async function updateOportunidade(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Oportunidade inválida." };
  const parsed = oportunidadeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const { consultor_id, ...rest } = parsed.data;
  // Somente a gestão transfere a carteira; para os demais o campo não é enviado.
  const data = isManagerRole(profile.role) ? { ...rest, consultor_id: consultor_id ?? userId } : rest;
  const supabase = await createClient();
  const { data: before } = await supabase.from("oportunidades").select("cliente_id").eq("id", id).maybeSingle();
  const { data: row, error } = await supabase.from("oportunidades").update(data).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para editar esta oportunidade." };
  revalidate([before?.cliente_id as string | undefined, rest.cliente_id]);
  return { ok: true, message: "Oportunidade atualizada.", id };
}

/** Move a oportunidade de etapa no funil (arrastar e soltar). */
export async function moveOportunidade(id: string, etapa: string, motivoPerda?: string | null): Promise<ActionState> {
  const g = await guard("negocios.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Oportunidade inválida." };
  const e = z.enum(ETAPAS).safeParse(etapa);
  if (!e.success) return { error: "Etapa inválida." };
  const motivo = typeof motivoPerda === "string" ? motivoPerda.trim().slice(0, 500) || null : null;

  const update: Record<string, unknown> = { etapa: e.data, motivo_perda: e.data === "perdido" ? motivo : null };
  if (e.data !== "ganho" && e.data !== "perdido") update.probabilidade = PROB_PADRAO[e.data];

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("oportunidades").update(update).eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para mover esta oportunidade." };
  revalidate([row.cliente_id as string]);
  const message = e.data === "ganho" ? "Negócio ganho! Parabéns." : e.data === "perdido" ? "Oportunidade marcada como perdida." : "Etapa atualizada.";
  return { ok: true, message, id };
}

export async function deleteOportunidade(id: string): Promise<ActionState> {
  const g = await guard("negocios.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Oportunidade inválida." };
  const supabase = await createClient();
  const { data } = await supabase.from("oportunidades").select("cliente_id").eq("id", id).maybeSingle();
  const falha = await excluirRegistro("oportunidades", id);
  if (falha) return falha;
  revalidate([data?.cliente_id as string]);
  return { ok: true, message: "Oportunidade movida para a lixeira." };
}
