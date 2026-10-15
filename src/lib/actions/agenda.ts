"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { deleteCalendarEvent, upsertCalendarEvent, type CalendarEventInput } from "@/lib/google";
import { spIsoFromMs, toSpIso } from "@/components/agenda/date-utils";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const TIPOS = ["reuniao", "visita", "ligacao", "assembleia", "renovacao", "tarefa", "audiencia", "prazo", "outro"] as const;
const STATUS = ["agendado", "concluido", "cancelado"] as const;

/** Aceita "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DDTHH:mm:ss" (horário de Brasília). */
const DT = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/;

const eventoSchema = z
  .object({
    titulo: zs.required("Título", 200).refine((v) => v.length >= 2, "Informe ao menos 2 caracteres"),
    tipo: zs.enumOf([...TIPOS], "Selecione o tipo"),
    inicio: zs.required("Início", 40).refine((v) => DT.test(v), "Data/hora inválida"),
    fim: zs.text(40).refine((v) => !v || DT.test(v), "Data/hora inválida"),
    dia_inteiro: zs.bool(),
    local: zs.text(300),
    link_reuniao: zs.text(500).refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "Informe um link válido (https://…)"),
    cliente_id: zs.uuid(),
    oportunidade_id: zs.uuid(),
    responsavel_id: zs.uuid(),
    lembrete_minutos: zs.number(0, 40320),
    descricao: zs.text(5000),
  })
  .transform((v, ctx) => {
    const s = DT.exec(v.inicio)!;
    let inicio: string;
    let fim: string;
    if (v.dia_inteiro) {
      const endDate = v.fim ? DT.exec(v.fim)![1] : s[1];
      inicio = `${s[1]}T00:00:00-03:00`;
      fim = `${endDate}T23:59:59-03:00`;
    } else {
      inicio = `${s[1]}T${s[2] ?? "09"}:${s[3] ?? "00"}:00-03:00`;
      if (v.fim) {
        const e = DT.exec(v.fim)!;
        fim = `${e[1]}T${e[2] ?? s[2] ?? "10"}:${e[3] ?? s[3] ?? "00"}:00-03:00`;
      } else {
        fim = Number.isNaN(Date.parse(inicio)) ? inicio : spIsoFromMs(Date.parse(inicio) + 3_600_000);
      }
    }
    if (Number.isNaN(Date.parse(inicio))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inicio"], message: "Data/hora inválida" });
      return z.NEVER;
    }
    if (Number.isNaN(Date.parse(fim))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fim"], message: "Data/hora inválida" });
      return z.NEVER;
    }
    if (Date.parse(fim) < Date.parse(inicio)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fim"], message: "O término deve ser depois do início" });
      return z.NEVER;
    }
    if (v.lembrete_minutos !== null && v.lembrete_minutos !== undefined && !Number.isInteger(v.lembrete_minutos)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lembrete_minutos"], message: "Lembrete inválido" });
      return z.NEVER;
    }
    return {
      titulo: v.titulo,
      tipo: v.tipo,
      inicio,
      fim,
      dia_inteiro: v.dia_inteiro,
      local: v.local ?? null,
      link_reuniao: v.link_reuniao ?? null,
      cliente_id: v.cliente_id ?? null,
      oportunidade_id: v.oportunidade_id ?? null,
      responsavel_id: v.responsavel_id ?? null,
      lembrete_minutos: v.lembrete_minutos ?? null,
      descricao: v.descricao ?? null,
    };
  });

type EventoData = z.output<typeof eventoSchema>;

interface EventoRow {
  id: string;
  titulo: string;
  descricao: string | null;
  local: string | null;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  lembrete_minutos: number | null;
  responsavel_id: string | null;
  google_event_id: string | null;
  cliente_id: string | null;
  status: (typeof STATUS)[number];
}

const ROW_COLS = "id, titulo, descricao, local, inicio, fim, dia_inteiro, lembrete_minutos, responsavel_id, google_event_id, cliente_id, status";

/** Converte o registro (do formulário ou do banco) para a entrada do Google Agenda. */
function googleInput(e: Pick<EventoRow, "titulo" | "descricao" | "local" | "inicio" | "fim" | "dia_inteiro" | "lembrete_minutos">): CalendarEventInput {
  return {
    titulo: e.titulo,
    descricao: e.descricao,
    local: e.local,
    // O helper do Google usa os 10 primeiros caracteres em eventos de dia inteiro: sempre no offset de Brasília.
    inicio: toSpIso(e.inicio),
    fim: toSpIso(e.fim),
    dia_inteiro: e.dia_inteiro,
    lembrete_minutos: e.lembrete_minutos,
  };
}

/**
 * Sincroniza com o Google Agenda do responsável (se conectado). Nunca lança:
 * falhas no Google não podem desfazer a operação no GE EASY.
 */
async function syncGoogle(eventId: string, responsavelId: string | null, input: CalendarEventInput, currentGoogleId: string | null) {
  if (!responsavelId) return;
  try {
    const gid = await upsertCalendarEvent(responsavelId, input, currentGoogleId);
    if (gid && gid !== currentGoogleId) {
      const supabase = await createClient();
      await supabase.from("agenda_eventos").update({ google_event_id: gid }).eq("id", eventId);
    }
  } catch (err) {
    console.error("[agenda.google.sync]", err instanceof Error ? err.message : err);
  }
}

async function removeGoogle(eventId: string | null, responsavelId: string | null, googleEventId: string | null) {
  if (!responsavelId || !googleEventId) return;
  try {
    await deleteCalendarEvent(responsavelId, googleEventId);
    if (eventId) {
      const supabase = await createClient();
      await supabase.from("agenda_eventos").update({ google_event_id: null }).eq("id", eventId);
    }
  } catch (err) {
    console.error("[agenda.google.delete]", err instanceof Error ? err.message : err);
  }
}

function revalidate(clienteIds: (string | null | undefined)[]) {
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  for (const c of new Set(clienteIds.filter(Boolean))) revalidatePath(`/clientes/${c}`);
}

export async function createEvento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = eventoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  // Não gestores só agendam para si mesmos (o RLS também garante).
  const data: EventoData = { ...parsed.data, responsavel_id: isManagerRole(profile.role) ? (parsed.data.responsavel_id ?? userId) : userId };

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("agenda_eventos").insert(data).select(ROW_COLS).single<EventoRow>();
  if (error) return dbError(error);

  await syncGoogle(row.id, row.responsavel_id, googleInput(row), null);
  revalidate([row.cliente_id]);
  return { ok: true, message: "Evento agendado.", id: row.id };
}

export async function updateEvento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Evento inválido." };
  const parsed = eventoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { userId, profile } = g.session;
  const manager = isManagerRole(profile.role);

  const supabase = await createClient();
  const { data: before } = await supabase.from("agenda_eventos").select(ROW_COLS).eq("id", id).maybeSingle<EventoRow>();
  if (!before) return { error: "Evento não encontrado ou sem acesso." };

  // Somente gestores alteram o responsável.
  const { responsavel_id, ...rest } = parsed.data;
  const update = manager ? { ...rest, responsavel_id: responsavel_id ?? userId } : rest;

  const { data: row, error } = await supabase.from("agenda_eventos").update(update).eq("id", id).select(ROW_COLS).maybeSingle<EventoRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para editar este evento." };

  if (row.status !== "cancelado") {
    if (before.google_event_id && before.responsavel_id !== row.responsavel_id) {
      // Mudou de responsável: remove da agenda antiga e cria na nova.
      await removeGoogle(row.id, before.responsavel_id, before.google_event_id);
      await syncGoogle(row.id, row.responsavel_id, googleInput(row), null);
    } else {
      await syncGoogle(row.id, row.responsavel_id, googleInput(row), row.google_event_id);
    }
  }
  revalidate([before.cliente_id, row.cliente_id]);
  return { ok: true, message: "Evento atualizado.", id: row.id };
}

export async function setEventoStatus(id: string, status: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Evento inválido." };
  const parsed = z.enum(STATUS).safeParse(status);
  if (!parsed.success) return { error: "Status inválido." };

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("agenda_eventos").update({ status: parsed.data }).eq("id", id).select(ROW_COLS).maybeSingle<EventoRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar este evento." };

  if (row.status === "cancelado") await removeGoogle(row.id, row.responsavel_id, row.google_event_id);
  else if (!row.google_event_id) await syncGoogle(row.id, row.responsavel_id, googleInput(row), null);

  revalidate([row.cliente_id]);
  const message = { agendado: "Evento reaberto.", concluido: "Evento concluído.", cancelado: "Evento cancelado." }[row.status];
  return { ok: true, message, id: row.id };
}

export async function deleteEvento(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Evento inválido." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("agenda_eventos").select(ROW_COLS).eq("id", id).maybeSingle<EventoRow>();
  if (!row) return { error: "Evento não encontrado ou sem acesso." };
  const { error, count } = await supabase.from("agenda_eventos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Você não tem permissão para excluir este evento." };

  await removeGoogle(null, row.responsavel_id, row.google_event_id);
  revalidate([row.cliente_id]);
  return { ok: true, message: "Evento excluído." };
}
