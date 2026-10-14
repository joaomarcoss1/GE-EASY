/**
 * Utilitários de período (mês / intervalo de datas) no fuso de Brasília.
 * Puros (sem "server-only") para poderem ser usados em servidor e cliente.
 */
import { todayISO } from "@/lib/format";

export const TZ = "America/Sao_Paulo";
/** Brasil não tem horário de verão desde 2019: Brasília = UTC-03:00 fixo. */
const SP_OFFSET = "-03:00";

export const isMonth = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function isISODate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const currentMonth = () => todayISO().slice(0, 7);

/** Mês válido do searchParam ou o mês atual. */
export const monthParam = (v: string | null | undefined) => (isMonth(v) ? v : currentMonth());

export function addMonths(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const firstDay = (mes: string) => `${mes}-01`;

export function lastDay(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Início do dia (00:00 em Brasília) como timestamptz ISO — para filtrar colunas timestamptz. */
export const spStartOf = (isoDate: string) => `${isoDate}T00:00:00${SP_OFFSET}`;

/** Data (YYYY-MM-DD) de um timestamptz no fuso de Brasília. */
export function spDateOf(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ts));
}

/** "outubro de 2026" */
export function monthLong(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "out/26" */
export function monthShort(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${name}/${String(y).slice(2)}`;
}

/** Lista de meses (YYYY-MM) do mais antigo para o atual. */
export function lastMonths(mes: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(mes, i - count + 1));
}

/** Variação percentual vs período anterior, no formato do StatCard. */
export function trendOf(current: number, previous: number): { value: string; positive: boolean } | undefined {
  if (!previous) return undefined;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(change * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return { value: `${sign}${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, positive: rounded >= 0 };
}

/** Intervalo de datas a partir de ?de=&ate= (padrão: mês atual). Garante de <= ate. */
export function rangeParam(de: string | null | undefined, ate: string | null | undefined): { de: string; ate: string } {
  const mes = currentMonth();
  let a = isISODate(de) ? de : firstDay(mes);
  let b = isISODate(ate) ? ate : lastDay(mes);
  if (a > b) [a, b] = [b, a];
  return { de: a, ate: b };
}

export const sum = <T>(rows: T[], pick: (r: T) => number | string | null | undefined) =>
  Math.round(rows.reduce((acc, r) => acc + Number(pick(r) ?? 0), 0) * 100) / 100;
