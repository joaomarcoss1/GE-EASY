"use server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AREA_COOKIE, EMPRESA_COOKIE, isEmpresaId } from "@/lib/tenant";
import type { ActionState } from "./types";

const COOKIE = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 180 };

/**
 * Troca a empresa ativa: confere o vínculo ativo, grava como empresa padrão (vale também para Realtime e
 * Storage, que não recebem o cabeçalho) e registra o acesso. O banco revalida o vínculo a cada requisição.
 */
export async function trocarEmpresa(id: string): Promise<ActionState> {
  if (!isEmpresaId(id)) return { error: "Empresa inválida." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  const { data: vinculo } = await supabase.from("empresa_membros").select("empresa_id").eq("user_id", user.id).eq("empresa_id", id).eq("ativo", true).maybeSingle();
  if (!vinculo) return { error: "Você não tem acesso a esta empresa." };
  const { error } = await supabase.from("profiles").update({ empresa_padrao_id: id }).eq("id", user.id);
  if (error) return { error: "Não foi possível trocar de empresa." };
  const store = await cookies();
  store.set(EMPRESA_COOKIE, id, COOKIE);
  store.delete(AREA_COOKIE);
  await supabase.rpc("registrar_acesso", { p_acao: "TROCA_EMPRESA", p_tabela: "empresas", p_registro: id, p_detalhes: null });
  return { ok: true, message: "Empresa alterada." };
}
