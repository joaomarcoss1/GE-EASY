"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const STATUS = ["pendente", "em_andamento", "concluida"] as const;
const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;

const tarefaSchema = z.object({
  titulo: zs.required("Título", 200).refine((v) => v.length >= 2, "Informe ao menos 2 caracteres"),
  descricao: zs.text(5000),
  prioridade: zs.enumOf([...PRIORIDADES], "Selecione a prioridade"),
  status: z
    .union([zs.enumOf([...STATUS], "Status inválido"), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  vencimento: zs.date(),
  cliente_id: zs.uuid(),
  responsavel_id: zs.uuid(),
});

function revalidate(clienteIds: (string | null | undefined)[]) {
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  for (const c of new Set(clienteIds.filter(Boolean))) revalidatePath(`/clientes/${c}`);
}

export async function createTarefa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = tarefaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const { status, responsavel_id, ...rest } = parsed.data;
  // Não gestores só criam tarefas para si (o RLS também garante).
  const data = {
    ...rest,
    status: status ?? "pendente",
    responsavel_id: isManagerRole(profile.role) ? (responsavel_id ?? userId) : userId,
  };
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("tarefas").insert(data).select("id").single();
  if (error) return dbError(error);
  revalidate([data.cliente_id]);
  return { ok: true, message: "Tarefa criada.", id: row.id };
}

export async function updateTarefa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Tarefa inválida." };
  const parsed = tarefaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const { status, responsavel_id, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (status) data.status = status;
  // Somente gestores reatribuem tarefas.
  if (isManagerRole(profile.role)) data.responsavel_id = responsavel_id ?? userId;

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("tarefas").update(data).eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para editar esta tarefa." };
  revalidate([row.cliente_id as string | null, rest.cliente_id]);
  return { ok: true, message: "Tarefa atualizada.", id };
}

/** Alterna entre aberta (pendente/em andamento) e concluída. */
export async function toggleTarefa(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Tarefa inválida." };
  const supabase = await createClient();
  const { data: current } = await supabase.from("tarefas").select("id, status").eq("id", id).maybeSingle();
  if (!current) return { error: "Tarefa não encontrada ou sem acesso." };
  const next = current.status === "concluida" ? "pendente" : "concluida";
  const { data: row, error } = await supabase.from("tarefas").update({ status: next }).eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar esta tarefa." };
  revalidate([row.cliente_id as string | null]);
  return { ok: true, message: next === "concluida" ? "Tarefa concluída." : "Tarefa reaberta.", id };
}

export async function deleteTarefa(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Tarefa inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tarefas").delete().eq("id", id).select("id, cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Somente quem criou a tarefa (ou a gestão) pode excluí-la." };
  revalidate([data.cliente_id as string | null]);
  return { ok: true, message: "Tarefa excluída." };
}
