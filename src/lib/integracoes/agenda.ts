import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { formatCNJ } from "@/lib/juridico/cnj";
import { toSpIso } from "@/components/agenda/date-utils";
import { deleteCalendarEvent, getAccessToken, upsertCalendarEvent, type CalendarEventInput } from "@/lib/google";

/** Prazo => evento de dia inteiro no vencimento, com lembretes 2 dias e 1 dia antes (9h). */
function prazoParaEvento(p: {
  id: string;
  descricao: string;
  data_fim: string;
  fatal: boolean;
  observacoes?: string | null;
  processo?: { id: string; titulo: string; numero_cnj: string | null } | null;
}): CalendarEventInput {
  const proc = p.processo;
  return {
    titulo: `${p.fatal ? "PRAZO FATAL" : "Prazo"}: ${p.descricao}${proc ? ` — ${proc.titulo}` : ""}`.slice(0, 200),
    descricao: [
      proc?.numero_cnj ? `Processo ${formatCNJ(proc.numero_cnj)}` : null,
      p.observacoes,
      proc ? `${env.siteUrl}/processos/${proc.id}` : `${env.siteUrl}/prazos`,
    ]
      .filter(Boolean)
      .join("\n"),
    inicio: p.data_fim,
    fim: p.data_fim,
    dia_inteiro: true,
    lembretes: [2340, 900],
    cor: p.fatal ? "11" : "5",
  };
}

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Mantém o evento do prazo no Google Agenda do responsável (cria, atualiza ou remove).
 * `antes` informa o responsável/evento anteriores (troca de responsável). Nunca lança.
 */
export async function sincronizarPrazoGoogle(db: SupabaseClient, prazoId: string, antes?: { responsavel_id: string | null; google_event_id: string | null } | null) {
  try {
    const { data } = await db
      .from("prazos")
      .select("id, descricao, data_fim, fatal, status, observacoes, responsavel_id, google_event_id, processos(id, titulo, numero_cnj)")
      .eq("id", prazoId)
      .maybeSingle();
    if (!data) return;
    let gid: string | null = data.google_event_id;
    if (antes?.google_event_id && antes.responsavel_id && antes.responsavel_id !== data.responsavel_id) {
      await deleteCalendarEvent(antes.responsavel_id, antes.google_event_id);
      gid = null;
    }
    if (data.status !== "pendente" || !data.responsavel_id) {
      if (gid && data.responsavel_id) await deleteCalendarEvent(data.responsavel_id, gid);
      if (data.google_event_id) await db.from("prazos").update({ google_event_id: null }).eq("id", data.id);
      return;
    }
    const novo = await upsertCalendarEvent(
      data.responsavel_id,
      prazoParaEvento({ ...data, processo: one(data.processos as unknown as { id: string; titulo: string; numero_cnj: string | null } | null) }),
      gid,
    );
    if (novo !== data.google_event_id) await db.from("prazos").update({ google_event_id: novo }).eq("id", data.id);
  } catch (err) {
    console.error("[agenda.prazo.google]", err instanceof Error ? err.message : err);
  }
}

/** Remove o evento do prazo (antes de excluir o prazo). */
export async function removerPrazoGoogle(responsavelId: string | null, googleEventId: string | null) {
  if (!responsavelId || !googleEventId) return;
  try {
    await deleteCalendarEvent(responsavelId, googleEventId);
  } catch (err) {
    console.error("[agenda.prazo.google.delete]", err instanceof Error ? err.message : err);
  }
}

/**
 * Envia ao Google Agenda os prazos pendentes e compromissos futuros ainda não sincronizados
 * dos usuários informados (que têm a conta Google conectada).
 */
export async function sincronizarPendentesAgenda(db: SupabaseClient, todos: string[], limite = 40, prazoFinal = Date.now() + 40_000) {
  const resultado = { prazos: 0, eventos: 0, falhas: 0 };
  // Só quem tem a conexão Google válida (um token revogado não pode travar a fila dos demais)
  const usuarios: string[] = [];
  for (const u of todos) {
    if (Date.now() > prazoFinal) break;
    if (await getAccessToken(u).catch(() => null)) usuarios.push(u);
  }
  if (!usuarios.length) return resultado;
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const { data: prazos } = await db
    .from("prazos")
    .select("id")
    .eq("status", "pendente")
    .gte("data_fim", hoje)
    .is("google_event_id", null)
    .in("responsavel_id", usuarios)
    .order("data_fim")
    .limit(limite);
  for (const p of prazos ?? []) {
    if (prazoFinal - Date.now() < 12_000) return resultado;
    await sincronizarPrazoGoogle(db, p.id);
    const { data: ok } = await db.from("prazos").select("google_event_id").eq("id", p.id).maybeSingle();
    if (ok?.google_event_id) resultado.prazos++;
    else resultado.falhas++;
  }
  const { data: eventos } = await db
    .from("agenda_eventos")
    .select("id, titulo, descricao, local, inicio, fim, dia_inteiro, lembrete_minutos, responsavel_id")
    .eq("status", "agendado")
    .gte("fim", new Date().toISOString())
    .is("google_event_id", null)
    .in("responsavel_id", usuarios)
    .order("inicio")
    .limit(limite);
  for (const e of eventos ?? []) {
    if (prazoFinal - Date.now() < 12_000) return resultado;
    try {
      const gid = await upsertCalendarEvent(e.responsavel_id!, {
        titulo: e.titulo,
        descricao: e.descricao,
        local: e.local,
        inicio: toSpIso(e.inicio),
        fim: toSpIso(e.fim),
        dia_inteiro: e.dia_inteiro,
        lembrete_minutos: e.lembrete_minutos,
      });
      if (gid) {
        await db.from("agenda_eventos").update({ google_event_id: gid }).eq("id", e.id);
        resultado.eventos++;
      } else resultado.falhas++;
    } catch {
      resultado.falhas++;
    }
  }
  return resultado;
}
