"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Ciclo do cadastro do cliente (Fase 3): situação, documentação, prazo, carteira e encaminhamento.
 * As regras (transições permitidas, quem pode, prazos e histórico) estão no banco; aqui só validamos a
 * entrada, exigimos a funcionalidade e traduzimos os erros.
 */

const erroBanco = (e: { code?: string; message?: string }): ActionState =>
  e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row")) ? { error: e.message } : dbError(e);

function revalidarCliente(id?: string | null) {
  revalidatePath("/clientes");
  revalidatePath("/consultor");
  revalidatePath("/administrativo");
  revalidatePath("/administrativo/base");
  revalidatePath("/administrativo/documentacao");
  if (id) revalidatePath(`/clientes/${id}`);
}

async function mudarSituacao(id: string, para: string, extra: Record<string, unknown> = {}): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clientes").update({ status_cadastro: para, ...extra }).eq("id", id).select("id").maybeSingle();
  if (error) return erroBanco(error);
  if (!data) return { error: "Cliente não encontrado ou sem permissão." };
  revalidarCliente(id);
  return { ok: true, message: "Situação do cadastro atualizada.", id };
}

/** Pré-cadastro → documentação pendente (abre o prazo, se estiver na carteira de um consultor). */
export async function enviarParaDocumentacao(id: string): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cliente inválido." };
  return mudarSituacao(id, "pendente_documentacao");
}

/** Documentação completa → cliente ativo (análise documental ou gestão). */
export async function ativarCliente(id: string): Promise<ActionState> {
  const g = await guard("documentacao.analisar");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cliente inválido." };
  return mudarSituacao(id, "ativo");
}

const perdaSchema = z.object({ id: zs.requiredUuid("o cliente"), motivo_perda: zs.required("Motivo", 500) });

export async function marcarPerdido(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const parsed = perdaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  return mudarSituacao(parsed.data.id, "perdido", { motivo_perda: parsed.data.motivo_perda });
}

const prorrogarSchema = z.object({ id: zs.requiredUuid("o cliente"), dias: zs.number(1, 90), motivo: zs.required("Motivo", 500) });

export async function prorrogarDocumentacao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("documentacao.prorrogar");
  if ("denied" in g) return g.denied;
  const parsed = prorrogarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prorrogar_documentacao", { p_cliente: parsed.data.id, p_dias: parsed.data.dias, p_motivo: parsed.data.motivo });
  if (error) return erroBanco(error);
  revalidarCliente(parsed.data.id);
  return { ok: true, message: `Prazo prorrogado até ${new Date(data as string).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`, id: parsed.data.id };
}

const redistribuirSchema = z.object({
  ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).min(1, "Selecione ao menos um cliente").max(500),
  consultor_id: zs.uuid(),
  motivo: zs.required("Motivo", 500),
  devolucao: zs.bool(),
});

/** Redistribui (para um consultor ou para a base administrativa) um ou vários clientes. */
export async function redistribuirClientes(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.transfer");
  if ("denied" in g) return g.denied;
  const obj = formToObject(formData);
  const ids = Array.isArray(obj.ids) ? obj.ids : obj.id ? [obj.id] : [];
  const parsed = redistribuirSchema.safeParse({ ...obj, ids });
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redistribuir_clientes", {
    p_clientes: parsed.data.ids,
    p_consultor: parsed.data.consultor_id ?? null,
    p_motivo: parsed.data.motivo,
    p_devolucao: parsed.data.devolucao,
  });
  if (error) return erroBanco(error);
  parsed.data.ids.forEach((id) => revalidatePath(`/clientes/${id}`));
  revalidarCliente();
  return { ok: true, message: `${data ?? 0} cliente(s) ${parsed.data.consultor_id ? "atribuído(s) ao consultor" : "movido(s) para a base administrativa"}.` };
}

const AREAS_PROCESSO = ["civel", "consumidor", "trabalhista", "tributario", "previdenciario", "familia", "criminal", "administrativo", "empresarial", "bancario", "outro"] as const;
const encaminharSchema = z.object({
  cliente_id: zs.requiredUuid("o cliente"),
  titulo: zs.required("Assunto", 250),
  area: zs.enumOf([...AREAS_PROCESSO], "Selecione a área"),
  observacoes: zs.text(5000),
});

/** Encaminha o cliente ao jurídico: cria o processo/demanda com situação "encaminhado". */
export async function encaminharJuridico(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("juridico.encaminhar");
  if ("denied" in g) return g.denied;
  const parsed = encaminharSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("encaminhar_ao_juridico", {
    p_cliente: parsed.data.cliente_id,
    p_titulo: parsed.data.titulo,
    p_area: parsed.data.area,
    p_observacoes: parsed.data.observacoes ?? null,
  });
  if (error) return erroBanco(error);
  revalidarCliente(parsed.data.cliente_id);
  revalidatePath("/processos");
  return { ok: true, message: "Encaminhado ao jurídico.", id: data as string };
}

const analiseSchema = z.object({
  documento_id: zs.requiredUuid("o documento"),
  status: zs.enumOf(["em_analise", "aprovado", "recusado"], "Situação inválida"),
  motivo: zs.text(1000),
  validade: zs.date(),
});

/** Análise documental: aprovar / recusar (com motivo) / marcar em análise. */
export async function analisarDocumento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("documentacao.analisar");
  if ("denied" in g) return g.denied;
  const parsed = analiseSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.status === "recusado" && !parsed.data.motivo) return { error: "Informe o motivo da recusa.", fieldErrors: { motivo: "Obrigatório na recusa" } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("analisar_documento", {
    p_documento: parsed.data.documento_id,
    p_status: parsed.data.status,
    p_motivo: parsed.data.motivo ?? null,
    p_validade: parsed.data.validade ?? null,
  });
  if (error) return erroBanco(error);
  revalidarCliente();
  revalidatePath("/documentos");
  return { ok: true, message: parsed.data.status === "aprovado" ? "Documento aprovado." : parsed.data.status === "recusado" ? "Documento recusado; quem enviou foi avisado." : "Documento em análise." };
}

/** Atalho para aprovar sem abrir formulário. */
export async function aprovarDocumento(id: string): Promise<ActionState> {
  const fd = new FormData();
  fd.set("documento_id", id);
  fd.set("status", "aprovado");
  return analisarDocumento({}, fd);
}

// ---------------------------------------------------------------- Parâmetros e documentos exigidos

const parametrosSchema = z.object({
  prazo_dias: zs.number(5, 365),
  contagem: zs.enumOf(["corridos", "uteis"]),
  avisos: z.string().trim().max(60).regex(/^\s*\d{1,3}(\s*,\s*\d{1,3})*\s*$/, "Use números separados por vírgula (ex.: 15, 7, 3, 1)"),
  max_prorrogacoes: zs.number(0, 10),
  prorrogacao_dias: zs.number(1, 90),
  comissao_apos_transferencia: zs.bool(),
});

export async function salvarParametrosDocumentacao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const parsed = parametrosSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const avisos = [...new Set(v.avisos.split(",").map((a) => Number(a.trim())).filter((n) => n > 0 && n < (v.prazo_dias ?? 45)))].sort((a, b) => b - a);
  const supabase = await createClient();
  const { error } = await supabase
    .from("configuracoes")
    .upsert({ chave: "documentacao", valor: { ...v, avisos }, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Regra de documentação salva. Vale para os próximos prazos abertos." };
}

const tipoSchema = z.object({
  id: zs.uuid(),
  categoria: z.string().refine((c) => DOC_CATEGORIAS.some((o) => o.value === c), "Categoria inválida"),
  nome: zs.required("Nome", 120),
  obrigatorio: zs.bool(),
  aplica_pf: zs.bool(),
  aplica_pj: zs.bool(),
  validade_dias: zs.number(1, 3650),
  ativo: zs.bool(),
});

export async function salvarTipoDocumento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const parsed = tipoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  if (!v.aplica_pf && !v.aplica_pj) return { error: "Marque se vale para pessoa física, jurídica ou ambas." };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("documento_tipos").update(v).eq("id", id) : await supabase.from("documento_tipos").insert(v);
  if (error) return error.code === "23505" ? { error: "Já existe uma exigência para esta categoria.", fieldErrors: { categoria: "Categoria já usada" } } : dbError(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Documento exigido salvo." };
}
