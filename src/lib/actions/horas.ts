"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/** "1:30", "1h30", "1,5" ou "90min" → minutos */
function parseDuracao(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})?\s*m?i?n?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = s.match(/^(\d{1,4})\s*min$/);
  if (m) return Number(m[1]);
  const dec = Number(s.replace(",", "."));
  if (Number.isFinite(dec) && dec > 0) return Math.round(dec * 60);
  return null;
}

const horaSchema = z
  .object({
    data: zs.date().refine((v) => !!v, "Informe a data"),
    duracao: z.string().trim().max(20).optional(),
    minutos: zs.number(1, 1440),
    descricao: zs.required("Descrição", 2000),
    processo_id: zs.uuid(),
    cliente_id: zs.uuid(),
    contrato_id: zs.uuid(),
    faturavel: zs.bool(),
    valor_hora: zs.money(),
  })
  .transform((v, ctx) => {
    const minutos = v.minutos ?? parseDuracao(v.duracao);
    if (!minutos || minutos < 1 || minutos > 1440) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duracao"], message: "Informe a duração (ex.: 1:30 ou 1,5)" });
      return z.NEVER;
    }
    const { duracao: _d, ...rest } = v;
    void _d;
    return { ...rest, minutos: Math.round(minutos) };
  });

function revalidar() {
  revalidatePath("/horas");
  revalidatePath("/contratos");
}

export async function lancarHoras(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("horas.lancar");
  if ("denied" in g) return g.denied;
  const parsed = horaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  let { cliente_id } = parsed.data;
  if (!cliente_id && parsed.data.processo_id) {
    const { data: p } = await supabase.from("processos").select("cliente_id").eq("id", parsed.data.processo_id).maybeSingle();
    cliente_id = p?.cliente_id ?? null;
  }
  const id = formData.get("id");
  const row = { ...parsed.data, cliente_id };
  const q = isUuid(id) ? supabase.from("horas_lancamentos").update(row).eq("id", id) : supabase.from("horas_lancamentos").insert({ ...row, user_id: g.session.userId });
  const { data, error } = await q.select("id").maybeSingle();
  if (error) return error.code === "42501" ? { error: "Sem permissão (horas já faturadas não podem ser alteradas)." } : dbError(error);
  if (!data) return { error: "Sem permissão para alterar este lançamento." };
  revalidar();
  const h = Math.floor(row.minutos / 60), m = row.minutos % 60;
  return { ok: true, message: `${h}h${String(m).padStart(2, "0")} lançadas.` };
}

export async function deleteHoras(id: string): Promise<ActionState> {
  const g = await guard("horas.lancar");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lançamento inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("horas_lancamentos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Horas já faturadas não podem ser excluídas." };
  revalidar();
  return { ok: true, message: "Lançamento excluído." };
}

/**
 * Fatura horas: soma minutos × valor da hora (da própria linha ou do contrato) e cria
 * UMA receita por cliente no financeiro; marca as horas como faturadas.
 */
export async function faturarHoras(ids: string[], contratoId?: string | null): Promise<ActionState> {
  const g = await guard("horas.gerir");
  if ("denied" in g) return g.denied;
  const valid = ids.filter(isUuid).slice(0, 1000);
  if (!valid.length) return { error: "Nenhuma hora selecionada." };
  const supabase = await createClient();
  const { data: horas } = await supabase
    .from("horas_lancamentos")
    .select("id, minutos, valor_hora, cliente_id, processo_id, contrato_id, faturavel, faturado")
    .in("id", valid)
    .eq("faturado", false)
    .eq("faturavel", true);
  if (!horas?.length) return { error: "Nenhuma hora faturável pendente na seleção." };

  const contratoIds = [...new Set([contratoId, ...horas.map((h) => h.contrato_id)].filter((v): v is string => isUuid(v)))];
  const { data: contratos } = contratoIds.length ? await supabase.from("contratos_honorarios").select("id, valor_hora, titulo").in("id", contratoIds) : { data: [] };
  const valorContrato = new Map((contratos ?? []).map((c) => [c.id, Number(c.valor_hora ?? 0)]));

  const porCliente = new Map<string, { minutos: number; valor: number; ids: string[]; processo: string | null; contrato: string | null }>();
  const semValor: string[] = [];
  for (const h of horas) {
    const vh = Number(h.valor_hora ?? 0) || valorContrato.get(h.contrato_id ?? "") || valorContrato.get(contratoId ?? "") || 0;
    if (!vh) {
      semValor.push(h.id);
      continue;
    }
    const k = h.cliente_id ?? "sem-cliente";
    const cur = porCliente.get(k) ?? { minutos: 0, valor: 0, ids: [] as string[], processo: h.processo_id, contrato: h.contrato_id ?? contratoId ?? null };
    cur.minutos += h.minutos;
    cur.valor += (h.minutos / 60) * vh;
    cur.ids.push(h.id);
    porCliente.set(k, cur);
  }
  if (!porCliente.size) return { error: "Defina o valor da hora (no lançamento ou no contrato) antes de faturar." };

  let criados = 0;
  for (const [cliente, v] of porCliente) {
    const { data: lanc, error } = await supabase
      .from("financeiro_lancamentos")
      .insert({
        tipo: "receita",
        categoria: "Honorários contratuais",
        descricao: `Honorários por hora — ${(v.minutos / 60).toFixed(1).replace(".", ",")} h`,
        valor: Math.round(v.valor * 100) / 100,
        vencimento: todayISO(),
        cliente_id: cliente === "sem-cliente" ? null : cliente,
        processo_id: v.processo,
        contrato_id: v.contrato,
      })
      .select("id")
      .single();
    if (error) return dbError(error);
    await supabase.from("horas_lancamentos").update({ faturado: true, lancamento_id: lanc.id }).in("id", v.ids);
    criados++;
  }
  revalidar();
  revalidatePath("/financeiro");
  if (contratoId) revalidatePath(`/contratos/${contratoId}`);
  return { ok: true, message: `${criados} cobrança(s) criada(s) no financeiro${semValor.length ? ` · ${semValor.length} lançamento(s) sem valor da hora ficaram pendentes` : ""}.` };
}
