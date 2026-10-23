import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid, registrarAcesso } from "@/lib/actions/utils";

/**
 * Mídia de uma mensagem de WhatsApp. A leitura da mensagem passa pelo RLS (só quem vê a conversa);
 * o arquivo é servido por URL assinada de 60 s, nunca direto do storage.
 */
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "inválido" }, { status: 400 });
  const supabase = await createClient();
  const { data: m } = await supabase.from("wa_mensagens").select("id, midia_path, midia_nome").eq("id", id).not("midia_path", "is", null).maybeSingle();
  if (!m?.midia_path) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  const { data: url } = await createAdminClient().storage.from("documentos").createSignedUrl(m.midia_path as string, 60, m.midia_nome ? { download: m.midia_nome as string } : undefined);
  if (!url?.signedUrl) return NextResponse.json({ error: "indisponível" }, { status: 404 });
  await registrarAcesso("DOWNLOAD", "wa_mensagens", id);
  return NextResponse.redirect(url.signedUrl, 302);
}
