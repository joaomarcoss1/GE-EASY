/** CSV para Excel (pt-BR): ponto e vírgula, BOM UTF-8, aspas sempre e fórmulas neutralizadas. */
type CsvCell = string | number | null | undefined;

/** Aspas sempre; neutraliza injeção de fórmula (= + - @ TAB CR) prefixando apóstrofo. */
function csvCell(v: CsvCell): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvResponse(nome: string, conteudo: string) {
  return new Response(conteudo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome.replace(/[^a-z0-9_.-]/gi, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Lê um CSV (separador ; ou ,) com aspas. Retorna linhas de células já sem aspas. */
export function parseCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const sep = (t.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) >= (t.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') aspas = false;
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(cel); cel = "";
      if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
      linha = [];
    } else cel += c;
  }
  linha.push(cel);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}
