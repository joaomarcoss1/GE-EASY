import { isValidCPF } from "@/lib/validators";

/** Extrai do texto lido por OCR (RG, CNH, CPF) os campos do pré-cadastro. Puro e testável. */
interface DadosOcr {
  cpf: string | null;
  nome: string | null;
  data_nascimento: string | null; // AAAA-MM-DD
  rg: string | null;
}

const RE_CPF = /\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})\b/g;
const RE_DATA = /\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/g;

export function extrairDados(texto: string): DadosOcr {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plano = linhas.join("\n");

  let cpf: string | null = null;
  for (const m of plano.matchAll(RE_CPF)) {
    const d = m.slice(1).join("");
    if (isValidCPF(d)) { cpf = d; break; }
  }

  // data de nascimento: a data mais antiga e plausível (documentos trazem também emissão/validade)
  const ano = new Date().getFullYear();
  const datas = [...plano.matchAll(RE_DATA)]
    .map((m) => ({ d: Number(m[1]), mm: Number(m[2]), a: Number(m[3]) }))
    .filter((x) => x.d >= 1 && x.d <= 31 && x.mm >= 1 && x.mm <= 12 && x.a >= ano - 110 && x.a <= ano - 14)
    .sort((x, y) => x.a - y.a || x.mm - y.mm || x.d - y.d);
  const n = datas[0];
  const data_nascimento = n ? `${n.a}-${String(n.mm).padStart(2, "0")}-${String(n.d).padStart(2, "0")}` : null;

  // nome: linha após o rótulo NOME (RG e CNH), só letras
  let nome: string | null = null;
  const i = linhas.findIndex((l) => /^(nome( e sobrenome)?|nome civil)\b/i.test(l));
  if (i >= 0) {
    const mesmaLinha = linhas[i].replace(/^(nome( e sobrenome)?|nome civil)\s*[:\-]?\s*/i, "");
    const candidato = mesmaLinha.length >= 5 ? mesmaLinha : linhas[i + 1] ?? "";
    if (/^[A-ZÀ-Úa-zà-ú' ]{5,120}$/.test(candidato) && candidato.trim().split(/\s+/).length >= 2) nome = candidato.trim().replace(/\s+/g, " ").toUpperCase();
  }

  // RG: número próximo ao rótulo "REGISTRO GERAL"/"RG"
  let rg: string | null = null;
  const j = linhas.findIndex((l) => /registro geral|\brg\b|identidade/i.test(l));
  if (j >= 0) {
    const m = [linhas[j], linhas[j + 1] ?? ""].join(" ").match(/\b(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?[\dxX]?)\b/);
    if (m) rg = m[1].replace(/[\s.]/g, "");
  }
  return { cpf, nome, data_nascimento, rg };
}
