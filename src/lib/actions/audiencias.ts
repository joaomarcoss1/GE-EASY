"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AUDIENCIA_MODALIDADES, AUDIENCIA_TIPOS } from "@/lib/constants";
import { deleteCalendarEvent, upsertCalendarEvent, type CalendarEventInput } from "@/lib/google";
import { spIsoFromMs, toSpIso } from "@/components/agenda/date-utils";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const TIPOS = ["conciliacao", "instrucao", "una", "julgamento", "mediacao", "outra"] as const;
const STATUS = ["agendada", "realizada", "redesignada", "cancelada"] as const;
const MODALIDADES = ["presencial", "virtual", "hibrida"] as const;
type Status = (typeof STATUS)[number];

/** datetime-local ("YYYY-MM-DDTHH:mm") interpretado no horário de Brasília (-03:00). */
const DT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/;
const dataHora = () =>
  zs
    .required("Data e hora", 40)
    .refine((v) => DT.test(v), "Data/hora inválida")
    .transform((v, ctx) => {
      const m = DT.exec(v)!;
      const iso = `${m[1]}T${m[2]}:${m[3]}:00-03:00`;
      if (Number.isNaN(Date.parse(iso))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data/hora inválida" });
        return z.NEVER;
      }
      return iso;
    });

const link = () => zs.text(500).refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), "Informe um link válido (https://…)");
const duracao = () =>
  zs.number(5, 720).refine((v) => v === null || v === undefined || Number.isInteger(v), "Duração inválida").transform((v) => v ?? 60);

const audienciaSchema = z.object({
  processo_id: zs.requiredUuid("o processo"),
  tipo: zs.enumOf([...TIPOS], "Selecione o tipo"),
  data_hora: dataHora(),
  duracao_min: duracao(),
  modalidade: zs.enumOf([...MODALIDADES], "Selecione a modalidade"),
  local: zs.text(300),
  link: link(),
  responsavel_id: zs.uuid(),
  preposto: zs.text(200),
});

const redesignarSchema = z.object({
  data_hora: dataHora(),
  duracao_min: duracao(),
  modalidade: zs.enumOf([...MODALIDADES], "Selecione a modalidade"),
  local: zs.text(300),
  link: link(),
});

interface AudienciaRow {
  id: string;
  processo_id: string;
  tipo: (typeof TIPOS)[number];
  data_hora: string;
  duracao_min: number;
  modalidade: (typeof MODALIDADES)[number];
  local: string | null;
  link: string | null;
  responsavel_id: string | null;
  preposto: string | null;
  status: Status;
  resultado: string | null;
  agenda_evento_id: string | null;
}
const COLS = "id, processo_id, tipo, data_hora, duracao_min, modalidade, local, link, responsavel_id, preposto, status, resultado, agenda_evento_id";

interface ProcessoInfo {
  id: string;
  titulo: string;
  numero_cnj: string | null;
  cliente_id: string | null;
}

interface EventoRef {
  id: string;
  responsavel_id: string | null;
  google_event_id: string | null;
}

type Db = Awaited<ReturnType<typeof createClient>>;

// ------------------------------------------------------------------ Agenda vinculada

const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

function eventoPayload(a: AudienciaRow, p: ProcessoInfo) {
  const tipo = label(AUDIENCIA_TIPOS, a.tipo).replace(/\s*\(.*\)$/, "");
  const inicio = toSpIso(a.data_hora);
  const fim = spIsoFromMs(Date.parse(a.data_hora) + a.duracao_min * 60_000);
  const descricao = [
    p.numero_cnj ? `Processo nº ${p.numero_cnj}` : null,
    `Modalidade: ${label(AUDIENCIA_MODALIDADES, a.modalidade)}`,
    a.preposto ? `Preposto: ${a.preposto}` : null,
    a.link ? `Link: ${a.link}` : null,
    a.resultado ? `Resultado: ${a.resultado}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    titulo: `Audiência de ${tipo} — ${p.titulo}`.slice(0, 200),
    descricao,
    tipo: "audiencia",
    status: a.status === "realizada" ? "concluido" : a.status === "cancelada" ? "cancelado" : "agendado",
    inicio,
    fim,
    dia_inteiro: false,
    local: a.local || a.link || null,
    link_reuniao: a.link,
    cliente_id: p.cliente_id,
    processo_id: p.id,
    responsavel_id: a.responsavel_id,
    lembrete_minutos: 60,
  };
}

const googleInput = (e: ReturnType<typeof eventoPayload>): CalendarEventInput => ({
  titulo: e.titulo,
  descricao: e.descricao,
  local: e.local,
  inicio: e.inicio,
  fim: e.fim,
  dia_inteiro: false,
  lembrete_minutos: e.lembrete_minutos,
});

/**
 * O evento da agenda é uma projeção da audiência, gravada com a sessão do usuário.
 * O RLS de agenda_eventos permite que quem edita o processo mantenha os eventos ligados
 * a ele (migração 20261014001000), inclusive audiências agendadas para colegas.
 */
async function withFallback<T>(supabase: Db, run: (db: Db) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>) {
  const first = await run(supabase);
  if (first.error) console.error("[audiencias.agenda]", first.error.code, first.error.message);
  return first.data ?? null;
}

async function syncGoogle(supabase: Db, eventId: string, responsavelId: string | null, input: CalendarEventInput, googleId: string | null) {
  if (!responsavelId) return;
  try {
    const gid = await upsertCalendarEvent(responsavelId, input, googleId);
    if (gid && gid !== googleId) {
      await withFallback(supabase, (db) => db.from("agenda_eventos").update({ google_event_id: gid }).eq("id", eventId).select("id").single());
    }
  } catch (err) {
    console.error("[audiencias.google.sync]", err instanceof Error ? err.message : err);
  }
}

async function removeGoogle(responsavelId: string | null, googleId: string | null) {
  if (!responsavelId || !googleId) return;
  try {
    await deleteCalendarEvent(responsavelId, googleId);
  } catch (err) {
    console.error("[audiencias.google.delete]", err instanceof Error ? err.message : err);
  }
}

/**
 * Cria/atualiza o evento da agenda vinculado e sincroniza com o Google Agenda do responsável.
 * Só reaproveita eventos do tipo "audiencia" do(s) mesmo(s) processo(s): `agenda_evento_id`
 * não é confiável sozinho (é uma coluna editável por quem edita o processo).
 */
async function syncAgenda(supabase: Db, a: AudienciaRow, createdBy: string, processoIds: string[] = [a.processo_id]) {
  const { data: proc } = await supabase.from("processos").select("id, titulo, numero_cnj, cliente_id").eq("id", a.processo_id).maybeSingle<ProcessoInfo>();
  if (!proc) return;
  const payload = eventoPayload(a, proc);

  let before: EventoRef | null = null;
  if (a.agenda_evento_id) {
    const evId = a.agenda_evento_id;
    before = await withFallback<EventoRef>(supabase, (db) =>
      db.from("agenda_eventos").select("id, responsavel_id, google_event_id").eq("id", evId).eq("tipo", "audiencia").in("processo_id", processoIds).single(),
    );
  }

  let ev: EventoRef | null;
  if (before) {
    const evId = before.id;
    ev = await withFallback<EventoRef>(supabase, (db) => db.from("agenda_eventos").update(payload).eq("id", evId).select("id, responsavel_id, google_event_id").single());
  } else {
    ev = await withFallback<EventoRef>(supabase, (db) =>
      db
        .from("agenda_eventos")
        .insert({ ...payload, created_by: createdBy })
        .select("id, responsavel_id, google_event_id")
        .single(),
    );
    if (ev) {
      const evId = ev.id;
      await supabase.from("audiencias").update({ agenda_evento_id: evId }).eq("id", a.id);
    }
  }
  if (!ev) return;

  // Google Agenda: cancelada sai da agenda; troca de responsável move o evento.
  if (a.status === "cancelada") {
    await removeGoogle(before?.responsavel_id ?? ev.responsavel_id, ev.google_event_id);
    if (ev.google_event_id) {
      const evId = ev.id;
      await withFallback(supabase, (db) => db.from("agenda_eventos").update({ google_event_id: null }).eq("id", evId).select("id").single());
    }
    return;
  }
  if (before?.google_event_id && before.responsavel_id !== ev.responsavel_id) {
    await removeGoogle(before.responsavel_id, before.google_event_id);
    await syncGoogle(supabase, ev.id, ev.responsavel_id, googleInput(payload), null);
  } else {
    await syncGoogle(supabase, ev.id, ev.responsavel_id, googleInput(payload), ev.google_event_id);
  }
}

async function removeAgenda(supabase: Db, agendaEventoId: string | null, processoId: string) {
  if (!agendaEventoId) return;
  const ev = await withFallback<EventoRef>(supabase, (db) =>
    db.from("agenda_eventos").select("id, responsavel_id, google_event_id").eq("id", agendaEventoId).eq("tipo", "audiencia").eq("processo_id", processoId).single(),
  );
  if (!ev) return;
  await withFallback(supabase, (db) => db.from("agenda_eventos").delete().eq("id", agendaEventoId).select("id").single());
  await removeGoogle(ev.responsavel_id, ev.google_event_id);
}

function revalidate(processoIds: (string | null | undefined)[]) {
  revalidatePath("/audiencias");
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  for (const p of new Set(processoIds.filter(Boolean))) revalidatePath(`/processos/${p}`);
}

// ------------------------------------------------------------------ Actions

export async function createAudiencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = audienciaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("audiencias")
    .insert({ ...v, responsavel_id: v.responsavel_id ?? g.session.userId, status: "agendada" })
    .select(COLS)
    .single<AudienciaRow>();
  if (error) {
    if (error.code === "42501") return { error: "Você não tem permissão para agendar audiências neste processo." };
    return dbError(error);
  }

  await syncAgenda(supabase, row, g.session.userId);
  revalidate([row.processo_id]);
  return { ok: true, message: "Audiência agendada e incluída na agenda.", id: row.id };
}

export async function updateAudiencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Audiência inválida." };
  const parsed = audienciaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { responsavel_id, ...rest } = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase.from("audiencias").select(COLS).eq("id", id).maybeSingle<AudienciaRow>();
  if (!before) return { error: "Audiência não encontrada ou sem acesso." };

  const update: Record<string, unknown> = { ...rest };
  if (responsavel_id) update.responsavel_id = responsavel_id;
  const { data: row, error } = await supabase.from("audiencias").update(update).eq("id", id).select(COLS).maybeSingle<AudienciaRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para editar esta audiência." };

  await syncAgenda(supabase, row, g.session.userId, [before.processo_id, row.processo_id]);
  revalidate([before.processo_id, row.processo_id]);
  return { ok: true, message: "Audiência atualizada.", id: row.id };
}

/** Redesignação: nova data/hora (e local/link), mantendo o histórico no processo. */
export async function redesignarAudiencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Audiência inválida." };
  const parsed = redesignarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { data: before } = await supabase.from("audiencias").select(COLS).eq("id", id).maybeSingle<AudienciaRow>();
  if (!before) return { error: "Audiência não encontrada ou sem acesso." };
  if (before.data_hora && Date.parse(before.data_hora) === Date.parse(parsed.data.data_hora) && before.status !== "cancelada") {
    return { error: "Informe a nova data/hora.", fieldErrors: { data_hora: "A data/hora é igual à atual" } };
  }

  const { data: row, error } = await supabase
    .from("audiencias")
    .update({ ...parsed.data, status: "redesignada" satisfies Status })
    .eq("id", id)
    .select(COLS)
    .maybeSingle<AudienciaRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar esta audiência." };

  await syncAgenda(supabase, row, g.session.userId);
  revalidate([row.processo_id]);
  return { ok: true, message: "Audiência redesignada — agenda atualizada.", id: row.id };
}

export async function setAudienciaStatus(id: string, status: string, resultado?: string | null): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Audiência inválida." };
  const parsed = z.enum(STATUS).safeParse(status);
  if (!parsed.success) return { error: "Status inválido." };
  const res = z.string().trim().max(5000).nullable().optional().safeParse(resultado);
  if (!res.success) return { error: "Resultado muito longo (máx. 5000 caracteres)." };

  const update: Record<string, unknown> = { status: parsed.data };
  if (res.data) update.resultado = res.data;

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("audiencias").update(update).eq("id", id).select(COLS).maybeSingle<AudienciaRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar esta audiência." };

  await syncAgenda(supabase, row, g.session.userId);
  revalidate([row.processo_id]);
  const message: Record<Status, string> = {
    agendada: "Audiência reaberta.",
    realizada: "Audiência registrada como realizada.",
    redesignada: "Audiência redesignada.",
    cancelada: "Audiência cancelada e removida da agenda.",
  };
  return { ok: true, message: message[row.status], id: row.id };
}

export async function deleteAudiencia(id: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Audiência inválida." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("audiencias").select(COLS).eq("id", id).maybeSingle<AudienciaRow>();
  if (!row) return { error: "Audiência não encontrada ou sem acesso." };
  const { error, count } = await supabase.from("audiencias").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Somente quem agendou a audiência ou a gestão pode excluí-la." };

  await removeAgenda(supabase, row.agenda_evento_id, row.processo_id);
  revalidate([row.processo_id]);
  return { ok: true, message: "Audiência excluída." };
}
