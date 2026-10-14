import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/lib/rbac";
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

/** Exige usuário autenticado e ATIVO. Usado em páginas. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.active) redirect("/acesso-pendente");
  return session;
}

/** Exige permissão específica. Usado em páginas. */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session.profile.role, permission)) redirect("/dashboard?erro=permissao");
  return session;
}
