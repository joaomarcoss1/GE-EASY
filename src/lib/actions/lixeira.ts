"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, isUuid } from "./utils";
import type { ActionState } from "./types";

const TABELAS = new Set(["clientes", "processos", "documentos", "oportunidades"]);

/** Restaura um registro da lixeira. `chave` = "<tabela>:<id>". A restauração é auditada pelo banco. */
export async function restaurarDaLixeira(chave: string): Promise<ActionState> {
  const g = await guard("lixeira.gerir");
  if ("denied" in g) return g.denied;
  const [tabela, id] = chave.split(":");
  if (!TABELAS.has(tabela) || !isUuid(id)) return { error: "Registro inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("lixeira_restaurar", { p_tabela: tabela, p_id: id });
  if (error) return { error: error.code === "P0001" ? error.message : "Não foi possível restaurar." };
  revalidatePath("/lixeira");
  revalidatePath(`/${tabela}`);
  return { ok: true, message: "Registro restaurado." };
}
