"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const CORES = ["brand", "accent", "green", "amber", "red", "sky", "violet", "slate"] as const;
const FUNCOES = ["responsavel", "membro"] as const;
type Funcao = (typeof FUNCOES)[number];

const departamentoSchema = z.object({
  nome: zs.required("Nome", 120).refine((v) => v.length >= 2, "Informe ao menos 2 caracteres"),
  sigla: zs.text(12).transform((v) => (v ? v.toUpperCase() : v)),
  descricao: zs.text(1000),
  cor: zs.enumOf([...CORES], "Selecione uma cor"),
  tipo: zs.enumOf(["consultor", "administrativo", "juridico", "rh", "financeiro", "personalizado"], "Selecione a área"),
  responsavel_id: zs.uuid(),
});

const membroSchema = z.object({
  departamento_id: zs.requiredUuid("o departamento"),
  user_id: zs.requiredUuid("o usuário"),
  funcao: zs.enumOf([...FUNCOES], "Selecione a função"),
});

function revalidate(depId?: string | null) {
  revalidatePath("/departamentos");
  if (depId) revalidatePath(`/departamentos/${depId}`);
  revalidatePath("/dashboard");
}

/** Garante que o responsável do departamento também conste como membro com função "responsavel". */
async function syncResponsavel(supabase: Awaited<ReturnType<typeof createClient>>, depId: string, userId: string | null | undefined) {
  if (!userId) return;
  const { error } = await supabase
    .from("departamento_membros")
    .upsert({ departamento_id: depId, user_id: userId, funcao: "responsavel" }, { onConflict: "departamento_id,user_id" });
  if (error) console.error("[departamentos] sync responsável", error.code, error.message);
}

// ------------------------------------------------------------------ Departamentos (gestão)

export async function createDepartamento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("departamentos.manage");
  if ("denied" in g) return g.denied;
  const parsed = departamentoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("departamentos").insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: "Já existe um departamento com esse nome.", fieldErrors: { nome: "Nome já utilizado" } };
    return dbError(error);
  }
  await syncResponsavel(supabase, row.id, parsed.data.responsavel_id);
  revalidate(row.id);
  return { ok: true, message: "Departamento criado.", id: row.id };
}

export async function updateDepartamento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("departamentos.manage");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Departamento inválido." };
  const parsed = departamentoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("departamentos").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return { error: "Já existe um departamento com esse nome.", fieldErrors: { nome: "Nome já utilizado" } };
    return dbError(error);
  }
  if (!row) return { error: "Departamento não encontrado ou sem permissão." };
  await syncResponsavel(supabase, id, parsed.data.responsavel_id);
  revalidate(id);
  return { ok: true, message: "Departamento atualizado.", id };
}

/** Ativa/desativa o departamento (desativados somem das listas de seleção). */
export async function toggleDepartamentoAtivo(id: string): Promise<ActionState> {
  const g = await guard("departamentos.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Departamento inválido." };
  const supabase = await createClient();
  const { data: current } = await supabase.from("departamentos").select("id, ativo").eq("id", id).maybeSingle();
  if (!current) return { error: "Departamento não encontrado." };
  const ativo = !current.ativo;
  const { data: row, error } = await supabase.from("departamentos").update({ ativo }).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar este departamento." };
  revalidate(id);
  return { ok: true, message: ativo ? "Departamento reativado." : "Departamento desativado.", id };
}

// ------------------------------------------------------------------ Membros
// Gestão (admin/gestor) ou o responsável do departamento — o RLS
// (dep_membros_write) é quem decide; aqui só traduzimos o resultado.

/** Server Action de formulário: `departamento_id`, `user_id`, `funcao`. */
export async function addMembro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("departamentos.view");
  if ("denied" in g) return g.denied;
  const parsed = membroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("departamento_membros").insert(parsed.data).select("user_id").maybeSingle();
  if (error) {
    if (error.code === "23505") return { error: "Essa pessoa já faz parte do departamento.", fieldErrors: { user_id: "Já é membro" } };
    if (error.code === "42501") return { error: "Somente a gestão ou o responsável do departamento pode adicionar membros." };
    if (error.code === "23503") return { error: "Usuário ou departamento inexistente." };
    return dbError(error);
  }
  if (!row) return { error: "Somente a gestão ou o responsável do departamento pode adicionar membros." };
  revalidate(parsed.data.departamento_id);
  return { ok: true, message: "Membro adicionado ao departamento." };
}

export async function updateMembroFuncao(departamentoId: string, userId: string, funcao: string): Promise<ActionState> {
  const g = await guard("departamentos.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(departamentoId) || !isUuid(userId)) return { error: "Membro inválido." };
  if (!(FUNCOES as readonly string[]).includes(funcao)) return { error: "Função inválida." };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("departamento_membros")
    .update({ funcao: funcao as Funcao })
    .eq("departamento_id", departamentoId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Somente a gestão ou o responsável do departamento pode alterar funções." };
  revalidate(departamentoId);
  return { ok: true, message: funcao === "responsavel" ? "Membro promovido a responsável." : "Função alterada para membro." };
}

/** Remove um membro. Use `removeMembro.bind(null, departamentoId)` para receber só o `userId`. */
export async function removeMembro(departamentoId: string, userId: string): Promise<ActionState> {
  const g = await guard("departamentos.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(departamentoId) || !isUuid(userId)) return { error: "Membro inválido." };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("departamento_membros")
    .delete()
    .eq("departamento_id", departamentoId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!row) return { error: "Somente a gestão ou o responsável do departamento pode remover membros." };
  revalidate(departamentoId);
  return { ok: true, message: "Membro removido do departamento." };
}
