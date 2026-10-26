"use server";
import { redirect } from "next/navigation";
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { strongPassword } from "@/lib/validators";
import type { ActionState } from "./types";

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/inicio");

/**
 * Limitador de tentativas de login persistido no banco (vale entre instâncias do servidor).
 * Cada tentativa é contada ANTES de testar a senha (atômico, vale para requisições paralelas):
 * 5 por IP + e-mail e 20 por e-mail (independente do IP) a cada 15 minutos. As chaves são HMAC:
 * o e-mail não fica em claro e terceiros não conseguem calcular a chave de outra pessoa.
 */
function chaveLogin(...partes: string[]) {
  const segredo = process.env.APP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "geeasy-login";
  return createHmac("sha256", segredo).update(partes.join("|")).digest("hex");
}

/** Falha de login na auditoria das empresas da conta (alerta de força bruta). Pelo servidor; nunca lança. */
async function registrarFalhaLogin(email: string, ip: string) {
  if (!hasServiceRole()) return;
  try {
    const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
    await createAdminClient().rpc("auditoria_falha_login", { p_email: email, p_ip: ip, p_ua: ua });
  } catch (e) {
    console.error("[falha_login]", e instanceof Error ? e.message : e);
  }
}

/** IP do cliente. Na Vercel, x-real-ip / x-forwarded-for são definidos pela própria plataforma. */
async function ipDaRequisicao() {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim().slice(0, 64);
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email("E-mail inválido"), password: z.string().min(6, "Senha inválida").max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ip = await ipDaRequisicao();
  const chaveIp = chaveLogin("ip", ip, parsed.data.email);
  const chaveEmail = chaveLogin("email", parsed.data.email);
  const supabase = await createClient();
  const [porIp, porEmail] = await Promise.all([
    supabase.rpc("tentativa_login", { p_hash: chaveIp, p_max: 5 }),
    supabase.rpc("tentativa_login", { p_hash: chaveEmail, p_max: 20 }),
  ]);
  if (porIp.data === false || porEmail.data === false) return { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." };

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) await registrarFalhaLogin(parsed.data.email, ip);
  if (error) return { error: error.message.includes("Email not confirmed") ? "Confirme seu e-mail antes de entrar." : "E-mail ou senha incorretos." };
  await Promise.all([supabase.rpc("limpar_rate_limit_login", { p_hash: chaveIp }), supabase.rpc("limpar_rate_limit_login", { p_hash: chaveEmail })]);
  // Registro de acesso (Marco Civil da Internet, art. 15: guarda dos registros de acesso a aplicações)
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await supabase.rpc("registrar_acesso", { p_acao: "LOGIN", p_tabela: "auth", p_registro: data.user?.id ?? null, p_detalhes: { ip, ua } });
  redirect(safeNext(formData.get("next")));
}

/**
 * Encerra a sessão deste aparelho. O signOut do SDK não apaga os cookies quando a chamada à API falha
 * (rede, token já expirado): os cookies sb-* são removidos aqui de qualquer forma.
 */
async function encerrarSessao(detalhes: Record<string, string> | null) {
  const supabase = await createClient();
  await supabase.rpc("registrar_acesso", { p_acao: "LOGOUT", p_tabela: "auth", p_registro: null, p_detalhes: detalhes }).then(() => undefined, () => undefined);
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.startsWith("sb-")) jar.delete(c.name);
}

export async function signOut() {
  await encerrarSessao(null);
  redirect("/login");
}

/** Saída por inatividade (chamada pelo vigia de sessão no navegador). */
export async function signOutInatividade() {
  await encerrarSessao({ motivo: "inatividade" });
  redirect("/login?motivo=inatividade");
}

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.siteUrl}/auth/callback?next=/redefinir-senha` });
  // Resposta sempre igual para não revelar se o e-mail existe
  return { ok: true, message: "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha." };
}

export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const pass = strongPassword.safeParse(formData.get("password"));
  if (!pass.success) return { error: pass.error.issues[0].message, fieldErrors: { password: pass.error.issues[0].message } };
  if (formData.get("password") !== formData.get("confirm")) return { error: "As senhas não conferem.", fieldErrors: { confirm: "As senhas não conferem." } };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente ou peça um novo link." };
  const atual = String(formData.get("atual") ?? "");
  const forcada = !!user.app_metadata?.trocar_senha;

  // O projeto exige a senha atual para trocar a senha, e o SDK não a envia: quando a pessoa a informa
  // (Segurança) ou acabou de entrar com a senha inicial do administrador, o servidor confere e grava.
  if ((forcada || atual) && hasServiceRole()) {
    if (atual) {
      const verif = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: e } = await verif.auth.signInWithPassword({ email: user.email ?? "", password: atual });
      if (e) return { error: "Senha atual incorreta.", fieldErrors: { atual: "Senha atual incorreta" } };
      await verif.auth.signOut({ scope: "local" });
      if (atual === pass.data) return { error: "A nova senha deve ser diferente da atual.", fieldErrors: { password: "Igual à atual" } };
    }
    const { error } = await createAdminClient().auth.admin.updateUserById(user.id, { password: pass.data, app_metadata: { trocar_senha: false } });
    if (error) return { error: error.code === "weak_password" ? "Senha fraca ou já vazada na internet. Escolha outra." : error.code === "same_password" ? "A nova senha deve ser diferente da atual." : "Não foi possível alterar a senha." };
    // trocar a senha encerra as sessões da conta: entra de novo com a nova senha para continuar logado
    await supabase.auth.signInWithPassword({ email: user.email ?? "", password: pass.data });
    return { ok: true, message: "Senha alterada com sucesso." };
  }
  // Link de recuperação ("Esqueci a senha")
  const { error } = await supabase.auth.updateUser({ password: pass.data });
  if (error) return { error: error.code === "same_password" ? "A nova senha deve ser diferente da atual." : "Não foi possível alterar a senha. O link pode ter expirado." };
  return { ok: true, message: "Senha alterada com sucesso." };
}
