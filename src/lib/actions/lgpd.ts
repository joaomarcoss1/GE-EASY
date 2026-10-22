"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dbError, guard, isUuid, limitar, registrarAcesso } from "./utils";
import type { ActionState } from "./types";

/**
 * LGPD art. 18, IV e VI: anonimização dos dados pessoais do titular quando não há
 * mais finalidade (sem processos ativos nem contrato vigente). Remove também os arquivos
 * do armazenamento. A regra de negócio e a permissão (somente administrador) estão no banco.
 */
export async function anonimizarCliente(id: string, confirmacao?: string): Promise<ActionState> {
  const g = await guard("lgpd.anonimizar");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cliente inválido." };
  if (confirmacao !== undefined && confirmacao.trim().toUpperCase() !== "ANONIMIZAR") return { error: 'Digite "ANONIMIZAR" para confirmar.' };
  const bloqueio = await limitar("lgpd-anonimizar", 10, 3600);
  if (bloqueio) return bloqueio;
  const supabase = await createClient();
  // a função apaga definitivamente os registros dos documentos (inclusive os da lixeira) e devolve os caminhos
  const { data, error } = await supabase.rpc("anonimizar_cliente", { p_cliente: id });
  if (error) return error.code === "P0001" ? { error: error.message } : dbError(error);
  const r = (data ?? {}) as { rotulo?: string; caminhos?: string[] };
  const caminhos = (r.caminhos ?? []).filter((p): p is string => !!p);
  if (caminhos.length) {
    const { error: rmErr } = await supabase.storage.from("documentos").remove(caminhos);
    if (rmErr) console.error("[lgpd] arquivos não removidos", rmErr.message);
  }
  await registrarAcesso("LGPD_ANONIMIZACAO", "clientes", id, { documentos_removidos: caminhos.length });
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  return { ok: true, message: `Dados pessoais anonimizados (${r.rotulo ?? "titular"}). Arquivos do armazenamento removidos; cópias no Drive devem ser apagadas manualmente.` };
}
