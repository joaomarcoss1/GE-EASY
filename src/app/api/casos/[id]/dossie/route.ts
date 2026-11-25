import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { protegerApi } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { registrarAcesso } from "@/lib/actions/utils";
import { gerarDossie, type Destino } from "@/lib/dossie/gerar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const destinoDe = (v: unknown): Destino => (v === "justica" ? "justica" : "inss");

/** Checklist do processo para o destino e os dossiês já gerados (com link temporário de download). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const bloqueio = await protegerApi(session);
  if (bloqueio) return bloqueio;
  if (!session || !can(session.profile, "clientes.view")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Processo inválido" }, { status: 400 });
  const destino = destinoDe(req.nextUrl.searchParams.get("destino"));
  const supabase = await createClient();
  const [{ data: checklist, error }, { data: dossies }] = await Promise.all([
    supabase.rpc("checklist_processo", { p_caso: id, p_destino: destino }),
    supabase.from("dossies").select("id, destino, arquivos, tamanho, faltando, gerado_por, created_at, storage_path, pdf_path").eq("caso_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  if (error || !checklist) return NextResponse.json({ error: "Processo não encontrado ou sem acesso." }, { status: 404 });
  const lista = dossies ?? [];
  const caminhos = lista.flatMap((d) => [d.storage_path, d.pdf_path].filter(Boolean) as string[]);
  const { data: urls } = caminhos.length ? await supabase.storage.from("dossies").createSignedUrls(caminhos, 600, { download: true }) : { data: [] };
  const url = new Map((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path ?? "", u.signedUrl as string]));
  const ids = [...new Set(lista.map((d) => d.gerado_por).filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await supabase.from("membros").select("id, full_name").in("id", ids) : { data: [] };
  const nome = new Map((pessoas ?? []).map((p) => [p.id as string, p.full_name as string]));
  return NextResponse.json({
    checklist,
    dossies: lista.map(({ storage_path, pdf_path, gerado_por, ...d }) => ({ ...d, por: gerado_por ? (nome.get(gerado_por) ?? "—") : "—", url: url.get(storage_path) ?? null, pdfUrl: pdf_path ? (url.get(pdf_path) ?? null) : null })),
  });
}

/** Gera o dossiê (ZIP com resumo, PDF único e documentos) e devolve o link temporário de download. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const bloqueio = await protegerApi(session);
  if (bloqueio) return bloqueio;
  if (!session?.empresa || !can(session.profile, "clientes.view")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Processo inválido" }, { status: 400 });
  const corpo = (await req.json().catch(() => ({}))) as { destino?: string };
  const destino = destinoDe(corpo.destino);
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "dossie", p_max: 20, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitos dossiês em pouco tempo. Aguarde alguns minutos." }, { status: 429 });
  try {
    const r = await gerarDossie(supabase, { casoId: id, destino, empresaId: session.empresa.id, geradoPor: session.userId, nomeQuemGera: session.profile.full_name || session.profile.email });
    await registrarAcesso("EXPORTACAO", "cliente_casos", id, { relatorio: "dossie", destino, arquivos: r.arquivos, faltando: r.faltando.length });
    const [{ data: link }, { data: pdf }] = await Promise.all([
      supabase.storage.from("dossies").createSignedUrl(r.caminho, 600, { download: r.nomeZip }),
      r.pdfCaminho ? supabase.storage.from("dossies").createSignedUrl(r.pdfCaminho, 600, { download: r.nomePdf }) : Promise.resolve({ data: null }),
    ]);
    return NextResponse.json({ ok: true, url: link?.signedUrl ?? null, pdfUrl: pdf?.signedUrl ?? null, arquivos: r.arquivos, faltando: r.faltando, tamanho: r.tamanho });
  } catch (e) {
    console.error("[dossie]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível gerar o dossiê." }, { status: 500 });
  }
}
