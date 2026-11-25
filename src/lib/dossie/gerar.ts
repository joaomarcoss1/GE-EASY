import "server-only";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CASO_STATUS, DOC_CATEGORIAS, FICHA_DESTINOS } from "@/lib/constants";
import { LOGO_PNG_BASE64 } from "@/lib/planilha/logo";

/**
 * Dossiê do processo (INSS ou Justiça): um ZIP com
 *   00 - Resumo do processo.pdf   (capa, dados do cliente e do benefício, checklist, histórico e fichas)
 *   01 - Processo completo.pdf    (resumo + todos os PDFs e imagens na ordem do checklist, para protocolar)
 *   Documentos/NN - Categoria - arquivo   (os originais)
 * Tudo é lido com a sessão de quem gera (RLS), e o ZIP é gravado na pasta do cliente no Storage.
 * A senha gov.br do cliente nunca entra no dossiê.
 */
export type Destino = "inss" | "justica";

export interface ItemChecklist { categoria: string; nome: string; obrigatorio: boolean; escopo: string; situacao: string; arquivos: number }
export interface Checklist { itens: ItemChecklist[]; faltando: string[] }

const LIMITE_TOTAL = 180 * 1024 * 1024; // o que cabe com folga na memória da função
const A4: [number, number] = [595.28, 841.89];
const MARGEM = 48;
const COR = { brand: rgb(0.176, 0.176, 0.514), accent: rgb(0.882, 0.31, 0.149), texto: rgb(0.09, 0.09, 0.23), muted: rgb(0.37, 0.37, 0.5), linha: rgb(0.86, 0.86, 0.92) };

// Helvetica padrão do PDF usa WinAnsi (cp1252): troca o que não existe nela
const CP1252 = new Set(Array.from(new TextDecoder("windows-1252").decode(Uint8Array.from({ length: 224 }, (_, i) => i + 32))));
const limpar = (t: string) => Array.from((t ?? "").replace(/\r?\n/g, " ").replace(/→/g, "->")).map((c) => (CP1252.has(c) ? c : "?")).join("");
const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const dataHoraBR = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const rotulo = (ops: { value: string; label: string }[], v: string | null | undefined) => ops.find((o) => o.value === v)?.label ?? v ?? "—";
const nomeArquivo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "arquivo";
const SITUACAO: Record<string, string> = { aprovado: "Aprovado", enviado: "Enviado (a conferir)", recusado: "Recusado", vencido: "Vencido", faltando: "FALTANDO" };

/** Escrita de texto com quebra de linha e página nova automática. */
class Escritor {
  page!: PDFPage;
  y = 0;
  constructor(private pdf: PDFDocument, private font: PDFFont, private bold: PDFFont, private rodape: string) { this.nova(); }
  nova() {
    this.page = this.pdf.addPage(A4);
    this.y = A4[1] - MARGEM;
    this.page.drawText(limpar(this.rodape), { x: MARGEM, y: 24, size: 7.5, font: this.font, color: COR.muted });
  }
  espaco(h: number) { if (this.y - h < MARGEM + 10) this.nova(); }
  linhas(texto: string, size: number, font: PDFFont, largura: number) {
    const out: string[] = [];
    for (const par of limpar(texto).split("\n")) {
      let atual = "";
      for (const w of par.split(" ")) {
        const t = atual ? `${atual} ${w}` : w;
        if (font.widthOfTextAtSize(t, size) > largura && atual) { out.push(atual); atual = w; } else atual = t;
      }
      out.push(atual);
    }
    return out;
  }
  texto(t: string, o: { size?: number; bold?: boolean; cor?: ReturnType<typeof rgb>; x?: number; largura?: number; depois?: number } = {}) {
    const size = o.size ?? 10, font = o.bold ? this.bold : this.font, x = o.x ?? MARGEM;
    for (const l of this.linhas(t, size, font, o.largura ?? A4[0] - x - MARGEM)) {
      this.espaco(size + 4);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.cor ?? COR.texto });
      this.y -= size + 4;
    }
    this.y -= o.depois ?? 0;
  }
  titulo(t: string) {
    this.espaco(40);
    this.y -= 10;
    this.page.drawText(limpar(t.toUpperCase()), { x: MARGEM, y: this.y - 11, size: 11, font: this.bold, color: COR.brand });
    this.y -= 16;
    this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4[0] - MARGEM, y: this.y }, thickness: 1, color: COR.linha });
    this.y -= 8;
  }
  campos(pares: [string, string][]) {
    const col = (A4[0] - 2 * MARGEM) / 2;
    for (let i = 0; i < pares.length; i += 2) {
      const linha = pares.slice(i, i + 2);
      const alturas = linha.map(([, v]) => this.linhas(v || "—", 10, this.font, col - 12).length);
      const h = 12 + Math.max(...alturas) * 14 + 6;
      this.espaco(h);
      linha.forEach(([r, v], j) => {
        const x = MARGEM + j * col;
        this.page.drawText(limpar(r.toUpperCase()), { x, y: this.y - 8, size: 7, font: this.bold, color: COR.muted });
        this.linhas(v || "—", 10, this.font, col - 12).forEach((l, k) => this.page.drawText(l, { x, y: this.y - 22 - k * 14, size: 10, font: this.font, color: COR.texto }));
      });
      this.y -= h;
    }
  }
}

interface Doc { id: string; nome: string; categoria: string; storage_path: string; mime_type: string | null; tamanho: number | null; analise_status: string | null; created_at: string }

export async function gerarDossie(supabase: SupabaseClient, args: { casoId: string; destino: Destino; empresaId: string; geradoPor: string; nomeQuemGera: string }) {
  const { casoId, destino } = args;
  const { data: caso } = await supabase
    .from("cliente_casos")
    .select("id, cliente_id, tipo, status, ano, protocolo_inss, situacao_atual, recebido_em, habilitado_em, exigencia_prazo, observacoes, corretor, cidade, uf, assessores(nome), clientes!inner(id, nome, documento, rg, data_nascimento, email, telefone, whatsapp, telefone_recado, cep, endereco, numero, complemento, bairro, cidade, uf, profissao, tipo_acao)")
    .eq("id", casoId)
    .maybeSingle();
  if (!caso) throw new Error("Processo não encontrado ou sem acesso.");
  const cli = (Array.isArray(caso.clientes) ? caso.clientes[0] : caso.clientes) as Record<string, string | null>;
  const assessor = (Array.isArray(caso.assessores) ? caso.assessores[0] : caso.assessores) as { nome: string } | null;

  const [{ data: chk }, { data: docsData }, { data: hist }, { data: fichas }] = await Promise.all([
    supabase.rpc("checklist_processo", { p_caso: casoId, p_destino: destino }),
    supabase.from("documentos").select("id, nome, categoria, storage_path, mime_type, tamanho, analise_status, created_at").eq("cliente_id", caso.cliente_id).is("excluido_em", null).not("storage_path", "is", null).neq("categoria", "dossie").order("created_at"),
    supabase.from("cliente_casos_historico").select("de, para, em, usuario_id").eq("caso_id", casoId).order("em"),
    supabase.from("fichas_pendencia").select("id, tipo, numero, status, destino, destino_em, encerrada_em, responsavel_id, exigencia_cumprida, ficha_pendencia_itens(secao, data, texto, resolvida)").eq("caso_id", casoId).order("created_at"),
  ]);
  const checklist = (chk ?? { itens: [], faltando: [] }) as Checklist;
  const ordem = new Map(checklist.itens.map((it, i) => [it.categoria, i]));
  const docs = ((docsData ?? []) as Doc[])
    .filter((d) => d.analise_status !== "recusado")
    .sort((a, b) => (ordem.get(a.categoria) ?? 999) - (ordem.get(b.categoria) ?? 999) || a.created_at.localeCompare(b.created_at));

  // nomes de quem mexeu no processo
  const ids = [...new Set([...(hist ?? []).map((h) => h.usuario_id), ...(fichas ?? []).map((f) => f.responsavel_id)].filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await supabase.from("membros").select("id, full_name").in("id", ids) : { data: [] };
  const nomeDe = new Map((pessoas ?? []).map((p) => [p.id as string, (p.full_name as string) || "—"]));

  // baixa os documentos (com a sessão de quem gera)
  const baixados: { doc: Doc; bytes: Uint8Array; erro?: string }[] = [];
  let total = 0;
  for (const d of docs) {
    if (total + (d.tamanho ?? 0) > LIMITE_TOTAL) { baixados.push({ doc: d, bytes: new Uint8Array(), erro: "não incluído: o dossiê passou do tamanho máximo" }); continue; }
    const { data, error } = await supabase.storage.from("documentos").download(d.storage_path);
    if (error || !data) { baixados.push({ doc: d, bytes: new Uint8Array(), erro: "não foi possível baixar" }); continue; }
    const bytes = new Uint8Array(await data.arrayBuffer());
    total += bytes.byteLength;
    baixados.push({ doc: d, bytes });
  }

  // ---------------------------------------------------------------- resumo
  const agora = new Date().toISOString();
  const resumo = await PDFDocument.create();
  resumo.setTitle(`Dossiê — ${cli.nome}`);
  resumo.setAuthor("GE EASY");
  const font = await resumo.embedFont(StandardFonts.Helvetica);
  const bold = await resumo.embedFont(StandardFonts.HelveticaBold);
  const w = new Escritor(resumo, font, bold, `GE EASY · Dossiê de ${cli.nome} · gerado em ${dataHoraBR(agora)} por ${args.nomeQuemGera} · documento interno`);
  try {
    const logo = await resumo.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
    const lw = 120, lh = (logo.height / logo.width) * lw;
    w.page.drawImage(logo, { x: A4[0] - MARGEM - lw, y: A4[1] - MARGEM - lh + 6, width: lw, height: lh });
  } catch { /* sem logo, segue */ }
  w.texto(destino === "inss" ? "DOSSIÊ PARA REQUERIMENTO NO INSS" : "DOSSIÊ PARA AÇÃO JUDICIAL", { size: 9, bold: true, cor: COR.accent, largura: 330 });
  w.texto(cli.nome ?? "Cliente", { size: 20, bold: true, largura: 330, depois: 2 });
  w.texto(`${caso.tipo} · situação: ${rotulo(CASO_STATUS, caso.status)}${caso.protocolo_inss ? ` · protocolo ${caso.protocolo_inss}` : ""}`, { size: 10, cor: COR.muted, largura: 330, depois: 6 });

  w.titulo("Dados do segurado");
  const endereco = [cli.endereco, cli.numero, cli.complemento, cli.bairro].filter(Boolean).join(", ");
  w.campos([
    ["Nome completo", cli.nome ?? ""], ["CPF", fmtCpf(cli.documento)],
    ["RG", cli.rg ?? ""], ["Data de nascimento", dataBR(cli.data_nascimento)],
    ["Telefone / WhatsApp", [cli.telefone, cli.whatsapp].filter(Boolean).join(" / ")], ["Telefone de recado", cli.telefone_recado ?? ""],
    ["E-mail", cli.email ?? ""], ["Profissão", cli.profissao ?? ""],
    ["Endereço", endereco], ["Cidade / UF / CEP", [cli.cidade, cli.uf, cli.cep].filter(Boolean).join(" / ")],
  ]);

  w.titulo("Benefício e processo");
  w.campos([
    ["Benefício", caso.tipo], ["Situação atual", rotulo(CASO_STATUS, caso.status)],
    ["Protocolo do INSS", caso.protocolo_inss ?? "ainda sem protocolo"], ["Estado atual", caso.situacao_atual ?? ""],
    ["Recebido em", dataBR(caso.recebido_em)], ["Habilitado em", dataBR(caso.habilitado_em)],
    ["Assessor", assessor?.nome ?? caso.corretor ?? ""], ["Cidade do processo", [caso.cidade, caso.uf].filter(Boolean).join(" / ")],
  ]);
  if (caso.observacoes) w.texto(`Observações: ${caso.observacoes}`, { size: 9, cor: COR.muted, depois: 4 });

  w.titulo(`Documentos exigidos (${destino === "inss" ? "INSS" : "Justiça"})`);
  if (!checklist.itens.length) w.texto("Nenhum documento exigido cadastrado para este benefício.", { size: 9, cor: COR.muted });
  for (const it of checklist.itens) {
    const falta = it.situacao === "faltando" || it.situacao === "recusado" || it.situacao === "vencido";
    w.texto(`${falta ? "[  ]" : "[X]"}  ${it.nome}${it.obrigatorio ? "" : " (opcional)"} — ${SITUACAO[it.situacao] ?? it.situacao}${it.arquivos ? ` · ${it.arquivos} arquivo(s)` : ""}`, { size: 9.5, cor: falta && it.obrigatorio ? COR.accent : COR.texto });
  }
  if (checklist.faltando.length) w.texto(`Atenção: faltam ${checklist.faltando.length} documento(s) obrigatório(s): ${checklist.faltando.join("; ")}.`, { size: 9.5, bold: true, cor: COR.accent, depois: 2 });

  w.titulo("Arquivos deste dossiê");
  if (!baixados.length) w.texto("Nenhum arquivo anexado ao cliente.", { size: 9, cor: COR.muted });
  baixados.forEach((b, i) => w.texto(`${String(i + 1).padStart(2, "0")}. ${rotulo(DOC_CATEGORIAS, b.doc.categoria)} — ${b.doc.nome}${b.erro ? ` (${b.erro})` : ""}`, { size: 9 }));

  w.titulo("Histórico da situação");
  if (!(hist ?? []).length) w.texto("Sem trocas registradas.", { size: 9, cor: COR.muted });
  for (const h of hist ?? []) w.texto(`${dataHoraBR(h.em)} — ${h.de ? `${rotulo(CASO_STATUS, h.de)} -> ` : ""}${rotulo(CASO_STATUS, h.para)} (${nomeDe.get(h.usuario_id) ?? "sistema"})`, { size: 9 });

  for (const f of fichas ?? []) {
    w.titulo(`Ficha de ${f.tipo === "exigencia" ? "exigências" : "pendências"} nº ${f.numero}`);
    w.texto(`Responsável: ${nomeDe.get(f.responsavel_id) ?? "—"} · ${f.status === "encerrada" ? `encerrada em ${dataBR(f.encerrada_em)} · destino: ${rotulo(FICHA_DESTINOS, f.destino)}` : "em andamento"}${f.tipo === "exigencia" && f.exigencia_cumprida !== null ? ` · exigência cumprida: ${f.exigencia_cumprida ? "sim" : "não"}` : ""}`, { size: 9, cor: COR.muted });
    const itens = (f.ficha_pendencia_itens ?? []) as { secao: string; data: string; texto: string; resolvida: boolean }[];
    for (const it of itens.sort((a, b) => a.data.localeCompare(b.data))) {
      w.texto(`${dataBR(it.data)} · ${it.secao === "pendencia" ? (f.tipo === "exigencia" ? "Exigência" : "Pendência") : "Retorno"}: ${it.texto}${it.secao === "pendencia" && it.resolvida ? " (resolvida)" : ""}`, { size: 9 });
    }
  }
  const resumoBytes = await resumo.save();

  // ---------------------------------------------------------------- PDF único (para protocolar)
  const completo = await PDFDocument.create();
  completo.setTitle(`Processo completo — ${cli.nome}`);
  const fc = await completo.embedFont(StandardFonts.Helvetica);
  for (const p of await completo.copyPages(await PDFDocument.load(resumoBytes), Array.from({ length: resumo.getPageCount() }, (_, i) => i))) completo.addPage(p);
  const fora: string[] = [];
  for (const b of baixados) {
    if (b.erro) continue;
    const tipo = (b.doc.mime_type ?? "").toLowerCase();
    try {
      if (tipo === "application/pdf" || b.doc.nome.toLowerCase().endsWith(".pdf")) {
        const src = await PDFDocument.load(b.bytes, { ignoreEncryption: true });
        for (const p of await completo.copyPages(src, src.getPageIndices())) completo.addPage(p);
      } else if (tipo === "image/jpeg" || tipo === "image/png" || /\.(jpe?g|png)$/i.test(b.doc.nome)) {
        const img = /png/i.test(tipo) || /\.png$/i.test(b.doc.nome) ? await completo.embedPng(b.bytes) : await completo.embedJpg(b.bytes);
        const page = completo.addPage(A4);
        const legenda = limpar(`${rotulo(DOC_CATEGORIAS, b.doc.categoria)} — ${b.doc.nome}`);
        page.drawText(legenda.slice(0, 110), { x: 36, y: A4[1] - 30, size: 8, font: fc, color: COR.muted });
        const maxW = A4[0] - 72, maxH = A4[1] - 80;
        const esc = Math.min(maxW / img.width, maxH / img.height, 1);
        page.drawImage(img, { x: (A4[0] - img.width * esc) / 2, y: (A4[1] - 44 - img.height * esc), width: img.width * esc, height: img.height * esc });
      } else fora.push(b.doc.nome);
    } catch {
      fora.push(b.doc.nome);
    }
  }
  if (fora.length) {
    const page = completo.addPage(A4);
    page.drawText(limpar("Arquivos que não entram no PDF único (estão na pasta Documentos do ZIP):"), { x: 48, y: A4[1] - 60, size: 10, font: fc, color: COR.texto });
    fora.forEach((n, i) => page.drawText(limpar(`- ${n}`).slice(0, 100), { x: 48, y: A4[1] - 80 - i * 14, size: 9, font: fc, color: COR.muted }));
  }
  const completoBytes = await completo.save();

  // ---------------------------------------------------------------- ZIP
  const zip = new JSZip();
  const base = nomeArquivo(cli.nome ?? "cliente");
  zip.file("00 - Resumo do processo.pdf", resumoBytes);
  zip.file(`01 - Processo completo - ${base}.pdf`, completoBytes);
  const pasta = zip.folder("Documentos")!;
  baixados.forEach((b, i) => {
    if (b.erro) return;
    const ext = (b.doc.nome.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
    pasta.file(`${String(i + 1).padStart(2, "0")} - ${nomeArquivo(rotulo(DOC_CATEGORIAS, b.doc.categoria))} - ${nomeArquivo(b.doc.nome.replace(/\.[a-z0-9]{2,5}$/i, ""))}${ext}`, b.bytes);
  });
  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });

  const carimbo = agora.replace(/[-:]/g, "").slice(0, 13);
  const caminho = `empresas/${args.empresaId}/clientes/${caso.cliente_id}/dossies/${casoId}/${carimbo}-${destino}.zip`;
  const { error: upErr } = await supabase.storage.from("documentos").upload(caminho, zipBytes, { contentType: "application/zip", upsert: true });
  if (upErr) throw new Error("Não foi possível guardar o dossiê.");
  const { data: reg, error: regErr } = await supabase
    .from("dossies")
    .insert({ caso_id: casoId, cliente_id: caso.cliente_id, destino, storage_path: caminho, arquivos: baixados.filter((b) => !b.erro).length, tamanho: zipBytes.byteLength, faltando: checklist.faltando, gerado_por: args.geradoPor })
    .select("id")
    .single();
  if (regErr || !reg) {
    await supabase.storage.from("documentos").remove([caminho]);
    throw new Error("Não foi possível registrar o dossiê.");
  }
  return { id: reg.id as string, caminho, arquivos: baixados.filter((b) => !b.erro).length, faltando: checklist.faltando, tamanho: zipBytes.byteLength, nomeZip: `Dossie - ${base} - ${destino === "inss" ? "INSS" : "Justica"}.zip` };
}

function fmtCpf(v: string | null) {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v ?? "";
}
