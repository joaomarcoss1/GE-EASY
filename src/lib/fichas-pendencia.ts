/** Tipos e consulta da Folha de Acompanhamento de Pendências (tela e impressão). */
export interface FichaCompleta {
  id: string;
  caso_id: string;
  cliente_id: string;
  numero: number;
  tipo: "pendencia" | "exigencia";
  exigencia_cumprida: boolean | null;
  beneficio: string | null;
  segurado: string | null;
  recebida_em: string;
  responsavel_id: string | null;
  status: string;
  destino: string | null;
  destino_status: string | null;
  destino_outro: string | null;
  destino_em: string | null;
  encaminhado_para: string | null;
  assinatura_path: string | null;
  encerrada_em: string | null;
  clientes: { nome: string; documento: string | null } | null;
  cliente_casos: {
    tipo: string; ano: number | null; status: string; protocolo_inss: string | null; situacao_atual: string | null; recebido_em: string | null;
    exigencia_prazo: string | null; exigencia_prorrogada: boolean; exigencia_texto: string | null; exigencia_aberta_em: string | null;
  } | null;
}
export interface ItemFicha {
  id: string;
  secao: "pendencia" | "retorno";
  data: string;
  texto: string;
  prazo: string | null;
  resolvida: boolean;
  criado_por: string | null;
  created_at: string;
}

export const SELECT_FICHA =
  "id, caso_id, cliente_id, numero, tipo, exigencia_cumprida, beneficio, segurado, recebida_em, responsavel_id, status, destino, destino_status, destino_outro, destino_em, encaminhado_para, assinatura_path, encerrada_em, clientes(nome, documento), cliente_casos(tipo, ano, status, protocolo_inss, situacao_atual, recebido_em, exigencia_prazo, exigencia_prorrogada, exigencia_texto, exigencia_aberta_em)";

type Perfil = { id: string; full_name: string | null; email: string; active: boolean };
type Leitor = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Para quem a ficha pode ser encaminhada: analistas = membros ativos do setor "Análise"; habilitação = lista em
 * configuracoes.fluxo_processos.habilitacao (na EASY, a Aline).
 */
export async function opcoesEncaminhamento(supabase: Leitor, perfis: Map<string, Perfil>) {
  const op = (ids: string[]) =>
    [...new Set(ids)].map((id) => perfis.get(id)).filter((p): p is Perfil => !!p && p.active).map((p) => ({ value: p.id, label: p.full_name || p.email }));
  const [{ data: dep }, { data: cfg }] = await Promise.all([
    supabase.from("departamentos").select("id").eq("nome", "Análise").maybeSingle(),
    supabase.from("configuracoes").select("valor").eq("chave", "fluxo_processos").maybeSingle(),
  ]);
  let analistas: string[] = [];
  if (dep?.id) {
    const { data: membros } = await supabase.from("departamento_membros").select("user_id").eq("departamento_id", dep.id).eq("ativo", true);
    analistas = ((membros ?? []) as { user_id: string }[]).map((m) => m.user_id);
  }
  const hab = ((cfg?.valor as { habilitacao?: unknown } | null)?.habilitacao ?? []) as unknown[];
  return { analistas: op(analistas), habilitadores: op(hab.filter((x): x is string => typeof x === "string")) };
}
