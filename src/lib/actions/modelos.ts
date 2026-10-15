"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const CATS = ["peticao", "procuracao", "contrato", "declaracao", "notificacao", "parecer", "recibo", "oficio", "outro"] as const;

const modeloSchema = z.object({
  titulo: zs.required("Título", 200),
  categoria: zs.enumOf([...CATS]),
  area: z.union([z.enum(["civel", "consumidor", "trabalhista", "tributario", "previdenciario", "familia", "criminal", "administrativo", "empresarial", "bancario", "outro"]), z.literal("")]).optional().transform((v) => v || null),
  descricao: zs.text(500),
  conteudo: z.string().trim().min(2, "Escreva o conteúdo do modelo").max(200_000),
  departamento_id: zs.uuid(),
  ativo: zs.bool(),
});

export async function saveModelo(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("modelos.write");
  if ("denied" in g) return g.denied;
  const parsed = modeloSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const id = formData.get("id");
  const supabase = await createClient();
  const q = isUuid(id) ? supabase.from("modelos_documentos").update(parsed.data).eq("id", id) : supabase.from("modelos_documentos").insert(parsed.data);
  const { data, error } = await q.select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Somente o autor ou a gestão podem alterar este modelo." };
  revalidatePath("/modelos");
  return { ok: true, message: isUuid(id) ? "Modelo atualizado." : "Modelo criado.", id: data.id };
}

export async function duplicarModelo(id: string): Promise<ActionState> {
  const g = await guard("modelos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Modelo inválido." };
  const supabase = await createClient();
  const { data: m } = await supabase.from("modelos_documentos").select("titulo, categoria, area, descricao, conteudo, departamento_id").eq("id", id).maybeSingle();
  if (!m) return { error: "Modelo não encontrado." };
  const { error } = await supabase.from("modelos_documentos").insert({ ...m, titulo: `${m.titulo} (cópia)`.slice(0, 200) });
  if (error) return dbError(error);
  revalidatePath("/modelos");
  return { ok: true, message: "Modelo duplicado — edite a cópia." };
}

export async function deleteModelo(id: string): Promise<ActionState> {
  const g = await guard("modelos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Modelo inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("modelos_documentos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Somente o autor ou a gestão podem excluir este modelo." };
  revalidatePath("/modelos");
  return { ok: true, message: "Modelo excluído." };
}

/** Registra no processo que um documento foi gerado a partir de um modelo. */
export async function registrarDocumentoGerado(processoId: string, titulo: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(processoId)) return { error: "Processo inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("processo_andamentos").insert({ processo_id: processoId, tipo: "peticao", descricao: `Documento gerado: ${titulo.slice(0, 200)}`, autor_id: g.session.userId });
  if (error) return error.code === "42501" ? { error: "Sem permissão neste processo." } : dbError(error);
  revalidatePath(`/processos/${processoId}`);
  return { ok: true, message: "Registrado nos andamentos do processo." };
}
