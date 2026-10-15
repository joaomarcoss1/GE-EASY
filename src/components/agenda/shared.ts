import type { FieldDef, Values } from "@/components/ui/form";
import { EVENTO_TIPOS, type Option } from "@/lib/constants";
import type { AgendaEvento } from "@/lib/types";
import type { GoogleEventItem } from "@/lib/google";
import { addDays, toLocal } from "./date-utils";

/** Evento serializável exibido no calendário (interno ou do Google Agenda). */
export interface CalEvent {
  id: string;
  /** "prazo": prazo processual pendente (somente leitura, dia inteiro) */
  source: "app" | "google" | "prazo";
  titulo: string;
  tipo: string;
  status: "agendado" | "concluido" | "cancelado";
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  startMin: number;
  endMin: number;
  local: string | null;
  link_reuniao: string | null;
  descricao: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  oportunidade_id: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  lembrete_minutos: number | null;
  google_event_id: string | null;
  htmlLink: string | null;
  canEdit: boolean;
  /** Link interno relacionado (ex.: /processos/<id>) */
  href?: string | null;
  /** Linha extra de contexto (ex.: processo do prazo/audiência) */
  subtitle?: string | null;
  /** Prazo fatal (exibido em vermelho) */
  fatal?: boolean;
}

function localParts(inicio: string, fim: string, diaInteiro: boolean) {
  const s = toLocal(inicio);
  const e = toLocal(fim);
  return {
    startDate: s.date,
    endDate: e.date < s.date ? s.date : e.date,
    startTime: diaInteiro ? "00:00" : s.time,
    endTime: diaInteiro ? "23:59" : e.time,
    startMin: diaInteiro ? 0 : s.minutes,
    endMin: diaInteiro ? 24 * 60 : e.minutes,
  };
}

export function fromAgendaEvento(
  e: AgendaEvento,
  ctx: { clienteNome: string | null; responsavelNome: string | null; canEdit: boolean },
): CalEvent {
  return {
    id: e.id,
    source: "app",
    titulo: e.titulo,
    tipo: e.tipo,
    status: e.status,
    inicio: e.inicio,
    fim: e.fim,
    dia_inteiro: e.dia_inteiro,
    ...localParts(e.inicio, e.fim, e.dia_inteiro),
    local: e.local,
    link_reuniao: e.link_reuniao,
    descricao: e.descricao,
    cliente_id: e.cliente_id,
    cliente_nome: ctx.clienteNome,
    oportunidade_id: e.oportunidade_id,
    responsavel_id: e.responsavel_id,
    responsavel_nome: ctx.responsavelNome,
    lembrete_minutos: e.lembrete_minutos,
    google_event_id: e.google_event_id,
    htmlLink: null,
    canEdit: ctx.canEdit,
  };
}

export function fromGoogleEvent(g: GoogleEventItem): CalEvent | null {
  let inicio: string;
  let fim: string;
  let allDay = false;
  if (g.start.date) {
    allDay = true;
    inicio = `${g.start.date}T00:00:00-03:00`;
    // No Google, a data final de eventos de dia inteiro é exclusiva
    const endExclusive = g.end?.date ?? addDays(g.start.date, 1);
    fim = `${addDays(endExclusive, -1)}T23:59:59-03:00`;
  } else if (g.start.dateTime) {
    inicio = g.start.dateTime;
    fim = g.end?.dateTime ?? g.start.dateTime;
  } else return null;
  if (Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) return null;
  return {
    id: `google:${g.id}`,
    source: "google",
    titulo: g.summary?.trim() || "(sem título)",
    tipo: "outro",
    status: "agendado",
    inicio,
    fim,
    dia_inteiro: allDay,
    ...localParts(inicio, fim, allDay),
    local: g.location ?? null,
    link_reuniao: null,
    descricao: null,
    cliente_id: null,
    cliente_nome: null,
    oportunidade_id: null,
    responsavel_id: null,
    responsavel_nome: null,
    lembrete_minutos: null,
    google_event_id: g.id,
    htmlLink: g.htmlLink && /^https:\/\//.test(g.htmlLink) ? g.htmlLink : null,
    canEdit: false,
  };
}

export const LEMBRETES: Option[] = [
  { value: "0", label: "Na hora do evento" },
  { value: "5", label: "5 minutos antes" },
  { value: "10", label: "10 minutos antes" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

export const lembreteLabel = (v: number | null) =>
  v === null ? "Sem lembrete" : LEMBRETES.find((o) => o.value === String(v))?.label ?? `${v} minutos antes`;

export function eventoFields(clientes: Option[], users: Option[], manager: boolean): FieldDef[] {
  return [
    { name: "titulo", label: "Título", required: true, placeholder: "Ex.: Apresentação de consórcio imobiliário", span: 6 },
    { name: "tipo", label: "Tipo", type: "select", options: EVENTO_TIPOS, emptyOption: false, span: 3 },
    { name: "lembrete_minutos", label: "Lembrete", type: "select", options: LEMBRETES, emptyOption: "Sem lembrete", span: 3 },
    { name: "inicio", label: "Início", type: "datetime-local", required: true, span: 3, section: "Quando" },
    { name: "fim", label: "Término", type: "datetime-local", span: 3, help: "Em branco: 1 hora após o início" },
    { name: "dia_inteiro", label: "Dia inteiro", type: "checkbox", help: "Considera apenas as datas, sem horário", span: 6 },
    { name: "local", label: "Local", placeholder: "Endereço, sala ou cidade", span: 3, section: "Onde" },
    { name: "link_reuniao", label: "Link da reunião", type: "url", placeholder: "https://meet.google.com/…", span: 3 },
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, emptyOption: "Sem cliente vinculado", span: manager ? 3 : 6, section: "Vínculos" },
    ...(manager ? [{ name: "responsavel_id", label: "Responsável", type: "select", options: users, emptyOption: "Eu mesmo", span: 3 } as FieldDef] : []),
    { name: "descricao", label: "Descrição", type: "textarea", rows: 4, placeholder: "Pauta, observações, documentos a levar…", span: 6 },
  ];
}

export function eventoValues(e: CalEvent): Values {
  return {
    titulo: e.titulo,
    tipo: e.tipo,
    inicio: `${e.startDate}T${e.dia_inteiro ? "09:00" : e.startTime}`,
    fim: `${e.endDate}T${e.dia_inteiro ? "10:00" : e.endTime}`,
    dia_inteiro: e.dia_inteiro,
    local: e.local,
    link_reuniao: e.link_reuniao,
    cliente_id: e.cliente_id,
    responsavel_id: e.responsavel_id,
    lembrete_minutos: e.lembrete_minutos === null ? "" : String(e.lembrete_minutos),
    descricao: e.descricao,
  };
}

/** Prazo processual pendente exibido na agenda (dia inteiro, somente leitura). */
export function fromPrazo(p: {
  id: string;
  descricao: string;
  data_fim: string;
  fatal: boolean;
  processo_id: string | null;
  processo_titulo: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
}): CalEvent {
  const inicio = `${p.data_fim}T00:00:00-03:00`;
  const fim = `${p.data_fim}T23:59:59-03:00`;
  return {
    id: `prazo:${p.id}`,
    source: "prazo",
    titulo: `${p.fatal ? "Prazo fatal" : "Prazo"}: ${p.descricao}`,
    tipo: "prazo",
    status: "agendado",
    inicio,
    fim,
    dia_inteiro: true,
    ...localParts(inicio, fim, true),
    local: null,
    link_reuniao: null,
    descricao: null,
    cliente_id: null,
    cliente_nome: null,
    oportunidade_id: null,
    responsavel_id: p.responsavel_id,
    responsavel_nome: p.responsavel_nome,
    lembrete_minutos: null,
    google_event_id: null,
    htmlLink: null,
    canEdit: false,
    href: p.processo_id ? `/processos/${p.processo_id}?tab=prazos` : "/prazos",
    subtitle: p.processo_titulo ?? (p.processo_id ? null : "Prazo administrativo"),
    fatal: p.fatal,
  };
}
