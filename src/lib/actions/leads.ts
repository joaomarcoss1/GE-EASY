"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { DISTRIBUICAO_CRITERIOS, LEAD_ORIGENS, LEAD_STATUS } from "@/lib/constants";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Leads (fase 6): captação com deduplicação/pontuação/distribuição feitas no banco (novo_lead, capturar_lead),
 * qualificação pelo responsável, conversão em cliente, regras de distribuição, formulários públicos e
 * páginas de Lead Ads. As travas de visibilidade são do RLS.
 */
const atualizar = () => revalidatePath("/leads");
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);

const leadSchema = z.object({
  nome: zs.required("Nome", 200),
  telefone: zs.text(30).refine((v) => !v || [10, 11, 12, 13].includes(onlyDigits(v).length), "Telefone inválido"),
  email: zs.text(200).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
  documento: zs.text(20).refine((v) => !v || isValidCPF(onlyDigits(v)) || onlyDigits(v).length === 14, "CPF/CNPJ inválido"),
  cidade: zs.text(120),
  uf: zs.text(2),
  origem: z.string().refine((v) => LEAD_ORIGENS.some((o) => o.value === v), "Origem inválida"),
  campanha: zs.text(200),
  interesse: zs.text(500),
  renda: zs.money(),
  mensagem: zs.text(4000),
});

export async function novoLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.write");
  if ("denied" in g) return g.denied;
  const parsed = leadSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (!parsed.data.telefone && !parsed.data.documento && !parsed.data.email) return { error: "Informe telefone, CPF ou e-mail.", fieldErrors: { telefone: "Informe um contato" } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("novo_lead", { p_dados: { ...parsed.data, renda: parsed.data.renda != null ? String(parsed.data.renda) : null } });
  if (error) return erroDb(error);
  atualizar();
  const r = data as { lead_id: string; novo: boolean };
  return { ok: true, id: r.lead_id, message: r.novo ? "Lead cadastrado e distribuído." : "Já existia um lead com este contato: os dados foram atualizados." };
}

const etapaSchema = z.object({
  id: zs.requiredUuid("o lead"),
  status: z.string().refine((v) => LEAD_STATUS.some((o) => o.value === v && v !== "convertido"), "Etapa inválida"),
  motivo_descarte: zs.text(500),
  observacoes: zs.text(4000),
  interesse: zs.text(500),
});

export async function atualizarLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.write");
  if ("denied" in g) return g.denied;
  const parsed = etapaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  if (v.status === "descartado" && !v.motivo_descarte) return { error: "Informe o motivo do descarte.", fieldErrors: { motivo_descarte: "Obrigatório para descartar" } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").update(v).eq("id", id).neq("status", "convertido").select("id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Lead não encontrado, já convertido ou de outro responsável." };
  atualizar();
  return { ok: true, message: "Lead atualizado." };
}

export async function converterLead(id: string): Promise<ActionState> {
  const g = await guard("leads.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Lead inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("converter_lead", { p_lead: id });
  if (error) return erroDb(error);
  atualizar();
  revalidatePath("/clientes");
  return { ok: true, id: data as string, message: "Lead convertido em cliente (pré-cadastro). O prazo de documentação começa a contar." };
}

const atribuirSchema = z.object({ id: zs.requiredUuid("o lead"), responsavel_id: zs.requiredUuid("o responsável") });

export async function atribuirLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.distribuir");
  if ("denied" in g) return g.denied;
  const parsed = atribuirSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").update({ responsavel_id: parsed.data.responsavel_id }).eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Lead não encontrado." };
  atualizar();
  return { ok: true, message: "Lead redistribuído; o novo responsável foi avisado." };
}

const regraSchema = z.object({
  id: zs.uuid(),
  ordem: zs.number(1, 1000),
  nome: zs.required("Nome", 120),
  criterio: z.string().refine((v) => DISTRIBUICAO_CRITERIOS.some((o) => o.value === v), "Critério inválido"),
  valor: zs.text(200),
  departamento_id: zs.uuid(),
  modo: zs.enumOf(["rodizio", "menor_carga"]),
  aplica_leads: zs.bool(),
  aplica_whatsapp: zs.bool(),
  ativo: zs.bool(),
});

export async function salvarRegra(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.distribuir");
  if ("denied" in g) return g.denied;
  const parsed = regraSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const membros = formData.getAll("membros[]").map(String).filter(isUuid);
  const { id, ...v } = parsed.data;
  if (v.criterio !== "qualquer" && !v.valor) return { error: "Informe o valor do critério.", fieldErrors: { valor: "Obrigatório para este critério" } };
  if (!membros.length && !v.departamento_id) return { error: "Escolha os membros ou o departamento que recebe.", fieldErrors: { membros: "Escolha quem recebe" } };
  const row = { ...v, ordem: v.ordem ?? 1, membros, valor: v.criterio === "ddd" ? onlyDigits(v.valor).slice(0, 2) : v.valor };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("distribuicao_regras").update(row).eq("id", id) : await supabase.from("distribuicao_regras").insert(row);
  if (error) return erroDb(error);
  atualizar();
  revalidatePath("/whatsapp/configuracao");
  return { ok: true, message: "Regra de distribuição salva." };
}

const formSchema = z.object({
  id: zs.uuid(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])$/, "Use letras minúsculas, números e hífen (3 a 60)"),
  titulo: zs.required("Título", 160),
  descricao: zs.text(1000),
  campanha: zs.text(200),
  interesses: zs.text(2000),
  pedir_documento: zs.bool(),
  pedir_renda: zs.bool(),
  mensagem_sucesso: zs.text(500),
  ativo: zs.bool(),
});

export async function salvarFormulario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.distribuir");
  if ("denied" in g) return g.denied;
  const parsed = formSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, interesses, ...v } = parsed.data;
  const row = { ...v, interesses: (interesses ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 30) };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("lead_formularios").update(row).eq("id", id) : await supabase.from("lead_formularios").insert(row);
  if (error) return error.code === "23505" ? { error: "Este endereço já está em uso.", fieldErrors: { slug: "Escolha outro" } } : erroDb(error);
  atualizar();
  return { ok: true, message: "Formulário salvo." };
}

const paginaSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 160),
  page_id: z.string().trim().regex(/^\d{5,30}$/, "ID da página inválido"),
  campanha_padrao: zs.text(200),
  token: zs.text(1000),
  ativo: zs.bool(),
});

/** Página do Facebook/Instagram para Lead Ads. O token fica criptografado e só o servidor lê. */
export async function salvarPaginaMeta(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.distribuir");
  if ("denied" in g) return g.denied;
  const parsed = paginaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, token, ...v } = parsed.data;
  if (!id && !token) return { error: "Informe o token de acesso da página.", fieldErrors: { token: "Obrigatório ao conectar" } };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("meta_paginas").update(v).eq("id", id).select("id, empresa_id").maybeSingle()
    : await supabase.from("meta_paginas").insert(v).select("id, empresa_id").single();
  if (error) return error.code === "23505" ? { error: "Esta página já está conectada a uma empresa." } : erroDb(error);
  if (!data) return { error: "Página não encontrada." };
  if (token) {
    const { error: e2 } = await createAdminClient().from("meta_pagina_tokens").upsert({ pagina_id: data.id, empresa_id: data.empresa_id, token_enc: encrypt(token), atualizado_em: new Date().toISOString() });
    if (e2) return dbError(e2);
  }
  atualizar();
  return { ok: true, message: "Página conectada. Assine o evento leadgen no aplicativo da Meta apontando para o webhook." };
}

const paramSchema = z.object({ sla_minutos: zs.number(1, 1440), max_redistribuicoes: zs.number(0, 10) });

export async function salvarParametrosLeads(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("leads.distribuir");
  if ("denied" in g) return g.denied;
  const parsed = paramSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const valor = { sla_minutos: Math.round(parsed.data.sla_minutos ?? 15), max_redistribuicoes: Math.round(parsed.data.max_redistribuicoes ?? 3) };
  const { error } = await supabase.from("configuracoes").upsert({ chave: "leads", valor, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  atualizar();
  return { ok: true, message: "Parâmetros salvos." };
}
