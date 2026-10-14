"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isValidCNPJ } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const optionalEmail = () => zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido");
const optionalUrl = () =>
  zs.text(200).refine((v) => {
    if (!v) return true;
    try {
      return ["http:", "https:"].includes(new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).protocol);
    } catch {
      return false;
    }
  }, "Site inválido");

const parceiroSchema = z
  .object({
    tipo: zs.enumOf(["administradora", "seguradora"], "Selecione o tipo"),
    nome: zs.required("Nome", 160).refine((v) => v.length >= 2, "Nome muito curto"),
    cnpj: zs.text(20).refine((v) => !v || isValidCNPJ(v), "CNPJ inválido"),
    contato: zs.text(120),
    email: optionalEmail(),
    telefone: zs.text(20),
    site: optionalUrl(),
    comissao_padrao: zs.number(0, 100),
    ativo: zs.bool(),
  })
  .transform((v) => ({
    ...v,
    cnpj: v.cnpj ? onlyDigits(v.cnpj) : null,
    telefone: v.telefone ? onlyDigits(v.telefone) : null,
    site: v.site && !/^https?:\/\//i.test(v.site) ? `https://${v.site}` : v.site,
    comissao_padrao: v.comissao_padrao ?? 0,
  }));

const produtoSchema = z
  .object({
    parceiro_id: zs.uuid(),
    linha: zs.enumOf(["consorcio", "seguro"], "Selecione a linha"),
    categoria: zs.required("Categoria", 60),
    nome: zs.required("Nome", 160).refine((v) => v.length >= 2, "Nome muito curto"),
    descricao: zs.text(1000),
    comissao_percentual: zs.number(0, 100),
    ativo: zs.bool(),
  })
  .transform((v) => ({ ...v, comissao_percentual: v.comissao_percentual ?? 0 }));

function done(message: string, id?: string): ActionState {
  revalidatePath("/configuracoes");
  return { ok: true, message, id };
}

const dup = (e: { code?: string }) => (e.code === "23505" ? { error: "Já existe um parceiro com este nome e tipo.", fieldErrors: { nome: "Nome já cadastrado" } } : null);

export async function createParceiro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const parsed = parceiroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("parceiros").insert(parsed.data).select("id").single();
  if (error) return dup(error) ?? dbError(error);
  return done("Parceiro cadastrado.", data.id);
}

export async function updateParceiro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Parceiro inválido." };
  const parsed = parceiroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("parceiros").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) return dup(error) ?? dbError(error);
  if (!data) return { error: "Sem permissão para alterar este parceiro." };
  return done("Parceiro atualizado.", id);
}

export async function deleteParceiro(id: string): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Parceiro inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("parceiros").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Sem permissão para excluir este parceiro." };
  return done("Parceiro excluído. Negócios vinculados ficaram sem parceiro — considere apenas inativar.");
}

export async function createProduto(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const parsed = produtoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("produtos").insert(parsed.data).select("id").single();
  if (error) return dbError(error);
  return done("Produto cadastrado.", data.id);
}

export async function updateProduto(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Produto inválido." };
  const parsed = produtoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("produtos").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este produto." };
  return done("Produto atualizado.", id);
}

export async function deleteProduto(id: string): Promise<ActionState> {
  const g = await guard("cadastros.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Produto inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("produtos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Sem permissão para excluir este produto." };
  return done("Produto excluído.");
}
