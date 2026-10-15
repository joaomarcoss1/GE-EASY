import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/env";
import { sincronizarProcessoDatajud } from "@/lib/integracoes/datajud";
import { buscarComunicacoesDjen, importarComunicacoes, isoDiasAtras, oabsMonitoradas } from "@/lib/integracoes/djen";
import { arquivarDocumentoNoDrive, getDriveEscritorio } from "@/lib/integracoes/drive";
import { sincronizarPendentesAgenda } from "@/lib/integracoes/agenda";

/**
 * Rotina de sincronização (chamada pelo pg_cron do Supabase via pg_net, com o segredo CRON_SECRET).
 * ?tarefa=datajud | djen | drive | agenda | limpeza (várias separadas por vírgula).
 * Usa o service role porque roda sem usuário: autorização = segredo compartilhado (comparação em tempo constante).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TAREFAS = new Set(["datajud", "djen", "drive", "agenda", "limpeza"]);

function autorizado(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const header = req.headers.get("authorization") ?? "";
  const recebido = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const esperado = Buffer.from(secret);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

async function executar(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!hasServiceRole()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada" }, { status: 503 });

  const tarefas = (req.nextUrl.searchParams.get("tarefa") ?? "").split(",").map((t) => t.trim()).filter((t) => TAREFAS.has(t));
  if (!tarefas.length) return NextResponse.json({ error: "tarefa inválida" }, { status: 400 });

  const admin = createAdminClient();
  // Prazo final da execução (maxDuration 60 s; pg_net também espera 60 s). Cada etapa só inicia
  // uma chamada externa se sobrar tempo para o pior caso dela (DataJud/DJEN 20 s, Drive 30 s).
  const fim = Date.now() + 56_000;
  const resumo: Record<string, unknown> = {};
  const registrar = (tipo: string, status: "ok" | "erro" | "parcial", mensagem: string, detalhes?: unknown) =>
    admin.from("integracoes_log").insert({ tipo, status, mensagem: mensagem.slice(0, 1000), detalhes: detalhes ?? null });

  // ---------------------------------------------------------- DataJud
  if (tarefas.includes("datajud")) {
    const { data: fila } = await admin
      .from("processos")
      .select("id")
      .eq("datajud_monitorar", true)
      .not("numero_cnj", "is", null)
      .in("status", ["ativo", "suspenso"])
      .or(`datajud_sincronizado_em.is.null,datajud_sincronizado_em.lt.${new Date(Date.now() - 6 * 3600_000).toISOString()}`)
      .order("datajud_sincronizado_em", { ascending: true, nullsFirst: true })
      .limit(30);
    const r = { consultados: 0, movimentos: 0, falhas: 0 };
    const lista = [...(fila ?? [])];
    const worker = async () => {
      while (lista.length && fim - Date.now() > 25_000) {
        const p = lista.shift()!;
        const s = await sincronizarProcessoDatajud(admin, p.id, { notificarDireto: true });
        r.consultados++;
        r.movimentos += s.novos;
        if (s.status === "erro") r.falhas++;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    resumo.datajud = r;
    if (r.consultados) await registrar("datajud", r.falhas ? (r.falhas === r.consultados ? "erro" : "parcial") : "ok", `Rotina: ${r.consultados} processo(s), ${r.movimentos} movimentação(ões) nova(s)`, r);
  }

  // ---------------------------------------------------------- DJEN
  if (tarefas.includes("djen") && Date.now() < fim) {
    const oabs = await oabsMonitoradas(admin);
    const r = { oabs: oabs.length, encontradas: 0, novas: 0, erros: [] as string[] };
    const inicio = isoDiasAtras(3);
    const hoje = isoDiasAtras(0);
    for (const oab of oabs) {
      if (fim - Date.now() < 25_000) break;
      const { itens, erro } = await buscarComunicacoesDjen(oab, inicio, hoje, fim);
      r.encontradas += itens.length;
      if (erro) r.erros.push(`${oab.rotulo}: ${erro}`);
      const imp = await importarComunicacoes(admin, itens, oab);
      r.novas += imp.novas;
      if (imp.erro) r.erros.push(`${oab.rotulo}: ${imp.erro}`);
      if (imp.novas && oab.responsavelId)
        await admin.from("notificacoes").insert({ user_id: oab.responsavelId, titulo: "Novas intimações no DJEN", mensagem: `${imp.novas} comunicação(ões) para a OAB ${oab.rotulo}`, link: "/publicacoes" });
    }
    resumo.djen = { ...r, erros: r.erros.slice(0, 5) };
    if (oabs.length) await registrar("djen", r.erros.length ? (r.novas ? "parcial" : "erro") : "ok", `Rotina: ${r.novas} intimação(ões) nova(s) de ${r.encontradas}`, resumo.djen);
  }

  // ---------------------------------------------------------- Drive do escritório
  if (tarefas.includes("drive") && googleConfigured() && Date.now() < fim && (await getDriveEscritorio(admin))) {
    const { data: docs } = await admin
      .from("documentos")
      .select("id")
      .in("drive_status", ["pendente", "erro"])
      .lt("drive_tentativas", 5)
      .not("storage_path", "is", null)
      .order("created_at")
      .limit(10);
    const r = { arquivados: 0, falhas: 0 };
    for (const d of docs ?? []) {
      if (fim - Date.now() < 40_000) break;
      const s = await arquivarDocumentoNoDrive(admin, d.id);
      if (s.ok) r.arquivados++;
      else r.falhas++;
    }
    resumo.drive = r;
    if (r.arquivados || r.falhas) await registrar("drive", r.falhas ? "parcial" : "ok", `Rotina: ${r.arquivados} documento(s) arquivado(s)`, r);
  }

  // ---------------------------------------------------------- Google Agenda
  if (tarefas.includes("agenda") && googleConfigured() && Date.now() < fim) {
    const { data: conectados } = await admin.from("integracoes_google").select("user_id").not("refresh_token_enc", "is", null);
    const usuarios = (conectados ?? []).map((c) => c.user_id as string);
    const r = await sincronizarPendentesAgenda(admin, usuarios, 40, fim);
    resumo.agenda = r;
    if (r.prazos || r.eventos || r.falhas) await registrar("agenda", r.falhas ? "parcial" : "ok", `Rotina: ${r.prazos} prazo(s) e ${r.eventos} compromisso(s) enviados`, r);
  }

  // ---------------------------------------------------------- Retenção de dados técnicos
  if (tarefas.includes("limpeza")) {
    const dias = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    await admin.from("rate_limits").delete().lt("janela_inicio", dias(2));
    await admin.from("integracoes_log").delete().lt("created_at", dias(180));
    await admin.from("notificacoes").delete().eq("lida", true).lt("created_at", dias(180));
    resumo.limpeza = "ok";
  }

  return NextResponse.json({ ok: true, resumo });
}

export const GET = executar;
export const POST = executar;
