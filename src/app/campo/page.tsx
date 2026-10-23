import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { CampoApp } from "@/components/campo/campo-app";

export const dynamic = "force-dynamic";

/**
 * App de campo do consultor. A página não traz dados pessoais (o service worker guarda esta tela para o
 * modo offline); os dados vêm à parte e ficam criptografados no aparelho.
 */
export default async function CampoPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: app } = await supabase.from("configuracoes").select("valor").eq("chave", "app").maybeSingle();
  void session;
  return (
    <Suspense>
      <CampoApp inicial={null} vapidKey={env.vapidPublicKey} versaoMinima={(app?.valor as { versao_minima?: string } | null)?.versao_minima ?? null} />
    </Suspense>
  );
}
