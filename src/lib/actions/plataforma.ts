"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, getSituacao2fa } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { strongPassword } from "@/lib/validators";
import { dbError, formToObject, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/** Dono da plataforma (não depende de empresa ativa). O banco confere de novo em cada RPC/política. */
async function plataforma(): Promise<{ userId: string } | { denied: ActionState }> {
  const session = await getSession();
  if (!session) return { denied: { error: "Sessão expirada. Entre novamente." } };
  if (!session.plataformaAdmin) return { denied: { error: "Somente o dono da plataforma." } };
  if ((await getSituacao2fa({ role: "admin", admin_master: true })).verificar) return { denied: { error: "Confirme a verificação em duas etapas." } };
  return { userId: session.userId };
}

const MODULOS = ["consultor", "administrativo", "juridico", "rh", "financeiro"] as const;

const criarSchema = z.object({
  nome: zs.required("Nome", 160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/, "Use letras minúsculas, números e hífen (2 a 40)"),
  cnpj: zs.text(20),
  plano: zs.required("Plano", 40),
  status: zs.enumOf(["trial", "ativa"]),
  admin_email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  admin_nome: zs.required("Nome do administrador", 120),
  admin_senha: z.string().max(128).optional().default(""),
});

/**
 * Cria a empresa (dados padrão: departamentos, níveis, documentos exigidos) e o acesso do administrador
 * master com a senha inicial (trocada no primeiro acesso). Conta já existente: só vincula.
 */
export async function criarEmpresa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await plataforma();
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: "Configure SUPABASE_SERVICE_ROLE_KEY para criar o administrador." };
  const parsed = criarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const admin = createAdminClient();
  const { data: existente } = await admin.from("profiles").select("id").eq("email", v.admin_email).maybeSingle();
  if (!existente) {
    const s = strongPassword.safeParse(v.admin_senha);
    if (!s.success) return { error: s.error.issues[0].message, fieldErrors: { admin_senha: s.error.issues[0].message } };
  }
  const supabase = await createClient();
  const { data: empresaId, error } = await supabase.rpc("plataforma_criar_empresa", { p_nome: v.nome, p_slug: v.slug, p_cnpj: v.cnpj, p_plano: v.plano, p_status: v.status });
  if (error) return error.code === "23505" ? { error: "Este endereço (slug) já está em uso.", fieldErrors: { slug: "Já existe" } } : dbError(error);

  let userId = (existente?.id as string | undefined) ?? null;
  if (!userId) {
    const { data: novo, error: e2 } = await admin.auth.admin.createUser({
      email: v.admin_email,
      password: v.admin_senha,
      email_confirm: true,
      user_metadata: { full_name: v.admin_nome },
      app_metadata: { trocar_senha: true },
    });
    if (e2) console.error("[plataforma.criar_admin]", e2.status, e2.code);
    userId = novo?.user?.id ?? null;
  }
  if (!userId) return { ok: true, message: "Empresa criada, mas não foi possível criar o administrador (senha fraca ou e-mail inválido). Tente de novo com outro e-mail.", id: empresaId as string };
  const { error: e3 } = await supabase.rpc("plataforma_vincular_usuario", { p_empresa: empresaId, p_user: userId, p_role: "admin", p_admin_master: true });
  if (e3) return { error: "Empresa criada, mas não foi possível vincular o administrador." };
  revalidatePath("/plataforma");
  return { ok: true, message: existente ? `Empresa criada e ${v.admin_email} (conta já existente) vinculado como administrador master.` : `Empresa criada. ${v.admin_email} já pode entrar com a senha inicial e vai trocá-la no primeiro acesso.`, id: empresaId as string };
}

const atualizarSchema = z.object({
  id: zs.requiredUuid("a empresa"),
  status: zs.enumOf(["trial", "ativa", "suspensa", "cancelada"]),
  plano: zs.required("Plano", 40),
  max_usuarios: zs.number(1, 100000),
  dominio: z.string().trim().toLowerCase().max(253).regex(/^$|^[a-z0-9.-]{4,253}$/, "Domínio inválido").transform((d) => d || null),
  modulos: z.array(z.enum(MODULOS)).optional().default([]),
});

/** Situação (suspender bloqueia o acesso de todos os usuários da empresa), plano, limites, domínio e módulos. */
export async function atualizarEmpresa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await plataforma();
  if ("denied" in g) return g.denied;
  const parsed = atualizarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: atual } = await supabase.from("empresas").select("limites").eq("id", v.id).maybeSingle();
  const limites = { ...((atual?.limites ?? {}) as Record<string, unknown>), max_usuarios: v.max_usuarios ?? null };
  const { error } = await supabase.from("empresas").update({ status: v.status, plano: v.plano, dominio: v.dominio, modulos: v.modulos, limites }).eq("id", v.id);
  if (error) return error.code === "23505" ? { error: "Domínio já usado por outra empresa." } : dbError(error);
  revalidatePath("/plataforma");
  return { ok: true, message: "Empresa atualizada." };
}
