import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { isValidCPF } from "@/lib/validators";

/**
 * Captação pública de leads (formulário /f/<slug>, site da empresa, landing pages).
 * Defesas: limite por IP (HMAC, sem guardar o IP), campo isca, Turnstile quando configurado,
 * validação estrita e consentimento LGPD obrigatório. A deduplicação e a distribuição são do banco.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(200),
  telefone: z.string().trim().max(30).refine((v) => { const d = v.replace(/\D/g, ""); return d.length >= 10 && d.length <= 13; }, "Telefone inválido"),
  email: z.string().trim().max(200).email("E-mail inválido").or(z.literal("")).optional(),
  documento: z.string().trim().max(20).optional().refine((v) => !v || isValidCPF(v.replace(/\D/g, "")), "CPF inválido"),
  cidade: z.string().trim().max(120).optional(),
  interesse: z.string().trim().max(500).optional(),
  renda: z.string().trim().max(20).optional(),
  mensagem: z.string().trim().max(2000).optional(),
  consentimento: z.literal(true, { errorMap: () => ({ message: "É preciso aceitar o uso dos dados para contato" }) }),
  website: z.string().max(0).optional(), // isca: robôs preenchem
  utm: z.record(z.string().max(200)).optional(),
  turnstile: z.string().max(4000).optional(),
});

function chaveIp(req: NextRequest) {
  const ip = (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  const segredo = serverEnv().encryptionKey || serverEnv().serviceRoleKey;
  return createHmac("sha256", segredo).update(`lead:${ip}`).digest("hex");
}

async function turnstileOk(token: string | undefined, req: NextRequest) {
  const secret = serverEnv().turnstileSecret;
  if (!secret) return true;
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: req.headers.get("x-real-ip") ?? "" }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return Boolean(r?.ok && ((await r.json()) as { success?: boolean }).success);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !hasServiceRole()) return NextResponse.json({ mensagem: "Formulário não encontrado." }, { status: 404 });
  const admin = createAdminClient();
  const chave = chaveIp(req);
  const [{ data: porMinuto }, { data: porDia }] = await Promise.all([
    admin.rpc("rate_limit_publico", { p_chave: `${chave}:m`, p_max: 5, p_janela_seg: 60 }),
    admin.rpc("rate_limit_publico", { p_chave: `${chave}:d`, p_max: 30, p_janela_seg: 86400 }),
  ]);
  if (porMinuto === false || porDia === false) return NextResponse.json({ mensagem: "Muitos envios. Tente novamente mais tarde." }, { status: 429 });
  const corpo = await req.json().catch(() => null);
  const parsed = schema.safeParse(corpo);
  if (!parsed.success) return NextResponse.json({ mensagem: parsed.error.issues[0].message }, { status: 422 });
  const v = parsed.data;
  if (v.website) return NextResponse.json({ ok: true }); // robô: finge sucesso
  if (!(await turnstileOk(v.turnstile, req))) return NextResponse.json({ mensagem: "Confirme que você não é um robô." }, { status: 422 });
  const { data: form } = await admin.from("lead_formularios").select("id, empresa_id, campanha, mensagem_sucesso").eq("slug", slug).eq("ativo", true).maybeSingle();
  if (!form) return NextResponse.json({ mensagem: "Formulário não encontrado." }, { status: 404 });
  const { error } = await admin.rpc("capturar_lead", {
    p_empresa: form.empresa_id,
    p_origem: "site",
    p_dados: {
      nome: v.nome, telefone: v.telefone, email: v.email || null, documento: v.documento || null, cidade: v.cidade || null,
      interesse: v.interesse || null, renda: v.renda ? v.renda.replace(/[^\d,]/g, "").replace(",", ".") : null, mensagem: v.mensagem || null,
      campanha: v.utm?.utm_campaign ?? form.campanha ?? null, utm: v.utm ?? null, formulario: slug,
      consentimento: { aceito: true, em: new Date().toISOString(), canal: "formulario_publico" },
    },
  });
  if (error) {
    console.error("[lead publico]", error.message);
    return NextResponse.json({ mensagem: "Não foi possível enviar agora. Tente novamente." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mensagem: form.mensagem_sucesso ?? "Recebemos seus dados! Em breve entraremos em contato." });
}
