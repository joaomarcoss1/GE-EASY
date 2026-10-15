/**
 * API Pública do DataJud (CNJ) — https://datajud-wiki.cnj.jus.br/api-publica/
 * Funções puras: identificação do índice do tribunal pelo número CNJ e
 * normalização da resposta (Elasticsearch) em dados do processo + movimentos.
 */
import { cnjDigits, isValidCNJ } from "./cnj";

export const DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br";
/** Chave pública divulgada pelo CNJ (pode ser trocada pelo CNJ; sobrescreva com DATAJUD_API_KEY). */
export const DATAJUD_CHAVE_PUBLICA = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const UF_TJ: Record<string, string> = {
  "01": "ac", "02": "al", "03": "ap", "04": "am", "05": "ba", "06": "ce", "07": "dft", "08": "es", "09": "go", "10": "ma",
  "11": "mt", "12": "ms", "13": "mg", "14": "pa", "15": "pb", "16": "pr", "17": "pe", "18": "pi", "19": "rj", "20": "rn",
  "21": "rs", "22": "ro", "23": "rr", "24": "sc", "25": "se", "26": "sp", "27": "to",
};
const TJM: Record<string, string> = { "13": "tjmmg", "21": "tjmrs", "26": "tjmsp" };

/** Alias do índice do tribunal (ex.: "tjsp", "trt2", "trf1", "tre-sp", "stj") ou null se não houver na API pública. */
export function datajudAlias(cnj: string): string | null {
  const d = cnjDigits(cnj);
  if (d.length !== 20) return null;
  const j = d.slice(13, 14);
  const tr = d.slice(14, 16);
  const n = Number(tr);
  switch (j) {
    case "3":
      return "stj";
    case "4":
      return n >= 1 && n <= 6 ? `trf${n}` : null;
    case "5":
      if (tr === "00") return "tst";
      return n >= 1 && n <= 24 ? `trt${n}` : null;
    case "6":
      if (tr === "00") return "tse";
      return UF_TJ[tr] ? `tre-${UF_TJ[tr] === "dft" ? "df" : UF_TJ[tr]}` : null;
    case "7":
      return "stm";
    case "8":
      return UF_TJ[tr] ? `tj${UF_TJ[tr]}` : null;
    case "9":
      return TJM[tr] ?? null;
    default:
      return null;
  }
}

export function datajudUrl(cnj: string) {
  const alias = datajudAlias(cnj);
  return alias ? `${DATAJUD_BASE}/api_publica_${alias}/_search` : null;
}

export function datajudBody(cnj: string) {
  return { query: { match: { numeroProcesso: cnjDigits(cnj) } }, size: 10 };
}

// ------------------------------------------------------------------ tipos da resposta (parciais)

interface DjNome {
  codigo?: number | string;
  nome?: string;
}
interface DjComplemento {
  codigo?: number;
  valor?: number | string;
  nome?: string;
  descricao?: string;
}
interface DjMovimento {
  codigo?: number | string;
  nome?: string;
  dataHora?: string;
  complementosTabelados?: DjComplemento[];
  orgaoJulgador?: DjNome;
}
export interface DjSource {
  numeroProcesso?: string;
  tribunal?: string;
  grau?: string;
  classe?: DjNome;
  assuntos?: (DjNome | DjNome[])[];
  orgaoJulgador?: DjNome & { codigoMunicipioIBGE?: number };
  dataAjuizamento?: string;
  dataHoraUltimaAtualizacao?: string;
  nivelSigilo?: number;
  sistema?: DjNome;
  formato?: DjNome;
  movimentos?: DjMovimento[];
}
export interface DjResposta {
  hits?: { total?: { value?: number }; hits?: { _source?: DjSource }[] };
}

export interface MovimentoNormalizado {
  externoId: string;
  dataHora: string; // ISO (UTC)
  data: string; // yyyy-mm-dd (Brasília)
  tipo: AndamentoTipo;
  descricao: string;
  grau: string | null;
}

export interface ProcessoDatajud {
  numero: string;
  tribunal: string | null;
  graus: string[];
  classe: string | null;
  assuntos: string[];
  orgao: string | null;
  dataAjuizamento: string | null; // yyyy-mm-dd
  atualizadoEm: string | null; // ISO
  sigilo: number;
  sistema: string | null;
  movimentos: MovimentoNormalizado[];
}

export type AndamentoTipo = "publicacao" | "despacho" | "decisao" | "sentenca" | "acordao" | "peticao" | "audiencia" | "juntada" | "citacao" | "intimacao" | "outro";

// ------------------------------------------------------------------ normalização

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Datas do DataJud aparecem como "2023-05-10T14:32:00.000Z", "2023-05-10T14:32:00" (sem fuso,
 * horário local) ou "20230510143200". Sem fuso => considera horário de Brasília (-03:00).
 */
export function parseDataDatajud(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  let iso: string;
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(s);
  if (compact) {
    const [, y, m, d, hh = "00", mi = "00", ss = "00"] = compact;
    iso = `${y}-${m}-${d}T${hh}:${mi}:${ss}-03:00`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    iso = `${s}T00:00:00-03:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    iso = `${s}-03:00`;
  } else {
    iso = s;
  }
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Data (yyyy-mm-dd) no fuso de Brasília. */
export function dataBrasilia(d: Date) {
  const sp = new Date(d.getTime() - 3 * 3600_000);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}`;
}

const REGRAS_TIPO: [RegExp, AndamentoTipo][] = [
  [/ac[oó]rd[aã]o/i, "acordao"],
  [/senten[cç]a|julgad[oa]s? (procedente|improcedente)|proced[eê]ncia|improced[eê]ncia|extin[cç][aã]o|homologa/i, "sentenca"],
  [/audi[eê]ncia/i, "audiencia"],
  [/cita[cç][aã]o/i, "citacao"],
  [/intima[cç][aã]o|expedi[cç][aã]o de (documento|intima)/i, "intimacao"],
  [/publica[cç][aã]o|disponibiliza[cç][aã]o no di[aá]rio/i, "publicacao"],
  [/despacho|mero expediente/i, "despacho"],
  [/decis[aã]o|liminar|tutela|concess[aã]o|deferid|indeferid|antecipa[cç][aã]o/i, "decisao"],
  [/peti[cç][aã]o/i, "peticao"],
  [/juntada/i, "juntada"],
];

export function tipoDoMovimento(nome: string): AndamentoTipo {
  for (const [re, tipo] of REGRAS_TIPO) if (re.test(nome)) return tipo;
  return "outro";
}

/** Hash curto e estável (FNV-1a 32 bits) para compor o id externo do movimento. */
export function hashCurto(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const humanize = (s: string) => s.replace(/_/g, " ").replace(/\s+/g, " ").trim();

function descricaoMovimento(m: DjMovimento) {
  const partes = [String(m.nome ?? "Movimentação").trim()];
  for (const c of m.complementosTabelados ?? []) {
    const rotulo = c.descricao ? humanize(c.descricao) : null;
    const valor = c.nome ?? (c.valor !== undefined ? String(c.valor) : null);
    if (valor) partes.push(rotulo ? `${rotulo}: ${valor}` : valor);
  }
  const txt = partes.join(" — ");
  const orgao = m.orgaoJulgador?.nome ? ` (${m.orgaoJulgador.nome})` : "";
  return `${txt}${orgao}`.slice(0, 2000);
}

/** Junta os registros (um por grau/sistema) em um único processo com movimentos sem duplicidade. */
export function normalizarDatajud(resp: DjResposta): ProcessoDatajud | null {
  const fontes = (resp.hits?.hits ?? []).map((h) => h._source).filter((s): s is DjSource => !!s);
  if (!fontes.length) return null;
  // registro mais recente primeiro (dados cadastrais vêm dele)
  fontes.sort((a, b) => (parseDataDatajud(b.dataHoraUltimaAtualizacao)?.getTime() ?? 0) - (parseDataDatajud(a.dataHoraUltimaAtualizacao)?.getTime() ?? 0));
  const principal = fontes.find((f) => f.grau === "G1") ?? fontes[0];
  const assuntos = new Set<string>();
  for (const f of fontes)
    for (const a of f.assuntos ?? []) for (const item of Array.isArray(a) ? a : [a]) if (item?.nome) assuntos.add(item.nome.trim());

  const movs = new Map<string, MovimentoNormalizado>();
  for (const f of fontes) {
    for (const m of f.movimentos ?? []) {
      const dt = parseDataDatajud(m.dataHora);
      if (!dt) continue;
      const descricao = descricaoMovimento(m);
      if (descricao.length < 2) continue;
      const externoId = `dj:${f.grau ?? "?"}:${m.codigo ?? "x"}:${dt.toISOString()}:${hashCurto(descricao)}`.slice(0, 200);
      if (!movs.has(externoId))
        movs.set(externoId, { externoId, dataHora: dt.toISOString(), data: dataBrasilia(dt), tipo: tipoDoMovimento(String(m.nome ?? "")), descricao, grau: f.grau ?? null });
    }
  }
  const ajuiz = parseDataDatajud(principal.dataAjuizamento);
  const atualizado = fontes.map((f) => parseDataDatajud(f.dataHoraUltimaAtualizacao)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    numero: cnjDigits(principal.numeroProcesso ?? ""),
    tribunal: principal.tribunal ?? null,
    graus: [...new Set(fontes.map((f) => f.grau).filter((g): g is string => !!g))],
    classe: principal.classe?.nome ?? null,
    assuntos: [...assuntos],
    orgao: principal.orgaoJulgador?.nome ?? null,
    dataAjuizamento: ajuiz ? dataBrasilia(ajuiz) : null,
    atualizadoEm: atualizado ? atualizado.toISOString() : null,
    sigilo: Math.max(0, ...fontes.map((f) => Number(f.nivelSigilo ?? 0))),
    sistema: principal.sistema?.nome ?? null,
    movimentos: [...movs.values()].sort((a, b) => a.dataHora.localeCompare(b.dataHora)),
  };
}

export const GRAU_LABEL: Record<string, string> = {
  G1: "1º grau", G2: "2º grau", JE: "Juizado Especial", TR: "Turma Recursal", SUP: "Tribunal Superior", TRU: "Turma Regional", TNU: "Turma Nacional",
};

export function podeConsultarDatajud(cnj: string | null | undefined) {
  return !!cnj && isValidCNJ(cnj) && datajudAlias(cnj) !== null;
}
