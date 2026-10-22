import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Option } from "@/lib/constants";
import type { Profile } from "@/lib/types";

/** Listas de apoio para selects e nomes (cacheadas por requisição). */

export const getProfiles = cache(async () => {
  const supabase = await createClient();
  // membros = usuários da empresa ativa, com papel e situação do vínculo
  const { data } = await supabase.from("membros").select("id, full_name, email, role, active, avatar_url, territorio, comissao_percentual").order("full_name");
  return (data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "role" | "active" | "avatar_url" | "territorio" | "comissao_percentual">[];
});

export const getProfileMap = cache(async () => new Map((await getProfiles()).map((p) => [p.id, p])));

export async function consultorOptions(): Promise<Option[]> {
  return (await getProfiles())
    .filter((p) => p.active && ["consultor", "consultor_externo", "gestor", "admin"].includes(p.role))
    .map((p) => ({ value: p.id, label: p.full_name || p.email }));
}

export async function userOptions(): Promise<Option[]> {
  return (await getProfiles()).filter((p) => p.active).map((p) => ({ value: p.id, label: p.full_name || p.email }));
}

export const parceiroOptions = cache(async (tipo: "administradora" | "seguradora"): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("parceiros").select("id, nome").eq("tipo", tipo).eq("ativo", true).order("nome");
  return (data ?? []).map((p) => ({ value: p.id, label: p.nome }));
});

export const produtoOptions = cache(async (linha: "consorcio" | "seguro"): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("produtos").select("id, nome, categoria").eq("linha", linha).eq("ativo", true).order("nome");
  return (data ?? []).map((p) => ({ value: p.id, label: p.nome }));
});

export const clienteOptions = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("clientes").select("id, nome, documento").order("nome").limit(1000);
  return (data ?? []).map((c) => ({ value: c.id, label: c.documento ? `${c.nome} · ${c.documento}` : c.nome }));
});

export const parceiroMap = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("parceiros").select("id, nome, tipo");
  return new Map((data ?? []).map((p) => [p.id as string, p.nome as string]));
});

/** Paginação padrão a partir de searchParams */
export function pageRange(page: string | undefined, size = 20) {
  const p = Math.max(1, Number(page) || 1);
  return { page: p, size, from: (p - 1) * size, to: p * size - 1 };
}

/** Sanitiza termo de busca para filtros .or() do PostgREST */
export function searchTerm(q: string | undefined) {
  return (q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
}

export const departamentoOptions = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("departamentos").select("id, nome, sigla").eq("ativo", true).order("nome");
  return (data ?? []).map((d) => ({ value: d.id, label: d.sigla ? `${d.nome} (${d.sigla})` : d.nome }));
});

export const departamentoMap = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("departamentos").select("id, nome, sigla, cor");
  return new Map((data ?? []).map((d) => [d.id as string, d as { id: string; nome: string; sigla: string | null; cor: string }]));
});

/** Advogados, assistentes e gestão (responsáveis por processos, prazos e audiências) */
export async function juridicoOptions(): Promise<Option[]> {
  return (await getProfiles())
    .filter((p) => p.active && ["admin", "gestor", "advogado", "assistente_juridico"].includes(p.role))
    .map((p) => ({ value: p.id, label: p.full_name || p.email }));
}

export const processoOptions = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("processos").select("id, titulo, numero_cnj").in("status", ["ativo", "suspenso"]).order("updated_at", { ascending: false }).limit(1000);
  return (data ?? []).map((p) => ({ value: p.id, label: p.numero_cnj ? `${p.titulo} · ${p.numero_cnj}` : p.titulo }));
});
