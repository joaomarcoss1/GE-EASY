import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env, serverEnv } from "@/lib/env";
import { isValidCNPJ } from "@/lib/validators";

/**
 * Cadastro self-service de empresa (teste de 14 dias). Defesas: limite por IP (HMAC), campo isca, Turnstile
 * quando configurado e aceite dos termos. O responsável recebe um convite por e-mail para definir a senha;
 * e-mail que já tem conta não é vinculado aqui (entra e pede a nova empresa ao suporte).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  empresa: z.string().trim().min(2, "Informe o nome da empresa").max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, "Endereço: letras minúsculas, números e hífen (3 a 40)"),
  cnpj: z.string().trim().max(20).optional().refine((v) => !v || isValidCNPJ(v.replace(/\D/g, "")), "CNPJ inválido"),
  plano: z.string().trim().max(40).default("profissional"),
  nome: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  termos: z.literal(true, { error: "É preciso aceitar os termos de uso e a política de privacidade" }),
  website: z.string().max(0).optional(),
  turnstile: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest) {
  if (!hasServiceRole()) return NextResponse.json({ mensagem: "Cadastro indisponível no momento." }, { status: 503 });
  const ip = (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  const chave = createHmac("sha256", serverEnv().encryptionKey || serverEnv().serviceRoleKey).update(`cadastro:${ip}`).digest("hex");
  const admin = createAdminClient();
  const { data: permitido } = await admin.rpc("rate_limit_publico", { p_chave: `${chave}:cad`, p_max: 3, p_janela_seg: 3600 });
  if (permitido === false) return NextResponse.json({ mensagem: "Muitas tentativas. Tente mais tarde." }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ mensagem: parsed.error.issues[0].message, campo: parsed.error.issues[0].path[0] }, { status: 422 });
  const v = parsed.data;
  if (v.website) return NextResponse.json({ ok: true, mensagem: "Verifique seu e-mail." });
  const secret = serverEnv().turnstileSecret;
  if (secret) {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret, response: v.turnstile ?? "", remoteip: ip }), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok || !((await r.json()) as { success?: boolean }).success) return NextResponse.json({ mensagem: "Confirme que você não é um robô." }, { status: 422 });
  }
  const { data: livre } = await admin.rpc("slug_disponivel", { p_slug: v.slug });
  if (!livre) return NextResponse.json({ mensagem: "Este endereço já está em uso. Escolha outro.", campo: "slug" }, { status: 409 });
  const { data: existente } = await admin.from("profiles").select("id").eq("email", v.email).maybeSingle();
  if (existente) return NextResponse.json({ mensagem: "Este e-mail já tem conta. Entre no sistema e fale com o suporte para abrir outra empresa.", campo: "email" }, { status: 409 });
  const { data: convite, error } = await admin.auth.admin.inviteUserByEmail(v.email, { data: { full_name: v.nome }, redirectTo: `${env.siteUrl}/auth/callback?next=/redefinir-senha` });
  if (error || !convite?.user) {
    console.error("[cadastro] convite", error?.message);
    return NextResponse.json({ mensagem: "Não foi possível enviar o e-mail de acesso. Tente novamente." }, { status: 500 });
  }
  const { error: e2 } = await admin.rpc("cadastrar_empresa_publica", { p_nome: v.empresa, p_slug: v.slug, p_cnpj: v.cnpj ?? "", p_plano: v.plano, p_user: convite.user.id });
  if (e2) {
    console.error("[cadastro] empresa", e2.message);
    await admin.auth.admin.deleteUser(convite.user.id).catch(() => null);
    return NextResponse.json({ mensagem: e2.code === "23505" ? "Este endereço já está em uso." : "Não foi possível criar a empresa. Tente novamente." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, mensagem: `Pronto! Enviamos para ${v.email} o link para definir sua senha. Seu teste de 14 dias começou.` });
}
