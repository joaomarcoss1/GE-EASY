"use client";
import { createBrowserClient } from "@supabase/ssr";
import { EMPRESA_COOKIE, cabecalhosBanco } from "@/lib/tenant";

export function createClient() {
  const empresa = typeof document === "undefined" ? undefined : document.cookie.match(new RegExp(`(?:^|; )${EMPRESA_COOKIE}=([^;]+)`))?.[1];
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: cabecalhosBanco(empresa, undefined) },
  });
}
