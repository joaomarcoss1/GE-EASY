import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { AREA_COOKIE, EMPRESA_COOKIE, cabecalhosBanco } from "@/lib/tenant";

export async function createClient(contexto?: { origem?: "web" | "app"; requestId?: string }) {
  const [cookieStore, reqHeaders] = await Promise.all([cookies(), headers()]);
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    // empresa ativa + contexto da auditoria (o banco confere o vínculo do usuário com a empresa)
    global: { headers: cabecalhosBanco(cookieStore.get(EMPRESA_COOKIE)?.value, cookieStore.get(AREA_COOKIE)?.value, reqHeaders, contexto) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado de um Server Component: o middleware renova a sessão.
        }
      },
    },
  });
}
