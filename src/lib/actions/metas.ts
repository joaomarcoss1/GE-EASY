"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const TIPOS = ["consorcio_credito", "seguro_premio", "novos_clientes", "comissao"] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function revalidate() {
  revalidatePath("/metas");
  revalidatePath("/dashboard");
}

const metaSchema = z
  .object({
    periodo: z.string({ error: "Informe o mês" }).trim().regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, "Mês inválido"),
    tipo: zs.enumOf([...TIPOS], "Selecione o tipo de meta"),
    consultor_id: zs.uuid(),
    valor_meta: zs.money().refine((v) => v !== null && v > 0, "Informe um valor maior que zero"),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "novos_clientes" && v.valor_meta !== null && !Number.isInteger(v.valor_meta)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor_meta"], message: "Informe um número inteiro de clientes" });
    }
  })
  .transform((v) => ({
    periodo: `${v.periodo.slice(0, 7)}-01`,
    tipo: v.tipo,
    consultor_id: v.consultor_id ?? null,
    valor_meta: v.valor_meta as number,
  }));

const DUP = { error: "Já existe uma meta deste tipo para este consultor/equipe no mês.", fieldErrors: { tipo: "Meta já cadastrada" } };

export async function createMeta(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  const parsed = metaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("metas").insert(parsed.data).select("id").single();
  if (error) return error.code === "23505" ? DUP : dbError(error);
  revalidate();
  return { ok: true, message: "Meta cadastrada.", id: data.id };
}

export async function updateMeta(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Meta inválida." };
  const parsed = metaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("metas").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) return error.code === "23505" ? DUP : dbError(error);
  if (!data) return { error: "Meta não encontrada ou sem permissão." };
  revalidate();
  return { ok: true, message: "Meta atualizada.", id };
}

export async function deleteMeta(id: string): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Meta inválida." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("metas").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Meta não encontrada ou sem permissão." };
  revalidate();
  return { ok: true, message: "Meta excluída." };
}

/** Copia as metas do mês anterior para `mes` (YYYY-MM), sem sobrescrever as já existentes. */
export async function copiarMetasMesAnterior(mes: string): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  if (typeof mes !== "string" || !MONTH_RE.test(mes)) return { error: "Mês inválido." };
  const [y, m] = mes.split("-").map(Number);
  const anterior = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const destino = `${mes}-01`;

  const supabase = await createClient();
  const [{ data: origem, error: e1 }, { data: existentes, error: e2 }] = await Promise.all([
    supabase.from("metas").select("consultor_id, tipo, valor_meta").eq("periodo", anterior),
    supabase.from("metas").select("consultor_id, tipo").eq("periodo", destino),
  ]);
  if (e1 || e2) return dbError(e1 ?? e2);
  if (!origem?.length) return { error: "Não há metas no mês anterior para copiar." };

  const key = (r: { consultor_id: string | null; tipo: string }) => `${r.consultor_id ?? "equipe"}|${r.tipo}`;
  const ja = new Set((existentes ?? []).map(key));
  const novas = origem.filter((r) => !ja.has(key(r))).map((r) => ({ consultor_id: r.consultor_id, tipo: r.tipo, valor_meta: r.valor_meta, periodo: destino }));
  if (!novas.length) return { ok: true, message: "Todas as metas do mês anterior já existem neste mês." };

  const { error } = await supabase.from("metas").insert(novas);
  if (error) return error.code === "23505" ? { error: "Algumas metas já existiam. Atualize a página e tente novamente." } : dbError(error);
  revalidate();
  return { ok: true, message: `${novas.length} meta(s) copiada(s) do mês anterior.` };
}
