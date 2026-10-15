/**
 * Preenchimento de modelos de documentos: substitui {{campo}} pelos dados do cliente,
 * processo, contrato, responsável e escritório. Valores são escapados para HTML.
 * Placeholders desconhecidos ficam destacados para revisão.
 */
import { formatCNJ } from "./cnj";

export interface MergeContext {
  cliente?: {
    nome?: string | null;
    documento?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    cep?: string | null;
    rg?: string | null;
    profissao?: string | null;
  } | null;
  processo?: {
    titulo?: string | null;
    numero_cnj?: string | null;
    orgao?: string | null;
    comarca?: string | null;
    uf?: string | null;
    tribunal?: string | null;
    classe?: string | null;
    parte_contraria?: string | null;
    valor_causa?: number | null;
  } | null;
  responsavel?: { nome?: string | null; oab?: string | null; email?: string | null } | null;
  escritorio?: { nome?: string | null; cnpj?: string | null; endereco?: string | null; telefone?: string | null; email?: string | null; cidade?: string | null } | null;
  contrato?: { descricao_honorarios?: string | null; numero?: string | null; titulo?: string | null } | null;
  hoje?: Date;
}

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "cliente.nome", label: "Nome do cliente" },
  { key: "cliente.documento", label: "CPF/CNPJ do cliente" },
  { key: "cliente.rg", label: "RG do cliente" },
  { key: "cliente.profissao", label: "Profissão" },
  { key: "cliente.endereco_completo", label: "Endereço completo" },
  { key: "cliente.email", label: "E-mail do cliente" },
  { key: "cliente.telefone", label: "Telefone do cliente" },
  { key: "processo.titulo", label: "Título do processo" },
  { key: "processo.numero_cnj", label: "Número CNJ" },
  { key: "processo.classe", label: "Classe processual" },
  { key: "processo.orgao", label: "Vara / órgão" },
  { key: "processo.comarca", label: "Comarca" },
  { key: "processo.parte_contraria", label: "Parte contrária" },
  { key: "processo.valor_causa", label: "Valor da causa" },
  { key: "responsavel.nome", label: "Advogado responsável" },
  { key: "responsavel.oab", label: "OAB do responsável" },
  { key: "escritorio.nome", label: "Nome do escritório" },
  { key: "escritorio.cnpj", label: "CNPJ do escritório" },
  { key: "escritorio.endereco", label: "Endereço do escritório" },
  { key: "contrato.descricao_honorarios", label: "Honorários (texto)" },
  { key: "cidade", label: "Cidade" },
  { key: "data", label: "Data (dd/mm/aaaa)" },
  { key: "data_extenso", label: "Data por extenso" },
];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function maskDoc(v?: string | null) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

function dataSP(d: Date) {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  const [y, m, dd] = iso.split("-").map(Number);
  return { y, m, d: dd };
}

export function valores(ctx: MergeContext): Record<string, string> {
  const c = ctx.cliente ?? {};
  const p = ctx.processo ?? {};
  const hoje = dataSP(ctx.hoje ?? new Date());
  const endereco = [
    [c.endereco, c.numero].filter(Boolean).join(", "),
    c.complemento,
    c.bairro,
    [c.cidade, c.uf].filter(Boolean).join("/"),
    c.cep ? `CEP ${String(c.cep).replace(/(\d{5})(\d{3})/, "$1-$2")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const cidade = ctx.escritorio?.cidade || c.cidade || p.comarca || "";
  return {
    "cliente.nome": c.nome ?? "",
    "cliente.documento": maskDoc(c.documento),
    "cliente.rg": c.rg ?? "",
    "cliente.profissao": c.profissao ?? "",
    "cliente.endereco_completo": endereco,
    "cliente.email": c.email ?? "",
    "cliente.telefone": c.telefone ?? "",
    "processo.titulo": p.titulo ?? "",
    "processo.numero_cnj": p.numero_cnj ? `nº ${formatCNJ(p.numero_cnj)}` : "",
    "processo.classe": p.classe ?? "",
    "processo.orgao": p.orgao ?? "",
    "processo.comarca": p.comarca ?? "",
    "processo.parte_contraria": p.parte_contraria ?? "",
    "processo.valor_causa": p.valor_causa != null ? Number(p.valor_causa).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "",
    "responsavel.nome": ctx.responsavel?.nome ?? "",
    "responsavel.oab": ctx.responsavel?.oab ?? "",
    "escritorio.nome": ctx.escritorio?.nome ?? "",
    "escritorio.cnpj": maskDoc(ctx.escritorio?.cnpj),
    "escritorio.endereco": ctx.escritorio?.endereco ?? "",
    "contrato.descricao_honorarios": ctx.contrato?.descricao_honorarios ?? "",
    cidade,
    data: `${String(hoje.d).padStart(2, "0")}/${String(hoje.m).padStart(2, "0")}/${hoje.y}`,
    data_extenso: `${hoje.d} de ${MESES[hoje.m - 1]} de ${hoje.y}`,
  };
}

/** Retorna HTML seguro (texto escapado, quebras de linha preservadas pelo CSS `white-space: pre-wrap`). */
export function renderModelo(conteudo: string, ctx: MergeContext): { html: string; faltando: string[] } {
  const v = valores(ctx);
  const faltando = new Set<string>();
  const html = escapeHtml(conteudo).replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, key: string) => {
    const k = key.toLowerCase();
    if (k in v && v[k]) return escapeHtml(v[k]);
    faltando.add(k);
    return `<mark class="ge-missing">[${escapeHtml(k)}]</mark>`;
  });
  return { html, faltando: [...faltando] };
}

/** Versão texto puro (para copiar). */
export function renderTexto(conteudo: string, ctx: MergeContext) {
  const v = valores(ctx);
  return conteudo.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, key: string) => v[key.toLowerCase()] || `[${key}]`);
}
