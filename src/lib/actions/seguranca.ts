"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, zodErrors } from "./utils";
import type { ActionState } from "./types";

const politicaSchema = z.object({
  inatividade_min: z.coerce.number().int().min(5, "Mínimo de 5 minutos").max(240, "Máximo de 240 minutos"),
  exigir_2fa: z.enum(["nenhum", "gestao", "todos"]),
});

/** Política de segurança do escritório (somente administrador; RLS: config_write = is_admin). */
export async function salvarPoliticaSeguranca(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = politicaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").upsert({ chave: "seguranca", valor: parsed.data }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Política de segurança atualizada." };
}
