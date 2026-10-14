"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const ROLES = ["admin", "gestor", "financeiro", "consultor", "consultor_externo"] as const;
const SERVICE_ROLE_MSG = "Configure a variável SUPABASE_SERVICE_ROLE_KEY no servidor para convidar usuários e reenviar acessos.";
const redirectTo = () => `${env.siteUrl}/auth/callback?next=/redefinir-senha`;

function revalidateUsers(id?: string) {
  revalidatePath("/configuracoes");
  revalidatePath("/consultores");
  if (id) revalidatePath(`/consultores/${id}`);
}

const updateSchema = z.object({
  id: zs.requiredUuid("o usuário"),
  role: zs.enumOf([...ROLES], "Selecione o papel"),
  active: zs.bool(),
  comissao_percentual: zs.number(0, 100),
  territorio: zs.text(120),
  cargo: zs.text(80),
});

/** Admin: altera papel, status, comissão, território e cargo (RLS profiles_update_admin + trigger de proteção). */
export async function updateUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = updateSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (v.id === g.session.userId && (v.role !== "admin" || !v.active)) {
    return { error: "Você não pode remover seu próprio acesso de administrador. Peça a outro administrador.", fieldErrors: { role: "Não é possível rebaixar a si mesmo" } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: v.role, active: v.active, comissao_percentual: v.comissao_percentual ?? 0, territorio: v.territorio, cargo: v.cargo })
    .eq("id", v.id)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Usuário não encontrado ou sem permissão." };
  revalidateUsers(v.id);
  return { ok: true, message: "Usuário atualizado.", id: v.id };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  full_name: zs.required("Nome", 120),
  role: zs.enumOf([...ROLES], "Selecione o papel"),
  comissao_percentual: zs.number(0, 100),
  territorio: zs.text(120),
});

/**
 * Admin: convida um usuário por e-mail. O trigger handle_new_user cria o perfil
 * (inativo); em seguida o perfil é ajustado com o service role (papel, ativo, comissão).
 */
export async function inviteUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const parsed = inviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { data: { full_name: v.full_name }, redirectTo: redirectTo() });
  if (error || !data?.user) {
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) return { error: "Este e-mail já possui cadastro. Ajuste o usuário na lista ou reenvie o acesso.", fieldErrors: { email: "E-mail já cadastrado" } };
    if (/rate limit/i.test(msg)) return { error: "Limite de envio de e-mails atingido. Aguarde alguns minutos." };
    console.error("[usuarios.invite]", error?.status, msg);
    return { error: "Não foi possível enviar o convite. Verifique o e-mail e as configurações de SMTP do Supabase." };
  }

  const { error: upError } = await admin
    .from("profiles")
    .update({ full_name: v.full_name, role: v.role, active: true, comissao_percentual: v.comissao_percentual ?? 0, territorio: v.territorio })
    .eq("id", data.user.id);
  if (upError) {
    console.error("[usuarios.invite.profile]", upError.code, upError.message);
    return { ok: true, message: "Convite enviado, mas o perfil não pôde ser ajustado. Edite o usuário na lista e ative-o.", id: data.user.id };
  }
  revalidateUsers();
  return { ok: true, message: `Convite enviado para ${v.email}.`, id: data.user.id };
}

/** Admin: reenvia o convite (se ainda não aceito) ou um link de redefinição de senha. */
export async function reenviarAcesso(id: string): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Usuário inválido." };
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", id).maybeSingle();
  if (!profile?.email) return { error: "Usuário não encontrado." };

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const pendingInvite = authUser?.user && !authUser.user.email_confirmed_at && !authUser.user.last_sign_in_at;
  if (pendingInvite) {
    const { error } = await admin.auth.admin.inviteUserByEmail(profile.email, { redirectTo: redirectTo() });
    if (!error) return { ok: true, message: `Convite reenviado para ${profile.email}.` };
    console.error("[usuarios.reinvite]", error.status, error.message);
  }
  const { error } = await admin.auth.resetPasswordForEmail(profile.email, { redirectTo: redirectTo() });
  if (error) {
    console.error("[usuarios.reset]", error.status, error.message);
    return { error: /rate limit/i.test(error.message) ? "Limite de envio de e-mails atingido. Aguarde alguns minutos." : "Não foi possível enviar o e-mail." };
  }
  return { ok: true, message: `Link de redefinição de senha enviado para ${profile.email}.` };
}

const consultorSchema = z.object({
  id: zs.requiredUuid("o consultor"),
  territorio: zs.text(120),
  cargo: zs.text(80),
  comissao_percentual: zs.number(0, 100),
});

/**
 * Gestão de consultores: território/cargo (admin e gestor) e comissão % (somente admin).
 * Admin usa a própria sessão (RLS). O gestor não tem política de UPDATE em perfis de
 * terceiros, então — após guard() e checagem do papel do alvo — apenas território e
 * cargo são gravados com o service role.
 */
export async function updateConsultor(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("consultores.manage");
  if ("denied" in g) return g.denied;
  const parsed = consultorSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("id, role").eq("id", v.id).maybeSingle();
  if (!target) return { error: "Consultor não encontrado." };

  if (g.session.profile.role === "admin") {
    const patch: Record<string, unknown> = { territorio: v.territorio, cargo: v.cargo };
    if (v.comissao_percentual !== null && v.comissao_percentual !== undefined) patch.comissao_percentual = v.comissao_percentual;
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", v.id).select("id").maybeSingle();
    if (error) return dbError(error);
    if (!data) return { error: "Sem permissão para alterar este perfil." };
  } else {
    if (!["consultor", "consultor_externo"].includes(target.role)) return { error: "Gestores só podem alterar dados de consultores." };
    if (!hasServiceRole()) return { error: "Para gestores editarem território, configure SUPABASE_SERVICE_ROLE_KEY (ou peça a um administrador)." };
    const { error } = await createAdminClient().from("profiles").update({ territorio: v.territorio, cargo: v.cargo }).eq("id", v.id).in("role", ["consultor", "consultor_externo"]);
    if (error) return dbError(error);
  }
  revalidateUsers(v.id);
  return { ok: true, message: "Consultor atualizado.", id: v.id };
}
