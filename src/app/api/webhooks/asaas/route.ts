import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/**
 * Webhook da Asaas (cobrança das assinaturas). Autenticado pelo token configurado no painel da Asaas
 * (cabeçalho asaas-access-token, comparação em tempo constante); evento gravado na fila (idempotente) e aplicado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const esperado = Buffer.from(serverEnv().asaasWebhookToken);
  const recebido = Buffer.from(req.headers.get("asaas-access-token") ?? "");
  if (esperado.length < 16 || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!hasServiceRole()) return NextResponse.json({ error: "indisponível" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { id?: string; event?: string; payment?: { id?: string; subscription?: string; dueDate?: string; value?: number } } | null;
  if (!body?.event) return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  const admin = createAdminClient();
  const externo = body.id ?? `${body.event}:${body.payment?.id ?? "?"}`;
  const { data: ev, error } = await admin.from("webhook_eventos").upsert({ origem: "cobranca", externo_id: externo.slice(0, 200), payload: body }, { onConflict: "origem,externo_id", ignoreDuplicates: true }).select("id");
  if (error) return NextResponse.json({ error: "falha ao registrar" }, { status: 500 });
  if (!ev?.length) return NextResponse.json({ ok: true, repetido: true });
  const p = body.payment;
  if (p?.subscription) {
    const { error: e2 } = await admin.rpc("aplicar_evento_cobranca", { p_assinatura: p.subscription, p_evento: body.event, p_vencimento: p.dueDate ?? null, p_valor: p.value ?? null });
    await admin.rpc("concluir_evento", { p_id: ev[0].id, p_ok: !e2, p_erro: e2?.message ?? null });
    if (e2) return NextResponse.json({ error: "falha ao aplicar" }, { status: 500 });
  } else {
    await admin.from("webhook_eventos").update({ status: "ignorado", processado_em: new Date().toISOString() }).eq("id", ev[0].id);
  }
  return NextResponse.json({ ok: true });
}
