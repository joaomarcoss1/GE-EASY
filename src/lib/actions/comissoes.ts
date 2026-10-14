"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const STATUS = ["prevista", "recebida", "paga", "estornada"] as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

function revalidate() {
  revalidatePath("/comissoes");
  revalidatePath("/dashboard");
  revalidatePath("/metas");
}

const updateSchema = z.object({
  status: zs.enumOf([...STATUS], "Selecione o status"),
  data_recebimento: zs.date(),
  data_pagamento: zs.date(),
  percentual_consultor: zs.number(0, 100),
  observacoes: zs.text(2000),
});

export async function updateComissao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("comissoes.manage");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Comissão inválida." };
  const parsed = updateSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: atual, error: readErr } = await supabase.from("comissoes").select("valor_corretora, percentual_consultor").eq("id", id).single();
  if (readErr || !atual) return dbError(readErr);

  const pctConsultor = v.percentual_consultor ?? Number(atual.percentual_consultor);
  const today = todayISO();
  const patch = {
    status: v.status,
    percentual_consultor: pctConsultor,
    valor_consultor: round2((Number(atual.valor_corretora) * pctConsultor) / 100),
    data_recebimento: v.data_recebimento ?? (v.status === "recebida" || v.status === "paga" ? today : null),
    data_pagamento: v.data_pagamento ?? (v.status === "paga" ? today : null),
    observacoes: v.observacoes ?? null,
  };
  const { error } = await supabase.from("comissoes").update(patch).eq("id", id);
  if (error) return dbError(error);
  revalidate();
  return { ok: true, message: "Comissão atualizada.", id };
}

const bulkSchema = z.object({
  ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).min(1, "Selecione ao menos uma comissão.").max(500, "Selecione no máximo 500 comissões por vez."),
  status: zs.enumOf([...STATUS]),
});

/** Altera o status em lote. Recebida => data_recebimento = hoje; paga => data_pagamento = hoje. */
export async function bulkSetStatus(ids: string[], status: string): Promise<ActionState> {
  const g = await guard("comissoes.manage");
  if ("denied" in g) return g.denied;
  const parsed = bulkSchema.safeParse({ ids, status });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Seleção inválida." };
  const { ids: list, status: st } = parsed.data;
  const today = todayISO();
  const supabase = await createClient();

  const patch: Record<string, unknown> = { status: st };
  if (st === "recebida") patch.data_recebimento = today;
  if (st === "paga") patch.data_pagamento = today;
  if (st === "prevista") Object.assign(patch, { data_recebimento: null, data_pagamento: null });

  let q = supabase.from("comissoes").update(patch, { count: "exact" }).in("id", list);
  // Estornadas só voltam ao fluxo por edição individual.
  if (st === "recebida" || st === "paga") q = q.neq("status", "estornada");
  const { error, count } = await q;
  if (error) return dbError(error);

  if (st === "paga") {
    // Pagar ao consultor pressupõe o recebimento: preenche a data se ainda vazia.
    const { error: e2 } = await supabase.from("comissoes").update({ data_recebimento: today }).in("id", list).eq("status", "paga").is("data_recebimento", null);
    if (e2) return dbError(e2);
  }
  revalidate();
  const label = { prevista: "previstas", recebida: "recebidas", paga: "pagas", estornada: "estornadas" }[st];
  if (!count) return { error: "Nenhuma comissão foi alterada (sem permissão ou já estornadas)." };
  return { ok: true, message: `${count} comissão(ões) marcada(s) como ${label}.` };
}

const manualSchema = z.object({
  linha: zs.enumOf(["consorcio", "seguro"], "Selecione a linha"),
  cliente_id: zs.uuid(),
  consultor_id: zs.uuid(),
  descricao: zs.required("Descrição", 300),
  competencia: z
    .string({ required_error: "Informe a competência" })
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, "Competência inválida"),
  base_calculo: zs.money().refine((v) => v !== null && v > 0, "Informe a base de cálculo"),
  percentual_corretora: zs.number(0, 100).refine((v) => v !== null, "Informe o % da corretora"),
  percentual_consultor: zs.number(0, 100),
  status: zs.enumOf([...STATUS]).optional(),
  observacoes: zs.text(2000),
});

export async function createComissaoManual(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("comissoes.manage");
  if ("denied" in g) return g.denied;
  const parsed = manualSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();

  let pctConsultor = v.percentual_consultor;
  if (pctConsultor === null && v.consultor_id) {
    const { data: p } = await supabase.from("profiles").select("comissao_percentual").eq("id", v.consultor_id).maybeSingle();
    pctConsultor = Number(p?.comissao_percentual ?? 0);
  }
  pctConsultor ??= 0;
  const base = v.base_calculo as number;
  const pctCorretora = v.percentual_corretora as number;
  const valorCorretora = round2((base * pctCorretora) / 100);
  const status = v.status ?? "prevista";
  const today = todayISO();

  const { data: row, error } = await supabase
    .from("comissoes")
    .insert({
      linha: v.linha,
      cliente_id: v.cliente_id ?? null,
      consultor_id: v.consultor_id ?? null,
      descricao: v.descricao,
      competencia: `${v.competencia.slice(0, 7)}-01`,
      base_calculo: base,
      percentual_corretora: pctCorretora,
      valor_corretora: valorCorretora,
      percentual_consultor: pctConsultor,
      valor_consultor: round2((valorCorretora * pctConsultor) / 100),
      status,
      data_recebimento: status === "recebida" || status === "paga" ? today : null,
      data_pagamento: status === "paga" ? today : null,
      observacoes: v.observacoes ?? null,
    })
    .select("id")
    .single();
  if (error) return dbError(error);
  revalidate();
  return { ok: true, message: "Comissão lançada.", id: row.id };
}
