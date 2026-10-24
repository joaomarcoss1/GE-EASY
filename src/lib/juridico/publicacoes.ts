/**
 * Utilitários para a caixa de publicações (Diário de Justiça Eletrônico).
 * Funções puras — usadas no servidor (importação) e no navegador (pré-visualização).
 */
import { formatCNJ } from "./cnj";

const CNJ_REGEX = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;

interface BlocoPublicacao {
  numero: string | null;
  conteudo: string;
}

const normaliza = (t: string) => t.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Divide o texto colado em publicações individuais.
 * - Blocos separados por linha em branco; blocos sem número CNJ são anexados ao anterior.
 * - Se nenhum número CNJ for encontrado, o texto inteiro vira uma publicação.
 */
export function dividirPublicacoes(texto: string): BlocoPublicacao[] {
  const limpo = normaliza(texto);
  if (!limpo) return [];
  const blocos = limpo.split(/\n\s*\n/);
  const out: BlocoPublicacao[] = [];
  for (const b of blocos) {
    const m = b.match(CNJ_REGEX);
    if (m && m.length) {
      out.push({ numero: formatCNJ(m[0]), conteudo: b.trim() });
    } else if (out.length) {
      out[out.length - 1].conteudo += `\n\n${b.trim()}`;
    } else {
      out.push({ numero: null, conteudo: b.trim() });
    }
  }
  return out.filter((b) => b.conteudo.length >= 5).slice(0, 300);
}

const EXTENSO: Record<string, number> = {
  um: 1, dois: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  quinze: 15, vinte: 20, trinta: 30, quarenta: 40, sessenta: 60, noventa: 90,
};

/** Sugere o prazo em dias a partir do texto ("em 15 (quinze) dias", "no prazo de cinco dias"). */
export function sugerirDias(texto: string): number | null {
  const num = texto.match(/(?:prazo\s+(?:legal\s+)?de\s+|em\s+|no\s+prazo\s+de\s+)?(\d{1,3})\s*(?:\([^)]{2,30}\))?\s*dias/i);
  if (num) {
    const n = Number(num[1]);
    if (n > 0 && n <= 365) return n;
  }
  const ext = texto.toLowerCase().match(/prazo\s+de\s+([a-zçãêéíóú]+)\s+dias/);
  if (ext && EXTENSO[ext[1]]) return EXTENSO[ext[1]];
  return null;
}

/** Palavras que merecem destaque visual na leitura da publicação. */
export const PALAVRAS_CHAVE = ["intimação", "intime-se", "intimem-se", "prazo", "dias", "audiência", "sentença", "despacho", "decisão", "citação", "manifeste-se", "recurso", "julgo", "acórdão", "penhora", "bloqueio"];
