import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole, type Permission } from "@/lib/rbac";
import type { Profile } from "@/lib/types";

export interface Session {
  userId: string;
  email: string;
  profile: Profile;
}

/** Sessão atual (memoizada por requisição). Retorna null se não autenticado. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  if (!profile) return null;
  return { userId: user.id, email: user.email ?? "", profile };
});

export interface PoliticaSeguranca {
  inatividade_min: number;
  exigir_2fa: "nenhum" | "gestao" | "todos";
}

/** Política de segurança do escritório (Configurações › Segurança), memoizada por requisição. */
export const getPoliticaSeguranca = cache(async (): Promise<PoliticaSeguranca> => {
  const supabase = await createClient();
  const { data } = await supabase.from("configuracoes").select("valor").eq("chave", "seguranca").maybeSingle();
  const v = (data?.valor ?? {}) as Partial<PoliticaSeguranca>;
  return {
    inatividade_min: Math.min(240, Math.max(5, Number(v.inatividade_min) || 30)),
    exigir_2fa: v.exigir_2fa === "gestao" || v.exigir_2fa === "todos" ? v.exigir_2fa : "nenhum",
  };
});

/**
 * Situação do segundo fator da sessão:
 * - `verificar`: o usuário tem 2FA, mas a sessão ainda é só senha (AAL1) → precisa informar o código;
 * - `cadastrar`: a política exige 2FA e o usuário ainda não cadastrou o autenticador.
 */
export const getSituacao2fa = cache(async (role: Profile["role"]) => {
  const supabase = await createClient();
  const [{ data: aal }, politica] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), getPoliticaSeguranca()]);
  const verificar = !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  const exige = politica.exigir_2fa === "todos" || (politica.exigir_2fa === "gestao" && (isManagerRole(role) || role === "financeiro"));
  const cadastrar = exige && aal?.nextLevel !== "aal2";
  return { verificar, cadastrar, bloqueado: verificar || cadastrar };
});

/** Exige usuário autenticado e ATIVO (e o 2FA exigido pela política). Usado em páginas. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.active) redirect("/acesso-pendente");
  const mfa = await getSituacao2fa(session.profile.role);
  if (mfa.verificar) redirect("/mfa");
  if (mfa.cadastrar) {
    // Sem 2FA cadastrado: somente a tela de segurança fica liberada até o cadastro
    const atual = (await headers()).get("x-geeasy-path") ?? "";
    if (!atual.startsWith("/configuracoes?tab=seguranca")) redirect("/configuracoes?tab=seguranca&exigir2fa=1");
  }
  return session;
}

/** Exige permissão específica. Usado em páginas. */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session.profile.role, permission)) redirect("/dashboard?erro=permissao");
  return session;
}
