import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import { fetchAll } from "@/components/dashboard/fetch-all";

interface ConsultorStats {
  clientes: number;
  credito: number;
  premio: number;
  comissao: number;
  visitas: number;
  ultimaVisita: string | null;
}

export const emptyStats = (): ConsultorStats => ({ clientes: 0, credito: 0, premio: 0, comissao: 0, visitas: 0, ultimaVisita: null });

/** Limites [início, fim) do mês corrente no fuso de Brasília. */
export function mesAtual() {
  const [y, m] = todayISO().split("-").map(Number);
  const ini = `${y}-${String(m).padStart(2, "0")}-01`;
  const fim = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { ini, fim };
}

/** Produção do mês por consultor (dados já filtrados pelo RLS do usuário logado). */
export async function statsPorConsultor(ids: string[]) {
  const map = new Map<string, ConsultorStats>();
  if (!ids.length) return map;
  const supabase = await createClient();
  const { ini, fim } = mesAtual();

  const [cli, cotas, aps, com, vis] = await Promise.all([
    fetchAll<{ consultor_id: string | null }>((from, to) => supabase.from("clientes").select("consultor_id").in("consultor_id", ids).order("id").range(from, to), 50_000),
    fetchAll<{ consultor_id: string | null; valor_credito: number }>((from, to) => supabase
      .from("consorcio_cotas")
      .select("consultor_id, valor_credito")
      .in("consultor_id", ids)
      .gte("data_adesao", ini)
      .lt("data_adesao", fim)
      .in("status", ["ativa", "contemplada", "quitada", "inadimplente"])
      .order("id").range(from, to), 50_000),
    fetchAll<{ consultor_id: string | null; premio_liquido: number }>((from, to) => supabase
      .from("seguro_apolices")
      .select("consultor_id, premio_liquido")
      .in("consultor_id", ids)
      .gte("inicio_vigencia", ini)
      .lt("inicio_vigencia", fim)
      .in("status", ["vigente", "renovada"])
      .order("id").range(from, to), 50_000),
    fetchAll<{ consultor_id: string | null; valor_consultor: number }>((from, to) => supabase.from("comissoes").select("consultor_id, valor_consultor").in("consultor_id", ids).eq("competencia", ini).neq("status", "estornada").order("id").range(from, to), 50_000),
    fetchAll<{ consultor_id: string | null; checkin_em: string }>((from, to) => supabase
      .from("visitas")
      .select("consultor_id, checkin_em")
      .in("consultor_id", ids)
      .gte("checkin_em", `${ini}T00:00:00-03:00`)
      .order("checkin_em", { ascending: false })
      .order("id")
      .range(from, to), 50_000),
  ]);

  const get = (id: string | null) => {
    if (!id) return null;
    let s = map.get(id);
    if (!s) map.set(id, (s = emptyStats()));
    return s;
  };
  for (const r of cli) {
    const s = get(r.consultor_id);
    if (s) s.clientes++;
  }
  for (const r of cotas) {
    const s = get(r.consultor_id);
    if (s) s.credito += Number(r.valor_credito);
  }
  for (const r of aps) {
    const s = get(r.consultor_id);
    if (s) s.premio += Number(r.premio_liquido);
  }
  for (const r of com) {
    const s = get(r.consultor_id);
    if (s) s.comissao += Number(r.valor_consultor);
  }
  for (const r of vis) {
    const s = get(r.consultor_id);
    if (s) {
      s.visitas++;
      if (!s.ultimaVisita) s.ultimaVisita = r.checkin_em;
    }
  }
  return map;
}
