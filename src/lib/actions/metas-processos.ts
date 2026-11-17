"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const schema = z
  .object({
    id: zs.uuid(),
    nome: zs.required("Nome da meta", 120),
    indicador: zs.enumOf(["processos_novos", "habilitados", "judicializados", "analises", "ligacoes"], "Escolha o indicador"),
    periodicidade: zs.enumOf(["diaria", "mensal", "anual"], "Escolha o período"),
    alvo: zs.enumOf(["empresa", "assessor", "categoria"], "Escolha para quem é a meta"),
    assessor_id: zs.uuid(),
    categoria: zs.text(20),
    valor: zs.number(1, 1_000_000).refine((v) => v !== null && Number.isInteger(v), "Informe um número inteiro maior que zero"),
    ativo: zs.bool(),
  })
  .superRefine((v, ctx) => {
    if (v.alvo === "assessor" && !v.assessor_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assessor_id"], message: "Escolha o assessor" });
    if (v.alvo === "categoria" && !["consultor", "corretor", "diretoria"].includes(v.categoria ?? "")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoria"], message: "Escolha a categoria" });
    if (v.indicador === "ligacoes" && v.alvo === "empresa") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["alvo"], message: "Ligações são medidas por pessoa: escolha um assessor ou uma categoria" });
  })
  .transform((v) => ({
    id: v.id,
    nome: v.nome,
    indicador: v.indicador,
    periodicidade: v.periodicidade,
    alvo: v.alvo,
    assessor_id: v.alvo === "assessor" ? v.assessor_id! : null,
    categoria: v.alvo === "categoria" ? v.categoria! : null,
    valor: v.valor as number,
    ativo: v.ativo,
  }));

function atualizar() {
  revalidatePath("/metas/processos");
  revalidatePath("/dashboard");
}

/** Cria ou edita uma meta de processos (recorrente: vale para todo dia/mês/ano até ser desativada). */
export async function salvarMetaProcesso(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  const form = formToObject(formData);
  const parsed = schema.safeParse({ ...form, ativo: form.id ? form.ativo : "on" });
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...dados } = parsed.data;
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("metas_processos").update(dados).eq("id", id).select("id").maybeSingle()
    : await supabase.from("metas_processos").insert(dados).select("id").single();
  if (error) return dbError(error);
  if (!data) return { error: "Meta não encontrada ou sem permissão." };
  atualizar();
  return { ok: true, message: id ? "Meta atualizada." : "Meta criada.", id: data.id };
}

export async function excluirMetaProcesso(id: string): Promise<ActionState> {
  const g = await guard("metas.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Meta inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("metas_processos").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return { error: "Meta não encontrada ou sem permissão." };
  atualizar();
  return { ok: true, message: "Meta excluída." };
}
