import { createClient } from "@/lib/supabase/server";

export interface LinhaEquipe {
  usuario_id: string;
  nome: string;
  papel: string;
  trocas_status: number;
  analises: number;
  pendencias_resolvidas: number;
  exigencias_cumpridas: number;
  enviados_analise: number;
  enviados_habilitacao: number;
  habilitados: number;
  fichas_abertas: number;
  fichas_encerradas: number;
  fichas_recebidas: number;
  dossies: number;
  resumos: number;
  processos_trabalhados: number;
  ultimo_acesso: string | null;
  metas: Record<string, number>;
}

/** Produtividade da equipe interna no período (banco: `produtividade_equipe`, exige `clientes.ver_todos`). */
export async function carregarEquipe(de: string, ate: string): Promise<LinhaEquipe[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("produtividade_equipe", { p_de: de, p_ate: ate });
  if (error) {
    console.error("[equipe]", error.code, error.message);
    return [];
  }
  return (data ?? []) as LinhaEquipe[];
}

/** Total de ações registradas no sistema (para ordenar e destacar quem ainda não usa). */
export const totalAcoes = (l: LinhaEquipe) =>
  l.trocas_status + l.fichas_abertas + l.fichas_encerradas + l.dossies + l.resumos;

/** Indicador principal de cada pessoa: o da meta individual, se houver. */
export const INDICADOR_ROTULO: Record<string, string> = {
  analises: "análises",
  pendencias_resolvidas: "pendências resolvidas",
  exigencias_cumpridas: "exigências cumpridas",
  habilitados: "habilitações",
};
