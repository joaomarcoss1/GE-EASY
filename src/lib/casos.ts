import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";

/** Mesma sanitização de searchTerm (data.ts), sem depender de código de servidor. */
const searchTerm = (q: string | undefined) => (q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);

/** Minúsculas e sem acento — mesma regra da função public.sem_acento do banco. */
export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtros da base de processos (lidos da URL; mesmos na tela, no relatório e na exportação). */
export interface FiltrosCasos {
  q: string;
  status: string | null;
  tipo: string | null;
  corretor: string | null;
  /** true = só processos em que o consultor é o principal (1º nome do campo) */
  principal: boolean;
  cidade: string | null;
  ano: number | null;
  pendencia: string | null;
  habilitado: boolean | null;
  exigencia: "aberta" | "cumprida" | "nenhuma" | null;
  assinaturas: "completas" | "faltando" | null;
}

const texto = (v: string | undefined) => (v ?? "").trim().slice(0, 80) || null;

export function lerFiltros(sp: Record<string, string | undefined>): FiltrosCasos {
  const ano = Number(sp.ano);
  return {
    q: searchTerm(sp.q),
    status: CASO_STATUS.some((s) => s.value === sp.status) ? sp.status! : null,
    tipo: texto(sp.tipo),
    corretor: texto(sp.corretor)?.toUpperCase() ?? null,
    principal: sp.papel === "principal",
    cidade: texto(sp.cidade),
    ano: Number.isInteger(ano) && ano > 2000 && ano < 2100 ? ano : null,
    pendencia: CASO_PENDENCIAS.some((p) => p.value === sp.pendencia) ? sp.pendencia! : null,
    habilitado: sp.habilitado === "sim" ? true : sp.habilitado === "nao" ? false : null,
    exigencia: sp.exigencia === "aberta" || sp.exigencia === "cumprida" || sp.exigencia === "nenhuma" ? sp.exigencia : null,
    assinaturas: sp.assinaturas === "completas" || sp.assinaturas === "faltando" ? sp.assinaturas : null,
  };
}

export const SELECT_CASOS =
  "id, cliente_id, ano, item, tipo, corretor, corretor_principal, cidade, uf, recebido_em, habilitado_em, exigencia_estado, exigencia_cumprida, pericia_em, avaliacao_em, status, pendencia, assinaturas, situacao_planilha, observacoes, contrato_assinado, procuracao_assinada, retroativo, clientes!inner(id, nome, documento, whatsapp, telefone, excluido_em)";

/** Busca por nome: cada palavra precisa aparecer (sem acento, em qualquer ordem); 3+ dígitos também buscam o CPF. */
export function filtrosNome(q: string) {
  const dig = q.replace(/\D/g, "");
  const palavras = semAcento(q).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 0 && !/^\d+$/.test(w));
  return { dig: dig.length >= 3 ? dig : null, palavras };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- construtor de consulta do supabase-js (tipagem genérica)
export function aplicarFiltros<Q extends { eq: any; contains: any; is: any; or: any; not: any; ilike: any }>(query: Q, f: FiltrosCasos): Q {
  let q = query.is("clientes.excluido_em", null) as Q;
  if (f.status) q = q.eq("status", f.status);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.corretor) q = f.principal ? q.eq("corretor_principal", f.corretor) : q.contains("corretores", [f.corretor]);
  if (f.cidade) q = q.eq("cidade_chave", semAcento(f.cidade));
  if (f.ano) q = q.eq("ano", f.ano);
  if (f.pendencia) q = q.eq("pendencia", f.pendencia);
  if (f.habilitado !== null) q = f.habilitado ? q.not("habilitado_em", "is", null) : q.is("habilitado_em", null);
  if (f.exigencia) q = f.exigencia === "nenhuma" ? q.is("exigencia_estado", null) : q.eq("exigencia_estado", f.exigencia);
  if (f.assinaturas) q = q.eq("assinaturas", f.assinaturas);
  if (f.q) {
    const { dig, palavras } = filtrosNome(f.q);
    if (dig && !palavras.length) q = q.ilike("clientes.documento", `%${dig}%`);
    else for (const w of palavras) q = q.ilike("clientes.nome_busca", `%${w}%`);
  }
  return q;
}

/** Parâmetros da função de resumo (mesmos filtros). */
export const argsResumo = (f: FiltrosCasos) => ({
  p_status: f.status, p_tipo: f.tipo, p_corretor: f.corretor, p_principal: f.principal, p_cidade: f.cidade, p_ano: f.ano,
  p_pendencia: f.pendencia, p_busca: f.q || null, p_habilitado: f.habilitado, p_exigencia: f.exigencia, p_assinaturas: f.assinaturas,
});

/** Monta a query string com os filtros atuais e alterações. */
export function qs(f: FiltrosCasos, extra: Record<string, string | number | null | undefined> = {}) {
  const p = new URLSearchParams();
  const base: Record<string, string | number | null> = {
    q: f.q || null, status: f.status, tipo: f.tipo, corretor: f.corretor, papel: f.principal ? "principal" : null, cidade: f.cidade, ano: f.ano,
    pendencia: f.pendencia, habilitado: f.habilitado === null ? null : f.habilitado ? "sim" : "nao", exigencia: f.exigencia, assinaturas: f.assinaturas,
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface LinhaResumo {
  chave: string;
  total: number;
  principal?: number;
  status: Record<string, number>;
}
export interface ResumoCasos {
  total: number;
  clientes: number;
  por_status: Record<string, number>;
  indicadores: { habilitados: number; exigencia_aberta: number; exigencia_cumprida: number; sem_assinatura: number; pericia_agendada: number; arquivo_morto: number };
  por_tipo: LinhaResumo[];
  por_corretor: LinhaResumo[];
  por_cidade: LinhaResumo[];
  por_ano: Record<string, number>;
  por_pendencia: Record<string, number>;
  sem_assinatura: number;
}
