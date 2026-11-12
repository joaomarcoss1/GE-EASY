import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";
import { searchTerm } from "@/lib/data";

/** Filtros da base de processos (lidos da URL; mesmos na tela, no relatório e na exportação). */
export interface FiltrosCasos {
  q: string;
  status: string | null;
  tipo: string | null;
  corretor: string | null;
  cidade: string | null;
  ano: number | null;
  pendencia: string | null;
}

const texto = (v: string | undefined) => (v ?? "").trim().slice(0, 80) || null;

export function lerFiltros(sp: Record<string, string | undefined>): FiltrosCasos {
  const ano = Number(sp.ano);
  return {
    q: searchTerm(sp.q),
    status: CASO_STATUS.some((s) => s.value === sp.status) ? sp.status! : null,
    tipo: texto(sp.tipo),
    corretor: texto(sp.corretor)?.toUpperCase() ?? null,
    cidade: texto(sp.cidade),
    ano: Number.isInteger(ano) && ano > 2000 && ano < 2100 ? ano : null,
    pendencia: CASO_PENDENCIAS.some((p) => p.value === sp.pendencia) ? sp.pendencia! : null,
  };
}

export const SELECT_CASOS =
  "id, cliente_id, ano, item, tipo, corretor, cidade, uf, recebido_em, habilitado_em, exigencia_cumprida, pericia_em, avaliacao_em, status, pendencia, situacao_planilha, observacoes, contrato_assinado, procuracao_assinada, retroativo, clientes!inner(id, nome, documento, whatsapp, telefone, excluido_em)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- construtor de consulta do supabase-js (tipagem genérica)
export function aplicarFiltros<Q extends { eq: any; contains: any; is: any; or: any }>(query: Q, f: FiltrosCasos): Q {
  let q = query.is("clientes.excluido_em", null) as Q;
  if (f.status) q = q.eq("status", f.status);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.corretor) q = q.contains("corretores", [f.corretor]);
  if (f.cidade) q = q.eq("cidade", f.cidade);
  if (f.ano) q = q.eq("ano", f.ano);
  if (f.pendencia) q = q.eq("pendencia", f.pendencia);
  if (f.q) {
    const dig = f.q.replace(/\D/g, "");
    q = q.or([`nome.ilike.%${f.q}%`, ...(dig.length >= 3 ? [`documento.ilike.%${dig}%`] : [])].join(","), { referencedTable: "clientes" });
  }
  return q;
}

/** Parâmetros da função de resumo (mesmos filtros). */
export const argsResumo = (f: FiltrosCasos) => ({
  p_status: f.status, p_tipo: f.tipo, p_corretor: f.corretor, p_cidade: f.cidade, p_ano: f.ano, p_pendencia: f.pendencia, p_busca: f.q || null,
});

/** Monta a query string com os filtros atuais e alterações. */
export function qs(f: FiltrosCasos, extra: Record<string, string | number | null | undefined> = {}) {
  const p = new URLSearchParams();
  const base: Record<string, string | number | null> = { q: f.q || null, status: f.status, tipo: f.tipo, corretor: f.corretor, cidade: f.cidade, ano: f.ano, pendencia: f.pendencia };
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface LinhaResumo {
  chave: string;
  total: number;
  status: Record<string, number>;
}
export interface ResumoCasos {
  total: number;
  clientes: number;
  por_status: Record<string, number>;
  por_tipo: LinhaResumo[];
  por_corretor: LinhaResumo[];
  por_cidade: LinhaResumo[];
  por_ano: Record<string, number>;
  por_pendencia: Record<string, number>;
  sem_assinatura: number;
}
