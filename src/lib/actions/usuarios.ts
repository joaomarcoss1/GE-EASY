"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const ROLES = ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "administrativo", "consultor", "consultor_externo"] as const;
const GESTAO = new Set<string>(["admin", "gestor"]);
const SERVICE_ROLE_MSG = "Configure a variável SUPABASE_SERVICE_ROLE_KEY no servidor para convidar usuários e reenviar acessos.";
const redirectTo = () => `${env.siteUrl}/auth/callback?next=/redefinir-senha`;

function revalidateUsers(id?: string) {
  revalidatePath("/configuracoes");
  revalidatePath("/consultores");
  revalidatePath("/acessos");
  revalidatePath("/rh");
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

/**
 * Altera o vínculo do usuário com a empresa ativa (papel = escopo dos dados, ativo) e os dados do perfil.
 * Regras no banco: ninguém altera o próprio acesso; perfis de gestão só pelo administrador master;
 * a empresa mantém ao menos um master ativo.
 */
export async function updateUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = updateSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const empresaId = g.session.empresa!.id;
  if (v.id === g.session.userId) return { error: "Você não pode alterar o seu próprio acesso. Peça a outro administrador.", fieldErrors: { role: "Não é possível alterar a si mesmo" } };
  const supabase = await createClient();
  const { data: vinc, error } = await supabase
    .from("empresa_membros")
    .update({ role: v.role, ativo: v.active })
    .eq("empresa_id", empresaId)
    .eq("user_id", v.id)
    .select("user_id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!vinc) return { error: "Usuário não encontrado nesta empresa ou sem permissão." };
  const { error: perfilError } = await supabase
    .from("profiles")
    .update({ comissao_percentual: v.comissao_percentual ?? 0, territorio: v.territorio, cargo: v.cargo })
    .eq("id", v.id);
  if (perfilError && perfilError.code !== "42501") return dbError(perfilError);
  revalidateUsers(v.id);
  return { ok: true, message: perfilError ? "Acesso atualizado. Comissão/território só o administrador altera." : "Usuário atualizado.", id: v.id };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  full_name: zs.required("Nome", 120),
  role: zs.enumOf([...ROLES], "Selecione o papel"),
  comissao_percentual: zs.number(0, 100),
  territorio: zs.text(120),
});

/**
 * Convida um usuário para a empresa ativa. Conta nova: convite por e-mail. Conta já existente (outra
 * empresa da plataforma): só cria o vínculo. O acesso padrão do perfil (departamento/nível) é aplicado
 * pelo banco; o administrador master ajusta na tela Acessos. O service role ignora as regras do banco,
 * então os perfis de gestão são conferidos aqui.
 */
export async function inviteUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const parsed = inviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (GESTAO.has(v.role) && !g.session.profile.admin_master) return { error: "Somente o administrador master convida administradores e gestores.", fieldErrors: { role: "Perfil de gestão" } };
  const empresaId = g.session.empresa!.id;
  const admin = createAdminClient();

  let userId: string | null = null;
  let existente = false;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { data: { full_name: v.full_name }, redirectTo: redirectTo() });
  if (data?.user) userId = data.user.id;
  else {
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      const { data: p } = await admin.from("profiles").select("id").eq("email", v.email).maybeSingle();
      userId = p?.id ?? null;
      existente = true;
    } else if (/rate limit/i.test(msg)) return { error: "Limite de envio de e-mails atingido. Aguarde alguns minutos." };
    if (!userId) {
      console.error("[usuarios.invite]", error?.status, msg);
      return { error: "Não foi possível enviar o convite. Verifique o e-mail e as configurações de SMTP do Supabase." };
    }
  }

  const { data: atual } = await admin.from("empresa_membros").select("ativo").eq("empresa_id", empresaId).eq("user_id", userId).maybeSingle();
  if (atual) return { error: atual.ativo ? "Este usuário já faz parte da empresa." : "Este usuário já tem vínculo (desativado). Reative-o na lista.", fieldErrors: { email: "Já vinculado" } };
  const { error: vincError } = await admin
    .from("empresa_membros")
    .insert({ empresa_id: empresaId, user_id: userId, role: v.role, ativo: true, admin_master: false, convidado_por: g.session.userId });
  if (vincError) {
    console.error("[usuarios.invite.vinculo]", vincError.code, vincError.message);
    return { error: vincError.message.includes("Limite de usuários") ? vincError.message : "Convite enviado, mas o vínculo com a empresa falhou. Tente novamente." };
  }
  if (!existente) {
    await admin
      .from("profiles")
      .update({ full_name: v.full_name, comissao_percentual: v.comissao_percentual ?? 0, territorio: v.territorio, empresa_padrao_id: empresaId })
      .eq("id", userId);
  }
  revalidateUsers();
  return { ok: true, message: existente ? `${v.email} já tinha conta e foi adicionado(a) à empresa.` : `Convite enviado para ${v.email}.`, id: userId };
}

/** Reenvia o convite (se ainda não aceito) ou um link de redefinição de senha. Só para membros da empresa. */
export async function reenviarAcesso(id: string): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Usuário inválido." };
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const supabase = await createClient();
  const { data: membro } = await supabase.from("membros").select("email").eq("id", id).maybeSingle();
  if (!membro?.email) return { error: "Usuário não encontrado nesta empresa." };

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const pendingInvite = authUser?.user && !authUser.user.email_confirmed_at && !authUser.user.last_sign_in_at;
  if (pendingInvite) {
    const { error } = await admin.auth.admin.inviteUserByEmail(membro.email, { redirectTo: redirectTo() });
    if (!error) return { ok: true, message: `Convite reenviado para ${membro.email}.` };
    console.error("[usuarios.reinvite]", error.status, error.message);
  }
  const { error } = await admin.auth.resetPasswordForEmail(membro.email, { redirectTo: redirectTo() });
  if (error) {
    console.error("[usuarios.reset]", error.status, error.message);
    return { error: /rate limit/i.test(error.message) ? "Limite de envio de e-mails atingido. Aguarde alguns minutos." : "Não foi possível enviar o e-mail." };
  }
  return { ok: true, message: `Link de redefinição de senha enviado para ${membro.email}.` };
}

const consultorSchema = z.object({
  id: zs.requiredUuid("o consultor"),
  territorio: zs.text(120),
  cargo: zs.text(80),
  comissao_percentual: zs.number(0, 100),
});

/**
 * Gestão de consultores: território/cargo (quem gere consultores) e comissão % (somente administrador).
 * O administrador usa a própria sessão (RLS). Os demais não têm política de UPDATE em perfis de
 * terceiros, então — após guard() e checagem do papel do alvo NA EMPRESA — só território e cargo são
 * gravados com o service role.
 */
export async function updateConsultor(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("consultores.manage");
  if ("denied" in g) return g.denied;
  const parsed = consultorSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: target } = await supabase.from("membros").select("id, role").eq("id", v.id).maybeSingle();
  if (!target) return { error: "Consultor não encontrado nesta empresa." };

  if (g.session.profile.role === "admin" || g.session.profile.admin_master) {
    const patch: Record<string, unknown> = { territorio: v.territorio, cargo: v.cargo };
    if (v.comissao_percentual !== null && v.comissao_percentual !== undefined) patch.comissao_percentual = v.comissao_percentual;
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", v.id).select("id").maybeSingle();
    if (error) return dbError(error);
    if (!data) return { error: "Sem permissão para alterar este perfil." };
  } else {
    if (!["consultor", "consultor_externo"].includes(target.role)) return { error: "Gestores só podem alterar dados de consultores." };
    if (!hasServiceRole()) return { error: "Para gestores editarem território, configure SUPABASE_SERVICE_ROLE_KEY (ou peça a um administrador)." };
    const { error } = await createAdminClient().from("profiles").update({ territorio: v.territorio, cargo: v.cargo }).eq("id", v.id);
    if (error) return dbError(error);
  }
  revalidateUsers(v.id);
  return { ok: true, message: "Consultor atualizado.", id: v.id };
}
