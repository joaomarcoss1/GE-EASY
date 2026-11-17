import "server-only";
import type { FieldDef } from "@/components/ui/form";
import { ROTA_OBJETIVOS, type Option } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { userOptions } from "@/lib/data";

export interface OpcoesRota {
  cidades: Option[];
  corretores: Option[];
  usuarios: Option[];
}

/** Cidades já lançadas no sistema (processos e clientes), assessores/corretores e usuários para a rota. */
export async function opcoesRota(): Promise<OpcoesRota> {
  const supabase = await createClient();
  const [{ data: op }, { data: cli }, { data: ass }, usuarios] = await Promise.all([
    supabase.rpc("cliente_casos_opcoes"),
    supabase.from("clientes").select("cidade, uf").not("cidade", "is", null).limit(5000),
    supabase.from("assessores").select("id, nome, categoria").eq("ativo", true).order("nome"),
    userOptions(),
  ]);
  const nomes = new Map<string, string>();
  const chave = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  for (const c of ((op as { cidades?: string[] } | null)?.cidades ?? [])) if (c?.trim()) nomes.set(chave(c), c.trim());
  for (const c of cli ?? []) if (c.cidade?.trim() && !nomes.has(chave(c.cidade))) nomes.set(chave(c.cidade), c.cidade.trim());
  return {
    cidades: [...nomes.values()].sort((a, b) => a.localeCompare(b, "pt-BR")).map((c) => ({ value: c, label: c })),
    corretores: (ass ?? []).map((a) => ({ value: a.id as string, label: `${a.nome}${a.categoria === "corretor" ? "" : ` (${a.categoria})`}` })),
    usuarios,
  };
}

export function rotaFields(o: OpcoesRota & { consultores: Option[]; veiculos: Option[] }): FieldDef[] {
  return [
    { name: "nome", label: "Nome da rota", required: true, span: 6, placeholder: "Ex.: Imperatriz e Açailândia — pendências" },
    { name: "data", label: "Data", type: "date", required: true, span: 3 },
    { name: "consultor_id", label: "Consultor responsável", type: "select", options: o.consultores, required: true, span: 3 },
    { name: "objetivo_tipo", label: "Objetivo da rota", type: "select", options: ROTA_OBJETIVOS, required: true, span: 6 },
    { name: "cidades", label: "Cidades da rota", type: "multiselect", options: o.cidades, required: true, span: 6, help: "Cidades já lançadas no sistema (clientes e processos)." },
    { name: "corretores", label: "Corretor(es) a atender", type: "multiselect", options: o.corretores, span: 6, help: "Obrigatório quando o objetivo é atender corretor." },
    { name: "objetivo", label: "Motivo da rota", type: "textarea", rows: 3, required: true, span: 6, placeholder: "Explique o motivo: quem será visitado, o que resolver, o que levar." },
    { name: "veiculo_id", label: "Veículo", type: "select", options: o.veiculos, span: 6, help: "Com veículo, o consultor faz o checklist (km, tanque e foto do painel) na saída e na chegada." },
    { name: "participantes", label: "Quem mais vai na rota", type: "multiselect", options: o.usuarios, span: 6, help: "Todos assinam o relatório no fim da rota." },
  ];
}
