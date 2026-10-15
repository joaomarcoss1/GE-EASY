"use server";
import { redirect } from "next/navigation";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ActionState } from "./types";

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard");

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
  if (error) return { error: error.message.includes("Email not confirmed") ? "Confirme seu e-mail antes de entrar." : "E-mail ou senha incorretos." };
  await Promise.all([supabase.rpc("limpar_rate_limit_login", { p_hash: chaveIp }), supabase.rpc("limpar_rate_limit_login", { p_hash: chaveEmail })]);
  // Registro de acesso (Marco Civil da Internet, art. 15: guarda dos registros de acesso a aplicações)
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await supabase.rpc("registrar_acesso", { p_acao: "LOGIN", p_tabela: "auth", p_registro: data.user?.id ?? null, p_detalhes: { ip, ua } });
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.rpc("registrar_acesso", { p_acao: "LOGOUT", p_tabela: "auth", p_registro: null, p_detalhes: null });
  await supabase.auth.signOut();
  redirect("/login");
}

/** Saída por inatividade (chamada pelo vigia de sessão no navegador). */
export async function signOutInatividade() {
  const supabase = await createClient();
  await supabase.rpc("registrar_acesso", { p_acao: "LOGOUT", p_tabela: "auth", p_registro: null, p_detalhes: { motivo: "inatividade" } });
  await supabase.auth.signOut();
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

const strongPassword = z
  .string()
  .min(10, "Mínimo de 10 caracteres")
  .max(128)
  .regex(/[a-z]/, "Inclua uma letra minúscula")
  .regex(/[A-Z]/, "Inclua uma letra maiúscula")
  .regex(/\d/, "Inclua um número");

export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const pass = strongPassword.safeParse(formData.get("password"));
  if (!pass.success) return { error: pass.error.issues[0].message, fieldErrors: { password: pass.error.issues[0].message } };
  if (formData.get("password") !== formData.get("confirm")) return { error: "As senhas não conferem.", fieldErrors: { confirm: "As senhas não conferem." } };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pass.data });
  if (error) return { error: error.message.includes("different") ? "A nova senha deve ser diferente da atual." : "Não foi possível alterar a senha. O link pode ter expirado." };
  return { ok: true, message: "Senha alterada com sucesso." };
}
