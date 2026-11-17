import "server-only";
import { createClient } from "@/lib/supabase/server";
import { INCONSISTENCIAS } from "@/lib/constants";
import { fetchAll } from "@/components/dashboard/fetch-all";

export interface Inconsistencia {
  chave: string;
  caso_id: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  tipo: string | null;
  status: string | null;
  detalhe: string;
  rota_id?: string | null;
}

/** Todas as inconsistências que o usuário pode ver (processos, clientes e rotas), com o resumo por tipo. */
export async function carregarInconsistencias(incluirRotas: boolean) {
  const supabase = await createClient();
  const [linhas, rotas] = await Promise.all([
    fetchAll<Inconsistencia>((f, t) => supabase.rpc("inconsistencias_processos").range(f, t) as unknown as PromiseLike<{ data: Inconsistencia[] | null; error: { message: string } | null }>, 30_000),
    incluirRotas ? supabase.rpc("inconsistencias_rotas") : Promise.resolve({ data: [] }),
  ]);
  const deRotas: Inconsistencia[] = ((rotas.data ?? []) as { rota_id: string; nome: string; data: string; detalhe: string }[]).map((r) => ({
    chave: "rota_sem_checklist", caso_id: null, cliente_id: null, cliente_nome: `${r.nome} (${r.data.split("-").reverse().join("/")})`, tipo: null, status: null, detalhe: r.detalhe, rota_id: r.rota_id,
  }));
  const todas = [...linhas, ...deRotas];
  const resumo = INCONSISTENCIAS.map((i) => ({ ...i, total: todas.filter((x) => x.chave === i.value).length }));
  return { todas, resumo };
}
