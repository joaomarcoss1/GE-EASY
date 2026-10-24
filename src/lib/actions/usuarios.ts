"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { strongPassword } from "@/lib/validators";
import { dbError, formToObject, guard, registrarAcesso, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const ROLES = ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "administrativo", "consultor", "consultor_externo"] as const;
const GESTAO = new Set<string>(["admin", "gestor"]);
const SERVICE_ROLE_MSG = "Configure a variável SUPABASE_SERVICE_ROLE_KEY no servidor para criar usuários e definir senhas.";

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

const novoSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  full_name: zs.required("Nome", 120),
  senha: z.string().max(128).optional().default(""),
  confirmar: z.string().max(128).optional().default(""),
  trocar_senha: zs.bool(),
  role: zs.enumOf([...ROLES], "Selecione o papel"),
  nivel_id: zs.uuid(),
  comissao_percentual: zs.number(0, 100),
  territorio: zs.text(120),
});

const erroSenha = (senha: string, confirmar: string): ActionState | null => {
  const s = strongPassword.safeParse(senha);
  if (!s.success) return { error: s.error.issues[0].message, fieldErrors: { senha: s.error.issues[0].message } };
  if (senha !== confirmar) return { error: "As senhas não conferem.", fieldErrors: { confirmar: "As senhas não conferem" } };
  return null;
};

/**
 * Cria o acesso direto no sistema, sem depender de e-mail: conta já confirmada, com a senha inicial
 * definida aqui (opcionalmente trocada pelo usuário no primeiro acesso). Conta já existente (outra
 * empresa da plataforma): só cria o vínculo e a senha continua a da pessoa. O acesso padrão do perfil é
 * aplicado pelo banco; o nível do departamento (opcional) só pelo administrador master. O service role
 * ignora as regras do banco, então os perfis de gestão são conferidos aqui.
 */
export async function criarUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const parsed = novoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const master = !!g.session.profile.admin_master;
  if (GESTAO.has(v.role) && !master) return { error: "Somente o administrador master cria administradores e gestores.", fieldErrors: { role: "Perfil de gestão" } };
  const empresaId = g.session.empresa!.id;
  const admin = createAdminClient();

  const { data: perfil } = await admin.from("profiles").select("id").eq("email", v.email).maybeSingle();
  let userId = (perfil?.id as string | undefined) ?? null;
  const novo = !userId;
  if (userId) {
    const { data: atual } = await admin.from("empresa_membros").select("ativo").eq("empresa_id", empresaId).eq("user_id", userId).maybeSingle();
    if (atual) return { error: atual.ativo ? "Este usuário já faz parte da empresa." : "Este usuário já tem vínculo (desativado). Reative-o na lista.", fieldErrors: { email: "Já vinculado" } };
  } else {
    const invalida = erroSenha(v.senha, v.confirmar);
    if (invalida) return invalida;
    const { data, error } = await admin.auth.admin.createUser({
      email: v.email,
      password: v.senha,
      email_confirm: true,
      user_metadata: { full_name: v.full_name },
      app_metadata: { trocar_senha: v.trocar_senha },
    });
    if (error || !data.user) {
      console.error("[usuarios.criar]", error?.status, error?.code);
      if (error?.code === "email_exists" || /already|registered/i.test(error?.message ?? "")) return { error: "Já existe uma conta com este e-mail.", fieldErrors: { email: "Já cadastrado" } };
      if (error?.code === "weak_password") return { error: "Senha fraca ou já vazada na internet. Escolha outra.", fieldErrors: { senha: "Senha fraca" } };
      return { error: "Não foi possível criar o usuário. Tente novamente." };
    }
    userId = data.user.id;
  }

  const { error: vincError } = await admin
    .from("empresa_membros")
    .insert({ empresa_id: empresaId, user_id: userId, role: v.role, ativo: true, admin_master: false, convidado_por: g.session.userId });
  if (vincError) {
    console.error("[usuarios.criar.vinculo]", vincError.code, vincError.message);
    // conta criada agora sem vínculo não serve para nada: desfaz
    if (novo) await admin.auth.admin.deleteUser(userId!);
    return { error: vincError.message.includes("Limite de usuários") ? vincError.message : "Não foi possível vincular o usuário à empresa. Tente novamente." };
  }
  if (novo) {
    await admin
      .from("profiles")
      .update({ full_name: v.full_name, comissao_percentual: v.comissao_percentual ?? 0, territorio: v.territorio, empresa_padrao_id: empresaId })
      .eq("id", userId);
  }
  let aviso = "";
  if (v.nivel_id && master) {
    // pela sessão do master: o banco confere o nível (desta empresa) e audita
    const supabase = await createClient();
    const { data: nivel } = await supabase.from("departamento_niveis").select("departamento_id").eq("id", v.nivel_id).maybeSingle();
    const { error } = nivel
      ? await supabase.from("departamento_membros").upsert({ departamento_id: nivel.departamento_id, user_id: userId, nivel_id: v.nivel_id, ativo: true }, { onConflict: "departamento_id,user_id" })
      : { error: { message: "nível não encontrado" } };
    if (error) aviso = " O nível de acesso não foi aplicado: ajuste na tela Acessos.";
  }
  await registrarAcesso("USUARIO_CRIADO", "empresa_membros", userId, { role: v.role, conta_nova: novo, trocar_senha: novo && v.trocar_senha });
  revalidateUsers();
  return {
    ok: true,
    id: userId!,
    message: (novo ? `Acesso criado. ${v.email} já pode entrar com a senha definida${v.trocar_senha ? " (e vai trocá-la no primeiro acesso)" : ""}.` : `${v.email} já tinha conta e foi adicionado(a) à empresa com a senha atual dele(a).`) + aviso,
  };
}

const senhaSchema = z.object({
  id: zs.requiredUuid("o usuário"),
  senha: z.string().max(128),
  confirmar: z.string().max(128),
  trocar_senha: zs.bool(),
});

/**
 * Define uma nova senha para um membro da empresa (esqueceu a senha, primeiro acesso). Não vale para
 * contas que também acessam outra empresa ou a plataforma: a senha é da pessoa, não desta empresa.
 */
export async function definirSenhaUsuario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: SERVICE_ROLE_MSG };
  const parsed = senhaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (v.id === g.session.userId) return { error: "Para trocar a sua senha use Configurações › Segurança." };
  const invalida = erroSenha(v.senha, v.confirmar);
  if (invalida) return invalida;
  const supabase = await createClient();
  const { data: alvo } = await supabase.from("membros").select("id, email, role, admin_master").eq("id", v.id).maybeSingle();
  if (!alvo) return { error: "Usuário não encontrado nesta empresa." };
  if ((GESTAO.has(alvo.role as string) || alvo.admin_master) && !g.session.profile.admin_master) return { error: "Somente o administrador master redefine a senha de administradores e gestores." };
  const admin = createAdminClient();
  const [{ data: outras }, { data: plataforma }] = await Promise.all([
    admin.from("empresa_membros").select("empresa_id").eq("user_id", v.id).neq("empresa_id", g.session.empresa!.id).limit(1),
    admin.from("plataforma_admins").select("user_id").eq("user_id", v.id).maybeSingle(),
  ]);
  if (outras?.length || plataforma) return { error: "Esta conta também acessa outra empresa. A própria pessoa deve trocar a senha em “Esqueci a senha”." };
  const { error } = await admin.auth.admin.updateUserById(v.id, { password: v.senha, app_metadata: { trocar_senha: v.trocar_senha } });
  if (error) {
    console.error("[usuarios.senha]", error.status, error.code);
    return error.code === "weak_password" ? { error: "Senha fraca ou já vazada na internet. Escolha outra.", fieldErrors: { senha: "Senha fraca" } } : { error: "Não foi possível definir a senha." };
  }
  await registrarAcesso("SENHA_REDEFINIDA", "profiles", v.id, { trocar_senha: v.trocar_senha });
  return { ok: true, message: `Nova senha definida para ${alvo.email}.${v.trocar_senha ? " Ela será trocada no próximo acesso." : ""}` };
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
