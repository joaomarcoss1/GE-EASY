import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/env";

/** Status da integração Google do usuário atual (RPC SECURITY DEFINER que não expõe tokens). */
export const getGoogleStatus = cache(async () => {
  const configured = googleConfigured();
  if (!configured) return { configured, connected: false, email: null as string | null, updatedAt: null as string | null };
  const supabase = await createClient();
  const { data } = await supabase.rpc("google_integracao_status");
  const row = (Array.isArray(data) ? data[0] : null) as { conectado?: boolean; google_email?: string | null; atualizado_em?: string | null } | null;
  return { configured, connected: Boolean(row?.conectado), email: row?.google_email ?? null, updatedAt: row?.atualizado_em ?? null };
});
