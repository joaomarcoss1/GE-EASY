import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { assinaturaValida, enfileirarEventos, enviarPendentes, eventosDoWebhook, processarFila } from "@/lib/integracoes/whatsapp";

/**
 * Webhook da Meta (WhatsApp Cloud API e Lead Ads). Uma única URL para os dois produtos.
 * GET: verificação do endpoint (hub.verify_token). POST: confere a assinatura X-Hub-Signature-256,
 * grava os eventos na fila (idempotente) e responde 200; o processamento roda em seguida com after().
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = Buffer.from(p.get("hub.verify_token") ?? "");
  const esperado = Buffer.from(serverEnv().whatsappVerifyToken);
  if (p.get("hub.mode") === "subscribe" && esperado.length >= 16 && token.length === esperado.length && timingSafeEqual(token, esperado)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "não autorizado" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const corpo = await req.text();
  if (corpo.length > 2_000_000) return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
  if (!assinaturaValida(corpo, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  if (!hasServiceRole()) return NextResponse.json({ error: "indisponível" }, { status: 503 });
  let body: unknown;
  try {
    body = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  const admin = createAdminClient();
  const eventos = eventosDoWebhook(body);
  try {
    await enfileirarEventos(admin, eventos);
  } catch (e) {
    console.error("[webhook meta]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "falha ao registrar" }, { status: 500 }); // a Meta reenvia
  }
  if (eventos.length) {
    after(async () => {
      const ate = Date.now() + 45_000;
      await processarFila(admin, ate);
      await enviarPendentes(admin, ate); // respostas automáticas (boas-vindas, menu, fora do horário)
    });
  }
  return NextResponse.json({ ok: true });
}
