import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Parâmetros de rotas, check-in e reembolso da empresa ativa (Configurações › Rotas), com padrões da especificação. */
interface ParametrosRotas {
  raio_m: number;
  fora_do_raio: "justificar" | "bloquear";
  reembolso_modo: "km" | "consumo";
  valor_km: number;
  consumo_km_l: number;
  preco_combustivel: number;
  fator_rodoviario: number;
  exigir_hodometro: boolean;
  exigir_selfie: boolean;
  rastreio: boolean;
}

const PADRAO_ROTAS: ParametrosRotas = {
  raio_m: 150,
  fora_do_raio: "justificar",
  reembolso_modo: "km",
  valor_km: 0.9,
  consumo_km_l: 10,
  preco_combustivel: 6,
  fator_rodoviario: 1.3,
  exigir_hodometro: false,
  exigir_selfie: false,
  rastreio: false,
};

const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

export function normalizarRotas(v: Partial<ParametrosRotas> | null | undefined): ParametrosRotas {
  const p = v ?? {};
  return {
    raio_m: num(p.raio_m, PADRAO_ROTAS.raio_m, 20, 5000),
    fora_do_raio: p.fora_do_raio === "bloquear" ? "bloquear" : "justificar",
    reembolso_modo: p.reembolso_modo === "consumo" ? "consumo" : "km",
    valor_km: num(p.valor_km, PADRAO_ROTAS.valor_km, 0, 50),
    consumo_km_l: num(p.consumo_km_l, PADRAO_ROTAS.consumo_km_l, 1, 100),
    preco_combustivel: num(p.preco_combustivel, PADRAO_ROTAS.preco_combustivel, 0, 100),
    fator_rodoviario: num(p.fator_rodoviario, PADRAO_ROTAS.fator_rodoviario, 1, 3),
    exigir_hodometro: p.exigir_hodometro === true,
    exigir_selfie: p.exigir_selfie === true,
    rastreio: p.rastreio === true,
  };
}

export const parametrosRotas = cache(async (): Promise<ParametrosRotas> => {
  const supabase = await createClient();
  const { data } = await supabase.from("configuracoes").select("valor").eq("chave", "rotas").maybeSingle();
  return normalizarRotas(data?.valor as Partial<ParametrosRotas> | null);
});
