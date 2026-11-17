import "server-only";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { LOGO_PNG_BASE64 } from "./logo";

/**
 * Planilhas exportadas (.xlsx) com o padrão visual do sistema: logo, título, empresa, data/hora e autor da
 * exportação, filtros aplicados, cabeçalho fixo com filtro, colunas com largura e formato, linhas zebradas e
 * total de registros. Os valores são gravados como texto/número/data (nunca como fórmula).
 */
export type ValorCelula = string | number | boolean | Date | null | undefined;
export type Formato = "texto" | "numero" | "inteiro" | "moeda" | "percentual" | "data" | "datahora";

export interface Coluna<T> {
  titulo: string;
  valor: (linha: T) => ValorCelula;
  largura?: number;
  formato?: Formato;
}

export interface Aba {
  nome: string;
  colunas: Coluna<never>[];
  linhas: unknown[];
}

/** Monta uma aba tipada (as colunas conhecem o tipo da linha). */
export function aba<T>(nome: string, colunas: Coluna<T>[], linhas: T[]): Aba {
  return { nome, colunas: colunas as unknown as Coluna<never>[], linhas };
}

export interface OpcoesPlanilha {
  titulo: string;
  empresa: string;
  usuario: string;
  filtros?: string[];
  resumo?: { rotulo: string; valor: ValorCelula }[];
  abas: Aba[];
}

const MARCA = "FF2D2D83";
const ACENTO = "FFE14F26";
const ZEBRA = "FFF4F4FA";
const BORDA = "FFE2E4EE";
const FMT: Record<Formato, string | undefined> = {
  texto: "@",
  numero: "#,##0.00",
  inteiro: "#,##0",
  moeda: '"R$" #,##0.00',
  percentual: "0.0%",
  data: "dd/mm/yyyy",
  datahora: "dd/mm/yyyy hh:mm",
};

/** "2026-11-17" ou ISO com hora → Date (sem deslocar o dia) */
export function paraData(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  if (!m[4]) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const d = new Date(v);
  // datas com hora: grava no horário de Brasília (a planilha não tem fuso)
  const sp = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return new Date(Date.UTC(sp.getFullYear(), sp.getMonth(), sp.getDate(), sp.getHours(), sp.getMinutes()));
}

function agoraBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function cabecalho(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, logoId: number, o: OpcoesPlanilha, subtitulo: string, ultimaColuna: number) {
  ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 72 } });
  const fim = Math.max(ultimaColuna, 4);
  const linha = (n: number, texto: string, fonte: Partial<ExcelJS.Font>) => {
    ws.mergeCells(n, 3, n, fim);
    const c = ws.getCell(n, 3);
    c.value = texto;
    c.font = { name: "Calibri", ...fonte };
    c.alignment = { vertical: "middle" };
  };
  linha(1, o.titulo, { size: 16, bold: true, color: { argb: MARCA } });
  linha(2, `${o.empresa} · ${subtitulo}`, { size: 11, color: { argb: "FF4B4D6B" } });
  linha(3, `Exportado em ${agoraBR()} por ${o.usuario}`, { size: 10, color: { argb: "FF6B6E8A" } });
  linha(4, o.filtros?.length ? `Filtros: ${o.filtros.join(" · ")}` : "Filtros: nenhum (todos os registros que você pode ver)", { size: 10, italic: true, color: { argb: "FF6B6E8A" } });
  for (const r of [1, 2, 3, 4]) ws.getRow(r).height = r === 1 ? 26 : 18;
  // faixa laranja da marca
  for (let col = 1; col <= fim; col++) ws.getCell(5, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACENTO } };
  ws.getRow(5).height = 4;
  void wb;
}

export async function gerarPlanilha(o: OpcoesPlanilha): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GE EASY";
  wb.created = new Date();
  wb.title = o.titulo;
  const logoId = wb.addImage({ base64: `data:image/png;base64,${LOGO_PNG_BASE64}`, extension: "png" });

  if (o.resumo?.length) {
    const ws = wb.addWorksheet("Resumo", { views: [{ showGridLines: false }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 14 }, { width: 14 }, { width: 44 }, { width: 22 }];
    cabecalho(ws, wb, logoId, o, "Resumo", 4);
    const h = ws.getRow(7);
    h.values = ["", "", "Indicador", "Valor"];
    for (const c of [3, 4]) {
      const cell = h.getCell(c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA } };
      cell.alignment = { vertical: "middle", horizontal: c === 4 ? "right" : "left" };
    }
    o.resumo.forEach((r, i) => {
      const row = ws.getRow(8 + i);
      row.getCell(3).value = r.rotulo;
      row.getCell(4).value = r.valor ?? "";
      row.getCell(4).alignment = { horizontal: "right" };
      if (typeof r.valor === "number") row.getCell(4).numFmt = Number.isInteger(r.valor) ? FMT.inteiro! : FMT.numero!;
      for (const c of [3, 4]) {
        row.getCell(c).border = { bottom: { style: "thin", color: { argb: BORDA } } };
        if (i % 2) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
    });
  }

  for (const a of o.abas) {
    const nome = a.nome.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Dados";
    const ws = wb.addWorksheet(nome, {
      views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
      pageSetup: { orientation: a.colunas.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
      headerFooter: { oddFooter: `&L${o.empresa} — ${o.titulo}&RPágina &P de &N` },
    });
    ws.columns = a.colunas.map((c) => ({ width: c.largura ?? 18 }));
    cabecalho(ws, wb, logoId, o, a.nome, a.colunas.length);

    const head = ws.getRow(7);
    a.colunas.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.titulo;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10.5 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA } };
      cell.alignment = { vertical: "middle", horizontal: c.formato && c.formato !== "texto" && c.formato !== "data" && c.formato !== "datahora" ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: ACENTO } } };
    });
    head.height = 24;

    a.linhas.forEach((linha, li) => {
      const row = ws.getRow(8 + li);
      a.colunas.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        let v = (c.valor as (l: unknown) => ValorCelula)(linha);
        if (typeof v === "boolean") v = v ? "Sim" : "Não";
        cell.value = v ?? "";
        const f = c.formato ? FMT[c.formato] : undefined;
        if (f && v !== null && v !== undefined && v !== "") cell.numFmt = f;
        cell.alignment = { vertical: "top", wrapText: typeof v === "string" && v.length > 40, horizontal: typeof v === "number" ? "right" : "left" };
        cell.border = { bottom: { style: "thin", color: { argb: BORDA } } };
        if (li % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    });

    const ultima = 7 + a.linhas.length;
    if (a.linhas.length) ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: ultima, column: a.colunas.length } };
    const total = ws.getRow(ultima + 2);
    total.getCell(1).value = `Total de registros: ${a.linhas.length.toLocaleString("pt-BR")}`;
    total.getCell(1).font = { bold: true, color: { argb: MARCA } };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Resposta HTTP de download da planilha (nome com a data do dia). */
export function respostaPlanilha(buffer: Buffer, base: string) {
  const dia = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const nome = `${base.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${dia}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
