"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { FUNCIONALIDADES } from "@/lib/rbac";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Tela de acessos (administrador master): departamentos × níveis × funcionalidades, exceções individuais,
 * vínculo (perfil, ativo, master) e cópia de perfil. O banco repete todas as travas (só master define
 * níveis/exceções, ninguém altera o próprio acesso, sempre resta um master ativo) e audita cada mudança.
 */
async function master() {
  const g = await guard();
  if ("denied" in g) return g;
  if (!g.session.profile.admin_master) return { denied: { error: "Somente o administrador master gerencia acessos." } as ActionState };
  return g;
}

const ok = (message: string): ActionState => {
  revalidatePath("/acessos");
  revalidatePath("/rh");
  return { ok: true, message };
};
const erro = (e: { code?: string; message?: string }): ActionState => (e.code === "42501" && e.message && !e.message.startsWith("new row") ? { error: e.message } : dbError(e));

/** Define o nível do usuário num departamento (null = retira do departamento). */
export async function definirNivel(userId: string, departamentoId: string, nivelId: string | null): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!isUuid(userId) || !isUuid(departamentoId) || (nivelId !== null && !isUuid(nivelId))) return { error: "Dados inválidos." };
  if (userId === g.session.userId) return { error: "Você não pode alterar o seu próprio acesso." };
  const supabase = await createClient();
  const { error } = nivelId
    ? await supabase.from("departamento_membros").upsert({ departamento_id: departamentoId, user_id: userId, nivel_id: nivelId, ativo: true }, { onConflict: "departamento_id,user_id" })
    : await supabase.from("departamento_membros").delete().eq("departamento_id", departamentoId).eq("user_id", userId);
  if (error) return erro(error);
  return ok(nivelId ? "Nível de acesso definido." : "Usuário retirado do departamento.");
}

const VINCULO = { role: ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "administrativo", "consultor", "consultor_externo"] } as const;

/** Perfil de escopo (o que a pessoa enxerga), acesso ativo e administrador master. */
export async function alterarVinculo(userId: string, campo: "role" | "ativo" | "admin_master", valor: string | boolean): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!isUuid(userId)) return { error: "Usuário inválido." };
  if (userId === g.session.userId) return { error: "Você não pode alterar o seu próprio acesso." };
  if (campo === "role" && !(VINCULO.role as readonly string[]).includes(String(valor))) return { error: "Perfil inválido." };
  if (campo !== "role" && typeof valor !== "boolean") return { error: "Valor inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empresa_membros")
    .update({ [campo]: valor })
    .eq("empresa_id", g.session.empresa!.id)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) return erro(error);
  if (!data) return { error: "Usuário não encontrado nesta empresa." };
  return ok("Acesso atualizado.");
}

const nivelSchema = z.object({ nivel_id: zs.requiredUuid("o nível"), f: z.array(z.string()).max(FUNCIONALIDADES.length).optional().default([]) });

/** Funcionalidades de um nível (vale para todos os membros desse nível). */
export async function salvarNivel(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const parsed = nivelSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const quer = new Set(parsed.data.f.filter((f) => (FUNCIONALIDADES as readonly string[]).includes(f)));
  const supabase = await createClient();
  const { data: atuais, error: e1 } = await supabase.from("nivel_funcionalidades").select("funcionalidade").eq("nivel_id", parsed.data.nivel_id);
  if (e1) return dbError(e1);
  const tem = new Set((atuais ?? []).map((a) => a.funcionalidade as string));
  const remover = [...tem].filter((f) => !quer.has(f));
  const incluir = [...quer].filter((f) => !tem.has(f));
  if (remover.length) {
    const { error } = await supabase.from("nivel_funcionalidades").delete().eq("nivel_id", parsed.data.nivel_id).in("funcionalidade", remover);
    if (error) return erro(error);
  }
  if (incluir.length) {
    const { error } = await supabase.from("nivel_funcionalidades").insert(incluir.map((f) => ({ nivel_id: parsed.data.nivel_id, funcionalidade: f })));
    if (error) return erro(error);
  }
  return ok(`Nível salvo (${incluir.length} incluída(s), ${remover.length} retirada(s)).`);
}

const novoNivelSchema = z.object({ departamento_id: zs.requiredUuid("o departamento"), nome: zs.required("Nome", 60), ordem: zs.number(1, 20) });

export async function criarNivel(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const parsed = novoNivelSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("departamento_niveis").insert({ ...parsed.data, ordem: parsed.data.ordem ?? 1 });
  if (error) return error.code === "23505" ? { error: "Já existe um nível com este nome no departamento." } : erro(error);
  return ok("Nível criado.");
}

const excecaoSchema = z.object({
  user_id: zs.requiredUuid("o usuário"),
  funcionalidade: z.string().refine((f) => (FUNCIONALIDADES as readonly string[]).includes(f), "Funcionalidade inválida"),
  tipo: zs.enumOf(["concessao", "revogacao"]),
  motivo: zs.required("Motivo", 500),
  valido_ate: zs.date(),
});

/** Concede ou revoga uma funcionalidade só para um usuário (com motivo e validade opcional). */
export async function salvarExcecao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const parsed = excecaoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (v.user_id === g.session.userId) return { error: "Você não pode alterar o seu próprio acesso." };
  const supabase = await createClient();
  const { error } = await supabase.from("usuario_permissoes_extra").upsert(
    { user_id: v.user_id, funcionalidade: v.funcionalidade, tipo: v.tipo, motivo: v.motivo, valido_ate: v.valido_ate ? `${v.valido_ate}T23:59:59-03:00` : null, concedido_por: g.session.userId },
    { onConflict: "empresa_id,user_id,funcionalidade" },
  );
  if (error) return erro(error);
  return ok(v.tipo === "concessao" ? "Funcionalidade concedida." : "Funcionalidade revogada.");
}

export async function removerExcecao(id: string): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Exceção inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("usuario_permissoes_extra").delete().eq("id", id);
  if (error) return erro(error);
  return ok("Exceção removida.");
}

const copiarSchema = z.object({ origem: zs.requiredUuid("o usuário de origem"), destino: zs.requiredUuid("o usuário de destino") });

/** "Igual ao fulano": copia departamentos, níveis e exceções. */
export async function copiarAcessos(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const parsed = copiarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.origem === parsed.data.destino) return { error: "Escolha usuários diferentes." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("copiar_acessos", { p_origem: parsed.data.origem, p_destino: parsed.data.destino });
  if (error) return erro(error);
  return ok("Acessos copiados.");
}
