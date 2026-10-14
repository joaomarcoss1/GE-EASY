"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isValidDocumento } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
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

export async function createCliente(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const parsed = clienteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = { ...parsed.data, consultor_id: parsed.data.consultor_id ?? g.session.userId };
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("clientes").insert(data).select("id").single();
  if (error) return error.code === "23505" ? { error: "Já existe um cliente com este CPF/CNPJ.", fieldErrors: { documento: "CPF/CNPJ já cadastrado" } } : dbError(error);
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
  if (error) return error.code === "23505" ? { error: "Já existe um cliente com este CPF/CNPJ.", fieldErrors: { documento: "CPF/CNPJ já cadastrado" } } : dbError(error);
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente atualizado.", id };
}

export async function deleteCliente(id: string): Promise<ActionState> {
  const g = await guard("clientes.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Cliente inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("clientes").delete({ count: "exact" }).eq("id", id);
  if (error) return error.code === "23503" ? { error: "O cliente possui consórcios ou seguros vinculados. Cancele-os ou inative o cliente." } : dbError(error);
  if (!count) return { error: "Sem permissão para excluir este cliente." };
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente excluído." };
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
