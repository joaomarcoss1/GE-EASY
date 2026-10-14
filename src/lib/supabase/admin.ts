import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

/**
 * Cliente com service role — ignora RLS. Use SOMENTE no servidor, depois de
 * verificar a autorização do usuário (requireRole) e para operações que o
 * RLS não cobre (convites de usuários, tokens de integração).
 */
export function createAdminClient() {
  const { serviceRoleKey } = serverEnv();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  return createClient(env.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const hasServiceRole = () => Boolean(serverEnv().serviceRoleKey);
