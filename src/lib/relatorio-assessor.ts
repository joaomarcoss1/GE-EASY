import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { isISODate } from "@/components/dashboard/periods";
import { todayISO } from "@/lib/format";

export interface CasoRelatorio {
  id: string;
  cliente_id: string;
  tipo: string;
  status: string;
  cidade: string | null;
  uf: string | null;
  recebido_em: string | null;
  habilitado_em: string | null;
  protocolo_inss: string | null;
  situacao_atual: string | null;
  pendencia: string | null;
  exigencia_prazo: string | null;
  exigencia_prorrogada: boolean;
  assinaturas: string | null;
  assessor_id: string | null;
  corretor: string | null;
  clientes: { nome: string; documento: string | null; telefone: string | null; whatsapp: string | null };
}

export interface FiltroRelatorio {
  assessor: string | null; // uuid, "sem" (sem assessor) ou null (todos)
  de: string;
  ate: string;
}

export function lerFiltroRelatorio(sp: Record<string, string | undefined>): FiltroRelatorio {
  const hoje = todayISO();
  let de = isISODate(sp.de) ? sp.de : `${hoje.slice(0, 7)}-01`;
  let ate = isISODate(sp.ate) ? sp.ate : hoje;
  if (de > ate) [de, ate] = [ate, de];
  const assessor = sp.assessor === "sem" || (sp.assessor && /^[0-9a-f-]{36}$/i.test(sp.assessor)) ? sp.assessor : null;
  return { assessor, de, ate };
}

/** Processos recebidos no período (com o RLS de quem consulta), filtrados pelo assessor. */
export async function carregarRelatorio(f: FiltroRelatorio): Promise<CasoRelatorio[]> {
  const supabase = await createClient();
  return fetchAll<CasoRelatorio>((from, to) => {
    let q = supabase
      .from("cliente_casos")
      .select("id, cliente_id, tipo, status, cidade, uf, recebido_em, habilitado_em, protocolo_inss, situacao_atual, pendencia, exigencia_prazo, exigencia_prorrogada, assinaturas, assessor_id, corretor, clientes!inner(nome, documento, telefone, whatsapp, excluido_em)")
      .is("clientes.excluido_em", null)
      .gte("recebido_em", f.de)
      .lte("recebido_em", f.ate);
    if (f.assessor === "sem") q = q.is("assessor_id", null);
    else if (f.assessor) q = q.eq("assessor_id", f.assessor);
    return q.order("recebido_em", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: CasoRelatorio[] | null; error: { message: string } | null }>;
  }, 20_000);
}
