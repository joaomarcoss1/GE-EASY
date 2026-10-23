import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { serverEnv } from "@/lib/env";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { extrairDados } from "@/lib/campo/ocr";
import { registrarAcesso } from "@/lib/actions/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OCR do documento (pré-preenche CPF, nome, nascimento e RG). Opcional e por empresa: precisa da chave do
 * Google Vision no servidor E da empresa ativar em Configurações (custo por página). A imagem não é guardada.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.empresa || !session.profile.active) return NextResponse.json({ mensagem: "Sem acesso." }, { status: 401 });
  if (!can(session.profile, "clientes.write")) return NextResponse.json({ mensagem: "Sem permissão." }, { status: 403 });
  const { googleVisionKey } = serverEnv();
  const db = await createClient({ origem: "app" });
  const { data: cfg } = await db.from("configuracoes").select("valor").eq("chave", "ocr").maybeSingle();
  if (!googleVisionKey || (cfg?.valor as { ativo?: boolean } | null)?.ativo !== true) return NextResponse.json({ mensagem: "Leitura automática (OCR) não está ativada para a empresa." }, { status: 404 });
  const { data: ok } = await db.rpc("rate_limit", { p_acao: "ocr", p_max: 60, p_janela_seg: 3600 });
  if (ok !== true) return NextResponse.json({ mensagem: "Limite de leituras por hora atingido." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const f = form?.get("imagem");
  if (!f || typeof f === "string" || f.size > 4 * 1024 * 1024) return NextResponse.json({ mensagem: "Envie uma foto de até 4 MB." }, { status: 400 });
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!detectarTipoArquivo(bytes, "image/jpeg")) return NextResponse.json({ mensagem: "Envie uma foto em JPEG." }, { status: 400 });

  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(googleVisionKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: Buffer.from(bytes).toString("base64") }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], imageContext: { languageHints: ["pt"] } }] }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!r?.ok) return NextResponse.json({ mensagem: "Serviço de leitura indisponível." }, { status: 502 });
  const j = (await r.json()) as { responses?: { fullTextAnnotation?: { text?: string } }[] };
  const dados = extrairDados(j.responses?.[0]?.fullTextAnnotation?.text ?? "");
  await registrarAcesso("INTEGRACAO", "ocr", null, { campos: Object.entries(dados).filter(([, v]) => v).map(([k]) => k) });
  return NextResponse.json({ dados });
}
