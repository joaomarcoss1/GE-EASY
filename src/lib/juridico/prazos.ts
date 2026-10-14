/**
 * Contagem de prazos processuais (CPC/2015):
 * - art. 224: exclui o dia do começo (publicação) e inclui o do vencimento;
 * - art. 219: em dias úteis (sábados, domingos e feriados não contam);
 * - art. 220: suspensão de 20/dez a 20/jan (recesso forense);
 * - se o vencimento cair em dia não útil, prorroga para o próximo dia útil.
 * Feriados nacionais fixos e móveis (Carnaval, Sexta-feira Santa, Corpus Christi).
 * Feriados estaduais/municipais podem ser informados em `extras` (YYYY-MM-DD).
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const toISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromISO = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) */
export function pascoa(ano: number) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

const cache = new Map<number, Set<string>>();
export function feriadosNacionais(ano: number): Set<string> {
  const hit = cache.get(ano);
  if (hit) return hit;
  const p = pascoa(ano);
  const set = new Set<string>([
    `${ano}-01-01`, `${ano}-04-21`, `${ano}-05-01`, `${ano}-09-07`, `${ano}-10-12`, `${ano}-11-02`, `${ano}-11-15`, `${ano}-11-20`, `${ano}-12-25`,
    toISO(addDays(p, -48)), // segunda de Carnaval
    toISO(addDays(p, -47)), // terça de Carnaval
    toISO(addDays(p, -2)), // Sexta-feira Santa
    toISO(addDays(p, 60)), // Corpus Christi
  ]);
  cache.set(ano, set);
  return set;
}

export function isRecesso(iso: string) {
  const md = iso.slice(5);
  return md >= "12-20" || md <= "01-20";
}

export function isDiaUtil(iso: string, extras: Set<string> = new Set()) {
  const d = fromISO(iso);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (feriadosNacionais(d.getUTCFullYear()).has(iso) || extras.has(iso)) return false;
  return true;
}

export interface CalculoPrazo {
  dataFim: string;
  diasCorridos: number;
  pulados: { data: string; motivo: string }[];
}

/**
 * Calcula o vencimento a partir da data de publicação/intimação.
 * @param inicio data da publicação (o prazo começa no 1º dia útil seguinte)
 * @param dias quantidade de dias do prazo
 */
export function calcularPrazo(inicio: string, dias: number, contagem: "uteis" | "corridos" = "uteis", extras: string[] = []): CalculoPrazo {
  const ex = new Set(extras);
  const pulados: CalculoPrazo["pulados"] = [];
  const motivo = (iso: string) => {
    const dow = fromISO(iso).getUTCDay();
    if (isRecesso(iso)) return "Recesso forense (CPC art. 220)";
    if (dow === 0 || dow === 6) return dow === 0 ? "Domingo" : "Sábado";
    return "Feriado";
  };
  const util = (iso: string) => !isRecesso(iso) && isDiaUtil(iso, ex);

  let cur = fromISO(inicio);
  let count = 0;
  while (count < dias) {
    cur = addDays(cur, 1);
    const iso = toISO(cur);
    if (contagem === "uteis") {
      if (util(iso)) count++;
      else pulados.push({ data: iso, motivo: motivo(iso) });
    } else {
      if (isRecesso(iso)) pulados.push({ data: iso, motivo: motivo(iso) });
      else count++;
    }
  }
  // vencimento em dia não útil prorroga (CPC art. 224 §1º)
  while (!util(toISO(cur))) {
    pulados.push({ data: toISO(cur), motivo: motivo(toISO(cur)) });
    cur = addDays(cur, 1);
  }
  const dataFim = toISO(cur);
  return { dataFim, diasCorridos: Math.round((cur.getTime() - fromISO(inicio).getTime()) / 86400000), pulados };
}
