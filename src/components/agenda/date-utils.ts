/**
 * Utilitários de data da agenda — puros (sem dependência de runtime) para uso
 * no servidor, no cliente e nas Server Actions.
 *
 * O fuso de trabalho é America/Sao_Paulo, que hoje não tem horário de verão
 * (UTC−03:00 fixo). Todas as contas usam datas "YYYY-MM-DD" ancoradas em UTC
 * para não depender do fuso da máquina que executa o código.
 */

export const SP_OFFSET = "-03:00";
const OFFSET_MS = 3 * 3_600_000;

export const isYmd = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(ymd: string, n: number) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado */
export const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
export const startOfWeek = (ymd: string) => addDays(ymd, -weekday(ymd));
export const startOfMonth = (ymd: string) => `${ymd.slice(0, 8)}01`;
export const endOfMonth = (ymd: string) => addDays(addMonths(ymd, 1), -1);

/** Lista inclusiva de dias entre `from` e `to` */
export function dayRange(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Converte um instante (ms) para ISO com offset de Brasília: 2026-10-14T09:00:00-03:00 */
export function spIsoFromMs(ms: number) {
  return `${new Date(ms - OFFSET_MS).toISOString().slice(0, 19)}${SP_OFFSET}`;
}

/** Normaliza qualquer ISO (ex.: vindo do banco em UTC) para o offset de Brasília */
export const toSpIso = (iso: string) => spIsoFromMs(Date.parse(iso));

/** Partes locais (Brasília) de um instante ISO */
export function toLocal(iso: string) {
  const s = new Date(Date.parse(iso) - OFFSET_MS).toISOString();
  const h = Number(s.slice(11, 13));
  const m = Number(s.slice(14, 16));
  return { date: s.slice(0, 10), time: s.slice(11, 16), minutes: h * 60 + m };
}

export const spStartOfDay = (ymd: string) => `${ymd}T00:00:00${SP_OFFSET}`;

const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", ...opts });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Quarta-feira, 14 de outubro" */
export const dayLong = (ymd: string) => cap(fmt(ymd, { weekday: "long", day: "numeric", month: "long" }));
/** "qua., 14 de out." */
export const dayShort = (ymd: string) => fmt(ymd, { weekday: "short", day: "numeric", month: "short" });
/** "Outubro de 2026" */
export const monthTitle = (ymd: string) => cap(fmt(ymd, { month: "long", year: "numeric" }));
/** "12 – 18 de out. de 2026" */
export function weekTitle(start: string) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const a = sameMonth ? String(Number(start.slice(8))) : fmt(start, { day: "numeric", month: "short" });
  return `${a} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Rótulo relativo do dia ("Hoje", "Amanhã", "Ontem") ou null */
export function relativeDay(ymd: string, today: string) {
  if (ymd === today) return "Hoje";
  if (ymd === addDays(today, 1)) return "Amanhã";
  if (ymd === addDays(today, -1)) return "Ontem";
  return null;
}

export function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
