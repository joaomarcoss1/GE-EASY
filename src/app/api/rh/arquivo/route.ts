import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { isUuid, registrarAcesso } from "@/lib/actions/utils";

/**
 * Arquivos do RH (documentos do funcionário e anexos de ausências). A linha é lida com RLS; atestados
 * (dado de saúde) exigem rh.dados_sensiveis ou ser o próprio funcionário. URL assinada de 60 s, auditada.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const doc = req.nextUrl.searchParams.get("doc");
  const aus = req.nextUrl.searchParams.get("ausencia");
  const supabase = await createClient();
  let path: string | null = null;
  let tabela = "funcionario_documentos";
  let id = doc;
  if (isUuid(doc)) {
    const { data } = await supabase.from("funcionario_documentos").select("storage_path").eq("id", doc).maybeSingle();
    path = (data?.storage_path as string | undefined) ?? null;
  } else if (isUuid(aus)) {
    tabela = "ausencias";
    id = aus;
    const { data } = await supabase.from("ausencias").select("anexo_path, tipo, funcionario_id").eq("id", aus).maybeSingle();
    if (data?.anexo_path) {
      const { data: meu } = await supabase.rpc("meu_funcionario");
      const proprio = meu === data.funcionario_id;
      if (data.tipo === "atestado" && !proprio && !can(session.profile, "rh.dados_sensiveis")) {
        await registrarAcesso("ACESSO_NEGADO", "ausencias", aus);
        return NextResponse.json({ error: "sem permissão" }, { status: 403 });
      }
      path = data.anexo_path as string;
    }
  }
  if (!path) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  const { data: url } = await createAdminClient().storage.from("documentos").createSignedUrl(path, 60);
  if (!url?.signedUrl) return NextResponse.json({ error: "indisponível" }, { status: 404 });
  await registrarAcesso("DOWNLOAD", tabela, id);
  return NextResponse.redirect(url.signedUrl, 302);
}
