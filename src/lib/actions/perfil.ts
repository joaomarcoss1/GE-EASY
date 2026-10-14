"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { onlyDigits } from "@/lib/format";
import { env } from "@/lib/env";
import { dbError, formToObject, guard, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/** Mesmos hosts liberados no CSP (img-src): evita pixels de rastreamento e imagens quebradas. */
function isAllowedAvatar(v: string) {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return false;
    const supabaseHost = env.supabaseUrl ? new URL(env.supabaseUrl).host : "";
    return u.host === supabaseHost || u.hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

const perfilSchema = z.object({
  full_name: zs.required("Nome", 120).refine((v) => v.length >= 2, "Informe o nome completo"),
  phone: zs.text(20).refine((v) => !v || [10, 11].includes(onlyDigits(v).length), "Telefone inválido"),
  cargo: zs.text(80),
  avatar_url: zs.text(500).refine((v) => !v || isAllowedAvatar(v), "Use uma imagem https do Google (googleusercontent.com) ou do armazenamento do sistema"),
});

/** Atualiza SOMENTE as colunas seguras do próprio perfil (papel/status/comissão são protegidos no banco). */
export async function updateMeuPerfil(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const parsed = perfilSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { full_name, phone, cargo, avatar_url } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name, phone: phone ? onlyDigits(phone) : null, cargo, avatar_url })
    .eq("id", g.session.userId);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Perfil atualizado." };
}

/** Encerra a sessão em todos os dispositivos (revoga todos os refresh tokens do usuário). */
export async function encerrarTodasSessoes(): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) return { error: "Não foi possível encerrar as sessões. Tente novamente." };
  return { ok: true, message: "Todas as sessões foram encerradas. Entre novamente." };
}
