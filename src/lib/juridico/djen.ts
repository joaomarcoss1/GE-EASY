/**
 * Diário de Justiça Eletrônico Nacional (DJEN) — consulta pública de comunicações
 * processuais (intimações) da plataforma Comunica PJe: https://comunicaapi.pje.jus.br
 * Funções puras: parâmetros, leitura defensiva da resposta e data de publicação.
 */
import { isDiaUtil, toISO } from "./prazos";

export const DJEN_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO"];

export interface Oab {
  numero: string;
  uf: string;
}

/** Lê "SP 123456", "123.456/SP", "123456-SP", "OAB/SP 123456" → { numero: "123456", uf: "SP" }. */
export function parseOab(v: string | null | undefined): Oab | null {
  if (!v) return null;
  const s = v.toUpperCase();
  const uf = (s.match(/\b([A-Z]{2})\b/g) ?? []).find((t) => UFS.includes(t)) ?? UFS.find((u) => s.replace(/[^A-Z]/g, "").replace(/^OAB/, "").startsWith(u));
  const numero = s.replace(/\D/g, "").replace(/^0+/, "");
  if (!uf || !numero || numero.length > 8) return null;
  return { numero, uf };
}

export function djenParams(oab: Oab, inicio: string, fim: string, pagina = 1) {
  return new URLSearchParams({
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: inicio,
    dataDisponibilizacaoFim: fim,
    pagina: String(pagina),
    itensPorPagina: "100",
  });
}

/** Primeiro dia útil seguinte à disponibilização (Lei 11.419/2006, art. 4º, § 3º). */
export function dataPublicacaoDjen(disponibilizacao: string, extras: Set<string> = new Set()) {
  const d = new Date(`${disponibilizacao}T00:00:00Z`);
  for (let i = 0; i < 60; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = toISO(d);
    if (isDiaUtil(iso, extras)) return iso;
  }
  return toISO(d);
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Converte "dd/mm/aaaa" ou "aaaa-mm-dd[...]" em "aaaa-mm-dd". */
export function normalizarData(v: unknown): string | null {
  const s = str(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Remove HTML do texto da comunicação, preservando quebras de linha. */
export function textoPlano(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ComunicacaoDjen {
  id: string;
  hash: string;
  disponibilizacao: string; // aaaa-mm-dd
  tribunal: string | null;
  orgao: string | null;
  tipo: string | null;
  classe: string | null;
  numeroProcesso: string | null; // somente dígitos
  link: string | null;
  texto: string;
  destinatarios: string[];
}

/** Lê um item da resposta aceitando as variações de nome de campo já observadas na API. */
export function lerComunicacao(item: Raw): ComunicacaoDjen | null {
  const id = str(item.id ?? item.numeroComunicacao);
  const disponibilizacao = normalizarData(item.data_disponibilizacao ?? item.dataDisponibilizacao ?? item.datadisponibilizacao);
  const texto = textoPlano(str(item.texto ?? item.conteudo));
  if (!disponibilizacao || texto.length < 5) return null;
  const numero = str(item.numero_processo ?? item.numeroProcesso ?? item.numeroprocessocommascara).replace(/\D/g, "");
  const dest = Array.isArray(item.destinatarios) ? (item.destinatarios as Raw[]).map((d) => str(d.nome)).filter(Boolean) : [];
  const hash = str(item.hash) || `${id}:${disponibilizacao}`;
  return {
    id,
    hash,
    disponibilizacao,
    tribunal: str(item.siglaTribunal ?? item.sigla_tribunal) || null,
    orgao: str(item.nomeOrgao ?? item.nome_orgao) || null,
    tipo: str(item.tipoComunicacao ?? item.tipo_comunicacao) || null,
    classe: str(item.nomeClasse ?? item.nome_classe) || null,
    numeroProcesso: numero.length === 20 ? numero : null,
    link: /^https:\/\//.test(str(item.link)) ? str(item.link) : null,
    texto,
    destinatarios: dest.slice(0, 20),
  };
}

export function lerResposta(json: unknown): { itens: ComunicacaoDjen[]; total: number } {
  const obj = (json ?? {}) as Raw;
  const lista = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.itens) ? obj.itens : Array.isArray(json) ? (json as unknown[]) : [];
  const itens = (lista as Raw[]).map(lerComunicacao).filter((c): c is ComunicacaoDjen => !!c);
  return { itens, total: Number(obj.count ?? obj.total ?? itens.length) || itens.length };
}

/** Texto gravado na caixa de publicações. */
export function conteudoPublicacao(c: ComunicacaoDjen) {
  const cab = [c.tipo, c.orgao, c.classe].filter(Boolean).join(" · ");
  const dest = c.destinatarios.length ? `\nDestinatários: ${c.destinatarios.join(", ")}` : "";
  return `${cab ? `${cab}\n` : ""}${dest ? `${dest.trim()}\n` : ""}\n${c.texto}`.trim().slice(0, 50000);
}
