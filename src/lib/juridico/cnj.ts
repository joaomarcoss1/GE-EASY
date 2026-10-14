/**
 * Numeração única do CNJ (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO
 * Dígito verificador: módulo 97 (ISO 7064) sobre NNNNNNN AAAA J TR OOOO 00.
 */
const onlyDigits = (v: string) => v.replace(/\D/g, "");

function mod97(numStr: string) {
  let rest = 0;
  for (let i = 0; i < numStr.length; i += 7) rest = Number(String(rest) + numStr.slice(i, i + 7)) % 97;
  return rest;
}

export function cnjDigits(value: string) {
  return onlyDigits(value);
}

export function formatCNJ(value: string | null | undefined) {
  const d = onlyDigits(value ?? "");
  if (d.length !== 20) return value ?? "";
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

export function isValidCNJ(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 20) return false;
  const n = d.slice(0, 7), dv = d.slice(7, 9), ano = d.slice(9, 13), j = d.slice(13, 14), tr = d.slice(14, 16), o = d.slice(16, 20);
  const calc = 98 - mod97(`${n}${ano}${j}${tr}${o}00`);
  return calc === Number(dv);
}

/** Calcula o dígito verificador (útil para testes e para completar números digitados sem DV). */
export function cnjCheckDigits(n: string, ano: string, j: string, tr: string, o: string) {
  return String(98 - mod97(`${n.padStart(7, "0")}${ano}${j}${tr.padStart(2, "0")}${o.padStart(4, "0")}00`)).padStart(2, "0");
}

const SEGMENTOS: Record<string, string> = {
  "1": "STF", "2": "CNJ", "3": "STJ", "4": "Justiça Federal", "5": "Justiça do Trabalho", "6": "Justiça Eleitoral",
  "7": "Justiça Militar da União", "8": "Justiça Estadual", "9": "Justiça Militar Estadual",
};

const UF_TJ: Record<string, string> = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA", "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
  "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB", "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
  "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE", "26": "SP", "27": "TO",
};

/** Extrai segmento de justiça, tribunal e ano a partir do número CNJ. */
export function parseCNJ(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 20) return null;
  const j = d.slice(13, 14), tr = d.slice(14, 16);
  let tribunal = "";
  if (j === "8") tribunal = UF_TJ[tr] ? `TJ${UF_TJ[tr]}` : "";
  else if (j === "5") tribunal = `TRT${Number(tr)}`;
  else if (j === "4") tribunal = `TRF${Number(tr)}`;
  else if (j === "6") tribunal = UF_TJ[tr] ? `TRE-${UF_TJ[tr]}` : "";
  return { segmento: SEGMENTOS[j] ?? "", tribunal, uf: j === "8" || j === "6" ? (UF_TJ[tr] ?? null) : null, ano: Number(d.slice(9, 13)), origem: d.slice(16, 20) };
}
