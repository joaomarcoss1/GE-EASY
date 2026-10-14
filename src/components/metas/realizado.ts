import type { MetaTipo } from "@/lib/types";

/**
 * Cálculo do "realizado" de metas a partir de linhas já filtradas para o mês
 * (e já restritas pelo RLS do usuário).
 * - consorcio_credito: cotas ativa/contemplada/quitada com data_adesao no mês
 * - seguro_premio: apólices vigente/renovada com inicio_vigencia no mês
 * - novos_clientes: clientes criados no mês
 * - comissao: valor_corretora das comissões (não estornadas) da competência
 */
export interface RealizadoRows {
  cotas: { valor_credito: number | string; consultor_id: string | null; status: string }[];
  apolices: { premio_liquido: number | string; consultor_id: string | null }[];
  clientes: { consultor_id: string | null }[];
  comissoes: { valor_corretora: number | string; consultor_id: string | null }[];
}

export const COTA_STATUS_META = ["ativa", "contemplada", "quitada"];

export function realizadoMeta(tipo: MetaTipo, consultorId: string | null, rows: RealizadoRows): number {
  const own = <T extends { consultor_id: string | null }>(list: T[]) => (consultorId ? list.filter((r) => r.consultor_id === consultorId) : list);
  let v = 0;
  switch (tipo) {
    case "consorcio_credito":
      v = own(rows.cotas)
        .filter((c) => COTA_STATUS_META.includes(c.status))
        .reduce((a, c) => a + Number(c.valor_credito), 0);
      break;
    case "seguro_premio":
      v = own(rows.apolices).reduce((a, c) => a + Number(c.premio_liquido), 0);
      break;
    case "novos_clientes":
      v = own(rows.clientes).length;
      break;
    case "comissao":
      v = own(rows.comissoes).reduce((a, c) => a + Number(c.valor_corretora), 0);
      break;
  }
  return Math.round(v * 100) / 100;
}

export const isCountMeta = (tipo: MetaTipo) => tipo === "novos_clientes";
