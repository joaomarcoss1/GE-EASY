"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isValidCNPJ } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { dbError, formToObject, guard, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const empresaSchema = z.object({
  nome: zs.required("Nome da empresa", 160),
  cnpj: zs.text(20).refine((v) => !v || isValidCNPJ(v), "CNPJ inválido"),
  telefone: zs.text(20),
  email: zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
  endereco: zs.text(300),
  site: zs.text(200).refine((v) => {
    if (!v) return true;
    try {
      return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.includes(".");
    } catch {
      return false;
    }
  }, "Site inválido"),
});

const comercialSchema = z.object({
  dias_alerta_renovacao: zs.number(1, 180).refine((v) => v !== null && Number.isInteger(v), "Informe um número inteiro de dias"),
});

async function saveConfig(chave: "empresa" | "comercial" | "app" | "ocr" | "lgpd_termo", patch: Record<string, unknown>, userId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data: current } = await supabase.from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
  const valor = { ...((current?.valor as Record<string, unknown> | null) ?? {}), ...patch };
  const { error } = await supabase.from("configuracoes").upsert({ chave, valor, updated_by: userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Configurações salvas." };
}

/** Admin: dados cadastrais da corretora (chave "empresa"). */
export async function updateEmpresa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = empresaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  return saveConfig(
    "empresa",
    {
      nome: v.nome,
      cnpj: v.cnpj ? onlyDigits(v.cnpj) : null,
      telefone: v.telefone ? onlyDigits(v.telefone) : null,
      email: v.email ? v.email.toLowerCase() : null,
      endereco: v.endereco,
      site: v.site && !/^https?:\/\//i.test(v.site) ? `https://${v.site}` : v.site,
    },
    g.session.userId,
  );
}

/** Admin: parâmetros comerciais (chave "comercial"). */
export async function updateComercial(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = comercialSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  return saveConfig("comercial", { dias_alerta_renovacao: parsed.data.dias_alerta_renovacao }, g.session.userId);
}

const appSchema = z.object({
  versao_minima: zs.text(20).refine((v) => !v || /^\d+\.\d+\.\d+$/.test(v), "Use o formato 1.0.0"),
  ocr_ativo: zs.bool(),
  termo_versao: zs.required("Versão do termo", 30),
  termo_texto: zs.required("Texto do termo", 4000),
});

/** App de campo: versão mínima, leitura automática de documentos (OCR, com custo por página) e termo LGPD do pré-cadastro. */
export async function salvarConfigApp(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("usuarios.manage");
  if ("denied" in g) return g.denied;
  const parsed = appSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  for (const [chave, patch] of [["app", { versao_minima: v.versao_minima }], ["ocr", { ativo: v.ocr_ativo }], ["lgpd_termo", { versao: v.termo_versao, texto: v.termo_texto }]] as const) {
    const r = await saveConfig(chave, patch, g.session.userId);
    if (!r.ok) return r;
  }
  return { ok: true, message: "Configurações do app salvas." };
}
