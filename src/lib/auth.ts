import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole, type Permission } from "@/lib/rbac";
import { AREA_COOKIE, isArea } from "@/lib/tenant";
import type { Area, EmpresaResumo, Profile } from "@/lib/types";

export interface Session {
  userId: string;
  email: string;
  /** Perfil com papel, situação e permissões do vínculo com a empresa ativa */
  profile: Profile;
  /** Empresa ativa (null = sem empresa válida nesta requisição) */
  empresa: EmpresaResumo | null;
  /** Empresas em que o usuário tem vínculo ativo */
  empresas: EmpresaResumo[];
  /** Áreas de trabalho disponíveis (entrada por departamento) */
  areas: Area[];
  /** Área escolhida (só organiza a interface; não amplia permissões) */
  areaAtiva: Area | null;
  plataformaAdmin: boolean;
  /** Senha inicial definida pelo administrador: precisa ser trocada antes de usar o sistema */
  trocarSenha: boolean;
}

interface ContextoSessao {
  empresa: EmpresaResumo | null;
  membro: { role: Profile["role"]; ativo: boolean; admin_master: boolean } | null;
  empresas: EmpresaResumo[];
  plataforma_admin: boolean;
  permissoes: string[];
  areas: Area[];
}

/** Sessão atual (memoizada por requisição). Retorna null se não autenticado. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  // getClaims() confere a assinatura do JWT (chave assimétrica) sem ir ao servidor de autenticação;
  // o vínculo ativo com a empresa é conferido no banco (contexto_sessao) a cada requisição.
  const { data: auth } = await supabase.auth.getClaims();
  const user = auth?.claims?.sub ? { id: auth.claims.sub, email: auth.claims.email as string | undefined, trocarSenha: !!auth.claims.app_metadata?.trocar_senha } : null;
  if (!user) return null;
  const [{ data: profile }, { data: ctx }, cookieStore] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    supabase.rpc("contexto_sessao"),
    cookies(),
    getPoliticaSeguranca(), // já carrega a política (memoizada) junto, em vez de depois
  ]);
  if (!profile) return null;
  const c = (ctx ?? null) as ContextoSessao | null;
  const empresa = c?.empresa ?? null;
  const areas = (c?.areas ?? []).filter(isArea);
  const areaCookie = cookieStore.get(AREA_COOKIE)?.value;
  return {
    userId: user.id,
    email: user.email ?? "",
    profile: {
      ...profile,
      role: c?.membro?.role ?? profile.role,
      active: !!(profile.active && empresa && c?.membro?.ativo),
      permissoes: empresa ? (c?.permissoes ?? []) : [],
      admin_master: !!(empresa && c?.membro?.admin_master),
    },
    empresa,
    empresas: c?.empresas ?? [],
    areas,
    areaAtiva: isArea(areaCookie) && areas.includes(areaCookie) ? areaCookie : null,
    plataformaAdmin: !!c?.plataforma_admin,
    trocarSenha: user.trocarSenha,
  };
});

interface PoliticaSeguranca {
  inatividade_min: number;
  exigir_2fa: "nenhum" | "gestao" | "todos";
}

/** Política de segurança da empresa (Configurações › Segurança), memoizada por requisição. */
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
 * Administrador master e dono da plataforma sempre precisam de 2FA quando a política é "gestão".
 */
export const getSituacao2fa = cache(async (profile: Pick<Profile, "role" | "admin_master">) => {
  const supabase = await createClient();
  const [{ data: aal }, politica] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), getPoliticaSeguranca()]);
  const verificar = !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  const gestao = isManagerRole(profile.role) || profile.role === "financeiro" || !!profile.admin_master;
  const exige = politica.exigir_2fa === "todos" || (politica.exigir_2fa === "gestao" && gestao);
  const cadastrar = exige && aal?.nextLevel !== "aal2";
  return { verificar, cadastrar, bloqueado: verificar || cadastrar };
});

/** Exige usuário autenticado, com empresa ativa válida e vínculo ATIVO (e o 2FA exigido). Usado em páginas. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.trocarSenha) redirect("/redefinir-senha");
  if (!session.empresa) {
    if (session.empresas.length) redirect("/selecionar-empresa");
    if (session.plataformaAdmin) redirect("/plataforma");
    redirect("/acesso-pendente");
  }
  if (!session.profile.active) redirect("/acesso-pendente");
  const mfa = await getSituacao2fa(session.profile);
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
  if (!can(session.profile, permission)) redirect("/inicio?erro=permissao");
  return session;
}

/** Exige acesso à área (departamento) — URLs /consultor, /administrativo, /juridico, /rh, /financeiro. */
export async function requireArea(area: Area): Promise<Session> {
  const session = await requireSession();
  if (!session.areas.includes(area)) redirect("/inicio?erro=area");
  return session;
}

/** Exige administrador master da empresa ativa (tela de acessos). */
export async function requireMaster(): Promise<Session> {
  const session = await requireSession();
  if (!session.profile.admin_master) redirect("/inicio?erro=permissao");
  return session;
}

/** Painel da plataforma: dono da plataforma (não depende de empresa ativa). */
export async function requirePlataforma(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.plataformaAdmin) redirect("/inicio?erro=permissao");
  const mfa = await getSituacao2fa({ role: "admin", admin_master: true });
  if (mfa.verificar) redirect("/mfa");
  return session;
}
