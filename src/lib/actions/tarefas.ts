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
  // Opcionais (demandas de departamento / vínculo com processo). Ausentes no
  // formulário => não alteram o registro na edição.
  departamento_id: zs.uuid(),
  processo_id: zs.uuid(),
});

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Responsável do departamento (RPC do banco, mesma regra do RLS). */
async function isResponsavelDep(supabase: Supabase, depId: string | null | undefined) {
  if (!depId) return false;
  const { data, error } = await supabase.rpc("is_responsavel_departamento", { p_dep: depId });
  if (error) console.error("[tarefas] is_responsavel_departamento", error.code, error.message);
  return data === true;
}

/** Remove chaves opcionais não enviadas pelo formulário (mantém compatibilidade com formulários antigos). */
function onlySent<T extends Record<string, unknown>>(data: T, formData: FormData, keys: (keyof T & string)[]) {
  for (const k of keys) if (!formData.has(k)) delete data[k];
  return data;
}

function revalidate(clienteIds: (string | null | undefined)[]) {
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  revalidatePath("/departamentos", "layout");
  for (const c of new Set(clienteIds.filter(Boolean))) revalidatePath(`/clientes/${c}`);
}

export async function createTarefa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = tarefaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const { status, responsavel_id, ...rest } = onlySent({ ...parsed.data }, formData, ["departamento_id", "processo_id"]);
  const supabase = await createClient();
  // Não gestores só criam tarefas para si — exceto o responsável do departamento,
  // que distribui demandas do próprio departamento (o RLS também garante).
  const canAssign = isManagerRole(profile.role) || (!!responsavel_id && responsavel_id !== userId && (await isResponsavelDep(supabase, rest.departamento_id)));
  const data = {
    ...rest,
    status: status ?? "pendente",
    responsavel_id: canAssign ? (responsavel_id ?? userId) : userId,
  };
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
  const { status, responsavel_id, ...rest } = onlySent({ ...parsed.data }, formData, ["departamento_id", "processo_id"]);
  const data: Record<string, unknown> = { ...rest };
  if (status) data.status = status;

  const supabase = await createClient();
  // Somente gestores (ou o responsável do departamento da demanda) reatribuem tarefas.
  if (isManagerRole(profile.role)) data.responsavel_id = responsavel_id ?? userId;
  else if (formData.has("responsavel_id") && responsavel_id) {
    const { data: atual } = await supabase.from("tarefas").select("departamento_id").eq("id", id).maybeSingle();
    const depId = (rest.departamento_id ?? atual?.departamento_id) as string | null | undefined;
    if (await isResponsavelDep(supabase, depId)) data.responsavel_id = responsavel_id;
  }

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

/** Muda o status diretamente (quadro kanban de demandas). */
export async function setTarefaStatus(id: string, status: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Tarefa inválida." };
  if (!(STATUS as readonly string[]).includes(status)) return { error: "Status inválido." };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("tarefas")
    .update({ status: status as (typeof STATUS)[number] })
    .eq("id", id)
    .select("id, cliente_id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar esta tarefa." };
  revalidate([row.cliente_id as string | null]);
  const msg = { pendente: "Demanda movida para pendente.", em_andamento: "Demanda em andamento.", concluida: "Demanda concluída." }[status as (typeof STATUS)[number]];
  return { ok: true, message: msg, id };
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
