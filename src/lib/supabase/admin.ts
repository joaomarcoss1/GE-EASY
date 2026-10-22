import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

/**
 * Cliente com service role — ignora RLS (inclusive o isolamento entre empresas). Use SOMENTE no servidor,
 * depois de verificar a autorização do usuário, e SEMPRE filtrando/gravando o empresa_id da sessão
 * (convites de usuários, tokens de integração, rotinas agendadas).
 */
export function createAdminClient() {
  const { serviceRoleKey } = serverEnv();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  return createClient(env.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-geeasy-origem": "servidor" } },
  });
}

export const hasServiceRole = () => Boolean(serverEnv().serviceRoleKey);
