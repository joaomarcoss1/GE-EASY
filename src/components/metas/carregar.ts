import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addMonths, firstDay, lastDay, spDateOf, spStartOf } from "@/components/dashboard/periods";
import { COTA_STATUS_META, type RealizadoRows } from "./realizado";

/** Linhas do mês (já restritas pelo RLS do usuário) para calcular o realizado de todas as metas. */
export async function carregarRealizado(mes: string): Promise<RealizadoRows> {
  const supabase = await createClient();
  const de = firstDay(mes);
  const ate = lastDay(mes);
  const inicio = spStartOf(de);
  const fim = spStartOf(firstDay(addMonths(mes, 1)));
  const [cotas, apolices, clientes, comissoes, analises] = await Promise.all([
    fetchAll<RealizadoRows["cotas"][number]>((f, t) =>
      supabase.from("consorcio_cotas").select("valor_credito, consultor_id, status").gte("data_adesao", de).lte("data_adesao", ate).in("status", COTA_STATUS_META).order("id").range(f, t),
    ),
    fetchAll<RealizadoRows["apolices"][number]>((f, t) =>
      supabase.from("seguro_apolices").select("premio_liquido, consultor_id").gte("inicio_vigencia", de).lte("inicio_vigencia", ate).in("status", ["vigente", "renovada"]).order("id").range(f, t),
    ),
    fetchAll<{ consultor_id: string | null; created_at: string }>((f, t) =>
      supabase.from("clientes").select("consultor_id, created_at").gte("created_at", inicio).lt("created_at", fim).order("id").range(f, t),
    ),
    fetchAll<RealizadoRows["comissoes"][number]>((f, t) =>
      supabase.from("comissoes").select("valor_corretora, consultor_id").eq("competencia", de).neq("status", "estornada").order("id").range(f, t),
    ),
    fetchAll<{ usuario_id: string | null }>((f, t) =>
      supabase.from("cliente_casos_historico").select("usuario_id").eq("de", "em_analise").neq("para", "em_analise").gte("em", inicio).lt("em", fim).order("id").range(f, t),
    ),
  ]);
  return {
    cotas,
    apolices,
    clientes: clientes.filter((c) => spDateOf(c.created_at).startsWith(mes)),
    comissoes,
    analises: analises.map((a) => ({ consultor_id: a.usuario_id })),
  };
}
