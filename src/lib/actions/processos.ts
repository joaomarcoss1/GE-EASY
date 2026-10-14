"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cnjDigits, formatCNJ, isValidCNJ } from "@/lib/juridico/cnj";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const AREAS = ["civel", "consumidor", "trabalhista", "tributario", "previdenciario", "familia", "criminal", "administrativo", "empresarial", "bancario", "outro"] as const;
const FASES = ["pre_processual", "conhecimento", "recursal", "execucao", "cumprimento_sentenca", "acordo", "transito_julgado"] as const;
const STATUS = ["ativo", "suspenso", "arquivado", "encerrado"] as const;

const processoSchema = z
  .object({
    titulo: zs.required("Título", 250),
    numero_cnj: zs.text(30),
    numero_interno: zs.text(60),
    cliente_id: zs.uuid(),
    polo_cliente: zs.enumOf(["ativo", "passivo", "terceiro"]),
    parte_contraria: zs.text(250),
    area: zs.enumOf([...AREAS], "Selecione a área"),
    classe: zs.text(150),
    assunto: zs.text(250),
    tribunal: zs.text(60),
    orgao: zs.text(200),
    comarca: zs.text(120),
    uf: zs.text(2),
    instancia: zs.number(1, 4),
    fase: zs.enumOf([...FASES], "Selecione a fase"),
    status: zs.enumOf([...STATUS], "Selecione a situação"),
    risco: z.union([z.enum(["provavel", "possivel", "remoto"]), z.literal("")]).optional().transform((v) => v || null),
    valor_causa: zs.money(),
    valor_provisionado: zs.money(),
    data_distribuicao: zs.date(),
    resultado: zs.text(2000),
    segredo_justica: zs.bool(),
    link_autos: zs.text(500).refine((v) => !v || /^https:\/\//i.test(v), "Use um link https://"),
    departamento_id: zs.uuid(),
    responsavel_id: zs.uuid(),
    equipe: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).max(20).optional(),
    tags: zs.text(300),
    observacoes: zs.text(10000),
  })
  .superRefine((v, ctx) => {
    if (v.numero_cnj && cnjDigits(v.numero_cnj).length === 20 && !isValidCNJ(v.numero_cnj)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numero_cnj"], message: "Número CNJ inválido (dígito verificador não confere)" });
    } else if (v.numero_cnj && cnjDigits(v.numero_cnj).length !== 20) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numero_cnj"], message: "O número CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO)" });
    }
  })
  .transform((v) => ({
    ...v,
    numero_cnj: v.numero_cnj ? formatCNJ(v.numero_cnj) : null,
    uf: v.uf ? v.uf.toUpperCase() : null,
    instancia: v.instancia ?? 1,
    equipe: v.equipe ?? [],
    tags: v.tags ? v.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 15) : [],
  }));

function revalidateProcesso(id?: string, clienteId?: string | null) {
  revalidatePath("/processos");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/processos/${id}`);
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

function cnjDuplicate(error: { code?: string } | null): ActionState | null {
  return error?.code === "23505" ? { error: "Já existe um processo com este número CNJ.", fieldErrors: { numero_cnj: "Número já cadastrado" } } : null;
}

export async function createProcesso(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = processoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = { ...parsed.data, responsavel_id: parsed.data.responsavel_id ?? g.session.userId };
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("processos").insert(data).select("id").single();
  if (error) {
    if (error.code === "42501") return { error: "Você só pode cadastrar processos nos departamentos de que participa." };
    return cnjDuplicate(error) ?? dbError(error);
  }
  revalidateProcesso(row.id, data.cliente_id);
  return { ok: true, message: "Processo cadastrado.", id: row.id };
}

export async function updateProcesso(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Processo inválido." };
  const parsed = processoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("processos").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) return cnjDuplicate(error) ?? dbError(error);
  if (!row) return { error: "Você não tem permissão para editar este processo." };
  revalidateProcesso(id, parsed.data.cliente_id);
  return { ok: true, message: "Processo atualizado.", id };
}

export async function deleteProcesso(id: string): Promise<ActionState> {
  const g = await guard("processos.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Processo inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("processos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Sem permissão para excluir este processo." };
  revalidateProcesso();
  return { ok: true, message: "Processo excluído." };
}

/** Atualização rápida de fase/situação a partir do cabeçalho do processo. */
export async function setProcessoFaseStatus(id: string, campo: "fase" | "status", valor: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Processo inválido." };
  const allowed = campo === "fase" ? (FASES as readonly string[]) : (STATUS as readonly string[]);
  if (!allowed.includes(valor)) return { error: "Valor inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("processos").update({ [campo]: valor }).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este processo." };
  revalidateProcesso(id);
  return { ok: true, message: campo === "fase" ? "Fase atualizada." : "Situação atualizada." };
}

// ---------------------------------------------------------------- Partes

const parteSchema = z.object({
  processo_id: zs.requiredUuid("o processo"),
  tipo: zs.enumOf(["autor", "reu", "terceiro", "advogado_contrario", "perito", "testemunha"]),
  nome: zs.required("Nome", 200),
  documento: zs.text(20),
  oab: zs.text(30),
  contato: zs.text(200),
  observacoes: zs.text(2000),
});

export async function saveParte(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = parteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const id = formData.get("id");
  const supabase = await createClient();
  const q = isUuid(id) ? supabase.from("processo_partes").update(parsed.data).eq("id", id) : supabase.from("processo_partes").insert(parsed.data);
  const { data, error } = await q.select("id").maybeSingle();
  if (error) return error.code === "42501" ? { error: "Sem permissão para alterar este processo." } : dbError(error);
  if (!data) return { error: "Sem permissão para alterar este processo." };
  revalidatePath(`/processos/${parsed.data.processo_id}`);
  return { ok: true, message: "Parte salva." };
}

export async function deleteParte(id: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Registro inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("processo_partes").delete().eq("id", id).select("processo_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para remover." };
  revalidatePath(`/processos/${data.processo_id}`);
  return { ok: true, message: "Parte removida." };
}

// ---------------------------------------------------------------- Andamentos

const andamentoSchema = z.object({
  processo_id: zs.requiredUuid("o processo"),
  data: zs.date().refine((v) => !!v, "Informe a data"),
  tipo: zs.enumOf(["publicacao", "despacho", "decisao", "sentenca", "acordao", "peticao", "audiencia", "juntada", "citacao", "intimacao", "outro"]),
  descricao: zs.required("Descrição", 10000).refine((v) => v.length >= 2, "Descreva o andamento"),
});

export async function addAndamento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = andamentoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("processo_andamentos").insert({ ...parsed.data, autor_id: g.session.userId });
  if (error) return error.code === "42501" ? { error: "Sem permissão para registrar andamentos neste processo." } : dbError(error);
  // toca o processo para subir na lista de "atualizados recentemente"
  await supabase.from("processos").update({ updated_at: new Date().toISOString() }).eq("id", parsed.data.processo_id);
  revalidatePath(`/processos/${parsed.data.processo_id}`);
  return { ok: true, message: "Andamento registrado." };
}

export async function deleteAndamento(id: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Registro inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("processo_andamentos").delete().eq("id", id).select("processo_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Somente o autor ou a gestão podem remover este andamento." };
  revalidatePath(`/processos/${data.processo_id}`);
  return { ok: true, message: "Andamento removido." };
}

// ---------------------------------------------------------------- Financeiro do processo

const lancamentoSchema = z.object({
  processo_id: zs.requiredUuid("o processo"),
  tipo: zs.enumOf(["custas", "despesa", "honorarios_contratuais", "honorarios_sucumbenciais", "honorarios_exito", "acordo", "condenacao", "deposito_judicial"]),
  descricao: zs.text(300),
  valor: zs.money().refine((v) => v !== null && v > 0, "Informe o valor"),
  data: zs.date().refine((v) => !!v, "Informe a data"),
  vencimento: zs.date(),
  status: zs.enumOf(["previsto", "pago", "recebido", "cancelado"]),
});

export async function saveLancamento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.financeiro");
  if ("denied" in g) return g.denied;
  const parsed = lancamentoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const id = formData.get("id");
  const supabase = await createClient();
  const q = isUuid(id) ? supabase.from("processo_lancamentos").update(parsed.data).eq("id", id) : supabase.from("processo_lancamentos").insert(parsed.data);
  const { data, error } = await q.select("id").maybeSingle();
  if (error) return error.code === "42501" ? { error: "Sem permissão para lançar valores neste processo." } : dbError(error);
  if (!data) return { error: "Sem permissão para alterar este lançamento." };
  revalidatePath(`/processos/${parsed.data.processo_id}`);
  return { ok: true, message: "Lançamento salvo." };
}

export async function deleteLancamento(id: string): Promise<ActionState> {
  const g = await guard("processos.financeiro");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Registro inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("processo_lancamentos").delete().eq("id", id).select("processo_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para remover este lançamento." };
  revalidatePath(`/processos/${data.processo_id}`);
  return { ok: true, message: "Lançamento removido." };
}
