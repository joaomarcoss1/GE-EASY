"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ActionState } from "./types";

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard");

// Limitador simples por IP+e-mail em memória (defesa extra além do rate limit do Supabase Auth)
const attempts = new Map<string, { n: number; until: number }>();
function throttled(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 5) return true;
  return false;
}
function registerFail(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) attempts.set(key, { n: 1, until: now + 15 * 60_000 });
  else a.n++;
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email("E-mail inválido"), password: z.string().min(6, "Senha inválida").max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${parsed.data.email}`;
  if (throttled(key)) return { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    registerFail(key);
    return { error: error.message.includes("Email not confirmed") ? "Confirme seu e-mail antes de entrar." : "E-mail ou senha incorretos." };
  }
  attempts.delete(key);
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
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
