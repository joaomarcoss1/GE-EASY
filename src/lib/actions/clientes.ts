"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { TERMO_LGPD_VERSAO } from "@/app/(app)/clientes/fields";
import { createClient } from "@/lib/supabase/server";
import { isValidDocumento } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { dbError, excluirRegistro, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const clienteSchema = z
  .object({
    tipo_pessoa: zs.enumOf(["PF", "PJ"]),
    nome: zs.required("Nome", 200),
    documento: zs.text(20),
    rg: zs.text(30),
    data_nascimento: zs.date(),
    email: zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
    telefone: zs.text(20),
    whatsapp: zs.text(20),
    cep: zs.text(10),
    endereco: zs.text(200),
    numero: zs.text(20),
    complemento: zs.text(100),
    bairro: zs.text(100),
    cidade: zs.text(100),
    uf: zs.text(2),
    latitude: zs.number(-90, 90),
    longitude: zs.number(-180, 180),
    profissao: zs.text(100),
    renda_mensal: zs.money(),
    origem: zs.text(60),
    status: zs.enumOf(["lead", "ativo", "inativo"]),
    tags: zs.text(300),
    consultor_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    if (v.documento && !isValidDocumento(v.documento)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documento"], message: v.tipo_pessoa === "PF" ? "CPF inválido" : "CNPJ inválido" });
    }
  })
  .transform((v) => ({
    ...v,
    documento: v.documento ? onlyDigits(v.documento) : null,
    telefone: v.telefone ? onlyDigits(v.telefone) : null,
    whatsapp: v.whatsapp ? onlyDigits(v.whatsapp) : null,
    cep: v.cep ? onlyDigits(v.cep) : null,
    uf: v.uf ? v.uf.toUpperCase() : null,
    tags: v.tags ? v.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 15) : [],
  }));

const novoSchema = z.object({
  status_cadastro: zs.enumOf(["pre_cadastro", "pendente_documentacao"], "Situação inválida"),
  lgpd_consentimento: zs.bool(),
});

const CARTEIRA_LABEL: Record<string, string> = { consultor: "de um consultor", administrativo: "administrativa", juridico: "jurídica" };

/** Mensagem de duplicidade: diz onde o cliente está sem expor dados de outra carteira. */
async function mensagemDuplicado(documento: string | null): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = documento ? await supabase.rpc("verificar_documento_cliente", { p_documento: documento }) : { data: null };
  const v = (data ?? {}) as { existe?: boolean; acessivel?: boolean; carteira?: string; na_lixeira?: boolean; cliente_id?: string };
  const onde = v.na_lixeira ? "na lixeira (peça a restauração ao administrador)" : `na carteira ${CARTEIRA_LABEL[v.carteira ?? ""] ?? "de outro responsável"}`;
  const msg = v.acessivel ? "Este CPF/CNPJ já está cadastrado na sua lista de clientes." : `Este CPF/CNPJ já está cadastrado ${onde}. Solicite a transferência à gestão, se for o caso.`;
  return { error: msg, fieldErrors: { documento: "CPF/CNPJ já cadastrado" }, id: v.acessivel ? v.cliente_id : undefined };
}

export async function createCliente(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const form = formToObject(formData);
  const parsed = clienteSchema.safeParse(form);
  if (!parsed.success) return zodErrors(parsed.error);
  const novo = novoSchema.safeParse({ status_cadastro: form.status_cadastro ?? "pre_cadastro", lgpd_consentimento: form.lgpd_consentimento });
  if (!novo.success) return zodErrors(novo.error);
  if (!novo.data.lgpd_consentimento) return { error: "Registre o consentimento do titular para o tratamento dos dados.", fieldErrors: { lgpd_consentimento: "Obrigatório" } };
  const h = await headers();
  const data = {
    ...parsed.data,
    consultor_id: parsed.data.consultor_id ?? g.session.userId,
    status_cadastro: novo.data.status_cadastro,
    lgpd_consentimento_em: new Date().toISOString(),
    lgpd_termo_versao: TERMO_LGPD_VERSAO,
    lgpd_consentimento_origem: { usuario: g.session.userId, ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || null, canal: "sistema" },
  };
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("clientes").insert(data).select("id").single();
  if (error) return error.code === "23505" ? mensagemDuplicado(data.documento) : dbError(error);
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente cadastrado.", id: row.id };
}

export async function updateCliente(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Cliente inválido." };
  const parsed = clienteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("clientes").update(parsed.data).eq("id", id);
  if (error) return error.code === "23505" ? mensagemDuplicado(parsed.data.documento) : dbError(error);
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente atualizado.", id };
}

export async function deleteCliente(id: string): Promise<ActionState> {
  const g = await guard("clientes.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cliente inválido." };
  const falha = await excluirRegistro("clientes", id);
  if (falha) return falha;
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente movido para a lixeira." };
}

const interacaoSchema = z.object({
  cliente_id: zs.requiredUuid("o cliente"),
  tipo: zs.enumOf(["nota", "ligacao", "email", "whatsapp", "visita"]),
  descricao: zs.required("Descrição", 5000),
});

export async function addInteracao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = interacaoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("interacoes").insert({ ...parsed.data, autor_id: g.session.userId });
  if (error) return dbError(error);
  revalidatePath(`/clientes/${parsed.data.cliente_id}`);
  return { ok: true, message: "Registro adicionado ao histórico." };
}

export async function deleteInteracao(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Registro inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("interacoes").delete().eq("id", id).select("cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para remover este registro." };
  revalidatePath(`/clientes/${data.cliente_id}`);
  return { ok: true, message: "Registro removido." };
}
