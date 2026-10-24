/**
 * Utilitários puros de prazos (servidor, cliente e Server Actions).
 * Datas sempre "YYYY-MM-DD" ancoradas em UTC (sem depender do fuso da máquina).
 */
import type { Tone } from "@/lib/constants";
import { isDiaUtil, isRecesso, pascoa, toISO, type CalculoPrazo } from "@/lib/juridico/prazos";

export interface PrazoItem {
  id: string;
  processo_id: string | null;
  processo_titulo: string | null;
  processo_cnj: string | null;
  descricao: string;
  data_publicacao: string | null;
  dias: number | null;
  contagem: "uteis" | "corridos";
  data_fim: string;
  fatal: boolean;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "pendente" | "cumprido" | "perdido" | "cancelado";
  responsavel_id: string | null;
  responsavel_nome: string | null;
  responsavel_avatar: string | null;
  departamento_id: string | null;
  departamento_nome: string | null;
  departamento_cor: Tone | null;
  cumprido_em: string | null;
  observacoes: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const diffDays = (a: string, b: string) => Math.round((ms(a) - ms(b)) / 86_400_000);
export const addDaysYmd = (d: string, n: number) => new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);

export function isValidYmd(v: string | null | undefined): v is string {
  if (!v || !ymd.test(v)) return false;
  const t = ms(v);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * Lê feriados locais digitados livremente: "dd/mm/aaaa" ou "aaaa-mm-dd",
 * separados por vírgula, ponto e vírgula, espaço ou quebra de linha.
 */
export function parseFeriados(text: string | null | undefined): { datas: string[]; invalidos: string[] } {
  const datas = new Set<string>();
  const invalidos: string[] = [];
  for (const raw of (text ?? "").split(/[\s,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    let iso: string | null = null;
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (br) iso = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    else if (ymd.test(t)) iso = t;
    if (iso && isValidYmd(iso)) datas.add(iso);
    else invalidos.push(t);
  }
  return { datas: [...datas].sort().slice(0, 60), invalidos };
}

/** "aaaa-mm-dd" → "dd/mm/aaaa" */
export const brDate = (iso: string | null | undefined) => (iso && ymd.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

/** "qua., 04/11/2026" */
export const brDateWeekday = (iso: string) =>
  `${new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short" })} ${brDate(iso)}`;

const FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Dia da Consciência Negra",
  "12-25": "Natal",
};

/** Nome do feriado nacional (fixo ou móvel) na data, se houver. */
function nomeFeriado(iso: string): string | null {
  const fixo = FIXOS[iso.slice(5)];
  if (fixo) return fixo;
  const p = toISO(pascoa(Number(iso.slice(0, 4))));
  const d = diffDays(iso, p);
  if (d === -48 || d === -47) return "Carnaval";
  if (d === -2) return "Sexta-feira Santa";
  if (d === 60) return "Corpus Christi";
  return null;
}

/** Motivo detalhado de um dia não contado. */
function motivoDetalhado(p: { data: string; motivo: string }, extras: string[]) {
  if (p.motivo !== "Feriado") return p.motivo;
  if (extras.includes(p.data)) return "Feriado local (informado)";
  const n = nomeFeriado(p.data);
  return n ? `Feriado nacional — ${n}` : "Feriado";
}

/** Agrupa dias consecutivos com o mesmo motivo (ex.: recesso forense inteiro numa linha). */
export function agruparPulados(pulados: CalculoPrazo["pulados"], extras: string[]) {
  const out: { de: string; ate: string; motivo: string; dias: number }[] = [];
  const sorted = [...pulados].sort((a, b) => a.data.localeCompare(b.data));
  for (const p of sorted) {
    const motivo = motivoDetalhado(p, extras);
    const last = out[out.length - 1];
    if (last && last.motivo === motivo && diffDays(p.data, last.ate) === 1) {
      last.ate = p.data;
      last.dias++;
    } else if (!last || last.ate !== p.data) {
      out.push({ de: p.data, ate: p.data, motivo, dias: 1 });
    }
  }
  return out;
}

const diaUtilForense = (iso: string) => !isRecesso(iso) && isDiaUtil(iso);

/** Dias úteis forenses entre hoje (exclusive) e a data (inclusive). */
function diasUteisAte(today: string, dataFim: string) {
  let n = 0;
  for (let d = addDaysYmd(today, 1), guard = 0; d <= dataFim && guard < 800; d = addDaysYmd(d, 1), guard++) if (diaUtilForense(d)) n++;
  return n;
}

export type PrazoSituacao = "vencido" | "hoje" | "amanha" | "semana" | "proximo";

export function situacaoPrazo(dataFim: string, today: string): PrazoSituacao {
  const d = diffDays(dataFim, today);
  if (d < 0) return "vencido";
  if (d === 0) return "hoje";
  if (d === 1) return "amanha";
  if (d <= 7) return "semana";
  return "proximo";
}

/** Rótulo "vence em X dias úteis (Y dias)" / "venceu há X dias" / "vence hoje". */
export function restanteLabel(p: Pick<PrazoItem, "data_fim" | "contagem" | "status" | "cumprido_em">, today: string): { text: string; tone: Tone } {
  if (p.status === "cumprido") return { text: p.cumprido_em ? `Cumprido em ${brDate(p.cumprido_em.slice(0, 10))}` : "Cumprido", tone: "green" };
  if (p.status === "cancelado") return { text: "Cancelado", tone: "slate" };
  if (p.status === "perdido") return { text: "Prazo perdido", tone: "red" };
  const d = diffDays(p.data_fim, today);
  if (d < 0) return { text: `Venceu há ${-d} dia${d === -1 ? "" : "s"}`, tone: "red" };
  if (d === 0) return { text: "Vence hoje", tone: "amber" };
  if (p.contagem === "uteis") {
    const u = diasUteisAte(today, p.data_fim);
    const corridos = d === 1 ? "amanhã" : `${d} dias`;
    return { text: `Vence em ${u} dia${u === 1 ? "" : "s"} út${u === 1 ? "il" : "eis"} (${corridos})`, tone: d <= 3 ? "amber" : "slate" };
  }
  return { text: d === 1 ? "Vence amanhã" : `Vence em ${d} dias`, tone: d <= 3 ? "amber" : "slate" };
}
