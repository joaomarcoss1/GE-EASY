import "server-only";
import { z } from "zod";
import { getSession, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/lib/rbac";
import type { ActionState } from "./types";

export type { ActionState };


export const initialState: ActionState = {};

/** Converte FormData em objeto simples; checkboxes vêm como "on". */
export function formToObject(formData: FormData) {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value !== "string") continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      (obj[k] = (obj[k] as string[] | undefined) ?? []);
      (obj[k] as string[]).push(value);
    } else {
      obj[key] = value;
    }
  }
  return obj;
}

// Helpers de schema para campos de formulário (strings vazias => null)
export const zs = {
  text: (max = 500) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional(),
  required: (label: string, max = 200) => z.string({ required_error: `${label} é obrigatório` }).trim().min(1, `${label} é obrigatório`).max(max),
  uuid: () => z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional().refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "Identificador inválido"),
  requiredUuid: (label: string) => z.string({ required_error: `Selecione ${label}` }).trim().regex(/^[0-9a-f-]{36}$/i, `Selecione ${label}`),
  money: () =>
    z.union([z.string(), z.number()]).optional().nullable().transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[R$\s.]/g, "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
        return z.NEVER;
      }
      return Math.round(n * 100) / 100;
    }),
  number: (min = 0, max = 1_000_000_000) =>
    z.union([z.string(), z.number()]).optional().nullable().transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Informe um número entre ${min} e ${max}` });
        return z.NEVER;
      }
      return n;
    }),
  date: () => z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida"),
  bool: () => z.union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")]).optional().transform((v) => v === "on" || v === "true"),
  enumOf: <T extends [string, ...string[]]>(values: T, msg = "Opção inválida") => z.enum(values, { errorMap: () => ({ message: msg }) }),
};

export function zodErrors(error: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = issue.path.join(".") || "_";
    if (!fieldErrors[k]) fieldErrors[k] = issue.message;
  }
  return { error: "Verifique os campos destacados.", fieldErrors };
}

/** Traduz erros do Postgres/PostgREST para mensagens amigáveis. */
export function dbError(error: { code?: string; message?: string } | null): ActionState {
  if (!error) return { error: "Erro desconhecido." };
  console.error("[db]", error.code, error.message);
  switch (error.code) {
    case "23505":
      return { error: "Já existe um registro com esses dados (duplicado)." };
    case "23503":
      return { error: "Este registro está vinculado a outros dados e não pode ser removido/alterado." };
    case "23514":
      return { error: "Algum valor está fora do permitido. Revise os campos." };
    case "42501":
      return { error: error.message?.startsWith("new row") ? "Você não tem permissão para esta operação." : error.message || "Sem permissão." };
    case "PGRST116":
      return { error: "Registro não encontrado ou sem acesso." };
    default:
      return { error: "Não foi possível salvar. Tente novamente." };
  }
}

/** Garante sessão ativa + permissão dentro de uma Server Action. */
export async function guard(permission?: Permission): Promise<{ session: Session } | { denied: ActionState }> {
  const session = await getSession();
  if (!session || !session.profile.active) return { denied: { error: "Sessão expirada. Entre novamente." } };
  if (permission && !can(session.profile.role, permission)) return { denied: { error: "Você não tem permissão para esta ação." } };
  return { session };
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/**
 * Limitador persistente por usuário (tabela rate_limits, vale entre instâncias do servidor).
 * Retorna um ActionState de erro quando o limite foi atingido; null quando pode seguir.
 */
export async function limitar(acao: string, max: number, janelaSeg: number): Promise<ActionState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_limit", { p_acao: acao, p_max: max, p_janela_seg: janelaSeg });
  if (error) {
    console.error("[rate_limit]", error.message);
    return { error: "Não foi possível validar a solicitação agora. Tente novamente em instantes." };
  }
  return data === true ? null : { error: "Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente." };
}

/** Registra na trilha de auditoria um acesso sensível (download, exportação, LGPD...). Nunca lança. */
export async function registrarAcesso(acao: string, tabela: string, registro: string | null, detalhes?: Record<string, unknown>) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("registrar_acesso", { p_acao: acao, p_tabela: tabela, p_registro: registro, p_detalhes: detalhes ?? null });
    if (error) console.error("[registrar_acesso]", error.message);
  } catch (e) {
    console.error("[registrar_acesso]", e instanceof Error ? e.message : e);
  }
}
